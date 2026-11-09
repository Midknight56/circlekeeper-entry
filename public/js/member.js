import { post, pollState } from "/js/api.js";
import { balanceLines } from "/js/share-balance.js";
import { words } from "/js/i18n.js";
import { el, money, monthLabel, dayLabel, bindChat, renderChat, renderSuggestions, keepFocus } from "/js/ui.js";
import { monthGrid } from "/js/member-calendar.js";
import { mountBryntumCalendar, updateBryntumEvents } from "/js/member-calendar-bryntum.js";
import { memberActionsFor } from "./member-actions.js";

const parts = location.pathname.split("/").filter(Boolean);
const id = parts[1] || "";
const token = parts[2] || "";
const notice = document.querySelector("#notice");
const PAID = ["PAID", "MARKED_AS_PAID", "COMPLETED"];
let state = null;
let t = words.en;
let lang = "en";
let calendarMonth = null;
let actionRules = "";
const basicCalendar = new URLSearchParams(location.search).get("calendar") === "basic";
const bryntumBox = document.querySelector("#calendar-bryntum");
const calendarModes = document.querySelector("#calendar-modes");
let bryntumCalendar = null;
let bryntumStarting = false;
let latestBryntumData = null;
const calendarWords = {
  en: { previous: "Previous", next: "Next" },
  es: { previous: "Anterior", next: "Siguiente" },
  fr: { previous: "Précédent", next: "Suivant" },
};
const calendarModeWords = {
  en: { month: "Month", agenda: "Agenda" },
  es: { month: "Mes", agenda: "Agenda" },
  fr: { month: "Mois", agenda: "Agenda" },
};

for (const modeButton of calendarModes.querySelectorAll("[data-calendar-mode]")) {
  modeButton.addEventListener("click", () => {
    if (!bryntumCalendar) return;
    bryntumCalendar.mode = modeButton.dataset.calendarMode === "agenda" ? "list" : modeButton.dataset.calendarMode;
    for (const button of calendarModes.querySelectorAll("[data-calendar-mode]")) {
      button.setAttribute("aria-pressed", String(button === modeButton));
    }
  });
}

async function act(b, fn) {
  b.disabled = true;
  notice.textContent = "";
  try {
    await fn();
  } catch (error) {
    notice.textContent = error.message;
  } finally {
    b.disabled = false;
  }
}

function button(label, fn, cls = "") {
  const b = el("button", label, cls);
  b.type = "button";
  b.addEventListener("click", () => act(b, fn));
  return b;
}

const nameOf = (mid) => state.circle.members.find((m) => m.id === mid)?.name || mid;
const monthOfRound = (round) => monthLabel(state.circle.rotation.find((s) => s.round === round)?.month || state.circle.startMonth, lang);

function renderShareSummary(me) {
  const box = document.querySelector("#share-summary");
  box.replaceChildren();
  const live = state.rounds.flatMap((r) => r.shares.filter((s) => s.memberId === me.id).flatMap((s) => s.parts)).filter((p) => p.status !== "CANCELLED");
  const paid = live.filter((p) => PAID.includes(p.status)).reduce((sum, p) => sum + p.cents, 0);
  const whole = state.circle.shareCents * state.rounds.length;
  const totals = el("div", null, "row between small");
  totals.append(el("span", t.paidSoFar), el("span", t.amountOf(money(paid, lang), money(whole, lang)), "amount"));
  const bar = el("div", null, "bar");
  bar.setAttribute("role", "progressbar");
  bar.setAttribute("aria-valuenow", String(paid));
  bar.setAttribute("aria-valuemin", "0");
  bar.setAttribute("aria-valuemax", String(whole));
  bar.setAttribute("aria-label", t.paidSoFar);
  const fill = el("div");
  fill.style.width = `${whole ? Math.min(100, paid / whole * 100) : 0}%`;
  bar.append(fill);
  box.append(totals, bar);
  if (state.circle.status === "draft") {
    box.append(el("p", t.notStarted, "small muted"));
  } else if (!state.rounds.some((r) => r.shares.some((s) => s.memberId === me.id && s.state !== "paid"))) {
    const lastRound = Math.max(0, ...state.rounds.filter((r) => r.shares.some((s) => s.memberId === me.id && s.parts.some((p) => p.status !== "CANCELLED"))).map((r) => r.round));
    const nextRound = state.rounds.find((r) => r.round > lastRound);
    if (nextRound) {
      const line = el("div", null, "row between small");
      line.append(el("span", t.nextShare), el("span", `${money(state.circle.shareCents, lang)} · ${monthLabel(nextRound.month, lang)}`, "amount"));
      box.append(line);
    }
  }
}

