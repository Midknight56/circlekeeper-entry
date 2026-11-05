// Small shared helpers for the pages: elements, money, dates, and the treasurer chat.

// Harbour is the palette; other palette blocks render with ?palette=<name>.
const palette = new URLSearchParams(location.search).get("palette");
if (palette && /^[a-z]+$/.test(palette)) document.documentElement.dataset.palette = palette;

export function el(tag, text, cls) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (cls) node.className = cls;
  return node;
}

export function money(cents, lang = "en") {
  return new Intl.NumberFormat(lang === "en" ? "en-US" : lang, { style: "currency", currency: "USD" }).format(cents / 100);
}

export function monthLabel(month, lang = "en") {
  return new Intl.DateTimeFormat(lang, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-15T12:00:00Z`));
}

export function dayLabel(date, lang = "en") {
  return new Intl.DateTimeFormat(lang, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
}

export function timeLabel(iso) {
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

/** Messages as bubbles. `me` is "organiser" or a member id: their own lines sit on the right. */
export function renderChat(box, messages, { me, nameOf, recordedLabel = "recorded run" }) {
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
  box.replaceChildren();
  for (const m of messages) {
    const mine = m.from === me;
    const cls = mine ? "bubble me" : m.kind === "notice" ? "bubble notice" : "bubble them";
    const b = el("div", m.text, cls);
    const who = mine ? "" : nameOf(m.from);
    const meta = [who, timeLabel(m.at), m.recorded ? recordedLabel : ""].filter(Boolean).join(" · ");
    b.append(el("span", meta, "meta"));
    box.append(b);
  }
  if (atBottom) box.scrollTop = box.scrollHeight;
}

export function renderSuggestions(box, state, send, notice) {
  box.replaceChildren();
  // A suggestion the viewer already sent is not offered again.
  const me = state.viewer?.role === "member" ? state.viewer.memberId : "organiser";
  const sent = new Set((state.messages || []).filter((m) => m.from === me).map((m) => m.text));
  for (const text of (state.treasurer?.suggestions || []).filter((x) => !sent.has(x))) {
    const b = el("button", text);
    b.type = "button";
    b.addEventListener("click", async () => {
      b.disabled = true;
      notice.textContent = "";
      try {
        await send(text);
      } catch (error) {
        notice.textContent = error.message;
      } finally {
        b.disabled = false;
      }
    });
    box.append(b);
  }
}

export function bindChat(form, input, send, notice) {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    const button = form.querySelector("button");
    button.disabled = true;
    notice.textContent = "";
    try {
      await send(text);
      input.value = "";
    } catch (error) {
      notice.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
}

/** A redraw replaces the buttons; keep keyboard focus on the same control (same section, same text) across it. */
export function keepFocus(redraw) {
  const a = document.activeElement;
  const section = a && a !== document.body ? a.closest("section, form, header") : null;
  const key = a && section ? `${a.tagName}|${(a.textContent || a.getAttribute("aria-label") || "").trim()}` : null;
  const sectionId = section ? [...document.querySelectorAll("section, form, header")].indexOf(section) : -1;
  redraw();
  if (!key || a.isConnected) return;
  const again = [...document.querySelectorAll("section, form, header")][sectionId];
  const match = again && [...again.querySelectorAll("button, a, input")].find((e) => `${e.tagName}|${(e.textContent || e.getAttribute("aria-label") || "").trim()}` === key);
  if (match) match.focus();
}
