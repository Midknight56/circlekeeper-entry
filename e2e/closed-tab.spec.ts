import { expect, test } from "@playwright/test";
import * as http from "node:http";
import { makeDemo, state, waitFor } from "./helpers";

test("a confirmer who closes the page right after the tap still counts", async ({ page, context, request, baseURL }) => {
  if (!baseURL) throw new Error("Playwright baseURL is required");
  let dropped = 0;
  const target = new URL(baseURL);
  // The hosted site cancels a request when the browser hangs up. The local server does not, so this proxy does it.
  const proxy = http.createServer((incoming, outgoing) => {
    let browserGone = false;
    outgoing.on("close", () => {
      if (!outgoing.writableFinished) browserGone = true;
    });

    const forward = (body?: Buffer) => {
      const upstream = http.request({
        hostname: target.hostname,
        port: target.port || (target.protocol === "https:" ? 443 : 80),
        protocol: target.protocol,
        method: incoming.method,
        path: incoming.url,
        headers: incoming.headers,
      }, (response) => {
        outgoing.writeHead(response.statusCode || 502, response.headers);
        response.pipe(outgoing);
      });
      upstream.on("error", () => {
        if (!outgoing.destroyed) outgoing.destroy();
      });
      if (body) upstream.end(body);
      else incoming.pipe(upstream);
    };

    if (incoming.method === "POST" && new URL(incoming.url || "/", "http://proxy").pathname.endsWith("/release/confirm")) {
      const chunks: Buffer[] = [];
      incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
      incoming.on("end", () => {
        setTimeout(() => {
          if (browserGone) {
            dropped += 1;
            return;
          }
          forward(Buffer.concat(chunks));
        }, 500);
      });
    } else {
      forward();
    }
  });
  await new Promise<void>((resolve, reject) => {
    proxy.once("error", reject);
    proxy.listen(0, "127.0.0.1", () => resolve());
  });
  const address = proxy.address();
  if (!address || typeof address === "string") throw new Error("Could not bind the confirmation proxy");
  const proxyBase = `http://127.0.0.1:${address.port}`;
  try {
    const demo = await makeDemo(request);
    await page.goto(demo.organiserUrl);
    const key = new URL(demo.organiserUrl, "http://local").searchParams.get("k") || "";
    const organiserState = () => state(request, demo.id, key);
    await page.getByRole("button", { name: "Start the circle" }).click();
    await waitFor(async () => (await organiserState()).rounds[0].shares.filter((s: any) => s.parts.some((p: any) => p.invoiceId)).length === 6, 120000);
    const members = (await organiserState()).circle.members;
    for (const { id: memberId, name } of members) {
      await page.locator("#round .controls").filter({ hasText: name }).getByRole("button", { name: "Record cash" }).click();
      await waitFor(async () => {
        const current = await organiserState();
        const share = current.rounds[0].shares.find((item: any) => item.memberId === memberId);
        return share?.parts.every((part: any) => ["PAID", "MARKED_AS_PAID", "COMPLETED"].includes(part.status));
      }, 60000);
    }
    await waitFor(async () => (await organiserState()).rounds[0].pot.status === "drafted", 120000);
    for (const memberId of ["dana", "theo"]) {
      const memberPage = await context.newPage();
      await memberPage.goto(new URL(demo.memberUrl(memberId), proxyBase).href);
      await memberPage.getByRole("button", { name: "Confirm the pot" }).click();
      await memberPage.close();
    }
    try {
      await waitFor(async () => {
        const pot = (await organiserState()).rounds[0].pot;
        return ["dana", "theo"].every((memberId) => pot.confirmations.includes(memberId));
      }, 30000);
    } catch (error) {
      throw new Error(`Expected both confirmations; proxy dropped ${dropped} request(s): ${String(error)}`);
    }
    await waitFor(async () => (await organiserState()).rounds[0].pot.status === "paid", 200000);
    const pot = (await organiserState()).rounds[0].pot;
    expect(pot.itemStatus).toBe("SUCCESS");
  } finally {
    await new Promise<void>((resolve, reject) => proxy.close((error) => error ? reject(error) : resolve()));
  }
});