function renderShares(me) {
  const box = document.querySelector("#shares");
  box.replaceChildren();
  for (const r of state.rounds) {
    const s = r.shares.find((x) => x.memberId === me.id);
    const balance = balanceLines(s, lang);
    if (balance.length) {
      const card = el("div", null, "stack");
      for (const line of balance) card.append(el("p", line, "small"));
      box.append(card);
    }
    for (const p of (s?.parts || []).filter((p) => p.status !== "CANCELLED" && !PAID.includes(p.status))) {
      const card = el("div", null, "stack");
      const head = el("div", null, "row between");
      head.append(el("span", money(p.cents, lang), "big"));
      head.append(el("span", t.due(dayLabel(p.dueDate, lang)), `pill ${s.reminded ? "reminded" : "sent"}`));
      card.append(head);
      if (p.recordPending) {
        card.append(el("p", t.recordPending, "small muted"));
        box.append(card);
        continue;
      }
      if (p.checkoutPending) {
        card.append(el("p", t.checkoutPending, "small muted"));
        card.append(button(t.checkout, async () => {
          const result = await post(`/api/circles/${id}/shares/${r.round}/${me.id}/order`, { k: token, part: p.number });
          if (result.approveUrl) location.assign(result.approveUrl);
          if (result.pending) notice.textContent = t.paymentRecordPending;
        }));
        box.append(card);
        continue;
      }
      const actions = el("div", null, "row");
      actions.append(button(t.card, async () => {
        const result = await post(`/api/circles/${id}/shares/${r.round}/${me.id}/card`, { k: token, part: p.number });
        if (result.pending) notice.textContent = t.paymentRecordPending;
      }, "primary"));
      if (p.payerUrl) {
        const a = el("a", t.pay, "button");
        a.href = p.payerUrl;
        a.target = "_blank";
        a.rel = "noopener";
        actions.append(a);
      }
      actions.append(
        button(t.checkout, async () => {
          const result = await post(`/api/circles/${id}/shares/${r.round}/${me.id}/order`, { k: token, part: p.number });
          if (result.approveUrl) location.assign(result.approveUrl);
          if (result.pending) notice.textContent = t.paymentRecordPending;
        }),
      );
      card.append(actions);
      card.append(el("p", t.cardNote, "small muted"));
      box.append(card);
    }
  }
}

