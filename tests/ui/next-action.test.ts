import { expect, it } from "vitest";
import { env } from "cloudflare:test";
// @ts-ignore shared page module
import { nextAction } from "../../public/js/next-action.js";

const members = [
  { id: "dana", name: "Dana" },
  { id: "theo", name: "Theo" },
  { id: "marisol", name: "Marisol" },
  { id: "sam", name: "Sam" },
  { id: "amelie", name: "Amélie" },
  { id: "keisha", name: "Keisha" },
];

it("case 1: draft circle prompts review and start", () => {
  const state = {
    circle: { status: "draft", members, rules: { confirmers: ["dana", "theo"] } },
    rounds: [{ round: 1, recipientId: "marisol", pot: { status: "waiting", cents: 60000 }, shares: [] }],
  };
  const action = nextAction(state);
  expect(action).toEqual({
    title: "Review the rules, then Start",
    detail: "Nothing is sent yet. Start sends round 1's shares as PayPal invoices.",
    members: [],
    tone: "act",
  });
});

it("case 2: proposed split waits for member answer", () => {
  const state = {
    circle: { status: "active", members, rules: { confirmers: ["dana", "theo"] } },
    rounds: [{ round: 1, recipientId: "dana", pot: { status: "waiting", cents: 60000 }, shares: [] }],
    splits: [{ round: 1, memberId: "marisol", nowCents: 6000, laterCents: 4000, status: "proposed" }],
  };
  const action = nextAction(state);
  expect(action).toEqual({
    title: "Waiting for Marisol to answer the split",
    detail: "Marisol was offered $60.00 now and $40.00 later.",
    members: ["marisol"],
    tone: "wait",
  });
});

it("case 3: asked swap waits for members who have not consented", () => {
  const state = {
    circle: { status: "active", members, rules: { confirmers: ["dana", "theo"] } },
    rounds: [{ round: 1, recipientId: "sam", pot: { status: "waiting", cents: 60000 }, shares: [] }],
    swaps: [{ from: "dana", to: "theo", status: "asked", consents: { theo: "yes" } }],
  };
  const action = nextAction(state);
  expect(action).toEqual({
    title: "Waiting for Dana to answer the swap",
    detail: "Dana and Theo swap turns only when both say yes.",
    members: ["dana"],
    tone: "wait",
  });

  const stateBoth = {
    ...state,
    swaps: [{ from: "dana", to: "theo", status: "asked", consents: {} }],
  };
  expect(nextAction(stateBoth)).toEqual({
    title: "Waiting for Dana and Theo to answer the swap",
    detail: "Dana and Theo swap turns only when both say yes.",
    members: ["dana", "theo"],
    tone: "wait",
  });
});

it("case 4: pot waiting and an unpaid share", () => {
  const state = {
    circle: { status: "active", members, rules: { confirmers: ["dana", "theo"] } },
    rounds: [{
      round: 1,
      recipientId: "dana",
      pot: { status: "waiting", cents: 60000 },
      shares: [
        { memberId: "dana", state: "sent", parts: [{ cents: 10000, status: "SENT" }] },
        { memberId: "theo", state: "paid", parts: [{ cents: 10000, status: "PAID" }] },
        { memberId: "marisol", state: "paid", parts: [{ cents: 10000, status: "PAID" }] },
        { memberId: "sam", state: "paid", parts: [{ cents: 10000, status: "PAID" }] },
        { memberId: "amelie", state: "paid", parts: [{ cents: 10000, status: "PAID" }] },
        { memberId: "keisha", state: "paid", parts: [{ cents: 10000, status: "PAID" }] },
      ],
    }],
  };
  const action = nextAction(state);
  expect(action).toEqual({
    title: "Waiting for 1 share: Dana",
    detail: "The pot of $600.00 goes out when every share is fully paid.",
    members: ["dana"],
    tone: "wait",
  });
});

