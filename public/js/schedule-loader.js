import { BasicScheduleView } from "./schedule-view-basic.js";

export function chooseView(wanted, importOk) {
  return wanted !== "basic" && importOk ? "bryntum" : "basic";
}

export async function createScheduleView(container, options = {}) {
  const wanted = options.wanted || "auto";
  if (wanted !== "basic") {
    try {
      const bryntum = await import("/vendor/bryntum/schedulerpro/schedulerpro.module.js");
      if (chooseView(wanted, true) === "bryntum") {
        const { BryntumScheduleView } = await import("./schedule-view.js");
        container.dataset.view = "bryntum";
        return new BryntumScheduleView(container, bryntum);
      }
    } catch {}
  }
  container.dataset.view = "basic";
  return new BasicScheduleView(container);
}
