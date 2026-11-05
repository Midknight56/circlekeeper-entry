import type { APIRequestContext } from "@playwright/test";
import type { Page } from "@playwright/test";

// Every control fits its margin on phones: 16 px inside the screen, text inside the button, 12 px or more between
// neighbours, nothing overlapping. A failure names the control.
export async function measure(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const problems: string[] = [];
    const controls = [...document.querySelectorAll<HTMLElement>("button, a.button, input, textarea, select")].filter((e) => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== "hidden";
    });
    const name = (e: HTMLElement) => `${e.tagName.toLowerCase()} "${(e.textContent || e.getAttribute("aria-label") || e.id || "").trim().slice(0, 40)}"`;
    if (document.documentElement.scrollWidth > vw + 1) problems.push(`page scrolls sideways: ${document.documentElement.scrollWidth} > ${vw}`);
    for (const e of controls) {
      const r = e.getBoundingClientRect();
      if (e.closest(".schedule-scroll")) continue; // the schedule scrolls inside its own box
      if (r.left < 16 - 0.5 || r.right > vw - 16 + 0.5) problems.push(`${name(e)} outside the 16 px margin (${Math.round(r.left)} to ${Math.round(r.right)} of ${vw})`);
      if (e.tagName === "BUTTON" || e.classList.contains("button")) {
        if (e.scrollWidth > e.clientWidth + 1) problems.push(`${name(e)} text overflows (${e.scrollWidth} > ${e.clientWidth})`);
        const cs = getComputedStyle(e);
        if (parseFloat(cs.paddingLeft) < 8 || parseFloat(cs.paddingRight) < 8) problems.push(`${name(e)} padding under 8 px`);
        if (r.height < 36) problems.push(`${name(e)} under 36 px high`);
      }
    }
    for (let i = 0; i < controls.length; i++) {
      for (let j = i + 1; j < controls.length; j++) {
        const a = controls[i].getBoundingClientRect();
        const b = controls[j].getBoundingClientRect();
        if (controls[i].contains(controls[j]) || controls[j].contains(controls[i])) continue;
        const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (overlapX > 0 && overlapY > 0) problems.push(`${name(controls[i])} overlaps ${name(controls[j])}`);
        else if (overlapY > 0 && overlapX > -12 && overlapX <= 0) problems.push(`${name(controls[i])} and ${name(controls[j])} are ${Math.round(-overlapX)} px apart (12 needed)`);
        else if (overlapX > 0 && overlapY > -12 && overlapY <= 0) problems.push(`${name(controls[i])} and ${name(controls[j])} are ${Math.round(-overlapY)} px apart vertically (12 needed)`);
      }
    }
    return problems;
  });
}

export interface Demo {
  id: string;
  organiserUrl: string;
  memberUrl(memberId: string): string;
}

export async function makeDemo(request: APIRequestContext): Promise<Demo> {
  const response = await request.post("/api/demo");
  const data = await response.json();
  if (!response.ok() || !data.ok) throw new Error(data.error || `Demo creation failed (${response.status()})`);
  const links = new Map<string, string>(data.memberLinks.map((link: { memberId: string; url: string }) => [link.memberId, link.url]));
  return {
    id: data.id,
    organiserUrl: data.organiserUrl,
    memberUrl(memberId: string) {
      const url = links.get(memberId);
      if (!url) throw new Error(`No page for member ${memberId}`);
      return url;
    },
  };
}

export async function state(request: APIRequestContext, id: string, k: string): Promise<any> {
  const response = await request.get(`/api/circles/${encodeURIComponent(id)}/state?k=${encodeURIComponent(k)}`);
  if (!response.ok()) throw new Error(`State request failed (${response.status()})`);
  return response.json();
}

export async function waitFor<T>(fn: () => Promise<T | false | null | undefined>, ms: number): Promise<T> {
  const started = Date.now();
  let lastError: unknown;
  while (Date.now() - started < ms) {
    try {
      const result = await fn();
      if (result) return result as T;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(`Condition not met within ${ms} ms${lastError ? `: ${String(lastError)}` : ""}`);
}
