# Circlekeeper

A savings circle that keeps itself. Shares come in by PayPal invoice, the pot goes out by PayPal payout, and an AI
treasurer helps everyone agree.

PayPal sandbox only: test money, no real money moves.

## Judge in 60 seconds

| Step | Where | What to look at |
| --- | --- | --- |
| 1 | https://circlekeeper.midknight-labs.workers.dev, tap "Open the demo circle" | Your own copy of a six member circle. The board is a Bryntum Scheduler Pro view: a bar per share, a bar per pot, a line from each share to its pot |
| 2 | Tap Start | Six PayPal sandbox invoices go out. The activity panel shows each `POST /v2/invoicing/invoices` with HTTP 201 |
| 3 | Open Marisol's page, tap "Pagar con tarjeta de prueba" | Her share turns green on the board. Or pay on PayPal's own page with the sandbox login below |
| 4 | On the board, tap "What if Theo leaves in March?" | A ghost schedule beside the real one, and the change in words. Nothing moves |

- No sign in, no cost: sandbox money only, and the demo treasurer plays recorded answers (0 model calls).
- Sandbox buyer login for PayPal's page: see "For judges" below.
- New since 1 Oct 2026: all of it. The repository starts on 22 Oct 2026.

Try it: https://circlekeeper.midknight-labs.workers.dev (free, no sign in). "Open the demo circle" gives you your own
copy of a six member circle, with the organiser's board and a link to each member's view.

## For judges: pay a share on PayPal's own page

The demo's first member, Marisol, is billed to a PayPal sandbox buyer. To pay her share the way a real member would:

1. Open the demo circle, then Marisol's page from the board.
2. Her page is in Spanish: tap "Pagar en PayPal" on her share. PayPal's sandbox invoice page opens.
3. Tap PayPal and log in with this sandbox test account (sandbox only, test money, never a real account):

<!-- judge-login -->
- Email: `sb-bzdbn21339224@personal.example.com`
- Password: `!_B%e5W%`
<!-- /judge-login -->

4. Tap Complete Purchase. Back on the board, her share turns green when PayPal's webhook arrives.

Every other member can pay with the sandbox test card button, with no sign in.

## What it is

A savings circle is a group of people who each pay the same share every month. Each month one member takes the whole
pot. In Africa south of the Sahara, 25 percent of adults saved through a savings club or a person outside the family in 2021
(World Bank, The Global Findex Database 2021, section 2.2, page 79).

Today one person usually keeps a notebook, chases cash and settles arguments about whose turn it is. Circlekeeper gives
the circle a treasurer:

1. The organiser describes the circle in plain words, for example "6 of us, $100 a month from December, Keisha needs
   the pot in February". Code builds a rotation that meets every stated need.
2. Each member's share goes out as a PayPal invoice.
3. PayPal webhooks mark each share paid on the circle's schedule as soon as it is paid.
4. The treasurer answers each member in their own language (English, Spanish, French), handles a short share by the
   circle's own rule, and helps two members swap turns.
5. When the round is fully paid, two members the circle chose tap Confirm, and code sends the pot by PayPal Payouts.
6. When a share is still unpaid after its due date and the circle's grace days, the circle's own rule runs: the late
   member's turn moves to the end of the rotation, or the pot waits. The board shows the planned change as ghost bars,
   and nothing moves until the confirmers tap yes. The PayPal invoice stays open.
7. The organiser can ask "what if Theo leaves in March?" or add a member. Code solves the open turns again and the
   board shows a ghost schedule beside the real one, with the change in words, before anyone decides. Nothing moves.
8. Every round ends with a receipt: money in, money out, a $0.00 difference, and a SHA-256 book anyone can check in
   the browser.
9. A "Try to break it" panel runs three attacks on a copy of the circle. Each one shows 0 PayPal writes.

## The rule

The AI never moves money or turns on its own.

- Every PayPal call runs from code, after a person taps or a circle rule allows it.
- A swap needs both members to tap Yes. A short share needs the member to tap Yes. A pot needs two confirmers.
- Before any payout, code asks PayPal again whether every share of the round is paid. A webhook alone never releases
  money.
- Replies check member payments, collected totals and payouts against separate facts. Each financial clause must match
  its amount, person, direction and any stated round or part. Due dates must match the day and any stated year.
  Unknown people and unclear financial relationships get a safe fallback. These checks cover supported expressions in
  English, Spanish and French; they do not prove every possible sentence is correct.
- Every model call and every PayPal call shows in the board's activity panel, with its HTTP code and ids.

## PayPal