function renderAsks(me) {
  const box = document.querySelector("#pending");
  box.replaceChildren();
  let n = 0;
  for (const s of state.swaps || []) {
    if (s.status !== "asked" || (s.from !== me.id && s.to !== me.id) || s.consents?.[me.id]) continue;
    n++;
    const iAmFrom = s.from === me.id;
    const text = iAmFrom ? t.swapMine(nameOf(s.to)) : t.swapAsk(nameOf(s.from), monthOfRound(s.toRound), monthOfRound(s.fromRound));
    const card = el("div", null, "stack");
    card.append(el("p", text));
    const fromMonth = monthLabel(s.why?.fromMonth || state.circle.rotation.find((r) => r.round === s.fromRound)?.month, lang);
    const toMonth = monthLabel(s.why?.toMonth || state.circle.rotation.find((r) => r.round === s.toRound)?.month, lang);
    const afterFrom = monthLabel(s.why?.fromNow || s.why?.toMonth || state.circle.rotation.find((r) => r.round === s.toRound)?.month, lang);
    const afterTo = monthLabel(s.why?.toNow || s.why?.fromMonth || state.circle.rotation.find((r) => r.round === s.fromRound)?.month, lang);
    card.append(el("p", t.swapTurns(nameOf(s.from), fromMonth, nameOf(s.to), toMonth, afterFrom, afterTo), "small"));
    const kept = s.why?.needsKept?.length ? t.swapNeedsKept(s.why.needsKept.map((n) => n.text).join(", ")) : t.swapNoNeeds;
    card.append(el("p", kept, "small"));
    const yesSoFar = Object.keys(s.consents || {}).filter((x) => s.consents[x] === "yes").map(nameOf).join(", ") || t.nobody;
    card.append(el("p", t.swapVotes(yesSoFar), "small"));
    const row = el("div", null, "row");
    row.append(button(t.yes, () => post(`/api/circles/${id}/swaps/${s.id}/consent`, { k: token, answer: "yes" }), "primary"));
    row.append(button(t.no, () => post(`/api/circles/${id}/swaps/${s.id}/consent`, { k: token, answer: "no" })));
    card.append(row);
    box.append(card);
  }
  for (const s of state.splits || []) {
    if (s.memberId === me.id && s.status === "pending") {
      n++;
      const card = el("div", null, "stack");
      card.append(el("p", t.splitPending));
      card.append(button(t.tryAgain, () => post(`/api/circles/${id}/splits/${s.id}/retry`, { k: token }), "primary"));
      box.append(card);
    }
    if (s.memberId !== me.id || s.status !== "proposed") continue;
    n++;
    const card = el("div", null, "stack");
    card.append(el("p", t.splitAsk(money(s.nowCents, lang), money(s.laterCents, lang), dayLabel(s.dueDate, lang))));
    const row = el("div", null, "row");
    row.append(button(t.yes, () => post(`/api/circles/${id}/splits/${s.id}/consent`, { k: token, answer: "yes" }), "primary"));
    row.append(button(t.no, () => post(`/api/circles/${id}/splits/${s.id}/consent`, { k: token, answer: "no" })));
    card.append(row);
    box.append(card);
  }
  for (const missed of state.missed || []) {
    if (missed.status !== "asked" || missed.memberId === me.id || !state.circle.rules.confirmers.includes(me.id) || missed.consents?.[me.id]) continue;
    n++;
    const card = el("div", null, "stack");
    card.append(el("p", `${t.missedAsk(nameOf(missed.memberId))} ${missed.change || ""}`));
    const row = el("div", null, "row");
    row.append(button(t.yes, () => post(`/api/circles/${id}/missed/${missed.id}/consent`, { k: token, answer: "yes" }), "primary"));
    row.append(button(t.no, () => post(`/api/circles/${id}/missed/${missed.id}/consent`, { k: token, answer: "no" })));
    card.append(row);
    box.append(card);
  }
  const r = state.rounds.find((x) => x.pot.status === "drafted");
  if (r && state.circle.rules.confirmers.includes(me.id)) {
    n++;
    const card = el("div", null, "stack");
    card.append(el("p", t.confirmAsk(money(r.pot.cents, lang), nameOf(r.recipientId))));
    const held = r.pot.waitUntil && r.pot.waitUntil > state.now.slice(0, 10);
    if (held) card.append(el("p", t.canGoOn(dayLabel(r.pot.waitUntil, lang)), "small muted"));
    if (!r.pot.confirmations.includes(me.id) || r.pot.waitUntil && !held) card.append(button(t.confirm, () => post(`/api/circles/${id}/rounds/${r.round}/release/confirm`, { k: token }), "primary"));
    box.append(card);
  }
  document.querySelector("#ask-card").hidden = n === 0;
}

function renderMemberActions(me) {
  const box = document.querySelector("#member-actions");
  box.hidden = state.circle.demo;
  const actions = memberActionsFor(state, me);
  const signature = JSON.stringify([actions, state.circle.rules.shortShare, lang]);
  if (box.hidden || actionRules === signature) return;
  actionRules = signature;
  box.replaceChildren();
  const rule = state.circle.rules.shortShare;
  if (!rule.allowed) box.append(el("p", t.noSplits, "small muted"));
  if (actions.split) {
    const form = el("form", null, "stack");
    const label = el("label", t.nowAmount);
    const amount = el("input");
    amount.type = "number";
    amount.min = String(actions.minNowCents / 100);
    amount.max = String(actions.maxNowCents / 100);
    amount.step = "0.01";
    amount.value = String(rule.minNowCents / 100);
    amount.required = true;
    label.append(amount);
    const submit = el("button", t.payPartNow);
    submit.type = "submit";
    form.append(label, el("p", t.partRule(rule.laterDays), "small muted"), submit);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      act(submit, () => post(`/api/circles/${id}/member/split`, { k: token, nowCents: Math.round(Number(amount.value) * 100) }));
    });
    box.append(form);
  }
  if (!actions.swap) return;
  const partners = el("div", null, "stack");
  box.append(button(t.findPartners, async () => {
    const result = await post(`/api/circles/${id}/member/partners`, { k: token });
    partners.replaceChildren();
    const label = el("label", t.choosePartner);
    const select = el("select");
    for (const partner of result.partners) {
      const option = el("option", `${partner.name} · ${monthLabel(partner.month, lang)}${partner.why ? `: ${partner.why}` : ""}`);
      option.value = partner.memberId;
      option.disabled = !partner.fits;
      select.append(option);
    }
    select.value = result.partners.find((p) => p.fits)?.memberId || "";
    label.append(select);
    const ask = button(t.askMySwap, () => post(`/api/circles/${id}/member/swap`, { k: token, to: select.value }));
    ask.disabled = !select.value;
    partners.append(label, ask);
  }), partners);
}

