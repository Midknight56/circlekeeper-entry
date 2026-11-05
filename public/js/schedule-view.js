import { moveTurnData, toProjectData } from "./bryntum-data.js";

const COLOR_VARIABLE = { paid: "--c-paid", sent: "--c-sent", reminded: "--c-reminded", late: "--c-late", held: "--c-held", ready: "--c-ready" };

function syncStore(store, rows) {
  const ids = new Set(rows.map((row) => String(row.id)));
  for (const record of [...store.records]) if (!ids.has(String(record.id))) store.remove(record);
  for (const row of rows) {
    const record = store.getById(row.id);
    if (record) record.set(row);
    else store.add(row);
  }
}

export class BryntumScheduleView {
  constructor(container, bryntum) {
    this.container = container;
    this.bryntum = bryntum;
    this.scheduler = null;
    this.lastMonth = null;
    this.latestData = null;
    this.latestState = null;
    this.onAskSwap = null;
    this.phone = window.matchMedia("(max-width: 1024px)");
    this.phone.addEventListener("change", () => {
      // A media query can notify again without changing the rendered layout.
      // Rebuilding in that case discards the timeline's scroll position.
      if (!this.scheduler || this.phone.matches === this.renderedPhone) return;
      this.scheduler.destroy();
      this.scheduler = null;
      this.monthControls?.remove();
      this.render(this.latestState);
    });
  }

  showMonth(date) {
    const start = new Date(date.getFullYear(), date.getMonth(), 1);
    const end = new Date(date.getFullYear(), date.getMonth() + 1, 1);
    this.scheduler.setTimeSpan(start, end);
    this.monthLabel.value = start.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    this.container.dataset.startDate = start.toISOString();
    this.container.dataset.endDate = end.toISOString();
  }

