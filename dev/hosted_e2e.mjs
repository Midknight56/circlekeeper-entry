// One-circle end-to-end run against Circlekeeper and the PayPal sandbox.
// Usage: node dev/hosted_e2e.mjs <base url> [--hosted] [--key-file <path>] [--close-tab]
// A non local base needs --hosted: each run uses one of the hosted site's 10 circles a day and a real $600 sandbox payout.
import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";

const base = (process.argv[2] || "").replace(/\/$/, "");
const optionValue = (name) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
};
const keyFile = optionValue("--key-file");
const closeTab = process.argv.includes("--close-tab");
const local = !!base && new URL(base).protocol === "http:" && new URL(base).hostname === "127.0.0.1";
if (!base || (!local && !process.argv.includes("--hosted"))) {
  console.error("Give a local http://127.0.0.1 base URL, or add --hosted for the hosted site.");
  process.exit(2);
}

const kv = Object.fromEntries(readFileSync(`${homedir()}/.cloudflare/paypal-sandbox.local.txt`, "utf8")
  .split(/\r?\n/).filter((line) => line.includes("=") && !line.startsWith("#"))
  .map((line) => [line.slice(0, line.indexOf("=")).trim(), line.slice(line.indexOf("=") + 1).trim()]));
if (!kv.PAYPAL_SANDBOX_BUYER_EMAIL || !kv.PAYPAL_SANDBOX_BUYER_PASSWORD) {
  console.error("Sandbox buyer credentials are missing from the configured secrets file.");
  process.exit(2);
}

