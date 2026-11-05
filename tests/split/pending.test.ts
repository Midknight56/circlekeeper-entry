import { expect, it } from "vitest";
import { getShare, startCircle } from "../../src/circle/shares";
import * as splits from "../../src/circle/split";
import { world } from "../helpers/world";

it("keeps an unfinished split pending and retries only its unsent part", async () => {
  const w = await world();
  await startCircle(w.ctx);
  const proposal = await splits.proposeSplit(w.ctx, 1, "keisha", 6000);
  w.sb.failInvoiceCreates(1, 400, 1);
  await splits.consentSplit(w.ctx, proposal.split!.id, "keisha", "yes");
  expect((await w.store.get<any>(`split:${proposal.split!.id}`)).status).toBe("pending");
  const messages = () => w.store.list<any>({ prefix: "msg:" }).then((m) => [...m.values()]);
  expect((await messages()).some((m) => m.text.startsWith("Your share is now two invoices"))).toBe(false);
  expect((await messages()).filter((m) => m.to === "group")).toHaveLength(0);
  expect((await messages()).some((m) => m.text === "Your share is being split. One part is not sent yet. Tap Try again.")).toBe(true);
  const parts = (await getShare(w.ctx, 1, "keisha"))!.parts.filter((p) => p.status !== "CANCELLED");
  expect([...(await w.store.list<any>({ prefix: "log:" })).values()].some((l) => l.note?.includes(parts[1].number) && l.note.includes("not sent"))).toBe(true);
  const creates = w.sb.calls("POST /v2/invoicing/invoices").filter((c) => c.path === "/v2/invoicing/invoices").length;
  expect((await splits.retrySplit(w.ctx, proposal.split!.id, "marisol")).ok).toBe(false);
  expect((await splits.retrySplit(w.ctx, proposal.split!.id, "keisha")).ok).toBe(true);
  expect(w.sb.calls("POST /v2/invoicing/invoices").filter((c) => c.path === "/v2/invoicing/invoices")).toHaveLength(creates + 1);
  expect((await w.store.get<any>(`split:${proposal.split!.id}`)).status).toBe("applied");
  expect((await getShare(w.ctx, 1, "keisha"))!.parts.filter((p) => p.status === "SENT")).toHaveLength(2);
  await splits.retrySplit(w.ctx, proposal.split!.id, "keisha");
  expect((await messages()).filter((m) => m.text.startsWith("Your share is now two invoices"))).toHaveLength(1);
  expect((await messages()).filter((m) => m.to === "group")).toHaveLength(1);
});

it("keeps the write guard on split retries and recovers an invoice whose send was held", async () => {
  const w = await world();
  await startCircle(w.ctx);
  const proposal = await splits.proposeSplit(w.ctx, 1, "keisha", 6000);
  let sends = 0;
  w.ctx.pp.beforeWrite = async (_method, path) => !path.endsWith("/send") || ++sends < 2;
  expect((await splits.consentSplit(w.ctx, proposal.split!.id, "keisha", "yes")).ok).toBe(false);
  const before = w.sb.sent.length;
  w.ctx.pp.beforeWrite = async () => false;
  expect((await splits.retrySplit(w.ctx, proposal.split!.id, "keisha")).ok).toBe(false);
  expect(w.sb.sent).toHaveLength(before);
  w.ctx.pp.beforeWrite = async () => true;
  const invoices = w.sb.invoices.size;
  expect((await splits.retrySplit(w.ctx, proposal.split!.id, "keisha")).ok).toBe(true);
  expect(w.sb.invoices.size).toBe(invoices);
  expect((await getShare(w.ctx, 1, "keisha"))!.parts.filter((p) => p.status === "SENT")).toHaveLength(2);
});
