import { post, pollState } from "/js/api.js";
import { createScheduleView } from "/js/schedule-loader.js";
import { el, money, monthLabel, dayLabel, timeLabel, bindChat, renderChat, renderSuggestions, keepFocus } from "/js/ui.js";
import { words } from "/js/i18n.js";
import { guardRows } from "/js/guard-panel.js";
import { draftRules, showDraftRules } from "/js/draft-rules.js";
import { balanceLines } from "/js/share-balance.js";
import { nextAction, refusalText } from "/js/next-action.js";

const id = location.pathname.split("/").filter(Boolean).pop() || "";
const k = new URLSearchParams(location.search).get("k") || "";
let schedule = null;
const notice = document.querySelector("#notice");
let state = null;
let filter = "all";
let guardResult = [];
const rulesPanel = draftRules(document.querySelector("#draft-rules"), id, k, document.querySelector("#rules-card"));
const seenSwaps = new Set();

for (const toggle of document.querySelectorAll(".diagnostic-toggle")) {
  const content = document.getElementById(toggle.getAttribute("aria-controls"));
  const label = toggle.textContent.replace(/^Show /, "");
  const expand = (open) => {
    content.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    toggle.textContent = `${open ? "Hide" : "Show"} ${label}`;
  };
  expand(false);
  toggle.addEventListener("click", () => expand(toggle.getAttribute("aria-expanded") !== "true"));
}

const PAID = ["PAID", "MARKED_AS_PAID", "COMPLETED"];

const askSwap = async (from, to) => {
  notice.textContent = `Asking ${nameOf(from)} and ${nameOf(to)}…`;
  try {
    await post(`/api/circles/${id}/swaps`, { k, from, to });
    notice.textContent = `Asked ${nameOf(from)} and ${nameOf(to)}. Nothing moves until both say yes.`;
  } catch (error) {
    notice.textContent = error.message;
  }
};