mkdirSync("shots", { recursive: true });
const startedAt = Date.now();
const steps = [];
const paypalIds = { invoiceIds: [], orderIds: [], payoutBatchId: null };
const addId = (list, value) => { if (value && !list.includes(value)) list.push(value); };
const safeDetail = (value) => String(value || "").replace(/https?:\/\/\S+/g, "[url]").replace(/[?&]k=[^&\s]*/g, "");
const request = async (path, body) => {
  const response = await fetch(new URL(path, base), body === undefined ? {} : {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
};
const state = async (circleId, key) => {
  const result = await request(`/api/circles/${encodeURIComponent(circleId)}/state?k=${encodeURIComponent(key)}`);
  if (result.status !== 200) throw new Error(`state HTTP ${result.status}`);
  return result.data;
};
const waitFor = async (fn, timeoutMs, label) => {
  const stop = Date.now() + timeoutMs;
  let last;
  while (Date.now() < stop) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) { last = error; }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(`${label} timed out${last ? ` (${last.message})` : ""}`);
};
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const board = await context.newPage();
let demo;
let circleId = "";
let boardKey = "";
let memberLinks = {};
let boardUrl = "";
let currentStep = 0;

async function shot(stepNo, name, page = board) {
  await page.screenshot({ path: `shots/e2e-${String(stepNo).padStart(2, "0")}-${name}.png`, fullPage: false });
}
async function step(no, name, action) {
  currentStep = no;
  const start = Date.now();
  let status = "PASS";
  let detail = "completed";
  try { detail = safeDetail(await action() || "completed"); }
  catch (error) { status = "FAIL"; detail = safeDetail(error?.message || error); }
  steps.push({ no, name, status, detail, durationMs: Date.now() - start });
  if (status === "FAIL") throw new Error(`step ${no} failed`);
}
const memberPage = async (memberId, phone = false) => {
  const p = await context.newPage();
  if (phone) await p.setViewportSize({ width: 390, height: 844 });
  await p.goto(new URL(memberLinks[memberId], base).href, { waitUntil: "domcontentloaded" });
  return p;
};
const roundOne = (s) => s.rounds.find((round) => round.round === 1);
const allPaid = (round) => round?.shares?.length === 6 && round.shares.every((share) => share.state === "paid" && share.parts.every((part) => ["PAID", "MARKED_AS_PAID", "COMPLETED", "CANCELLED"].includes(part.status)));
const harvestIds = (s) => {
  const round = roundOne(s);
  for (const share of round?.shares || []) for (const part of share.parts || []) {
    addId(paypalIds.invoiceIds, part.invoiceId);
  }
  for (const entry of s.log || []) {
    if (entry.path?.includes("/v2/checkout/orders")) for (const id of entry.ids || []) addId(paypalIds.orderIds, id);
  }
  if (round?.pot?.payoutBatchId) paypalIds.payoutBatchId = round.pot.payoutBatchId;
};

try {
  await step(1, "demo-board", async () => {
    const created = await request("/api/demo", {});
    if (created.status !== 200 || !created.data.ok) throw new Error(`demo HTTP ${created.status}`);
    demo = created.data;
    circleId = demo.id;
    boardKey = new URL(demo.organiserUrl, base).searchParams.get("k") || "";
    boardUrl = new URL(demo.organiserUrl, base).href;
    memberLinks = Object.fromEntries(demo.memberLinks.map((member) => [member.memberId, member.url]));
    if (keyFile) writeFileSync(keyFile, `${JSON.stringify({ circleId, boardKey, memberLinks, base }, null, 2)}\n`);
    await board.goto(boardUrl, { waitUntil: "domcontentloaded" });
    await board.waitForFunction(() => document.querySelector("#chat")?.textContent?.includes("Keisha needs the pot in February"), null, { timeout: 30000 });
    await board.locator("#recorded-run").getByText("recorded run", { exact: false }).waitFor({ timeout: 30000 });
    await shot(1, "demo-board");
    return `circle ${circleId}; draft`;
  });

  await step(2, "start-six-invoices", async () => {
    await board.getByRole("button", { name: "Start the circle" }).click();
    const s = await waitFor(async () => {
      const current = await state(circleId, boardKey);
      const round = roundOne(current);
      if (round?.shares?.length !== 6) return false;
      const sent = round.shares.flatMap((share) => share.parts).filter((part) => part.status === "SENT");
      return sent.length === 6 ? current : false;
    }, 120000, "six sent invoices");
    harvestIds(s);
    await board.waitForTimeout(500);
    await shot(2, "six-invoices-sent");
    return `${paypalIds.invoiceIds.length} invoices SENT`;
  });

  await step(3, "marisol-paypal-payment", async () => {
    const p = await memberPage("marisol");
    const link = p.getByRole("link", { name: "Pagar en PayPal", exact: true });
    await waitFor(async () => await link.isVisible().catch(() => false), 90000, "Marisol PayPal link");
    const payerUrl = await link.getAttribute("href");
    if (!payerUrl) throw new Error("PayPal invoice link missing");
    // Follow the invoice's own PayPal page, using the sandbox buyer credentials as in judge_run.mjs.
    await p.goto(payerUrl, { waitUntil: "domcontentloaded" });
    await p.waitForTimeout(5000);
    await p.locator("button[aria-label*=lose]").first().click({ timeout: 5000 }).catch(() => {});
    const popupPromise = context.waitForEvent("page", { timeout: 20000 }).catch(() => null);
    await p.frameLocator("iframe[title*='PayPal' i], iframe[src*='smart/buttons']").first()
      .locator("[data-funding-source=paypal], div[role=link], div[role=button]").first().click({ timeout: 20000 });
    const popup = await popupPromise;
    let payer = p;
    if (popup) { payer = popup; await payer.waitForLoadState("domcontentloaded"); }
    await payer.waitForTimeout(5000);
    await payer.locator("input#email, input[name=login_email]").first().fill(kv.PAYPAL_SANDBOX_BUYER_EMAIL, { timeout: 20000 });
    const next = payer.locator("button#btnNext");
    if (await next.isVisible().catch(() => false)) { await next.click(); await payer.waitForTimeout(3000); }
    await payer.locator("input#password, input[name=login_password]").first().fill(kv.PAYPAL_SANDBOX_BUYER_PASSWORD, { timeout: 20000 });
    await payer.locator("button#btnLogin").click();
    await payer.waitForTimeout(9000);
    await payer.locator("button, input[type=submit]").filter({ hasText: /complete purchase|pay now/i }).first().click({ timeout: 30000 });
    await payer.waitForTimeout(8000).catch(() => {});
    const paid = await waitFor(async () => {
      const current = await state(circleId, boardKey);
      const share = roundOne(current)?.shares.find((item) => item.memberId === "marisol");
      if (share?.state === "paid") return current;
      return false;
    }, 180000, "Marisol paid state refresh");
    harvestIds(paid);
    await board.goto(boardUrl, { waitUntil: "domcontentloaded" });
    await board.waitForTimeout(1000);
    await shot(3, "marisol-paid");
    await p.close().catch(() => {});
    if (payer !== p) await payer.close().catch(() => {});
    return `Marisol paid; invoice ${roundOne(paid).shares.find((item) => item.memberId === "marisol").parts[0].invoiceId}`;
  });

  await step(8, "unpaid-confirmations-refused", async () => {
    const current = await state(circleId, boardKey);
    const before = roundOne(current);
    if (!before || before.pot.status === "drafted" || before.shares.filter((share) => share.state === "paid").length >= 6) throw new Error("no unpaid share available for the refusal check");
    const results = [];
    for (const memberId of ["dana", "theo"]) {
      const token = new URL(memberLinks[memberId], base).pathname.split("/").filter(Boolean).at(-1);
      results.push(await request(`/api/circles/${circleId}/rounds/1/release/confirm`, { k: token }));
    }
    const after = await state(circleId, boardKey);
    const round = roundOne(after);
    const okStatuses = results.every((result) => result.status === 409 && /round is not fully paid/i.test(result.data.error || ""));
    if (!okStatuses || round.pot.status !== "waiting" || round.pot.confirmations.length !== 0) throw new Error("unpaid confirmations changed the pot or were not refused");
    await board.goto(boardUrl, { waitUntil: "domcontentloaded" });
    await board.waitForTimeout(1000);
    await board.locator("#round-strip").getByText(/^[1-5] of 6 paid$/).waitFor({ timeout: 30000 });
    await shot(8, "unpaid-pot-held");
    return `both confirms HTTP 409; board held with ${round.shares.filter((share) => share.state !== "paid").length} unpaid`;
  });

  await step(4, "five-test-card-payments", async () => {
    const ids = ["sam", "keisha", "theo", "amelie", "dana"];
    const first = await memberPage(ids[0], true);
    await first.getByRole("button", { name: "Pay with a test card" }).waitFor({ timeout: 30000 });
    await shot(4, "member-before-cards", first);
    for (const memberId of ids) {
      const page = memberId === ids[0] ? first : await memberPage(memberId);
      const responsePromise = page.waitForResponse((response) => response.url().includes(`/shares/1/${memberId}/card`) && response.request().method() === "POST", { timeout: 120000 }).catch(() => null);
      await page.locator("#shares button").first().click();
      const response = await responsePromise;
      if (!response) throw new Error(`${memberId} card request did not return`);
      const body = await response.json().catch(() => ({}));
      if (!response.ok() || body.ok === false) throw new Error(`${memberId} card payment HTTP ${response.status()}`);
      await waitFor(async () => {
        const current = await state(circleId, boardKey);
        return roundOne(current)?.shares.find((share) => share.memberId === memberId)?.state === "paid" ? current : false;
      }, 60000, `${memberId} paid state`);
      await page.close();
    }
    const current = await state(circleId, boardKey);
    harvestIds(current);
    if (paypalIds.orderIds.length < 5) {
      for (const entry of current.log || []) if (entry.path?.includes("/v2/checkout/orders")) for (const id of entry.ids || []) addId(paypalIds.orderIds, id);
    }
    return `five shares paid; ${paypalIds.orderIds.length} card order ids recorded`;
  });

  await step(5, "all-paid-pot-ready", async () => {
    const ready = await waitFor(async () => {
      const current = await state(circleId, boardKey);
      const round = roundOne(current);
      return allPaid(round) && round.pot.status === "drafted" ? current : false;
    }, 90000, "all six paid and pot drafted");
    harvestIds(ready);
    await board.goto(boardUrl, { waitUntil: "domcontentloaded" });
    await board.waitForTimeout(1000);
    await shot(5, "all-paid-pot-ready");
    return "6 of 6 paid; pot ready for two confirmers";
  });

  await step(6, "two-confirmers-payout-success", async () => {
    const confirmAnswers = [];
    for (const memberId of ["dana", "theo"]) {
      const p = await memberPage(memberId);
      await p.getByRole("button", { name: "Confirm the pot" }).waitFor({ timeout: 30000 });
      if (closeTab) {
        await p.getByRole("button", { name: "Confirm the pot" }).click();
        await p.close();
        confirmAnswers.push(`${memberId} closed the page`);
        continue;
      }
      const [answer] = await Promise.all([
        p.waitForResponse((r) => r.url().includes("/release/confirm") && r.request().method() === "POST", { timeout: 120000 }),
        p.getByRole("button", { name: "Confirm the pot" }).click(),
      ]);
      const body = await answer.json().catch(() => ({}));
      confirmAnswers.push(`${memberId} ${answer.status()}${body.error ? ` ${body.error}` : ""}`);
      await p.close();
    }
    let lastPot = null;
    let paid;
    try {
      paid = await waitFor(async () => {
        const current = await state(circleId, boardKey);
        const pot = roundOne(current)?.pot;
        lastPot = pot || null;
        return pot?.status === "paid" && pot.itemStatus === "SUCCESS" && pot.payoutBatchId ? current : false;
      }, 300000, "payout SUCCESS (five minute limit)");
    } catch (error) {
      throw new Error(`${error?.message || error}; confirmAnswers: ${confirmAnswers.join("; ")}; pot status=${lastPot?.status ?? "unknown"}, refusal=${lastPot?.refusal ?? "unknown"}, batchStatus=${lastPot?.batchStatus ?? "unknown"}, itemStatus=${lastPot?.itemStatus ?? "unknown"}`);
    }
    harvestIds(paid);
    await board.goto(boardUrl, { waitUntil: "domcontentloaded" });
    await board.waitForTimeout(1000);
    await shot(6, "payout-success");
    return `pot paid; batch ${paypalIds.payoutBatchId}; item SUCCESS; confirmAnswers: ${confirmAnswers.join("; ")}`;
  });

  await step(7, "round-receipt-check", async () => {
    const receiptUrl = new URL(`/receipt?c=${encodeURIComponent(circleId)}&k=${encodeURIComponent(boardKey)}&r=1`, base).href;
    await board.goto(receiptUrl, { waitUntil: "domcontentloaded" });
    await board.locator("#delta").getByText("0.00", { exact: false }).waitFor({ timeout: 30000 });
    await board.getByRole("button", { name: "Check the book" }).click();
    await board.locator("#result").getByText("The book checks out", { exact: true }).waitFor({ timeout: 30000 });
    await shot(7, "receipt-checks-out");
    return "$0.00; Check the book passes";
  });

  await step(9, "wrong-key-rejected", async () => {
    const wrongState = await request(`/api/circles/${circleId}/state?k=wrong-key`);
    const wrongConfirm = await request(`/api/circles/${circleId}/rounds/1/release/confirm`, { k: "wrong-key" });
    if (![403, 404].includes(wrongState.status) || ![403, 404].includes(wrongConfirm.status)) throw new Error(`wrong key statuses ${wrongState.status}/${wrongConfirm.status}`);
    await board.goto(boardUrl, { waitUntil: "domcontentloaded" });
    await board.waitForTimeout(500);
    await shot(9, "wrong-key-rejected");
    return `state ${wrongState.status}; confirm ${wrongConfirm.status}`;
  });

  await step(10, "forged-webhook-rejected", async () => {
    const response = await fetch(new URL("/webhooks/paypal", base), {
      method: "POST",
      headers: {
        "content-type": "application/json", "paypal-auth-algo": "fake", "paypal-cert-url": "https://invalid.test/cert",
        "paypal-transmission-id": "fake", "paypal-transmission-sig": "fake", "paypal-transmission-time": "2026-10-23T00:00:00Z",
      },
      body: JSON.stringify({ id: "EVT-FORGED", event_type: "PAYMENT.CAPTURE.COMPLETED", resource: {} }),
    });
    if (response.status !== 400) throw new Error(`forged webhook HTTP ${response.status}`);
    await board.goto(boardUrl, { waitUntil: "domcontentloaded" });
    await board.waitForTimeout(500);
    await shot(10, "forged-webhook-rejected");
    return `HTTP ${response.status}`;
  });

  await step(11, "need-breaking-swap-refused", async () => {
    const before = await state(circleId, boardKey);
    const rotation = structuredClone(before.circle.rotation);
    const swaps = structuredClone(before.swaps);
    const danaToken = new URL(memberLinks.dana, base).pathname.split("/").filter(Boolean).at(-1);
    const ask = await request(`/api/circles/${circleId}/chat`, { k: danaToken, text: "Can I take February instead of March? Keisha needs February." });
    const after = await state(circleId, boardKey);
    if (ask.status !== 200 || JSON.stringify(after.circle.rotation) !== JSON.stringify(rotation) || JSON.stringify(after.swaps) !== JSON.stringify(swaps)) {
      throw new Error("need-breaking swap moved or altered the schedule");
    }
    await board.goto(boardUrl, { waitUntil: "domcontentloaded" });
    await board.waitForTimeout(500);
    await shot(11, "need-breaking-swap-refused");
    return "schedule unchanged; no swap created";
  });
} catch {
  // Preserve the per-step ledger; remaining numbered checks are recorded as not reached.
} finally {
  for (let n = currentStep + 1; n <= 11; n++) {
    if (!steps.some((entry) => entry.no === n)) {
      const names = ["", "demo-board", "start-six-invoices", "marisol-paypal-payment", "five-test-card-payments", "all-paid-pot-ready", "two-confirmers-payout-success", "round-receipt-check", "unpaid-confirmations-refused", "wrong-key-rejected", "forged-webhook-rejected", "need-breaking-swap-refused"];
      steps.push({ no: n, name: names[n], status: "FAIL", detail: "not reached after an earlier failure", durationMs: 0 });
    }
  }
}

for (const entry of steps) {
  if (entry.status === "FAIL" && !entry.detail.includes("not reached")) continue;
}
steps.sort((a, b) => a.no - b.no);
const overall = steps.every((entry) => entry.status === "PASS");
const receipts = {
  circleId,
  paypalIds,
  startedAt: new Date(startedAt).toISOString(),
  finishedAt: new Date().toISOString(),
  totalDurationMs: Date.now() - startedAt,
  steps,
};
writeFileSync("shots/e2e-receipts.json", `${JSON.stringify(receipts, null, 2)}\n`);

// Render a labelled contact sheet in a local browser page from in-memory image data.
try {
  const files = steps.map((entry) => {
    const prefix = `shots/e2e-${String(entry.no).padStart(2, "0")}-`;
    const candidates = ["demo-board", "six-invoices-sent", "marisol-paid", "member-before-cards", "all-paid-pot-ready", "payout-success", "receipt-checks-out", "unpaid-pot-held", "wrong-key-rejected", "forged-webhook-rejected", "need-breaking-swap-refused"].map((suffix) => `${prefix}${suffix}.png`);
    const file = candidates.find((candidate) => { try { readFileSync(candidate); return true; } catch { return false; } });
    return { label: `${String(entry.no).padStart(2, "0")} ${entry.name} · ${entry.status}`, data: file ? `data:image/png;base64,${readFileSync(file).toString("base64")}` : "" };
  });
  const sheet = await context.newPage();
  await sheet.setViewportSize({ width: 1440, height: Math.max(900, Math.ceil(files.length / 3) * 320) });
  const cards = files.map((file) => `<figure><figcaption>${file.label}</figcaption>${file.data ? `<img src="${file.data}">` : "<div class=missing>Screenshot not available</div>"}</figure>`).join("");
  await sheet.setContent(`<!doctype html><html><head><style>body{margin:0;padding:18px;background:#e9edf1;font:16px system-ui;color:#17212b}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}figure{margin:0;background:white;border-radius:10px;padding:10px;box-shadow:0 2px 8px #0002}figcaption{font-weight:700;margin:0 0 8px}img{display:block;width:100%;height:260px;object-fit:contain;background:#f5f6f7}.missing{height:260px;display:grid;place-items:center;background:#f5f6f7;color:#805}</style></head><body><main class="grid">${cards}</main></body></html>`);
  await sheet.screenshot({ path: "shots/e2e-contact-sheet.png", fullPage: true });
  await sheet.close();
} catch (error) {
  console.error(`contact sheet failed: ${safeDetail(error?.message || error)}`);
  process.exitCode = 1;
}
await browser.close().catch(() => {});

for (const entry of steps) console.log(`${String(entry.no).padStart(2, "0")} ${entry.name} ${entry.status} ${entry.detail}`);
if (!overall) process.exitCode = 1;
