import { expect, test } from "@playwright/test";
import { makeDemo, state, waitFor } from "./helpers";
// @ts-ignore plain JavaScript module shared with the pages
import { toProjectData } from "../public/js/bryntum-data.js";

const fullyPaid = (share: any, cents: number) => {
  const parts = (share?.parts || []).filter((part: any) => part.status !== "CANCELLED");
  return parts.length > 0 && parts.every((part: any) => part.invoiceId && ["PAID", "MARKED_AS_PAID", "COMPLETED"].includes(part.status)) &&
    parts.reduce((sum: number, part: any) => sum + part.cents, 0) === cents;
};

test("a full round: setup, start, short share, swap, cash, two confirmers, payout SUCCESS", async ({ page, context, request }) => {
  const demo = await makeDemo(request);
  await page.goto(demo.organiserUrl);
  await expect(page.locator("#chat")).toContainText("Keisha needs the pot in February");
  await expect(page.locator("#recorded-run")).toContainText("recorded run");

  const organiserState = async () => state(request, demo.id, new URL(demo.organiserUrl, "http://local").searchParams.get("k") || "");
  await page.getByRole("button", { name: "Start the circle" }).click();
  await waitFor(async () => {
    const text = (await page.locator("#log").allTextContents()).join(" ");
    return text.split("POST /v2/invoicing/invoices · HTTP 201").length - 1 >= 6;
  }, 120000);
  const heldBefore = toProjectData(await organiserState());
  const heldPotBefore = heldBefore.events.find((event: any) => event.id === "pot-1");
  expect(heldPotBefore.held).toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 2000));
  const heldAfter = toProjectData(await organiserState());
  const heldPotAfter = heldAfter.events.find((event: any) => event.id === "pot-1");
  expect(Date.parse(heldPotAfter.startDate)).toBeGreaterThan(Date.parse(heldPotBefore.startDate));

  const marisol = await context.newPage();
  await marisol.goto(demo.memberUrl("marisol"));
  await marisol.getByRole("button", { name: "Solo tengo 60 esta semana." }).click();
  await expect(marisol.locator("#chat")).toContainText("60,00");
  await marisol.locator("#pending").getByRole("button", { name: /^(Sí|Yes)$/ }).click();
  await waitFor(async () => {
    const current = await organiserState();
    const share = current.rounds.find((round: any) => round.round === 1)?.shares.find((item: any) => item.memberId === "marisol");
    return share?.parts?.some((part: any) => part.cents === 6000) && share?.parts?.some((part: any) => part.cents === 4000) ? true : false;
  }, 60000);

  const dana = await context.newPage();
  await dana.goto(demo.memberUrl("dana"));
  await dana.getByRole("button", { name: "My rent went up. Can I take March instead of May?" }).click();
  const theo = await context.newPage();
  await theo.goto(demo.memberUrl("theo"));
  await theo.locator("#pending").getByRole("button", { name: /^(Yes|Sí)$/ }).click();
  await dana.locator("#pending").getByRole("button", { name: /^(Yes|Sí)$/ }).click();
  await waitFor(async () => {
    const current = await organiserState();
    return current.circle.rotation.some((slot: any) => slot.memberId === "dana" && slot.month === "2027-03") &&
      current.circle.rotation.some((slot: any) => slot.memberId === "theo" && slot.month === "2027-05");
  }, 60000);
  await expect(page.locator("#changes")).toContainText("Dana and Theo swapped turns, both agreed");

  const keisha = await context.newPage();
  await keisha.goto(demo.memberUrl("keisha"));
  await keisha.getByRole("button", { name: "Pay with a test card" }).click();
  await waitFor(async () => {
    const current = await organiserState();
    const share = current.rounds.find((round: any) => round.round === 1)?.shares.find((item: any) => item.memberId === "keisha");
    return fullyPaid(share, current.circle.shareCents);
  }, 60000);
  await expect(page.locator("#log")).toContainText("POST /v2/checkout/orders · HTTP 201");

  for (let attempt = 0; attempt < 12; attempt++) {
    const current = await organiserState();
    const round = current.rounds.find((item: any) => item.round === 1);
    if (round?.pot.status === "drafted") break;
    const unpaid = round?.shares.find((share: any) => !fullyPaid(share, current.circle.shareCents));
    if (!unpaid) throw new Error("Round one has no unpaid share to record");
    const name = current.circle.members.find((member: any) => member.id === unpaid.memberId)?.name || unpaid.memberId;
    await page.locator("#round").locator(".controls").filter({ hasText: name }).getByRole("button", { name: "Record cash" }).click();
    await waitFor(async () => {
      const latest = await organiserState();
      const after = latest.rounds.find((item: any) => item.round === 1)?.shares.find((share: any) => share.memberId === unpaid.memberId);
      return fullyPaid(after, latest.circle.shareCents);
    }, 60000);
  }
  await waitFor(async () => {
    const current = await organiserState();
    return current.rounds.find((round: any) => round.round === 1)?.pot.status === "drafted";
  }, 120000);

  const funded = await organiserState();
  const fundedRound = funded.rounds.find((round: any) => round.round === 1);
  for (const member of funded.circle.members) {
    expect(fullyPaid(fundedRound.shares.find((share: any) => share.memberId === member.id), funded.circle.shareCents)).toBe(true);
  }
  await expect(page.locator("#log")).not.toContainText("POST /v1/payments/payouts");

  await dana.getByRole("button", { name: "Confirm the pot" }).click();
  await theo.getByRole("button", { name: "Confirm the pot" }).click();
  const paid = await waitFor(async () => {
    const current = await organiserState();
    const pot = current.rounds.find((round: any) => round.round === 1)?.pot;
    return pot?.status === "paid" && pot.itemStatus === "SUCCESS" && pot.payoutBatchId ? pot : false;
  }, 200000);
  await expect(page.locator("#log")).toContainText(paid.payoutBatchId);
  expect(toProjectData(await organiserState()).events.find((event: any) => event.id === "pot-1").held).toBe(false);
});
