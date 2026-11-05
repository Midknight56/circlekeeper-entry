import type { Store } from "./model";

export interface WebhookRecord {
  id: string;
  at: string;
  eventType: string;
  resourceId: string;
  verified: "SUCCESS";
  duplicates: number;
}

const KEY = "webhooks";

export async function recordWebhook(store: Store, record: Omit<WebhookRecord, "duplicates">): Promise<void> {
  const rows = await store.get<WebhookRecord[]>(KEY) || [];
  if (rows.some((row) => row.id === record.id)) return;
  await store.put(KEY, [...rows, { ...record, duplicates: 0 }].slice(-50));
}

export async function countWebhookDuplicate(store: Store, id: string): Promise<void> {
  const rows = await store.get<WebhookRecord[]>(KEY) || [];
  const index = rows.findIndex((row) => row.id === id);
  if (index < 0) return;
  rows[index] = { ...rows[index], duplicates: rows[index].duplicates + 1 };
  await store.put(KEY, rows);
}
