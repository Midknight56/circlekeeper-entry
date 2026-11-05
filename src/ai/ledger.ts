// The neuron ledger. D1 `hackathon-ledger`, table ai_calls(app, day, neurons, at), shared by every hackathon app on
// the account. One INSERT ... SELECT ... WHERE checks both limits and charges in a single statement, so two calls at
// once cannot both slip under the cap.

import type { NeuronLedger } from "./model";

export class D1Ledger implements NeuronLedger {
  constructor(private db: D1Database, private now: () => Date = () => new Date()) {}

  async charge(app: string, day: string, neurons: number, appLimit: number, accountLimit: number): Promise<string | null> {
    const row = await this.db
      .prepare(
        `INSERT INTO ai_calls (app, day, neurons, at)
         SELECT ?1, ?2, ?3, ?4
         WHERE (SELECT COALESCE(SUM(neurons), 0) FROM ai_calls WHERE app = ?1 AND day = ?2) + ?3 <= ?5
           AND (SELECT COALESCE(SUM(neurons), 0) FROM ai_calls WHERE day = ?2) + ?3 <= ?6
         RETURNING id`,
      )
      .bind(app, day, neurons, this.now().toISOString(), appLimit, accountLimit)
      .first<{ id: number }>();
    return row ? String(row.id) : null;
  }

  async settle(id: string, neurons: number): Promise<void> {
    await this.db.prepare("UPDATE ai_calls SET neurons = ?1 WHERE id = ?2").bind(neurons, Number(id)).run();
  }

  async spent(app: string, day: string): Promise<number> {
    const row = await this.db
      .prepare("SELECT COALESCE(SUM(neurons), 0) AS n FROM ai_calls WHERE app = ?1 AND day = ?2")
      .bind(app, day)
      .first<{ n: number }>();
    return row?.n ?? 0;
  }
}

/** In memory, for tests and for local runs before the shared database exists. */
export class MemoryLedger implements NeuronLedger {
  rows: { id: string; app: string; day: string; neurons: number }[] = [];
  async charge(app: string, day: string, neurons: number, appLimit: number, accountLimit: number): Promise<string | null> {
    const mine = this.rows.filter((r) => r.app === app && r.day === day).reduce((a, r) => a + r.neurons, 0);
    const all = this.rows.filter((r) => r.day === day).reduce((a, r) => a + r.neurons, 0);
    if (mine + neurons > appLimit || all + neurons > accountLimit) return null;
    const id = String(this.rows.length + 1);
    this.rows.push({ id, app, day, neurons });
    return id;
  }
  async settle(id: string, neurons: number): Promise<void> {
    const r = this.rows.find((x) => x.id === id);
    if (r) r.neurons = neurons;
  }
  async spent(app: string, day: string): Promise<number> {
    return this.rows.filter((r) => r.app === app && r.day === day).reduce((a, r) => a + r.neurons, 0);
  }
}
