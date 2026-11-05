// The Hub: one Durable Object for the whole app. It owns the index from PayPal ids to circles, the webhook dedupe,
// the per visitor and per day counters, and the neuron ledger until the shared D1 database is bound.
// One object, so every counter is exact (no eventual consistency).

import { DurableObject } from "cloudflare:workers";

export class HubDO extends DurableObject {
  async index(kind: string, id: string, circleId: string): Promise<void> {
    await this.ctx.storage.put(`idx:${kind}:${id}`, circleId);
  }

  async lookup(kind: string, id: string): Promise<string | undefined> {
    return this.ctx.storage.get<string>(`idx:${kind}:${id}`);
  }

  async firstSeen(eventId: string): Promise<boolean> {
    const k = `evt:${eventId}`;
    if (await this.ctx.storage.get(k)) return false;
    await this.ctx.storage.put(k, Date.now());
    return true;
  }

  /** Adds one to a counter if it is under the limit. */
  async take(key: string, limit: number, by = 1): Promise<boolean> {
    const k = `cap:${key}`;
    const v = (await this.ctx.storage.get<number>(k)) || 0;
    if (v + by > limit) return false;
    await this.ctx.storage.put(k, v + by);
    return true;
  }

  async count(key: string): Promise<number> {
    return (await this.ctx.storage.get<number>(`cap:${key}`)) || 0;
  }

  // The neuron ledger, same rules as the D1 one.
  async ledgerCharge(app: string, day: string, neurons: number, appLimit: number, accountLimit: number): Promise<string | null> {
    const rows = await this.ctx.storage.list<{ app: string; neurons: number }>({ prefix: `neu:${day}:` });
    let mine = 0;
    let all = 0;
    for (const r of rows.values()) {
      all += r.neurons;
      if (r.app === app) mine += r.neurons;
    }
    if (mine + neurons > appLimit || all + neurons > accountLimit) return null;
    const id = `neu:${day}:${Date.now()}:${crypto.randomUUID().slice(0, 8)}`;
    await this.ctx.storage.put(id, { app, neurons });
    return id;
  }

  async ledgerSettle(id: string, neurons: number): Promise<void> {
    const r = await this.ctx.storage.get<{ app: string; neurons: number }>(id);
    if (r) await this.ctx.storage.put(id, { ...r, neurons });
  }

  async ledgerSpent(app: string, day: string): Promise<number> {
    const rows = await this.ctx.storage.list<{ app: string; neurons: number }>({ prefix: `neu:${day}:` });
    let n = 0;
    for (const r of rows.values()) if (r.app === app) n += r.neurons;
    return Math.round(n * 100) / 100;
  }

  async registerCircle(id: string, demo: boolean): Promise<void> {
    await this.ctx.storage.put(`circle:${id}`, { at: Date.now(), demo });
  }

  async listCircles(): Promise<string[]> {
    const rows = await this.ctx.storage.list({ prefix: "circle:" });
    return [...rows.keys()].map((k) => k.slice("circle:".length));
  }

  async forgetCircle(id: string): Promise<void> {
    await this.ctx.storage.delete(`circle:${id}`);
  }

  /** Daily tidy: webhook ids older than 30 days, counters older than 3 days. */
  async tidy(now = Date.now()): Promise<number> {
    let n = 0;
    const evts = await this.ctx.storage.list<number>({ prefix: "evt:" });
    for (const [k, at] of evts) if (now - at > 30 * 86400_000) n += (await this.ctx.storage.delete(k)) ? 1 : 0;
    const cutoff = new Date(now - 3 * 86400_000).toISOString().slice(0, 10);
    for (const prefix of ["cap:", "neu:"]) {
      const rows = await this.ctx.storage.list({ prefix });
      for (const k of rows.keys()) {
        const day = /(\d{4}-\d{2}-\d{2})/.exec(k)?.[1];
        if (day && day < cutoff) n += (await this.ctx.storage.delete(k)) ? 1 : 0;
      }
    }
    return n;
  }
}
