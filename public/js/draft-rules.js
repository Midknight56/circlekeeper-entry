import { el, money, monthLabel } from "/js/ui.js";
import { post } from "/js/api.js";
import { rulesSummary, showDraftRules } from "./rules-summary.js";

export { rulesSummary, showDraftRules };

// Keep edits while the board polls. Start awaits save(), so an unsaved control is never silently ignored.
export function draftRules(box, circleId, token, summaryBox) {
  let signature = "";
  let circle;
  let form;
  const controls = {};
  function field(label, name, node) {
    controls[name] = node;
    const wrap = el("label", label);
    wrap.append(node);
    form.append(wrap);
    return node;
  }
  function select(label, name, values, value) {
    const node = el("select");
    for (const [key, text] of values) {
      const option = el("option", text);
      option.value = key;
      node.append(option);
    }
    node.value = String(value);
    return field(label, name, node);
  }
  function number(label, name, value, min, max, step = "1") {
    const node = el("input");
    Object.assign(node, { type: "number", value: String(value), min: String(min), step, required: true });
    if (max !== undefined) node.max = String(max);
    return field(label, name, node);
  }
  const panel = {
    render(next) {
      const showDraft = showDraftRules(next);
      box.hidden = !showDraft;
      if (summaryBox) {
        summaryBox.hidden = showDraft;
        summaryBox.replaceChildren();
        if (!showDraft) {
          for (const line of rulesSummary(next)) summaryBox.append(el("p", line, "small"));
          summaryBox.append(el("p", next.demo ? "The demo rules are locked for the recorded run." : "The rules are locked after Start.", "small muted"));
        }
      }
      if (!showDraft) {
        box.replaceChildren();
        circle = next;
        form = null;
        signature = "";
        return;
      }
      const sameDraft = circle?.status === "draft" && next.status === "draft" && !next.demo;
      circle = next;
      const nextSignature = JSON.stringify([circle.status, circle.rules, circle.payDay, circle.unused, circle.brokenNeeds]);
      if (signature === nextSignature) return;
      if (sameDraft && form) return;
      signature = nextSignature;
      box.replaceChildren(el("h2", "Circle terms and rules"));
      box.append(el("p", `${circle.members.map((m) => m.name).join(", ")}. ${money(circle.shareCents)} each month from ${monthLabel(circle.startMonth)}. Pot: ${money(circle.shareCents * circle.members.length)}.`));
      for (const need of circle.needs) box.append(el("p", `${circle.members.find((m) => m.id === need.memberId)?.name}: ${({ want: "wants", avoid: "avoids", on_or_before: "needs by", on_or_after: "needs from" })[need.kind]} ${monthLabel(need.month)}.`, "small"));
      form = el("form", null, "stack");
      const rule = circle.rules;
      number("Pay day", "payDay", circle.payDay, 1, 28);
      select("Short shares", "allowed", [["true", "Allowed"], ["false", "Not allowed"]], rule.shortShare.allowed);
      number("Minimum amount now", "minimum", rule.shortShare.minNowCents / 100, 0.01, (circle.shareCents - 1) / 100, "0.01");
      form.append(el("p", `The rest is due within ${rule.shortShare.laterDays} days after the share due date, or after today if that date has passed.`, "small muted"));
      select("Missed share action", "missed", [["move_to_end", "Move to the end"], ["pot_waits", "The pot waits"]], rule.missed.action);
      number("Grace days", "grace", rule.missed.graceDays, 0);
      select("Privacy", "privacy", [["true", "Amounts private"], ["false", "Amounts shared"]], rule.privacy);
      const members = circle.members.map((m) => [m.id, m.name]);
      select("First confirmer", "first", members, rule.confirmers[0]);
      select("Second confirmer", "second", members, rule.confirmers[1]);
      box.append(el("p", "Choose the rules before Start. Start saves these choices and locks the rules.", "small muted"));
      form.addEventListener("submit", (event) => event.preventDefault());
      const feedback = el("p", "", "small muted");
      form.append(feedback);
      form.addEventListener("change", async () => {
        feedback.textContent = "Saving rules.";
        try { await panel.save(); feedback.textContent = "Rules saved."; }
        catch (error) { feedback.textContent = error.message; }
      });
      box.append(form);
      if (circle.brokenNeeds?.length) {
        box.append(el("h3", "Needs we could not meet:"));
        for (const need of circle.brokenNeeds) box.append(el("p", need, "small"));
        box.append(el("p", "Start keeps the rotation shown.", "small muted"));
      }
      if (circle.unused?.length) {
        box.append(el("h3", "Not used:"));
        for (const sentence of circle.unused) box.append(el("p", sentence, "small"));
        const accept = el("input");
        Object.assign(accept, { type: "checkbox", checked: false });
        const label = el("label", "I accept leaving out the text listed above.");
        label.append(accept);
        controls.acceptUnused = accept;
        box.append(label);
      } else {
        delete controls.acceptUnused;
      }
    },
    async save() {
      if (circle.demo) return;
      if (controls.acceptUnused && !controls.acceptUnused.checked) throw new Error("Review the unused text. Accept leaving it out before Start.");
      if (!form.reportValidity()) throw new Error("Check the rules before Start.");
      const rules = {
        payDay: Number(controls.payDay.value),
        privacy: controls.privacy.value === "true",
        shortShare: { ...circle.rules.shortShare, allowed: controls.allowed.value === "true", minNowCents: Math.round(Number(controls.minimum.value) * 100) },
        missed: { action: controls.missed.value, graceDays: Number(controls.grace.value) },
        confirmers: [controls.first.value, controls.second.value],
        acceptUnused: controls.acceptUnused?.checked === true,
      };
      await post(`/api/circles/${circleId}/rules`, { k: token, rules });
    },
  };
  return panel;
}
