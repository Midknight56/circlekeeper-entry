import { expect, test } from "@playwright/test";
import { makeDemo, state, waitFor } from "./helpers";

const keyFrom = (url: string) => new URL(url, "http://local").searchParams.get("k") || "";
const memberKey = (url: string) => new URL(url, "http://local").pathname.split("/").filter(Boolean).pop() || "";

test("an unverified webhook is refused", async ({ request }) => {
  const response = await request.post("/webhooks/paypal", { data: { id: "EVT-TEST", event_type: "PAYMENT.CAPTURE.COMPLETED" } });
  expect(response.status()).toBe(400);
});

test("a third tap on a swap is refused", async ({ page, context, request }) => {
  const demo = await makeDemo(request);
  const boardKey = keyFrom(demo.organiserUrl);
  await page.goto(demo.organiserUrl);
  await page.getByRole("button", { name: "Start the circle" }).click();
  await waitFor(async () => {
    const current = await state(request, demo.id, boardKey);
    return current.rounds.find((round: any) => round.round === 1)?.shares.length === 6;
  }, 60000);
  const dana = await context.newPage();
  await dana.goto(demo.memberUrl("dana"));
  await dana.getByRole("button", { name: "My rent went up. Can I take March instead of May?" }).click();
  const theo = await context.newPage();
  await theo.goto(demo.memberUrl("theo"));
  await theo.locator("#pending").getByRole("button", { name: "Yes" }).click();
  await dana.locator("#pending").getByRole("button", { name: "Yes" }).click();
  const applied = await waitFor(async () => {
    const current = await state(request, demo.id, boardKey);
    return current.swaps.find((swap: any) => swap.from === "dana" && swap.to === "theo" && swap.status === "applied") ? current : false;
  }, 60000);
  const swapId = applied.swaps.find((swap: any) => swap.from === "dana" && swap.to === "theo").id;
  const rotation = applied.circle.rotation;
  const third = await request.post(`/api/circles/${demo.id}/swaps/${swapId}/consent`, { data: { k: memberKey(demo.memberUrl("theo")), answer: "yes" } });
  expect(third.status()).toBe(409);
  expect((await state(request, demo.id, boardKey)).circle.rotation).toEqual(rotation);
});

test("the pot cannot be confirmed while a share is unpaid", async ({ page, request }) => {
  const demo = await makeDemo(request);
  const boardKey = keyFrom(demo.organiserUrl);
  await page.goto(demo.organiserUrl);
  await request.post(`/api/circles/${demo.id}/start`, { data: { k: boardKey } });
  await waitFor(async () => {
    const current = await state(request, demo.id, boardKey);
    return current.rounds.find((round: any) => round.round === 1)?.shares.length === 6;
  }, 60000);
  const danaKey = memberKey(demo.memberUrl("dana"));
  const response = await request.post(`/api/circles/${demo.id}/rounds/1/release/confirm`, { data: { k: danaKey } });
  expect(response.status()).toBe(409);
  expect((await response.json()).error).toMatch(/round is not fully paid/i);
  await expect(page.locator("#log")).not.toContainText("POST /v1/payments/payouts");
});

test("a non confirmer cannot confirm", async ({ request }) => {
  const demo = await makeDemo(request);
  const samKey = memberKey(demo.memberUrl("sam"));
  const response = await request.post(`/api/circles/${demo.id}/rounds/1/release/confirm`, { data: { k: samKey } });
  expect([403, 409]).toContain(response.status());
});