function renderTurn(me) {
  const box = document.querySelector("#turn");
  box.replaceChildren();
  const r = state.rounds.find((x) => x.recipientId === me.id);
  if (!r) return;
  box.append(el("p", t.turnLine(monthLabel(r.month, lang), money(r.pot.cents, lang)), "big"));
  box.append(el("p", t.turnRound(r.round, state.rounds.length), "small muted"));
  if (r.pot.status === "drafted" && r.pot.waitUntil > state.now.slice(0, 10)) box.append(el("p", t.canGoOn(dayLabel(r.pot.waitUntil, lang)), "small muted"));
  if (r.pot.status === "paid") box.append(el("span", `${t.paid} · ${r.pot.payoutBatchId || ""}`, "pill paid"));
}

function renderDates(me) {
  const box = document.querySelector("#calendar");
  const bryntumRows = [];
  box.replaceChildren();
  const rows = [];
  for (const r of state.rounds) {
    const s = r.shares.find((x) => x.memberId === me.id);
    for (const p of (s?.parts || []).filter((p) => p.status !== "CANCELLED")) {
      rows.push({ id: `${r.round}-${p.invoiceId || p.dueDate}`, date: p.dueDate, label: `${t.shareDue} · ${money(p.cents, lang)}`, kind: "share", paid: PAID.includes(p.status), cls: PAID.includes(p.status) ? "paid" : "sent" });
    }
    if (r.recipientId === me.id) rows.push({ id: `pot-${r.round}`, date: r.date, label: `${t.potDay} · ${money(r.pot.cents, lang)}`, kind: "pot", paid: r.pot.status === "paid", cls: r.pot.status === "paid" ? "paid" : "ready" });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date));
  for (const row of rows) {
    const amount = row.label.slice(row.label.indexOf(" · ") + 3);
    bryntumRows.push({ ...row, memberId: me.id, amount, status: row.paid ? (row.kind === "pot" ? "paid" : "PAID") : (row.kind === "pot" ? "ready" : "UNPAID") });
  }
  latestBryntumData = { rows: bryntumRows, memberId: me.id, lang, labels: t };
  if (!calendarMonth) {
    const firstDate = rows.find((row) => row.kind === "share" && !row.paid) || rows.find((row) => row.kind === "pot") || rows[0];
    calendarMonth = firstDate?.date.slice(0, 7) || null;
  }
  if (!basicCalendar && bryntumCalendar) {
    updateBryntumEvents(bryntumCalendar, bryntumRows, me.id, lang, t);
    calendarModes.hidden = false;
    bryntumBox.hidden = false;
    box.hidden = true;
    return;
  }
  if (!basicCalendar && !bryntumStarting) {
    bryntumStarting = true;
    mountBryntumCalendar(bryntumBox, bryntumRows, me.id, lang, t, calendarMonth)
      .then((calendar) => {
        bryntumCalendar = calendar;
        const latest = latestBryntumData;
        updateBryntumEvents(calendar, latest.rows, latest.memberId, latest.lang, latest.labels);
        box.hidden = true;
        calendarModes.hidden = false;
        bryntumBox.hidden = false;
      })
      .catch(() => { bryntumBox.hidden = true; calendarModes.hidden = true; })
      .finally(() => { bryntumStarting = false; });
  }
  bryntumBox.hidden = true;
  box.hidden = false;
  const months = [...new Set(rows.map((row) => row.date.slice(0, 7)))].sort();
  const unpaidShare = rows.find((row) => row.kind === "share" && !row.paid);
  const pot = rows.find((row) => row.kind === "pot");
  if (!months.includes(calendarMonth)) {
    calendarMonth = (unpaidShare || pot || rows[0])?.date.slice(0, 7) || null;
  }
  if (calendarMonth) {
    const monthIndex = months.indexOf(calendarMonth);
    const nav = el("div", null, "member-calendar-nav row between");
    const labels = calendarWords[lang];
    const previous = el("button", labels.previous, "small");
    previous.type = "button";
    previous.disabled = monthIndex <= 0;
    previous.addEventListener("click", () => { calendarMonth = months[monthIndex - 1]; renderDates(me); });
    const title = el("strong", monthGrid(rows, calendarMonth, lang).title);
    const next = el("button", labels.next, "small");
    next.type = "button";
    next.disabled = monthIndex < 0 || monthIndex >= months.length - 1;
    next.addEventListener("click", () => { calendarMonth = months[monthIndex + 1]; renderDates(me); });
    nav.append(previous, title, next);
    box.append(nav);
    const grid = monthGrid(rows, calendarMonth, lang);
    const table = el("div", null, "member-calendar");
    table.setAttribute("role", "grid");
    const headings = el("div", null, "member-calendar-weekdays");
    headings.setAttribute("role", "row");
    for (const weekday of grid.weekdays) {
      const heading = el("span", weekday);
      heading.setAttribute("role", "columnheader");
      headings.append(heading);
    }
    table.append(headings);
    for (const week of grid.weeks) {
      const weekNode = el("div", null, "member-calendar-week");
      weekNode.setAttribute("role", "row");
      for (const cell of week) {
        const day = el("div", null, "member-calendar-day");
        day.setAttribute("role", "gridcell");
        if (cell.day !== null) day.append(el("span", String(cell.day), "member-calendar-number"));
        for (const mark of cell.marks) {
          const dot = el("span", null, `member-calendar-dot ${mark.paid ? "paid" : mark.kind === "share" ? "sent" : "ready"}`);
          dot.title = mark.label;
          dot.setAttribute("aria-label", mark.label);
          day.append(dot);
        }
        weekNode.append(day);
      }
      table.append(weekNode);
    }
    box.append(table);
  }
  for (const { date, label, cls } of rows) {
    const line = el("div", null, "row");
    line.append(el("span", dayLabel(date, lang), "when"));
    const tag = el("span", label, `pill ${cls}`);
    line.append(tag);
    box.append(line);
  }
}

