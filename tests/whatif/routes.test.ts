import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { draftCircle } from "../../src/circle/create";
import worker from "../../src/worker";

describe("what if routes", () => {
  it("lets only the organiser save and clear a preview", async () => {
    const circle = draftCircle("4 of us: Ari, Bo, Cal and Dee. $50 a month from December.", "2026-10-23").circle!;
    const stub: any = env.CIRCLE.get(env.CIRCLE.idFromName(circle.id));
    await stub.create(circle);
    const post = (path: string, body: unknown) => worker.fetch(new Request(`https://ck.test/api/circles/${circle.id}/${path}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    }), env, {} as ExecutionContext);
    const change = { kind: "join", name: "Rae" };
    expect((await post("whatif", { k: circle.members[0].token, change })).status).toBe(403);
    expect((await post("whatif", { k: circle.organiserToken, change })).status).toBe(200);
    expect((await stub.state("https://ck.test", circle.members[0].token)).body).not.toHaveProperty("whatIf");
    expect((await post("whatif/clear", { k: circle.members[0].token })).status).toBe(403);
    expect((await post("whatif/clear", { k: circle.organiserToken })).status).toBe(200);
    expect((await stub.state("https://ck.test", circle.organiserToken)).body.whatIf).toBeNull();
  });
});