| What | Call |
| --- | --- |
| A share | `POST /v2/invoicing/invoices`, then `POST /v2/invoicing/invoices/{id}/send` |
| Its status | `GET /v2/invoicing/invoices/{id}` |
| A reminder | `POST /v2/invoicing/invoices/{id}/remind` |
| A short share | `POST /v2/invoicing/invoices/{id}/cancel`, then two new invoices |
| A cash share | `POST /v2/invoicing/invoices/{id}/payments` |
| Pay by checkout instead | `POST /v2/checkout/orders`, then `POST /v2/checkout/orders/{id}/capture` |
| Pay with the sandbox test card | `POST /v2/checkout/orders` with a card source, then the invoice is marked paid by card |
| Settle a round | the paid invoices against the payout batch; `GET /v1/reporting/transactions` |
| The pot | `POST /v1/payments/payouts`, then `GET /v1/payments/payouts/{id}` |
| Live status | Webhooks, each one checked with `POST /v1/notifications/verify-webhook-signature` |

All calls go to the PayPal sandbox with the client credentials grant.

## How it is built

- One Cloudflare Worker serves the pages and the API. Each circle lives in its own Durable Object, so its actions run
  one at a time.
- The pages are plain HTML and JavaScript.
- With `LIVE_AI=1`, the treasurer runs on Cloudflare Workers AI, model `@cf/qwen/qwen3-30b-a3b-fp8`, through a small set of read and
  propose tools. It answers in JSON; code checks every action and every sentence.
- The organiser's board is a Bryntum Scheduler Pro view: one row per member, a bar per share and per pot, and a
  finish to start line from every share of a round to its pot, so a pot cannot start before its shares are paid.
  Dragging a pot to another member asks both of them; nothing moves until both say yes.
- Each member's page has a Bryntum Calendar (month and agenda) with only their own dates, in their own language.
- The Bryntum views run on the public trial packages (a "Trial Version" watermark shows). If they cannot load, the
  pages fall back to a plain schedule and calendar.
- More detail: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## What it does not do

- It runs only in the PayPal sandbox. No real money moves.
- It does not hold money. The pot goes out by PayPal Payouts as soon as the round is paid and two members confirm.
- A real circle would run through the group's own PayPal business account, with PayPal's approval for payouts. This
  entry makes no claim about the law of savings circles in any place.
- The demo's treasurer answers are recorded from real model runs, so a visit costs no model calls. With the default
  `LIVE_AI=0`, your own circle gets no model answers. Live answers require `LIVE_AI=1` and stay within the daily caps.

## Free to try

A visitor never costs money:

- Model calls are capped per visitor (6 a day) and per day for the app (700 neurons, inside the Workers AI free
  allowance of 10,000 a day). Each call is charged against the cap before it runs. The arithmetic is in `src/caps.ts`.
- The demo circle plays recorded treasurer answers, marked "recorded run" on screen, so replaying it uses no model
  calls. Every PayPal call in the demo is live in the sandbox.
- Limits keep the sandbox working for every visitor. Each network can make 10 circles a day and send 3 pots a day.
  The whole site makes up to 1,000 PayPal writes a day. A reached limit says so in plain words and resets at 00:00
  UTC. The arithmetic is in `src/caps.ts`.

## Privacy

A circle keeps the names and messages typed into it, and is deleted 14 days after it was made (a Durable Object
alarm). No cookies, no tracking. The daily caps count a salted SHA-256 hash of the connecting address and the day; the
address itself is never stored.

## Run it

Use Node 22 or later, Python 3, and a PayPal sandbox app with Invoicing and Payouts enabled.
The trial calendar and scheduler packages come from the public npm registry; no private registry login is needed.

```powershell
npm install
python dev/vendor_bryntum.py
npx playwright install chromium
```

The Python script copies the trial builds into `public/vendor/bryntum/`. Without it the pages fall back to basic
schedule and calendar views. The browser tests for the full schedule need these builds.

Copy `wrangler.example.jsonc` to `wrangler.jsonc` for your own account. The checked in config holds the hosted site's
account and binding ids. Sign in, create your own KV namespace and D1 database, and replace `account_id`, the `CK`
namespace `id`, and the `LEDGER` `database_id` in your copy:

```powershell
npx wrangler login
npx wrangler kv namespace create CK
npx wrangler d1 create hackathon-ledger
```

Keep the binding names. `CK` is the token cache, `AI` is the Workers AI binding, `ASSETS` serves `public/`, and `HUB`
and `CIRCLE` are the Durable Object bindings with the migrations already in the config. `LEDGER` names the shared
neuron database. A run without live answers needs no ledger rows, but the binding must exist for this config.
With `LIVE_AI=0`, the hosted site never calls the ledger. For live answers, apply the schema to your own database:

```powershell
npx wrangler d1 execute hackathon-ledger --file dev/ledger.sql --remote
```

Replace `hackathon-ledger` with your database name if you changed it. `--remote` matches the config's remote ledger
binding, including during local development. `dev/ledger.sql` creates `ai_calls` with the columns used by `src/ai/ledger.ts`.

Create `.dev.vars` beside the config. Use your own sandbox app credentials and sandbox account emails:

