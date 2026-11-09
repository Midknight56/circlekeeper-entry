import { expect, test, type Page } from "@playwright/test";
import { makeDemo, state, waitFor } from "./helpers";

// Follows the README section "Judge path, about 5 minutes", step by step, through the real pages.
const PAID = ["PAID", "MARKED_AS_PAID", "COMPLETED"];
const live = (share: any) => (share?.parts || []).filter((part: any) => part.status !== "CANCELLED");
const fullyPaid = (share: any, cents: number) => {
  const parts = live(share);
  return parts.length > 0 && parts.every((part: any) => PAID.includes(part.status)) && parts.reduce((sum: number, part: any) => sum + part.cents, 0) === cents;
};
const CARD = /^(Pay by card|Pagar con tarjeta|Payer par carte)$/;

test("follows the README judge path: split before payment, both parts paid, swap after two yeses, two confirmations, payout SUCCESS, receipt checks out", async ({ page, context, request }) => {
  test.setTimeout(15 * 60 * 1000);
  const demo = await makeDemo(request);
  const key = new URL(demo.organiserUrl, "http://local").searchParams.get("k") || "";
  const now = async () => state(request, demo.id, key);
  const round1 = (s: any) => s.rounds.find((round: any) => round.round === 1);
  const shareOf = (s: any, id: string) => round1(s)?.shares.find((share: any) => share.memberId === id);
  const monthOf = (s: any, id: string) => s.circle.rotation.find((slot: any) => slot.memberId === id)?.month;
  const next = async () => {
    await page.reload();
    return page.locator(".next-title");
  };
  const payByCard = async (member: Page, id: string, part?: RegExp) => {
    await member.goto(demo.memberUrl(id));
    await member.waitForSelector("#member-name:not(:empty)");
    let cards = member.locator("#shares .stack").filter({ has: member.getByRole("button", { name: CARD }) });
    if (part) cards = cards.filter({ hasText: part });
    await waitFor(async () => {
      if (await cards.count()) return true;
      await member.reload();
      return false;
    }, 60000);
    await cards.last().getByRole("button", { name: CARD }).click();
  };

  await test.step("step 1", async () => {
    await page.goto(demo.organiserUrl);
    await expect(page.getByRole("button", { name: "Start the circle" })).toBeVisible();
    await expect(page.locator(".next-title")).toContainText("Review the rules, then Start");
  });

  await test.step("step 2", async () => {
    await page.getByRole("button", { name: "Start the circle" }).click();
    await waitFor(async () => round1(await now())?.shares.length === 6, 120000);
    await expect(await next()).toContainText("Waiting for 6 shares");
  });

  const marisol = await context.newPage();
  await test.step("step 3", async () => {
    await marisol.goto(demo.memberUrl("marisol"));
    await marisol.getByRole("button", { name: "Solo tengo 60 esta semana." }).click();
    await expect(marisol.locator("#chat")).toContainText("60,00");
    await marisol.locator("#pending").getByRole("button", { name: /^(Sí|Yes)$/ }).click();
    const share = await waitFor(async () => {
      const s = shareOf(await now(), "marisol");
      return live(s).length === 2 ? s : false;
    }, 60000);
    const cents = live(share).map((part: any) => part.cents).sort();
    expect(cents).toEqual([4000, 6000]);
    expect(live(share).every((part: any) => !PAID.includes(part.status))).toBe(true);
    expect(share.parts.find((part: any) => part.cents === 10000)?.status).toBe("CANCELLED");
  });

  await test.step("step 4", async () => {
    await payByCard(marisol, "marisol", /60[,.]00/);
    const s = await waitFor(async () => {
      const latest = await now();
      return live(shareOf(latest, "marisol")).some((part: any) => part.cents === 6000 && PAID.includes(part.status)) ? latest : false;
    }, 60000);
    const parts = live(shareOf(s, "marisol"));
    expect(PAID.includes(parts.find((part: any) => part.cents === 4000).status)).toBe(false);
    expect(fullyPaid(shareOf(s, "marisol"), s.circle.shareCents)).toBe(false);
    expect(round1(s).pot.status).toBe("waiting");
    // Marisol's share is not fully paid, so all six shares are still waiting.
    await expect(await next()).toContainText("Waiting for 6 shares");
  });

  await test.step("step 5", async () => {
    const dana = await context.newPage();
    await dana.goto(demo.memberUrl("dana"));
    await dana.getByRole("button", { name: "My rent went up. Can I take March instead of May?" }).click();
    await waitFor(async () => (await now()).swaps.some((swap: any) => swap.status === "asked"), 60000);
    const theo = await context.newPage();
    await theo.goto(demo.memberUrl("theo"));
    const theoYes = theo.locator("#pending").getByRole("button", { name: /^(Yes|Sí)$/ });
    await waitFor(async () => {
      if (await theoYes.isVisible()) return true;
      await theo.reload();
      return false;
    }, 60000);
    await expect(theo.locator("#ask-card")).toContainText("Today:");
    await theoYes.click();
    await waitFor(async () => (await now()).swaps.some((swap: any) => swap.consents?.theo === "yes"), 60000);
    const afterOne = await now();
    expect(monthOf(afterOne, "dana")).toBe("2027-05");
    expect(monthOf(afterOne, "theo")).toBe("2027-03");
    await dana.reload();
    await expect(dana.locator("#ask-card")).toContainText("Yes so far: Theo");
    await dana.locator("#pending").getByRole("button", { name: /^(Yes|Sí)$/ }).click();
    await waitFor(async () => {
      const s = await now();
      return monthOf(s, "dana") === "2027-03" && monthOf(s, "theo") === "2027-05";
    }, 60000);
    await dana.close();
    await theo.close();
  });

  await test.step("step 6", async () => {
    const member = await context.newPage();
    for (const id of ["sam", "keisha", "amelie", "dana", "theo"]) {
      await payByCard(member, id);
      await waitFor(async () => {
        const s = await now();
        return fullyPaid(shareOf(s, id), s.circle.shareCents);
      }, 90000).catch(async (error) => {
        const text = await member.locator("#notice, .notice").allTextContents().catch(() => []);
        throw new Error(`${id}'s test card payment did not land: ${text.join(" ") || String(error)}`);
      });
    }
    await member.close();
    await expect(await next()).toContainText("Marisol's remaining $40.00");
    await payByCard(marisol, "marisol", /40[,.]00/);
    await waitFor(async () => {
      const s = await now();
      return round1(s).shares.every((share: any) => fullyPaid(share, s.circle.shareCents)) && round1(s).pot.status === "drafted";
    }, 120000);
  });

  await test.step("step 7", async () => {
    const dana = await context.newPage();
    await dana.goto(demo.memberUrl("dana"));
    await dana.getByRole("button", { name: "Confirm the pot" }).click();
    await waitFor(async () => (round1(await now()).pot.confirmations || []).length === 1, 60000);
    await expect(await next()).toContainText("Waiting for Theo to confirm the pot");
    const theo = await context.newPage();
    await theo.goto(demo.memberUrl("theo"));
    await theo.getByRole("button", { name: "Confirm the pot" }).click();
    const pot = await waitFor(async () => {
      const p = round1(await now()).pot;
      return p.status === "paid" && p.itemStatus === "SUCCESS" && p.payoutBatchId ? p : false;
    }, 200000);
    await page.reload();
    await expect(page.locator("#log")).toContainText(pot.payoutBatchId);
    await expect(page.locator(".next-title")).toContainText("paid out");
  });

  await test.step("step 8", async () => {
    await page.reload();
    await page.getByRole("link", { name: "Round 1 receipt" }).click();
    await expect(page.locator("#delta")).toContainText("0.00");
    await page.getByRole("button", { name: "Check the book" }).click();
    await expect(page.locator("#result")).toHaveText("The book checks out");
  });
});
