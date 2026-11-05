import { expect, it } from "vitest";
import { extractTokens } from "../../src/ai/drop";
import { privateMemberClaim } from "../../src/circle/privacy";
import { runTurn } from "../../src/ai/loop";
import { RecordedModel } from "../../src/ai/model";
import { TOOLS } from "../../src/ai/tools";
import { addMsg } from "../../src/circle/messages";
import { sendReminder } from "../../src/circle/reminders";
import { startCircle } from "../../src/circle/shares";
import { world } from "../helpers/world";

it("matches complete identities with accents and word boundaries", async () => {
  const w = await world();
  w.circle.members[0].name = "Member 1";
  w.circle.members[1].name = "Marisol Rivera";
  expect(extractTokens("Member 10 owes $100.", ["Member 1"]).some((t) => t.kind === "name")).toBe(false);
  for (const name of ["Member 1", "Marisol Rivera", "Amélie"]) {
    expect(privateMemberClaim(w.circle, "group", `${name} owes $100.`)).toBe(true);
    expect(privateMemberClaim(w.circle, "group", `${name}'s share is $100.`)).toBe(true);
    expect(privateMemberClaim(w.circle, "group", `${name}’s share is $100.`)).toBe(true);
    const member = w.circle.members.find((m) => m.name === name)!;
    expect(privateMemberClaim(w.circle, `member:${member.id}`, `${name} owes $100.`)).toBe(false);
  }
});

it("blocks a generated member name and amount in a grounded group reply", async () => {
  const w = await world();
  w.circle.members[0].name = "Member 1";
  await w.store.put("circle", w.circle);
  await startCircle(w.ctx);
  const model = new RecordedModel([JSON.stringify({ action: null, say: [{ to: "group", text: "Member 1 owes $100.", refs: ["call_1"] }] })]);
  const result = await runTurn(w.ctx, model, { role: "organiser" }, "status?");
  expect(result.said.some((m) => m.to === "group")).toBe(false);
});

it.each(["tool", "direct"])("checks the reminder recipient before PayPal delivery through %s", async (path) => {
  const w = await world();
  await startCircle(w.ctx);
  const text = "Marisol has $100 due.";
  if (path === "tool") {
    await TOOLS.find((t) => t.name === "draft_reminder")!.run(w.ctx, { role: "organiser" }, { member_id: "sam", round: 1, tone: "kind", reason: "due soon", text });
  } else await sendReminder(w.ctx, "sam", 1, { tone: "kind", reason: "due soon", note: text });
  const calls = w.sb.sent.filter((s) => s.path.endsWith("/remind"));
  expect(calls.every((s) => !JSON.stringify(s.body).includes("Marisol"))).toBe(true);
  if (path === "tool") expect(calls).toHaveLength(1);
  if (path === "direct") {
    expect(calls).toHaveLength(0);
    expect((await sendReminder(w.ctx, "marisol", 1, { tone: "kind", reason: "due soon", note: text })).ok).toBe(true);
  }
});

it.each(["group", "member:sam"])("checks privacy at the message delivery boundary for %s", async (to) => {
  const w = await world();
  const message = await addMsg(w.ctx, { to, from: "treasurer", kind: "notice", text: "Marisol owes a share. Please check the schedule." });
  expect(message.text).toBe("Please check the schedule.");
});

it.each(["Marisol is overdue.", "Marisol está atrasada.", "Marisol est en retard.", "La parte de Marisol pasó su fecha.", "La part de Marisol a dépassé sa date."])("protects a late debt status: %s", async (text) => {
  const w = await world();
  expect(privateMemberClaim(w.circle, "member:sam", text)).toBe(true);
});
