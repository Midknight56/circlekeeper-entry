import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("demo visitor cap", () => {
  it("allows ten circles per visitor per day and distinguishes visitors", async () => {
    const createDemo = (ip: string) => SELF.fetch("https://ck.test/api/demo", {
      method: "POST",
      headers: { "cf-connecting-ip": ip },
    });

    for (let attempt = 0; attempt < 10; attempt++) {
      const response = await createDemo("203.0.113.7");
      expect(response.status).toBe(200);
      expect((await response.json() as { ok: boolean }).ok).toBe(true);
    }

    const capped = await createDemo("203.0.113.7");
    expect(capped.status).toBe(429);
    const capBody = await capped.json() as { ok: boolean; error: string };
    expect(capBody.ok).toBe(false);
    expect(capBody.error).toContain("today's circles");

    const otherVisitor = await createDemo("203.0.113.8");
    expect(otherVisitor.status).toBe(200);
    expect((await otherVisitor.json() as { ok: boolean }).ok).toBe(true);
  });
});