```dotenv
PAYPAL_CLIENT_ID=your_sandbox_client_id
PAYPAL_CLIENT_SECRET=your_sandbox_client_secret
PAYPAL_PERSONAS='{"merchant":"merchant@example.com","members":["buyer1@example.com","buyer2@example.com","buyer3@example.com","buyer4@example.com","buyer5@example.com","buyer6@example.com"]}'
PAYPAL_WEBHOOK_ID=""
```

The keys read by `Env` in `src/worker.ts` are:

| Keys | Local setup |
| --- | --- |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_PERSONAS` | Required secrets as above. The merchant is the sandbox seller; members are sandbox buyers. |
| `PAYPAL_WEBHOOK_ID` | Optional locally; leave empty without webhook delivery. Required to verify invoice app webhooks. |
| `PAYPAL_PAYOUT_CLIENT_ID`, `PAYPAL_PAYOUT_CLIENT_SECRET` | Optional pair for a separate funded sandbox payout app. Otherwise payouts use the invoice app. |
| `PAYPAL_PAYOUT_WEBHOOK_ID` | Optional webhook id for that separate payout app. |
| `VISITOR_SALT` | Optional secret for hashing visitor addresses; set your own random value outside a disposable local run. |
| `BUILD_TAG`, `PAYPAL_BASE` | Supplied by config. Sandbox API only; the tag identifies the build. |
| `LIVE_AI`, `DEV_ROUTES` | Supplied by config, both default to `"0"`. Set `LIVE_AI=1` only for live answers; keep developer routes off for ordinary runs. |
| `CK`, `AI`, `ASSETS`, `HUB`, `CIRCLE`, `LEDGER` | Config bindings, not text secrets in `.dev.vars`. |
| `LOCAL_CIRCLE_CAP`, `LOCAL_AI_CAP`, `LOCAL_PAYPAL_WRITE_CAP`, `LOCAL_PAYOUT_CAP_CENTS`, `LOCAL_LIVE_POT_CAP` | Optional local cap overrides; leave unset to use the normal caps. |
| `LOCAL_POT_CLIENT_ID`, `LOCAL_POT_CLIENT_SECRET`, `LOCAL_POT_SEND_CENTS` | Optional local payout test credentials and amount; leave unset for ordinary runs. |

Webhook setup is optional for a local run. Creating circles, sending invoices, recording cash, sandbox test card
payments, chat replays and payout status checks work without incoming webhooks. A payment on the external invoice
page will not update the board immediately without delivery. To test delivery, expose `/webhooks/paypal` through
your own public HTTPS address, register that URL on each sandbox app, and set the matching webhook ids.

`LIVE_AI=0` is the default: demo suggestions play recorded answers and own circles get no model answers. `LIVE_AI=1`
needs the Workers AI binding and the ledger schema above. Calls still run behind the visitor, app and shared account
caps; turning live answers on does not remove the caps.

Start the Worker at http://127.0.0.1:8795 in one terminal:

```powershell
npx wrangler dev
```

In another terminal, run the checks. Unit tests use test bindings and sandbox fakes; browser tests use the running
Worker and your real sandbox credentials, sending test invoices and payouts:

```powershell
npm test
npm run e2e
```

## Receipts

| What | Number | Where it came from |
| --- | --- | --- |
| Unit tests | 298 passing in 62 files | `npm test`, 3 Nov 2026 |
| End to end tests | 30 against the real sandbox: full rounds, refusals, swaps, a late share, what if, keyboard use, phone widths 360, 390 and 412 px | `npm run e2e`, 3 Nov 2026: 29 passed in one run; the keyboard answer test waited past its 5 s for the treasurer and passed 3 of 3 alone |
| A full round on the hosted site, 3 Nov 2026 | payout batch CJUUK9XQ426NY reached SUCCESS ($600) | the film's capture run |
| A full demo round on the hosted Worker | 80 PayPal calls, all 2xx; payout batch ME2QWSBF69T3W reached SUCCESS | `python dev/demo_run.py <url>`, 23 Oct 2026 |
| Webhooks | real signed events verified SUCCESS and routed, for both the invoice app and the payout app; forged deliveries refused with 400 | `docs/DAY1-RECEIPTS.md`, C10, C11 and "Pot webhook live" |
| Payouts from the funded pot account | $600 batch WT73XUUKVWYNS and $1 batch 9F7PZ35PTZCL6, both SUCCESS | `python dev/paypal_day1.py poll-payout <id>`, 23 Oct 2026 |
| Neurons per model call | 9.2 to 11.9 | Workers AI's own `usage.neurons`, 49 calls on 23 Oct 2026 |
| Neurons per treasurer answer | 9.21 (one step) to 32.29 (three steps) | `python dev/record_turns.py`, 23 Oct 2026 |
| Neurons to replay the demo | 0 | recorded run, `tests/demo/replay.test.ts` |

## Licence

MIT. See LICENSE.