async function act(button, fn) {
  button.disabled = true;
  notice.textContent = "";
  try {
    await fn();
  } catch (error) {
    notice.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

function button(label, fn, cls = "") {
  const b = el("button", label, cls);
  b.type = "button";
  b.addEventListener("click", () => act(b, fn));
  return b;
}

const nameOf = (memberId) => state.circle.members.find((m) => m.id === memberId)?.name || memberId;

function currentRound() {
  return state.rounds.find((r) => r.pot.status !== "paid") || state.rounds[state.rounds.length - 1];
}

function renderRoundStrip() {
  const box = document.querySelector("#round-strip");
  box.replaceChildren();

  const action = nextAction(state);
  const nextBlock = el("div", null, "next-action stack");
  nextBlock.setAttribute("role", "status");
  nextBlock.setAttribute("aria-live", "polite");
  nextBlock.append(el("div", action.title, "next-title"));
  if (action.detail) nextBlock.append(el("p", action.detail, "next-detail muted"));

  if (state.circle.status === "draft") {
    box.append(nextBlock);
    box.append(button("Start the circle", async () => {
      await rulesPanel.save();
      await post(`/api/circles/${id}/start`, { k });
    }, "primary"));
    return;
  }

  if (action.members && action.members.length > 0) {
    const memberActions = el("div", null, "next-actions");
    for (const memberId of action.members) {
      const link = (state.memberLinks || []).find((l) => (l.memberId || l.id) === memberId);
      const a = el("a", `Open ${nameOf(memberId)}'s page`, "button small");
      a.href = link ? link.url : "#";
      a.target = "_blank";
      a.rel = "noopener";
      memberActions.append(a);
    }
    nextBlock.append(memberActions);
  }
  box.append(nextBlock);

  const r = currentRound();
  const left = el("div", null, "round-overview");
  left.append(el("div", `Round ${r.round} of ${state.rounds.length} · ${monthLabel(r.month)}`, "muted small"));
  left.append(el("div", `${money(r.pot.cents)} to ${nameOf(r.recipientId)}`, "round-payout"));
  const progress = el("div", null, "stack");
  const totals = el("div", null, "row between small");
  const paid = r.shares.filter((s) => s.state === "paid").length;
  const cents = r.shares.flatMap((s) => s.parts).filter((p) => p.status !== "CANCELLED" && PAID.includes(p.status)).reduce((sum, p) => sum + p.cents, 0);
  totals.append(el("span", `${paid} of ${state.circle.members.length} paid`), el("span", `${money(cents)} of ${money(r.pot.cents)}`, "amount"));
  const bar = el("div", null, "bar");
  bar.setAttribute("role", "progressbar");
  bar.setAttribute("aria-valuenow", String(cents));
  bar.setAttribute("aria-valuemin", "0");
  bar.setAttribute("aria-valuemax", String(r.pot.cents));
  bar.setAttribute("aria-label", "Money in this round");
  const fill = el("div");
  fill.style.width = `${r.pot.cents ? Math.min(100, cents / r.pot.cents * 100) : 0}%`;
  bar.append(fill);
  progress.append(totals, bar);
  const right = el("div", null, "stack");
  const steps = el("ol", null, "steps");
  const current = { waiting: 0, drafted: 1, paying: 2, paid: 3, failed: 2 }[r.pot.status];
  ["Shares in", "Two confirm", "Paid out"].forEach((label, index) => {
    const item = el("li", null, index < current ? "done" : index === current ? `now${r.pot.status === "failed" ? " late" : ""}` : "");
    if (index === current) item.setAttribute("aria-current", "step");
    const dot = el("span", null, "step-dot");
    dot.setAttribute("aria-hidden", "true");
    item.append(dot, el("span", index === 1 && current === 1 ? `${label} · ${r.pot.confirmations.length} of 2` : label));
    steps.append(item);
  });
  const confirmers = state.circle.rules.confirmers.map(nameOf).join(" and ");
  if (r.pot.status === "drafted" && r.pot.waitUntil > state.now.slice(0, 10)) right.append(el("p", words.en.canGoOn(dayLabel(r.pot.waitUntil, "en")), "small muted"));
  right.append(steps, el("p", `${confirmers} confirm${r.pot.payoutBatchId ? ` · payout batch ${r.pot.payoutBatchId}${r.pot.itemStatus ? ` · ${r.pot.itemStatus}` : ""}` : ""}`, "small muted"));
  if (r.pot.status === "failed") {
    const refusal = r.pot.refusal;
    const text = refusalText(refusal);
    right.append(el("p", text, "small"));
    if (refusal !== "CHECK_BY_HAND") right.append(button("Try the payout again", () => post(`/api/circles/${id}/rounds/${r.round}/release/retry`, { k })));
  }
  if (r.pot.status === "paying" && r.pot.retrying) right.append(el("p", "PayPal did not answer. We are trying again by ourselves. Nothing is sent twice.", "small"));
  box.append(left, progress, right);
}

function renderRound() {
  const box = document.querySelector("#round");
  box.replaceChildren();
  box.closest("section").hidden = state.circle.status === "draft";
  if (state.circle.status === "draft") return;
  const r = currentRound();
  const list = el("div", null, "share-list");
  const members = [...state.circle.members].sort((a, b) => Number(r.shares.find((s) => s.memberId === a.id)?.state === "paid") - Number(r.shares.find((s) => s.memberId === b.id)?.state === "paid"));
  for (const m of members) {
    const s = r.shares.find((x) => x.memberId === m.id);
    const row = el("div", null, "share-row controls");
    const initials = el("span", m.name.charAt(0).toUpperCase(), "initials");
    initials.setAttribute("aria-hidden", "true");
    const details = el("div", null, "share-details");
    details.append(el("div", m.name, "who"));
    const parts = (s?.parts || []).filter((p) => p.status !== "CANCELLED");
    const amounts = el("div", null, "share-amounts amount");
    for (const p of parts.length ? parts : [null]) {
      const status = !p ? "none" : PAID.includes(p.status) ? "paid" : s.reminded ? "reminded" : "sent";
      const line = el("div", null, `share-status small ${status}`);
      const dot = el("span", null, "dot");
      dot.setAttribute("aria-hidden", "true");
      line.append(dot, el("span", status === "none" ? "not sent" : status));
      details.append(line);
      amounts.append(el("div", money(p ? p.cents : state.circle.shareCents)));
    }
    if (parts.length > 1) amounts.classList.add("split-amounts");
    for (const line of balanceLines(s, "en")) details.append(el("p", line, "small"));
    row.append(initials, details, amounts);
    if (s && s.state !== "paid" && s.parts.some((p) => p.invoiceId && !PAID.includes(p.status) && p.status !== "CANCELLED")) {
      row.append(button("Record cash", () => post(`/api/circles/${id}/shares/${r.round}/${m.id}/cash`, { k }), "small quiet"));
    }
    list.append(row);
  }
  box.append(list);
}

function renderGuard() {
  const action = document.querySelector("#guard-action");
  if (!action.querySelector("button")) {
    action.append(button("Run the three isolated checks", async () => {
      const result = await post(`/api/circles/${id}/guard`, { k });
      guardResult = result.rows || [];
      renderGuard();
    }, "primary"));
  }
  const box = document.querySelector("#guard-results");
  box.replaceChildren();
  for (const row of guardRows(guardResult)) {
    const item = el("article", null, "stack");
    item.append(el("h3", row.attack));
    item.append(el("p", row.result.charAt(0).toUpperCase() + row.result.slice(1), "big"));
    item.append(el("p", `PayPal writes: ${row.paypalWrites}`));
    item.append(el("p", `Tried: ${row.tried}`));
    item.append(el("p", row.stoppedBy));
    for (const attempt of row.attempted || []) item.append(el("p", `${attempt.method} ${attempt.path}: ${attempt.items.map((item) => `${item.receiver} $${item.amount}`).join(", ")}`));
    box.append(item);
  }
}

function renderPending() {
  const box = document.querySelector("#pending");
  box.replaceChildren();
  const open = [
    ...state.swaps.filter((s) => s.status === "asked").map((s) => {
      const fromName = nameOf(s.from);
      const toName = nameOf(s.to);
      const fromMonth = monthLabel(s.why?.fromMonth || state.circle.rotation.find((r) => r.round === s.fromRound)?.month, "en");
      const toMonth = monthLabel(s.why?.toMonth || state.circle.rotation.find((r) => r.round === s.toRound)?.month, "en");
      const trade = `Swap: ${fromName} ${fromMonth} and ${toName} ${toMonth} would trade turns.`;
      const kept = s.why?.needsKept?.length ? `Still true: ${s.why.needsKept.map((n) => n.text).join(", ")}.` : "No stated needs are affected.";
      const yesSoFar = Object.keys(s.consents || {}).filter((x) => s.consents[x] === "yes").map(nameOf).join(", ") || "nobody";
      const votes = `Both must say yes. Yes so far: ${yesSoFar}.`;
      return `${trade} ${kept} ${votes}`;
    }),
    ...state.splits.filter((s) => s.status === "proposed").map((s) => `Short share: ${nameOf(s.memberId)}, ${money(s.nowCents)} now and ${money(s.laterCents)} later. Waiting for ${nameOf(s.memberId)}.`),
  ];
  document.querySelector("#pending-card").hidden = open.length === 0;
  for (const line of open) box.append(el("p", line));
}

// In by invoice, out by payout: one line per round whose pot was sent.
function renderSettlements() {
  const list = state.settlements || [];
  document.querySelector("#settle-card").hidden = list.length === 0;
  const box = document.querySelector("#settlements");
  box.replaceChildren();
  for (const s of list) {
    const row = el("div", null, "settlement-row");
    const details = el("div", null, "settlement-details");
    details.append(el("div", `Round ${s.round}`, "who"));
    details.append(el("p", `${money(s.paidCents)} in by invoice`, "small muted"));
    details.append(el("p", `${money(s.paidOutCents)} out by payout`, "small muted"));
    if (s.payoutBatchId) details.append(el("p", `Payout batch ${s.payoutBatchId}${s.itemStatus ? " · " + s.itemStatus : ""}`, "small muted"));
    row.append(details);
    row.append(el("span", s.balanced ? "balanced" : s.unpaid.length ? `waiting: ${s.unpaid.map(nameOf).join(", ")}` : "payout pending", `pill ${s.balanced ? "paid" : "held"}`));
    box.append(row);
  }
  const links = document.querySelector("#receipt-links");
  links.replaceChildren();
  for (const receipt of state.receipts || []) {
    const a = el("a", `Round ${receipt.round} receipt`, "button small");
    a.href = `/receipt?c=${encodeURIComponent(id)}&k=${encodeURIComponent(k)}&r=${receipt.round}`;
    links.append(a);
  }
}

function renderChanges() {
  const box = document.querySelector("#changes");
  box.replaceChildren();
  if (!state.changes.length) box.append(el("p", "No changes yet.", "muted"));
  for (const c of [...state.changes].reverse()) box.append(el("div", c.at ? `${c.text}, ${timeLabel(c.at)}` : c.text, "change-line"));
}

function renderLinks() {
  const box = document.querySelector("#member-links");
  box.replaceChildren();
  for (const m of state.memberLinks || []) {
    const a = el("a", `${m.name}'s view`, "button small");
    a.href = m.url;
    a.target = "_blank";
    a.rel = "noopener";
    box.append(a);
  }
}

function renderMissedAction() {
  const box = document.querySelector("#missed-action");
  box.replaceChildren();
  box.hidden = !state.circle.demo;
  if (!state.circle.demo) return;
  const current = state.rounds.find((r) => r.pot.status !== "paid");
  if (current?.pot.waitUntil > state.now.slice(0, 10)) {
    box.append(button("Skip to the agreed date", async () => {
      const result = await post(`/api/circles/${id}/demo/skip-to-wait`, { k });
      box.querySelector(".demo-date")?.remove();
      box.append(el("span", `Demo date ${result.demoDate || ""}.`, "demo-date muted"));
    }, "small"));
  }
  box.append(button("Skip to the due date", async () => {
    const result = await post(`/api/circles/${id}/missed/check`, { k });
    box.querySelector(".demo-date")?.remove();
    const said = result.proposed ? "The confirmers have been asked." : "No share is late.";
    box.append(el("span", `Demo date ${result.demoDate || ""}. ${said}`, "demo-date muted"));
  }, "small"));
}

function viewerLanguage() {
  const language = (navigator.language || "en").slice(0, 2).toLowerCase();
  return ["es", "fr"].includes(language) ? language : "en";
}

function fillOptions(select, options, selected) {
  const value = selected || select.value;
  select.replaceChildren(...options.map((item) => {
    const option = el("option", item.label);
    option.value = item.value;
    option.selected = item.value === value;
    return option;
  }));
}

function syncWhatIfKind() {
  const joining = document.querySelector("#whatif-kind").value === "join";
  document.querySelector("#whatif-member-wrap").hidden = joining;
  document.querySelector("#whatif-month-wrap").hidden = joining;
  document.querySelector("#whatif-name-wrap").hidden = !joining;
}

document.querySelector("#whatif-kind").addEventListener("change", syncWhatIfKind);
document.querySelector("#whatif-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const buttonNode = form.querySelector("button");
  const kind = document.querySelector("#whatif-kind").value;
  const change = kind === "join"
    ? { kind, name: document.querySelector("#whatif-name").value.trim() }
    : { kind: "leave", memberId: document.querySelector("#whatif-member").value, month: document.querySelector("#whatif-month").value };
  if (kind === "join" && !change.name) return;
  act(buttonNode, async () => {
    await post(`/api/circles/${id}/whatif`, { k, change });
  });
});

function renderWhatIf() {
  const memberSelect = document.querySelector("#whatif-member");
  const monthSelect = document.querySelector("#whatif-month");
  fillOptions(memberSelect, state.circle.members.map((member) => ({ value: member.id, label: member.name })));
  fillOptions(monthSelect, state.rounds.map((round) => ({ value: round.month, label: monthLabel(round.month) })));
  syncWhatIfKind();
  const preview = state.whatIf;
  const lang = viewerLanguage();
  const lines = document.querySelector("#whatif-lines");
  const moneyLines = document.querySelector("#whatif-money");
  const actions = document.querySelector("#whatif-actions");
  lines.replaceChildren();
  moneyLines.replaceChildren();
  actions.replaceChildren();
  if (!preview) return;
  for (const text of preview.lines?.[lang] || preview.lines?.en || []) lines.append(el("p", text));
  for (const text of preview.money?.[lang] || preview.money?.en || []) moneyLines.append(el("p", text, "small muted"));
  if (preview.broken?.length) {
    const brokenLine = {
      en: "This need does not fit the open turns.",
      es: "Esta necesidad no cabe en los turnos libres.",
      fr: "Ce besoin ne convient pas aux tours libres.",
    };
    lines.append(el("p", brokenLine[lang], "error"));
  }
  actions.append(button("Clear", async () => post(`/api/circles/${id}/whatif/clear`, { k })));
}

function logText(entry) {
  if (entry.kind === "paypal") {
    const ids = (entry.ids || []).join(", ");
    const err = entry.errorName ? ` · ${entry.errorName}` : "";
    return `${entry.method} ${entry.path} · HTTP ${entry.status}${ids ? " · " + ids : ""}${err}`;
  }
  if (entry.kind === "tool") return `${entry.tool}${entry.callId ? " (" + entry.callId + ")" : ""}: ${entry.note || ""}`;
  if (entry.kind === "model") return `model ${entry.note || ""} · ${entry.neurons ?? 0} neurons`;
  return entry.note || "";
}

const FILTERS = { all: () => true, paypal: (e) => e.kind === "paypal" || e.kind === "webhook", ai: (e) => ["model", "tool", "drop"].includes(e.kind), rules: (e) => ["rule", "schedule"].includes(e.kind), webhooks: () => false };

function renderFilters() {
  const box = document.querySelector("#filters");
  box.replaceChildren();
  for (const [key, label] of [["all", "All"], ["paypal", "PayPal"], ["ai", "AI"], ["rules", "Rules"], ["webhooks", "Webhooks"]]) {
    const b = el("button", label, "small");
    b.type = "button";
    b.setAttribute("aria-pressed", String(filter === key));
    b.addEventListener("click", () => {
      filter = key;
      renderFilters();
      renderLog();
    });
    box.append(b);
  }
}

function renderLog() {
  const box = document.querySelector("#log");
  box.replaceChildren();
  if (filter === "webhooks") {
    const entries = state.webhooks || [];
    if (!entries.length) box.append(el("p", "No webhooks yet", "muted"));
    for (const entry of entries) {
      const line = el("div", null, "log-line");
      line.append(el("span", timeLabel(entry.at), "t"));
      line.append(el("span", entry.eventType, "k k-webhook"));
      line.append(el("span", `Resource ${entry.resourceId}. Signature check: verified ${entry.verified}. Duplicate deliveries dropped: ${entry.duplicates}.`, "x"));
      box.append(line);
    }
    return;
  }
  for (const entry of (state.log || []).filter(FILTERS[filter])) {
    const line = el("div", null, "log-line");
    line.append(el("span", timeLabel(entry.at), "t"));
    line.append(el("span", entry.kind, `k k-${entry.kind}`));
    line.append(el("span", logText(entry) + (entry.recorded ? " · recorded run" : ""), "x"));
    box.append(line);
  }
}

function render(next) {
  const previous = state;
  state = next;
  document.title = `${state.circle.name} · Circlekeeper`;
  document.querySelector("#title").textContent = state.circle.name;
  document.querySelector("#status").textContent = { draft: "draft", active: "active", done: "complete" }[state.circle.status];
  const newlyApplied = [];
  for (const swap of state.swaps || []) {
    if (swap.status === "applied" && !seenSwaps.has(swap.id)) {
      if (previous) newlyApplied.push(swap);
      seenSwaps.add(swap.id);
    }
  }
  for (const swap of newlyApplied) schedule?.moveTurn(swap);
  schedule?.render(state);
  if (previous) {
    for (const round of state.rounds) {
      const oldRound = previous.rounds.find((item) => item.round === round.round);
      for (const share of round.shares || []) {
        const oldShare = oldRound?.shares.find((item) => item.memberId === share.memberId);
        (share.parts || []).forEach((part, partIndex) => {
          if (oldShare?.parts[partIndex]?.status !== part.status) schedule?.markShare({ round: round.round, memberId: share.memberId, partIndex });
        });
      }
    }
  }
  renderRoundStrip();
  rulesPanel.render(state.circle);
  const roundStrip = document.querySelector("#round-strip");
  const draftRulesBox = document.querySelector("#draft-rules");
  const rulesCard = document.querySelector("#rules-card");
  const linksCard = document.querySelector("#links-card");
  // Move a box only when it is not already in place: re-inserting it on every poll would take focus out of its inputs.
  const placeAfter = (anchor, box) => { if (anchor.nextElementSibling !== box) anchor.after(box); };
  const placeBefore = (anchor, box) => { if (anchor.previousElementSibling !== box) anchor.before(box); };
  if (state.circle.status === "draft") {
    if (showDraftRules(state.circle)) {
      placeAfter(roundStrip, draftRulesBox);
      placeAfter(linksCard, rulesCard);
    } else {
      placeAfter(roundStrip, rulesCard);
      placeBefore(roundStrip, draftRulesBox);
    }
  } else {
    placeAfter(linksCard, rulesCard);
    placeBefore(roundStrip, draftRulesBox);
  }
  renderRound();
  renderMissedAction();
  renderWhatIf();
  renderGuard();
  renderPending();
  renderChanges();
  renderSettlements();
  renderLinks();
  renderChat(document.querySelector("#chat"), state.messages, { me: "organiser", nameOf: (x) => (x === "treasurer" ? "Treasurer" : nameOf(x)) });
  renderSuggestions(document.querySelector("#suggestions"), state, (text) => post(`/api/circles/${id}/chat`, { k, text }), notice);
  document.querySelector("#recorded-run").textContent = state.treasurer?.recordedRun
    ? "Demo: the treasurer's answers are a recorded run. Every PayPal call is live."
    : "";
  renderLog();
}

bindChat(document.querySelector("#chat-form"), document.querySelector("#chat-input"), (text) => post(`/api/circles/${id}/chat`, { k, text }), notice);
renderFilters();
pollState(id, k, (next, error) => {
  if (error) notice.textContent = error.message; // an empty message clears the banner once the server answers again
  else keepFocus(() => render(next));
});

// Load the timeline independently so its vendor module cannot delay the round actions.
createScheduleView(document.querySelector("#schedule"), { wanted: new URLSearchParams(location.search).get("view") || "auto" }).then((view) => {
  schedule = view;
  schedule.onAskSwap = askSwap;
  if (state) keepFocus(() => schedule.render(state));
});