it("case 4: pot waiting and outstanding split balance", () => {
  const state = {
    circle: { status: "active", members, rules: { confirmers: ["dana", "theo"] } },
    rounds: [{
      round: 1,
      recipientId: "dana",
      pot: { status: "waiting", cents: 60000 },
      shares: [
        { memberId: "dana", state: "paid", parts: [{ cents: 10000, status: "PAID" }] },
        { memberId: "theo", state: "paid", parts: [{ cents: 10000, status: "PAID" }] },
        {
          memberId: "marisol",
          state: "partial",
          parts: [
            { cents: 6000, status: "PAID" },
            { cents: 4000, status: "SENT" },
          ],
        },
        { memberId: "sam", state: "paid", parts: [{ cents: 10000, status: "PAID" }] },
        { memberId: "amelie", state: "paid", parts: [{ cents: 10000, status: "PAID" }] },
        { memberId: "keisha", state: "paid", parts: [{ cents: 10000, status: "PAID" }] },
      ],
    }],
  };
  const action = nextAction(state);
  expect(action).toEqual({
    title: "Waiting for Marisol's remaining $40.00",
    detail: "The pot of $600.00 goes out when every share is fully paid.",
    members: ["marisol"],
    tone: "wait",
  });
});

it("case 4: pot waiting with multiple unpaid shares lists up to 3 names and more", () => {
  const state = {
    circle: { status: "active", members, rules: { confirmers: ["dana", "theo"] } },
    rounds: [{
      round: 1,
      recipientId: "marisol",
      pot: { status: "waiting", cents: 60000 },
      shares: [
        { memberId: "dana", state: "sent", parts: [{ cents: 10000, status: "SENT" }] },
        { memberId: "theo", state: "sent", parts: [{ cents: 10000, status: "SENT" }] },
        { memberId: "sam", state: "sent", parts: [{ cents: 10000, status: "SENT" }] },
        { memberId: "amelie", state: "sent", parts: [{ cents: 10000, status: "SENT" }] },
        { memberId: "keisha", state: "sent", parts: [{ cents: 10000, status: "SENT" }] },
        { memberId: "marisol", state: "sent", parts: [{ cents: 10000, status: "SENT" }] },
      ],
    }],
  };
  const action = nextAction(state);
  expect(action).toEqual({
    title: "Waiting for 6 shares: Dana, Theo, Sam and 3 more",
    detail: "The pot of $600.00 goes out when every share is fully paid.",
    members: ["dana", "theo", "sam", "amelie", "keisha", "marisol"],
    tone: "wait",
  });
});

it("case 5: pot drafted but held until waitUntil date", () => {
  const state = {
    now: "2026-06-01T12:00:00Z",
    circle: { status: "active", members, rules: { confirmers: ["dana", "theo"] } },
    rounds: [{
      round: 1,
      recipientId: "marisol",
      pot: { status: "drafted", cents: 60000, waitUntil: "2026-06-15", confirmations: [] },
      shares: [],
    }],
  };
  const action = nextAction(state);
  expect(action).toEqual({
    title: "The pot can go out on Jun 15, 2026",
    detail: "Every share is in. The circle agreed to wait until then.",
    members: [],
    tone: "wait",
  });
});

it("case 6: pot drafted waiting for confirmation", () => {
  const state = {
    now: "2026-06-20T12:00:00Z",
    circle: { status: "active", members, rules: { confirmers: ["dana", "theo"] } },
    rounds: [{
      round: 1,
      recipientId: "marisol",
      pot: { status: "drafted", cents: 60000, confirmations: ["dana"] },
      shares: [],
    }],
  };
  const action = nextAction(state);
  expect(action).toEqual({
    title: "Waiting for Theo to confirm the pot",
    detail: "1 of 2 confirmed. The pot of $600.00 goes to Marisol after both confirm.",
    members: ["theo"],
    tone: "act",
  });

  const stateNone = {
    ...state,
    rounds: [{
      round: 1,
      recipientId: "marisol",
      pot: { status: "drafted", cents: 60000, confirmations: [] },
      shares: [],
    }],
  };
  expect(nextAction(stateNone)).toEqual({
    title: "Waiting for Dana and Theo to confirm the pot",
    detail: "0 of 2 confirmed. The pot of $600.00 goes to Marisol after both confirm.",
    members: ["dana", "theo"],
    tone: "act",
  });
});

it("case 7: pot paying uncertain payout with batch id and item status", () => {
  const state = {
    circle: { status: "active", members, rules: { confirmers: ["dana", "theo"] } },
    rounds: [{
      round: 1,
      recipientId: "marisol",
      pot: { status: "paying", cents: 60000, payoutBatchId: "BATCH-123", itemStatus: "PENDING" },
      shares: [],
    }],
  };
  const action = nextAction(state);
  expect(action).toEqual({
    title: "PayPal is checking the payout",
    detail: "Payout batch BATCH-123 · PENDING",
    members: [],
    tone: "wait",
  });

  const stateNoBatch = {
    circle: { status: "active", members, rules: { confirmers: ["dana", "theo"] } },
    rounds: [{
      round: 1,
      recipientId: "marisol",
      pot: { status: "paying", cents: 60000, payoutBatchId: null },
      shares: [],
    }],
  };
  expect(nextAction(stateNoBatch)).toEqual({
    title: "PayPal is checking the payout",
    detail: "Sending to PayPal",
    members: [],
    tone: "wait",
  });
});

