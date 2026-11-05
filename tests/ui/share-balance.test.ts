import { expect, it } from "vitest";
import { env } from "cloudflare:test";
// @ts-ignore shared page module
import { balanceLines } from "../../public/js/share-balance.js";

it("shows the outstanding balance and account check without offering another payment", () => {
  const share = { balanceCents: 4000, recoveryError: "This share needs a payment check. Check the PayPal account before replacing its invoice." };
  expect(balanceLines(share, "en")).toEqual(["$40.00 still unresolved", share.recoveryError]);
  expect(balanceLines({ balanceCents: 0, recoveryError: null }, "en")).toEqual([]);
  expect(balanceLines(share, "es").join(" ")).toContain("PayPal");
  expect(balanceLines(share, "fr").join(" ")).toContain("PayPal");
});

it("connects the balance notice to both organiser and member views", async () => {
  for (const file of ["circle.js", "member.js"]) {
    const source = await (await (env as any).ASSETS.fetch(`http://circlekeeper.test/js/${file}`)).text();
    expect(source, file).toContain('from "/js/share-balance.js"');
    expect(source, file).toContain("balanceLines(s,");
  }
});
