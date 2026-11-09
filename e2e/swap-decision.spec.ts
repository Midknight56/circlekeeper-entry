import { expect, test } from "@playwright/test";
import { makeDemo, state, waitFor } from "./helpers";

test("Dana sees both dates and why the swap fits before anyone says yes", async ({ page, context, request }) => {
  test.setTimeout(15 * 60 * 1000);

  // 1. Make a fresh demo circle through the page or POST /api/demo, as judge-path does. Start it.
  const demo = await makeDemo(request);
  const key = new URL(demo.organiserUrl, "http://local").searchParams.get("k") || "";
  const now = async () => state(request, demo.id, key);
  const round1 = (s: any) => s.rounds.find((round: any) => round.round === 1);
  const monthOf = (s: any, id: string) => s.circle.rotation.find((slot: any) => slot.memberId === id)?.month;

  await test.step("step 1: start the circle", async () => {
    await page.goto(demo.organiserUrl);
    await expect(page.getByRole("button", { name: "Start the circle" })).toBeVisible();
    await page.getByRole("button", { name: "Start the circle" }).click();
    await waitFor(async () => round1(await now())?.shares.length === 6, 120000);
  });

  // 2. Open Dana's member page at a 390x844 viewport. Tap the suggested message "My rent went up. Can I take March instead of May?" and wait for the swap card.
  const dana = await context.newPage();
  await dana.setViewportSize({ width: 390, height: 844 });
  await dana.goto(demo.memberUrl("dana"));
  await dana.waitForSelector("#member-name:not(:empty)");

  await test.step("step 2: tap Dana's suggested swap message and wait for the swap card", async () => {
    await dana.getByRole("button", { name: "My rent went up. Can I take March instead of May?" }).click();
    await waitFor(async () => (await now()).swaps.some((swap: any) => swap.status === "asked"), 60000);
    const askCard = dana.locator("#ask-card");
    await waitFor(async () => {
      if (await askCard.isVisible()) return true;
      await dana.reload();
      return false;
    }, 60000);
  });

  const askCard = dana.locator("#ask-card");

  // 3. Assert the swap card shows both dates (May 2027 and March 2027, in the words the card uses),
  // the needs kept line (it names Keisha's February need), and the votes line saying nobody or only Dana has said yes,
  // in the card's own words.
  await test.step("step 3: assert swap card content before anyone says yes", async () => {
    await expect(askCard).toContainText("May 2027");
    await expect(askCard).toContainText("March 2027");
    await expect(askCard).toContainText("Today: Dana May 2027, Theo March 2027. After: Dana March 2027, Theo May 2027.");
    await expect(askCard).toContainText("Still true after the swap: Keisha needs February 2027.");
    await expect(askCard).toContainText(/Both must say yes\. Yes so far: (nobody|Dana)\./);
    await expect(askCard).toContainText("Both must say yes. Yes so far: nobody.");
  });

  // 4. Save test-results/dana-swap-decision-390.png (a screenshot of the card element, or the viewport scrolled to it).
  await test.step("step 4: save screenshot of the swap card", async () => {
    await askCard.scrollIntoViewIfNeeded();
    await askCard.screenshot({ path: "test-results/dana-swap-decision-390.png" });
  });

  // 5. Open Theo's member page and tap his yes. Reload Dana's page: Dana's turn ("Your turn" card) still says May 2027.
  const theo = await context.newPage();
  await test.step("step 5: Theo taps yes, Dana's turn still says May 2027", async () => {
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
    const turnCard = dana.locator("section").filter({ has: dana.locator("#turn-title") });
    await expect(turnCard).toContainText("May 2027");
    await expect(dana.locator("#turn")).toContainText("May 2027");
    await expect(dana.locator("#ask-card")).toContainText("Yes so far: Theo");
  });

  // 6. On Dana's page tap her yes. Reload: her turn now says March 2027.
  await test.step("step 6: Dana taps yes, her turn now says March 2027", async () => {
    const danaYes = dana.locator("#pending").getByRole("button", { name: /^(Yes|Sí)$/ });
    await danaYes.click();
    await waitFor(async () => {
      const s = await now();
      return monthOf(s, "dana") === "2027-03" && monthOf(s, "theo") === "2027-05";
    }, 60000);

    await dana.reload();
    const turnCard = dana.locator("section").filter({ has: dana.locator("#turn-title") });
    await expect(turnCard).toContainText("March 2027");
    await expect(turnCard).not.toContainText("May 2027");
    await expect(dana.locator("#turn")).toContainText("March 2027");
    await expect(dana.locator("#turn")).not.toContainText("May 2027");
  });

  await dana.close();
  await theo.close();
});
