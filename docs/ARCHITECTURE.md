# How Circlekeeper works

## The pieces

| Piece | Where | What it does |
| --- | --- | --- |
| Worker | `src/worker.ts` | Routes, the webhook door, the cron jobs |
| Circle | `src/circle/circle-do.ts` | One Durable Object per circle; runs its actions one at a time |
| Hub | `src/hub.ts` | One Durable Object for the app: which circle owns which PayPal id, webhook dedupe, daily counters |
| PayPal | `src/paypal/` | Token cache, request ids, retries; invoices, orders, payouts, webhooks |
| Shares | `src/circle/shares.ts` | Invoices out, status in, cash records, the checkout fallback |
| Pot gate | `src/circle/gate.ts` | Fresh PayPal check, two confirmers, one payout per round |
| Swaps, short shares, reminders | `src/circle/swap.ts`, `split.ts`, `reminders.ts` | The circle's rules |
| Rotation | `src/circle/solver.ts` | Exact search: every member gets one month, every stated need it can meet |
| Treasurer | `src/ai/` | The tool loop, the tools, the drop rule, the caps |

## A share, start to end

1. The organiser taps Start. Code creates and sends one invoice per member, numbered `CK-<circle>-<round>-<member>`.
2. A member pays on PayPal's own page, or with the sandbox test card from their own view (no sign in needed).
3. PayPal sends `INVOICING.INVOICE.PAID`. The Worker checks the signature with PayPal, answers 200, and hands the event
   to the circle that owns that invoice. Events for invoices that are not ours are ignored.
4. The circle reads the invoice again with `GET` before it marks the share paid.
5. When every share of the round reads paid, code drafts the pot release.
6. The two confirmers tap Confirm. Code reads every invoice of the round from PayPal again, then sends one payout with
   `sender_batch_id` `ck-<circle>-r<round>`.
7. `PAYMENT.PAYOUTS-ITEM.SUCCEEDED` arrives, or the five minute reconcile job reads the batch. The pot shows paid,
   the board shows the round settled (in by invoice, out by payout), and the next round's invoices go out.

## The treasurer

Each turn is at most four model steps. Each step answers one JSON object: an optional tool call and the sentences to
say, each citing the tool results it relies on.

The tools only read or propose: `get_circle`, `get_round`, `solve_rotation`, `find_swap_partners`, `propose_swap`,
`propose_split`, `draft_reminder`, `draft_pot_release`, `explain_rule`. Nothing the model can call writes to PayPal,
taps a consent or confirms a pot.

The drop rule (`src/ai/drop.ts`) reads every sentence for amounts, dates, member names and payment status words in
English, Spanish and French. A sentence with any of them that is not in a cited tool result is removed.