it("case 8: pot failed with refusal text", () => {
  const state = {
    circle: { status: "active", members, rules: { confirmers: ["dana", "theo"] } },
    rounds: [{
      round: 1,
      recipientId: "marisol",
      pot: { status: "failed", cents: 60000, refusal: "NETWORK_POT_LIMIT" },
      shares: [],
    }],
  };
  const action = nextAction(state);
  expect(action).toEqual({
    title: "The payout needs attention",
    detail: "This network has used today's 3 live pots. This pot was not sent. Try again after 00:00 UTC.",
    members: [],
    tone: "problem",
  });
});

it("case 9: every pot paid when circle is done or last round pot is paid", () => {
  const stateDone = {
    circle: { status: "done", members, rules: { confirmers: ["dana", "theo"] } },
    rounds: [{
      round: 1,
      recipientId: "marisol",
      pot: { status: "paid", cents: 60000 },
      shares: [],
    }],
  };
  expect(nextAction(stateDone)).toEqual({
    title: "Every round is paid out",
    detail: "Open a round's receipt below to check money in and money out.",
    members: [],
    tone: "done",
  });

  const stateLastPaid = {
    circle: { status: "active", members, rules: { confirmers: ["dana", "theo"] } },
    rounds: [
      { round: 1, recipientId: "marisol", pot: { status: "paid", cents: 60000 }, shares: [] },
      { round: 2, recipientId: "dana", pot: { status: "paid", cents: 60000 }, shares: [] },
    ],
  };
  expect(nextAction(stateLastPaid)).toEqual({
    title: "Every round is paid out",
    detail: "Open a round's receipt below to check money in and money out.",
    members: [],
    tone: "done",
  });
});

it("case 10: a completed round when later rounds exist", () => {
  const round1 = { round: 1, recipientId: "marisol", pot: { status: "paid", cents: 60000 }, shares: [] };
  const round2 = { round: 2, recipientId: "dana", pot: { status: "waiting", cents: 60000 }, shares: [] };
  const state = {
    currentRound: round1,
    circle: { status: "active", members, rules: { confirmers: ["dana", "theo"] } },
    rounds: [round1, round2],
  };
  const action = nextAction(state);
  expect(action).toEqual({
    title: "Round 1 is paid out",
    detail: "$600.00 went to Marisol.",
    members: [],
    tone: "done",
  });
});

it("diagnostic panels in public/circle.html have aria-expanded='false'", async () => {
  const html = await (await (env as any).ASSETS.fetch("http://circlekeeper.test/circle.html")).text();
  expect(html).toContain('aria-expanded="false" aria-controls="guard-body"');
  expect(html).toContain('aria-expanded="false" aria-controls="changes"');
  expect(html).toContain('aria-expanded="false" aria-controls="log-body"');
  expect(html).not.toContain('aria-expanded="true" aria-controls="guard-body"');
  expect(html).not.toContain('aria-expanded="true" aria-controls="changes"');
  expect(html).not.toContain('aria-expanded="true" aria-controls="log-body"');
});

it("case 11: a demo circle after round 1 is paid says round 1 is done, not that round 2 waits", () => {
  const round1 = { round: 1, recipientId: "marisol", pot: { status: "paid", cents: 60000 }, shares: [] };
  const round2 = { round: 2, recipientId: "dana", pot: { status: "waiting", cents: 60000 }, shares: [{ memberId: "sam", state: "sent", parts: [{ status: "SENT", cents: 10000 }] }] };
  const state = {
    circle: { status: "active", demo: true, members, rules: { confirmers: ["dana", "theo"] } },
    rounds: [round1, round2],
  };
  expect(nextAction(state)).toEqual({
    title: "Round 1 is paid out",
    detail: "$600.00 went to Marisol. This demo pays out round 1 only; make your own circle to run more rounds.",
    members: [],
    tone: "done",
  });
});