function render(next) {
  state = next;
  const me = state.circle.members.find((m) => m.id === state.viewer.memberId);
  lang = ["en", "es", "fr"].includes(me.lang) ? me.lang : "en";
  t = words[lang];
  document.documentElement.lang = lang;
  document.title = `${me.name} · Circlekeeper`;
  document.querySelector("#member-name").textContent = t.hello(me.name);
  document.querySelector("#sandbox-label").textContent = t.label;
  for (const [sel, text] of [["#share-title", t.yourShare], ["#pending-title", t.asks], ["#chat-title", t.chat], ["#turn-title", t.yourTurn], ["#calendar-title", t.dates], ["#chat-send", t.send]]) {
    document.querySelector(sel).textContent = text;
  }
  for (const modeButton of calendarModes.querySelectorAll("[data-calendar-mode]")) {
    modeButton.textContent = calendarModeWords[lang][modeButton.dataset.calendarMode];
  }
  document.querySelector("#receipt-links-title").textContent = t.receiptTitle;
  const receiptBox = document.querySelector("#receipt-links");
  receiptBox.replaceChildren();
  const receipts = state.receipts || [];
  document.querySelector("#receipt-card").hidden = receipts.length === 0;
  for (const receipt of receipts) {
    const link = el("a", `${t.roundReceipt} ${receipt.round}`, "button small");
    link.href = `/receipt?c=${encodeURIComponent(id)}&k=${encodeURIComponent(token)}&r=${receipt.round}`;
    receiptBox.append(link);
  }
  document.querySelector("#chat-input").placeholder = t.placeholder;
  renderShareSummary(me);
  renderShares(me);
  renderAsks(me);
  renderMemberActions(me);
  const off = document.querySelector("#live-off");
  off.hidden = state.circle.demo || state.treasurer?.live !== false;
  off.textContent = t.liveOff;
  renderChat(document.querySelector("#chat"), state.messages, { me: me.id, nameOf: (x) => (x === "treasurer" ? t.treasurer : nameOf(x)), recordedLabel: t.recorded });
  renderSuggestions(document.querySelector("#suggestions"), state, (text) => post(`/api/circles/${id}/chat`, { k: token, text }), notice);
  document.querySelector("#recorded-run").textContent = state.treasurer?.recordedRun ? t.demoNote : "";
  renderTurn(me);
  renderDates(me);
}

bindChat(document.querySelector("#chat-form"), document.querySelector("#chat-input"), (text) => post(`/api/circles/${id}/chat`, { k: token, text }), notice);
pollState(id, token, (next, error) => {
  if (error) notice.textContent = error.message; // an empty message clears the banner once the server answers again
  else keepFocus(() => render(next));
});
