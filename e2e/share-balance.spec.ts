import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

test("an unresolved cancelled balance stays visible on the board and member page", async ({ page }) => {
  const state = JSON.parse(readFileSync("public/dev/sample-state.json", "utf8"));
  const round = state.rounds[0];
  round.pot = { status: "waiting", cents: 60000, confirmations: [] };
  for (const share of round.shares) share.state = "paid";
  const sam = round.shares.find((s: any) => s.memberId === "sam");
  Object.assign(sam, {
    state: "partial", balanceCents: 4000,
    recoveryError: "This share needs a payment check. Check the PayPal account before replacing its invoice.",
    parts: [
      { number: "sam-a", cents: 6000, status: "PAID", paidAt: state.now },
      { number: "sam-b", cents: 4000, status: "CANCELLED", checkoutPending: true },
    ],
  });
  await page.route("**/dev/sample-state.json", (route) => route.fulfill({ json: state }));
  await page.goto("/c/demo?fixture=1");
  await expect(page.locator("#round-strip")).toContainText("5 of 6 paid");
  await expect(page.locator("#round")).toContainText("$40.00 still unresolved");
  await expect(page.locator("#round")).toContainText(sam.recoveryError);
  state.viewer = { role: "member", memberId: "sam" };
  state.version++;
  await page.goto("/m/demo/sam?fixture=1");
  await expect(page.locator("#shares")).toContainText("$40.00 still unresolved");
  await expect(page.locator("#shares")).toContainText(sam.recoveryError);
  await expect(page.locator("#shares button, #shares a")).toHaveCount(0);
});
