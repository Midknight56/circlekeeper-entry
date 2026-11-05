import { potTiming } from "./schedule-model.js";
const paidPart = (part) => ["PAID", "MARKED_AS_PAID", "COMPLETED"].includes(part.status);
const money = (cents) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format((cents || 0) / 100);

export function layout(state) {
  const members = state.circle.members;
  const months = state.rounds.map((round) => round.month);
  const monthLabels = months.map((month) => {
    const [year, number] = month.split("-").map(Number);
    return new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, number - 1, 1)));
  });
  const todayDate = new Date(state.now);
  const todayMonth = `${todayDate.getUTCFullYear()}-${String(todayDate.getUTCMonth() + 1).padStart(2, "0")}`;
  const rows = members.map((member) => ({ memberId: member.id, name: member.name, chips: [] }));
  for (const round of state.rounds) {
    for (const share of round.shares || []) {
      const row = rows.find((item) => item.memberId === share.memberId);
      if (!row) continue;
      const parts = (share.parts || Array.from({ length: share.partCount || 0 }, () => ({ status: share.state === "paid" ? "PAID" : "UNPAID" }))).filter((part) => part.status !== "CANCELLED");
      parts.forEach((part, partIndex) => {
        const unpaid = !paidPart(part);
        let color = "none";
        if (share.state === "paid" || paidPart(part)) color = "paid";
        else if (unpaid && part.dueDate && new Date(`${part.dueDate}T23:59:59Z`) < new Date(state.now)) color = "late";
        else if (share.reminded && unpaid) color = "reminded";
        else if (share.state === "sent" || ["SENT", "UNPAID", "PAYER_ACTION"].includes(part.status)) color = "sent";
        row.chips.push({ kind: "share", memberId: share.memberId, round: round.round, month: round.month, partIndex, cents: part.cents, color, label: part.cents === undefined ? paidPart(part) ? "Paid" : "Not paid yet" : money(part.cents) });
      });
    }
    const held = (round.shares || []).reduce((sum, share) => sum + (share.parts
      ? share.parts.filter((part) => part.status !== "CANCELLED" && !paidPart(part)).length
      : share.state === "paid" ? 0 : share.partCount || 0), 0);
    const recipient = rows.find((item) => item.memberId === round.recipientId);
    if (recipient) {
      const status = round.pot.status;
      const color = status === "paid" ? "paid" : held > 0 ? "held" : status === "drafted" ? "ready" : status === "paying" ? "paying" : status === "failed" ? "late" : "none";
      const timing = potTiming(round, state.now || new Date().toISOString());
      recipient.chips.push({ kind: "pot", memberId: round.recipientId, round: round.round, month: round.month, cents: round.pot.cents, color, held, heldBy: timing.heldBy, start: timing.start, label: money(round.pot.cents) });
    }
  }
  return { months, monthLabels, todayMonth, rows };
}

export class BasicScheduleView {
  constructor(container) { this.container = container; this.previous = null; }
  render(state) {
    const model = layout(state);
    this.container.replaceChildren();
    this.container.className = "schedule-scroll";
    const table = document.createElement("table"); table.className = "schedule-grid";
    const head = table.createTHead().insertRow(); head.insertCell().textContent = "Member";
    model.months.forEach((month, index) => {
      const cell = head.insertCell();
      cell.textContent = model.monthLabels[index];
      if (month === model.todayMonth) cell.className = "today";
    });
    const body = table.createTBody();
    for (const row of model.rows) {
      const tr = body.insertRow(); const name = tr.insertCell(); name.textContent = row.name; name.className = "member-name";
      for (const month of model.months) {
        const cell = tr.insertCell();
        if (month === model.todayMonth) cell.className = "today";
        for (const chip of row.chips.filter((item) => item.month === month)) {
          const node = document.createElement("span"); node.className = `chip ${chip.kind} ${chip.color}`; node.dataset.round = String(chip.round); node.dataset.member = row.memberId; if (chip.partIndex !== undefined) node.dataset.partIndex = String(chip.partIndex);
          if (chip.kind === "pot" && chip.heldBy && chip.heldBy.length) {
            const names = chip.heldBy.map((id) => (state.circle.members.find((m) => m.id === id) || { name: id }).name);
            node.title = `Waits for ${names.join(", ")}`;
          }
          if (chip.kind === "pot" && chip.held > 0) { const lock = document.createElement("span"); lock.className = "lock"; lock.setAttribute("aria-hidden", "true"); node.append(lock, document.createTextNode(` ${chip.label} · held`)); } else node.textContent = chip.label;
          node.title = `${chip.kind} ${chip.round}`; cell.append(node);
        }
      }
    }
    const legend = document.createElement("div"); legend.className = "schedule-legend";
    const entries = [
      ["paid", "Paid", "share"], ["sent", "Sent", "share"], ["reminded", "Reminded", "share"], ["late", "Late", "share"],
      ["held", "Held pot", "pot"], ["ready", "Ready", "pot"],
    ];
    for (const [color, label, kind] of entries) {
      const item = document.createElement("span"); item.className = "schedule-legend-item";
      const chip = document.createElement("span"); chip.className = `chip ${kind} ${color}`;
      if (color === "held") { const lock = document.createElement("span"); lock.className = "lock"; lock.setAttribute("aria-hidden", "true"); chip.append(lock); }
      item.append(chip, document.createTextNode(label)); legend.append(item);
    }
    this.container.append(table, legend);
    this.previous = model;
  }
  moveTurn(swap) {
    const rounds = [swap.fromRound, swap.toRound];
    for (const chip of this.container.querySelectorAll('.chip.pot')) if (rounds.includes(Number(chip.dataset.round))) chip.classList.add("moved");
    setTimeout(() => this.container.querySelectorAll(".chip.moved").forEach((chip) => chip.classList.remove("moved")), 900);
  }
  markShare(share) {
    const part = share.partIndex === undefined ? "" : `[data-part-index="${share.partIndex}"]`;
    const chip = this.container.querySelector(`.chip.share[data-round="${share.round}"][data-member="${CSS.escape(share.memberId)}"]${part}`);
    if (chip) { chip.classList.add("pulse"); setTimeout(() => chip.classList.remove("pulse"), 900); }
  }
}
