// Circle state mapped to the fields declared by the installed Scheduler Pro package.
import { potTiming } from "./schedule-model.js";

const PAID = ["PAID", "MARKED_AS_PAID", "COMPLETED"];
// DependencyBaseModel.Type declares EndToStart as finish to start with numeric value 2.
export const FINISH_TO_START = 2;
const day = 24 * 60 * 60 * 1000;

function shareColor(share, part, now) {
  if (PAID.includes(part.status) || share.state === "paid") return "paid";
  if (part.dueDate && Date.parse(`${part.dueDate}T23:59:59Z`) < Date.parse(now)) return "late";
  if (share.reminded) return "reminded";
  return "sent";
}

export function toProjectData(state) {
  const now = state.now || new Date().toISOString();
  const resources = state.circle.members.map((member) => ({ id: member.id, name: member.name }));
  for (const member of state.whatIf?.members || []) {
    if (!resources.some((resource) => String(resource.id) === String(member.id))) resources.push({ id: member.id, name: member.name });
  }
  const events = [];
  const assignments = [];
  const dependencies = [];

  for (const round of state.rounds) {
    const potId = `pot-${round.round}`;
    for (const share of round.shares || []) {
      (share.parts || Array.from({ length: share.partCount || 0 }, () => ({ status: share.state === "paid" ? "PAID" : "UNPAID" }))).forEach((part, partIndex) => {
        if (part.status === "CANCELLED") return;
        const id = `share-${round.round}-${share.memberId}-${partIndex}`;
        const paid = PAID.includes(part.status) || share.state === "paid";
        const due = Date.parse(`${part.dueDate || round.date}T12:00:00Z`);
        const start = new Date(due - 9 * day).toISOString();
        const paidAt = paid ? new Date(part.paidAt ? Date.parse(part.paidAt) : due).toISOString() : null;
        // Shares are planned across the nine days before their due date. Keep
        // the due-date window stable while dependencies schedule the pot after it.
        const end = new Date(due).toISOString();
        events.push({ id, name: part.cents === undefined ? paid ? "Paid" : "Not paid yet" : `$${(part.cents / 100).toFixed(2)}`, startDate: start, endDate: end,
          duration: Math.max(1, Math.ceil((Date.parse(end) - Date.parse(start)) / day)), durationUnit: "d", manuallyScheduled: true,
          kind: "share", round: round.round, draggable: false,
          memberId: share.memberId, colorKey: shareColor(share, part, now), paid, paidAt });
        assignments.push({ id: `a-${id}`, event: id, resource: share.memberId });
        dependencies.push({ id: `d-${id}`, fromEvent: id, toEvent: potId, type: FINISH_TO_START });
      });
    }
    const timing = potTiming(round, now);
    const startDate = round.pot.waitUntil ? timing.start : (round.shares || []).length ? timing.start : `${round.date}T12:00:00.000Z`;
    const potColor = timing.held ? "held" : "ready";
    events.push({ id: potId, name: `$${(round.pot.cents / 100).toFixed(2)}`, startDate,
      endDate: new Date(Date.parse(startDate) + 9 * day).toISOString(), duration: 9, durationUnit: "d", kind: "pot", round: round.round,
      memberId: round.recipientId, colorKey: potColor, held: timing.held, status: round.pot.status, draggable: true });
    assignments.push({ id: `a-${potId}`, event: potId, resource: round.recipientId });
  }
  const eventsById = new Map(events.map((event) => [event.id, event]));
  for (const swap of (state.swaps || []).filter((item) => item.status === "asked")) {
    for (const [round, recipientId] of [[swap.fromRound, swap.to], [swap.toRound, swap.from]]) {
      const original = eventsById.get(`pot-${round}`);
      if (!original) continue;
      const id = `ghost-${swap.id}-pot-${round}`;
      events.push({ ...original, id, memberId: recipientId, kind: "ghost", colorKey: "ready", held: false, draggable: false, ghost: true });
      assignments.push({ id: `a-${id}`, event: id, resource: recipientId });
    }
  }
  for (const missed of (state.missed || []).filter((item) => item.status === "asked" && item.plan?.action === "move_to_end")) {
    for (const turn of missed.plan.turns || []) {
      const original = eventsById.get(`pot-${turn.round}`);
      if (!original) continue;
      const id = `ghost-missed-${missed.id}-pot-${turn.round}`;
      events.push({ ...original, id, memberId: turn.memberId, kind: "ghost", colorKey: "late", held: false, draggable: false, ghost: true });
      assignments.push({ id: `a-${id}`, event: id, resource: turn.memberId });
    }
  }
  if (state.whatIf?.rotation) {
    const current = new Map(state.rounds.map((round) => [round.round, round]));
    for (const slot of state.whatIf.rotation) {
      const round = current.get(slot.round);
      const recipientId = round?.recipientId;
      const cents = state.whatIf.potCentsByRound?.[slot.round] ?? round?.pot.cents ?? state.circle.shareCents * (state.whatIf.members?.length || state.circle.members.length);
      if (round && String(recipientId) === String(slot.memberId) && cents === round.pot.cents) continue;
      const original = eventsById.get(`pot-${slot.round}`);
      const id = `whatif-pot-${slot.round}`;
      const startDate = original?.startDate || `${slot.date}T12:00:00.000Z`;
      const event = original
        ? { ...original, id, name: `$${(cents / 100).toFixed(2)}`, memberId: slot.memberId, kind: "ghost", colorKey: "ready", held: false, draggable: false, ghost: true, whatIf: true }
        : { id, name: `$${(cents / 100).toFixed(2)}`, startDate, endDate: new Date(Date.parse(startDate) + 9 * day).toISOString(), duration: 9, durationUnit: "d", kind: "ghost", round: slot.round, memberId: slot.memberId, colorKey: "ready", held: false, status: "waiting", draggable: false, ghost: true, whatIf: true };
      events.push(event);
      assignments.push({ id: `a-${id}`, event: id, resource: slot.memberId });
    }
  }
  return { resources, events, assignments, dependencies };
}

// Pure counterpart of moveTurn for deterministic updates and unit coverage.
export function moveTurnData(data, swap) {
  const assignments = data.assignments.map((assignment) => ({ ...assignment }));
  const fromPot = `pot-${swap.fromRound}`;
  const toPot = `pot-${swap.toRound}`;
  for (const assignment of assignments) {
    if (assignment.event === fromPot) assignment.resource = swap.to;
    else if (assignment.event === toPot) assignment.resource = swap.from;
  }
  return { ...data, assignments };
}
