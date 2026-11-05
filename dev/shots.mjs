// Screenshots of the real pages for review: the board in each palette option, and member pages at phone width.
// Usage: node dev/shots.mjs [base url]   (headless; writes to shots/)
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const BASE = process.argv[2] || "http://127.0.0.1:8795";
const OUT = "shots";
mkdirSync(OUT, { recursive: true });

async function api(method, path, body) {
  const res = await fetch(BASE + path, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return res.json();
}

const demo = await api("POST", "/api/demo");
const org = demo.organiserToken;
const tok = Object.fromEntries(demo.memberLinks.map((m) => [m.memberId, m.url.split("/").pop()]));
const cid = demo.id;
await api("POST", `/api/circles/${cid}/start`, { k: org });
await api("POST", `/api/circles/${cid}/chat`, { k: tok.marisol, text: "Solo tengo 60 esta semana." });
await api("POST", `/api/circles/${cid}/chat`, { k: tok.dana, text: "My rent went up. Can I take March instead of May?" });
await api("POST", `/api/circles/${cid}/chat`, { k: tok.amelie, text: "Quand est mon tour ?" });
for (const m of ["sam", "keisha", "amelie"]) await api("POST", `/api/circles/${cid}/shares/1/${m}/cash`, { k: org });

const browser = await chromium.launch({ headless: true });
try {
  const desk = await browser.newPage({ viewport: { width: 1280, height: 1000 }, colorScheme: "light" });
  for (const p of ["ink", "market", "harbour", "clay"]) {
    await desk.goto(`${BASE}/c/${cid}?k=${org}&palette=${p}`);
    await desk.waitForSelector(".chip");
    await desk.waitForTimeout(800);
    await desk.screenshot({ path: `${OUT}/board-${p}.png`, fullPage: false });
  }
  await desk.goto(`${BASE}/c/${cid}?k=${org}`);
  await desk.waitForSelector(".chip");
  await desk.screenshot({ path: `${OUT}/board-full.png`, fullPage: true });
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, colorScheme: "light", deviceScaleFactor: 2 });
  for (const m of ["marisol", "theo", "amelie"]) {
    await phone.goto(`${BASE}/m/${cid}/${tok[m]}`);
    await phone.waitForSelector("#member-name:not(:empty)");
    await phone.waitForTimeout(600);
    await phone.screenshot({ path: `${OUT}/member-${m}.png`, fullPage: true });
  }
  const dark = await browser.newPage({ viewport: { width: 1280, height: 1000 }, colorScheme: "dark" });
  await dark.goto(`${BASE}/c/${cid}?k=${org}`);
  await dark.waitForSelector(".chip");
  await dark.screenshot({ path: `${OUT}/board-dark.png` });
} finally {
  await browser.close();
}
console.log("circle", cid, "shots in", OUT);
