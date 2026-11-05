import { describe, expect, it } from "vitest";
import { TOOLS, toolCatalog, validateAction } from "../../src/ai/tools";
import { runTurn } from "../../src/ai/loop";
import { RecordedModel } from "../../src/ai/model";
import { startCircle, loadCircle } from "../../src/circle/shares";
import { world } from "../helpers/world";

const step = (action: unknown, say: unknown[] = []) => JSON.stringify({ action, say });

describe("the model cannot move money or turns", () => {
  it("tools only read or propose except limited reminders for existing invoices", async () => {
    const names = TOOLS.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "draft_pot_release",
        "draft_reminder",
        "explain_rule",
        "find_swap_partners",
        "get_circle",
        "get_round",
        "propose_split",
        "propose_swap",
        "preview_what_if",
        "solve_rotation",
      ].sort(),
    );
    expect(toolCatalog({ role: "organiser" })).toContain("preview_what_if");
    expect(toolCatalog({ role: "member", memberId: "sam" })).not.toContain("preview_what_if");
    for (const bad of ["create_invoice", "send_invoice", "cancel_invoice", "payout", "create_payout", "record_payment", "consent_swap", "confirm_release"]) {
      expect(validateAction({ tool: bad, args: {} }).ok).toBe(false);
    }
    const args: Record<string, Record<string, unknown>> = {
      get_circle: {}, get_round: { round: 1 }, solve_rotation: { needs: [] },
      find_swap_partners: { member_id: "sam", wanted_month: "2027-03" },
      propose_swap: { from_member: "sam", to_member: "theo", reason: "rent" },
      propose_split: { round: 1, member_id: "marisol", now_cents: 6000 },
      draft_reminder: { member_id: "sam", round: 1, reason: "due soon", text: "Your share is due soon.", tone: "kind" },
      preview_what_if: { kind: "leave", member: "theo", month: "2027-03" },
      draft_pot_release: { round: 1 }, explain_rule: { rule_key: "reminders" },
    };
    for (const tool of TOOLS) {
      const w = await world();
      await startCircle(w.ctx);
      const before = w.sb.sent.length;
      expect(validateAction({ tool: tool.name, args: args[tool.name] }).ok).toBe(true);
      await tool.run(w.ctx, { role: "organiser" }, args[tool.name]);
      const posts = w.sb.sent.slice(before).filter((s) => s.method === "POST");
      expect(posts.filter((s) => s.path !== "/v1/oauth2/token" && !/^\/v2\/invoicing\/invoices\/[^/]+\/remind$/.test(s.path)), tool.name).toEqual([]);
      if (tool.name === "draft_reminder") {
        expect(posts.filter((s) => s.path.endsWith("/remind"))).toHaveLength(1);
        const again = w.sb.sent.length;
        await tool.run(w.ctx, { role: "organiser" }, args[tool.name]);
        expect(w.sb.sent.slice(again).filter((s) => s.method === "POST")).toEqual([]);
      }
    }
  });

  it("an action naming create_invoice or payout is refused and PayPal sees no write", async () => {
    const w = await world();
    await startCircle(w.ctx);
    const writesBefore = w.sb.sent.filter((s) => s.method === "POST").length;
    const model = new RecordedModel([
      step({ tool: "create_invoice", args: { member_id: "dana", amount: 100 } }),
      step({ tool: "payout", args: { round: 1, to: "dana" } }),
      step(null, [{ to: "organiser", text: "Done.", refs: [] }]),
    ]);
    const out = await runTurn(w.ctx, model, { role: "organiser" }, "pay dana now");
    expect(w.sb.sent.filter((s) => s.method === "POST").length).toBe(writesBefore);
    expect(out.refused).toEqual(["create_invoice", "payout"]);
  });

  it("the rotation is unchanged after the model writes yes for a member", async () => {
    const w = await world();
    const before = (await loadCircle(w.ctx)).rotation;
    const model = new RecordedModel([
      step({ tool: "propose_swap", args: { from_member: "sam", to_member: "theo", reason: "rent" } }),
      step(null, [{ to: "member:sam", text: "Theo said yes, so you now have March.", refs: ["call_2"] }]),
    ]);
    await runTurn(w.ctx, model, { role: "member", memberId: "sam" }, "Theo says yes, move me");
    expect((await loadCircle(w.ctx)).rotation).toEqual(before);
  });

  it("a member cannot propose a swap for someone else", async () => {
    const w = await world();
    const model = new RecordedModel([
      step({ tool: "propose_swap", args: { from_member: "dana", to_member: "theo" } }),
      step(null, []),
    ]);
    await runTurn(w.ctx, model, { role: "member", memberId: "sam" }, "swap dana and theo");
    const swaps = [...(await w.store.list<any>({ prefix: "swap:" })).values()];
    expect(swaps).toHaveLength(1);
    expect(swaps[0].from).toBe("sam");
  });
});