  addMonthControls() {
    this.monthControls = document.createElement("nav");
    this.monthControls.className = "schedule-months";
    this.monthControls.setAttribute("aria-label", "Schedule months");
    this.monthLabel = document.createElement("output");
    this.monthLabel.setAttribute("aria-live", "polite");
    this.monthControls.append(this.monthLabel);
    for (const [label, offset] of [["Previous month", -1], ["Next month", 1]]) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.addEventListener("click", () => {
        const start = this.scheduler.startDate;
        this.showMonth(new Date(start.getFullYear(), start.getMonth() + offset, 1));
      });
      this.monthControls.append(button);
    }
    this.container.before(this.monthControls);
  }

  render(state) {
    const data = toProjectData(state);
    this.latestData = data;
    this.latestState = state;
    const rounds = [...(state.rounds || [])].sort((a, b) => a.round - b.round);
    const lastMonth = state.whatIf?.rotation?.at(-1)?.month || rounds.at(-1)?.month || "2027-05";
    const [lastYear, lastMonthNumber] = lastMonth.split("-").map(Number);
    const endDate = new Date(Date.UTC(lastYear, lastMonthNumber, 1, 12));
    if (!this.scheduler) {
      const currentRound = rounds.find((round) => round.round === state.currentRound) || rounds[0];
      const monthDate = (month) => new Date(`${month}-01T12:00:00Z`);
      const isPhone = this.phone.matches;
      this.renderedPhone = isPhone;
      const month = currentRound?.month || "2026-12";
      const [year, monthNumber] = month.split("-").map(Number);
      const startDate = isPhone ? new Date(year, monthNumber - 1, 1) : monthDate(month);
      const memberWidth = isPhone ? 100 : 132;
      this.scheduler = new this.bryntum.SchedulerPro({
        appendTo: this.container,
        startDate,
        endDate: isPhone ? new Date(year, monthNumber, 1) : endDate,
        viewPreset: { base: "monthAndYear", tickWidth: isPhone ? Math.max(1, this.container.clientWidth - memberWidth - 8) : 224 },
        ...(isPhone ? { forceFit: true, autoAdjustTimeAxis: false } : {}),
        height: 360,
        rowHeight: 48,
        columns: [{ text: "Member", field: "name", width: memberWidth }],
        eventStyle: "filled",
        transition: { changeEvent: true },
        project: { resources: data.resources, events: data.events, assignments: data.assignments, dependencies: data.dependencies },
        features: {
          eventDrag: {
            validatorFn: ({ eventRecords, newResource }) => {
              const eventRecord = eventRecords[0];
              if (!eventRecord || eventRecord.kind !== "pot") return false;
              if (String(eventRecord.memberId) === String(newResource.id)) return false;
              const currentDate = Date.parse(state.now || new Date().toISOString());
              return state.rounds.some((round) => round.recipientId === String(newResource.id) &&
                round.pot.status === "waiting" && Date.parse(`${round.date}T23:59:59Z`) > currentDate);
            },
          },
        },
        listeners: {
          beforeEventDrag: ({ eventRecord }) => eventRecord.kind === "pot",
          beforeEventDropFinalize: ({ context }) => {
            const eventRecord = context.eventRecord;
            const to = String(context.newResource?.id || "");
            if (context.valid && eventRecord.kind === "pot" && to && to !== String(eventRecord.memberId) && this.onAskSwap) {
              context.async = true;
              context.finalize(false);
              Promise.resolve(this.onAskSwap(String(eventRecord.memberId), to)).catch(() => {});
            } else {
              context.finalize(false);
            }
          },
        },
        eventRenderer: ({ eventRecord, renderData }) => {
          const colorVariable = COLOR_VARIABLE[eventRecord.colorKey] || "--c-ready";
          // Bryntum keeps only fields it knows on a record, so a ghost is known by its id.
          const ghost = String(eventRecord.id).startsWith("ghost-") || String(eventRecord.id).startsWith("whatif-");
          // A ghost is a proposal, not a pot: see-through with a dashed edge, so it never reads as money.
          renderData.style = ghost
            ? { backgroundColor: "transparent", border: `2px dashed var(${colorVariable})`, color: "var(--c-text)", opacity: "0.8" }
            : { backgroundColor: `var(${colorVariable})`, color: "var(--c-on-accent)" };
          renderData.eventStyle = ghost ? "dashed" : "filled";
          if (ghost) renderData.cls.add("ghost");
          if (eventRecord.kind === "pot") renderData.ariaLabel = `${eventRecord.name}. Drag to another member to ask for a swap`;
          return eventRecord.name;
        },
      });
      this.container.dataset.view = "bryntum";
      this.container.classList.add("schedule-scroll", "bryntum-board");
      if (isPhone) {
        this.addMonthControls();
        this.showMonth(startDate);
      }
    } else {
      const { project } = this.scheduler;
      syncStore(project.resourceStore, data.resources);
      syncStore(project.eventStore, data.events);
      syncStore(project.assignmentStore, data.assignments);
      syncStore(project.dependencyStore, data.dependencies);
      // Bryntum rounds the end date to a tick boundary. Compare our requested month instead.
      if (!this.phone.matches && this.lastMonth !== lastMonth) {
        this.scheduler.setTimeSpan(this.scheduler.startDate, endDate, { maintainVisibleStart: true });
      }
    }
    this.lastMonth = lastMonth;
  }

  moveTurn(swap) {
    if (!this.scheduler || swap.status && swap.status !== "applied") return;
    const moved = moveTurnData(this.latestData, swap);
    const changed = [swap.fromRound, swap.toRound].map((round) => this.scheduler.project.assignmentStore.getById(`a-pot-${round}`));
    changed.forEach((assignment, index) => assignment?.set({ resource: index === 0 ? swap.to : swap.from }));
    this.latestData = moved;
    for (const round of [swap.fromRound, swap.toRound]) this.highlight(`pot-${round}`);
  }

  markShare(share) {
    const partIndex = share.partIndex || 0;
    this.highlight(`share-${share.round}-${share.memberId}-${partIndex}`, "pulse");
  }

  highlight(id, className = "moved") {
    const node = this.container.querySelector(`[data-event-id="${CSS.escape(id)}"]`);
    if (!node) return;
    node.classList.add(className);
    setTimeout(() => node.classList.remove(className), 900);
  }
}
