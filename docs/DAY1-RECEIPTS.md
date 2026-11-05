# Day one receipts

Written by `python dev/paypal_day1.py`. HTTP codes, PayPal ids and status words only. Times are UTC.

| Check | Call | HTTP | Note |
| --- | --- | --- | --- |
| C1 token (2026-10-23 01:23) | POST /v1/oauth2/token | 200 | expires_in 32332 s; 28 scopes |
| C2 event names (2026-10-23 01:23) | GET /v1/notifications/webhooks-event-types | 200 | 205 types; INVOICING.INVOICE.PAID FOUND; INVOICING.INVOICE.CANCELLED FOUND; PAYMENT.PAYOUTSBATCH.SUCCESS FOUND; PAYMENT.PAYOUTS-ITEM.SUCCEEDED FOUND; PAYMENT.PAYOUTSBATCH.DENIED FOUND; PAYMENT.PAYOUTS-ITEM.FAILED FOUND; PAYMENT.PAYOUTS-ITEM.UNCLAIMED FOUND; PAYMENT.CAPTURE.COMPLETED FOUND |
| C3 payout create (2026-10-23 01:23) | POST /v1/payments/payouts (member1, 1.00 USD) | 201 | sender_batch_id ck-day1-ba1a9982b4; payout_batch_id HA4QPAWVJXCRU; batch_status PENDING |
| C4 order create (2026-10-23 01:23) | POST /v2/checkout/orders (paypal source, return_url in experience_context) | 200 | order 1ML49459NX1207543; status PAYER_ACTION_REQUIRED; link rels self,payer-action |
| C5 order card (2026-10-23 01:23) | POST /v2/checkout/orders (test card) | 422 | UNPROCESSABLE_ENTITY; debug_id f2118722a1a09; PAYEE_NOT_ENABLED_FOR_CARD_PROCESSING at |
| C14 invoicing on (2026-10-23 01:23) | GET /v2/invoicing/invoices | 200 | total_items 0 |
| C8 webhook count (2026-10-23 01:24) | GET /v1/notifications/webhooks | 200 | 0 webhooks; circlekeeper ids [] |
| C3 payout poll (2026-10-23 01:24) | GET /v1/payments/payouts/HA4QPAWVJXCRU | 200 | batch_status SUCCESS; item Y6X88VSVWS5BG transaction_status SUCCESS; amount field keys ['currency', 'value'] |
| C21 transaction search (2026-10-23 01:27) | GET /v1/reporting/transactions (last 2 d) | 200 | 0 transactions |
| C15 invoice draft (2026-10-23 01:27) | POST /v2/invoicing/invoices (detail, invoicer, primary_recipients, items) | 201 | invoice INV2-J5UC-STLA-Y9KC-TAU7; status DRAFT |
| C16 send (2026-10-23 01:27) | POST /v2/invoicing/invoices/INV2-J5UC-STLA-Y9KC-TAU7/send | 200 | link rels  |
| invoice get (2026-10-23 01:27) | GET /v2/invoicing/invoices/INV2-J5UC-STLA-Y9KC-TAU7 | 200 | status SENT; payer view link present True |
| C20 remind (2026-10-23 01:27) | POST /v2/invoicing/invoices/INV2-J5UC-STLA-Y9KC-TAU7/remind | 204 |  |
| C15 invoice draft (2026-10-23 01:27) | POST /v2/invoicing/invoices (detail, invoicer, primary_recipients, items) | 201 | invoice INV2-5DRP-FJFD-9B8N-RQSN; status DRAFT |
| C16 send (2026-10-23 01:27) | POST /v2/invoicing/invoices/INV2-5DRP-FJFD-9B8N-RQSN/send | 200 | link rels  |
| C18 cash record (2026-10-23 01:27) | POST /v2/invoicing/invoices/INV2-5DRP-FJFD-9B8N-RQSN/payments | 200 | payment EXTR-3P748613CE194192E; status now MARKED_AS_PAID |
| C15 invoice draft (2026-10-23 01:27) | POST /v2/invoicing/invoices (detail, invoicer, primary_recipients, items) | 201 | invoice INV2-CYBZ-9X98-N2D9-YGKH; status DRAFT |
| C16 send (2026-10-23 01:27) | POST /v2/invoicing/invoices/INV2-CYBZ-9X98-N2D9-YGKH/send | 200 | link rels  |
| C19 cancel (2026-10-23 01:27) | POST /v2/invoicing/invoices/INV2-CYBZ-9X98-N2D9-YGKH/cancel | 204 | status now CANCELLED |
| C13 Bryntum docs (2026-10-23 01:40) | read only: Bryntum public docs and registry.npmjs.org | 200 | Plain Scheduler: dependencies feature "draws dependencies between events" (bryntum.com/products/scheduler/docs-llm/api/Scheduler/feature/Dependencies.md); no text found that it moves a successor. Scheduler Pro: "adding a dependency between two tasks adjusts the scheduling of the successor task" (bryntum.com/products/schedulerpro/docs/guide/SchedulerPro/data/project_data), so the pot hold uses Scheduler Pro. Trial packages on registry.npmjs.org, read 23 Oct: @bryntum/scheduler-trial 7.3.7, @bryntum/schedulerpro-trial 7.3.7 (main schedulerpro.module.js), @bryntum/calendar-trial 7.3.7, all "Commercial". Trial npm packages are public, no login ("the Bryntum trial npm packages, which are public", public-repository-access guide). 45 days ("Full functionality for 45 days", bryntum.com/download). Serving the trial publicly: NOT VERIFIED (EULA PDF did not extract); treat as not allowed until Bryntum says yes |
| C8 webhook count (2026-10-23 02:14) | GET /v1/notifications/webhooks | 200 | 3 webhooks; circlekeeper ids [] |
| C9 register (2026-10-23 02:14) | POST /v1/notifications/webhooks | 201 | webhook id 4G814100GL652302X; 8 types |
| C10 simulate (2026-10-23 02:15) | POST /v1/notifications/simulate-event (PAYMENT.PAYOUTSBATCH.SUCCESS) | 202 | event WH-83C777576Y8332450-2L845887S3616745G |
| C6 Worker up (2026-10-23 02:12) | `python dev/cf.py deploy`, then GET https://circlekeeper.midknight-labs.workers.dev/healthz | 200 | second Cloudflare account 9fc5652f61b1f60eb20e1d9a2ef70041; version c940e52a-7b60-4f63-bdb8-8d444749c0dc; KV circlekeeper-ck made by the deploy |
| C7 secrets in (2026-10-23 02:13) | `python dev/secrets.py put`, then `wrangler secret list` | 0 | PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_PERSONAS, VISITOR_SALT, PAYPAL_WEBHOOK_ID listed (names only) |
| C10 simulate, our side (2026-10-23 02:14) | the Worker's log (`wrangler tail`) | 200 | SURPRISE: the simulated event sent with our webhook_id came back verification_status SUCCESS (webhook-sandbox.md says a simulated event cannot verify). It was then ignored: no PayPal id of ours in it, nothing changed |
| C10b forged deliveries (2026-10-23 02:20) | POST /webhooks/paypal with no PayPal headers; and with made up PayPal headers | 400, 400 | the door refuses both |
| C11 real signed events (2026-10-23 02:16) | the Worker's log during a hosted demo round | 200 | 5 INVOICING.INVOICE.PAID for our cash recorded invoices: verified SUCCESS, routed; 1 PAYMENT.PAYOUTS-ITEM.SUCCEEDED for payout batch ME2QWSBF69T3W: verified SUCCESS, routed; 2 INVOICING.INVOICE.PAID for other apps' invoices: verified, ignored |
| Hosted demo round (2026-10-23 02:16) | `python dev/demo_run.py https://circlekeeper.midknight-labs.workers.dev` | 200 | 80 PayPal calls, codes 200, 201, 204 only; payout batch ME2QWSBF69T3W item SUCCESS; round 2 sent; 0 sentences dropped; 0 neurons |
| C12 Workers AI, measured (2026-10-23 03:00) | `python dev/record_turns.py` against a local Worker on the hackathon account, LIVE_AI on | 200 | model @cf/qwen/qwen3-30b-a3b-fp8; neurons per model call 9.2 to 11.9 (usage.neurons from Workers AI); per treasurer turn 9.21 (one step) to 32.29 (three steps); 5 recording runs, 49 calls, 498.44 neurons, read back from the shared ledger (app circlekeeper, day 2026-10-23) |
| C5 order card (2026-10-23 02:50) | POST /v2/checkout/orders (test card) | 201 | order 7WD19010KY7122916; status COMPLETED; capture 2XL155946P114181M COMPLETED |
| C5 order card (2026-10-23 03:09) | POST /v2/checkout/orders (test card) | 201 | order 5L978161XM948334A; status COMPLETED; capture 0BE136823B046252T COMPLETED |
| C3 payout create (2026-10-23 03:09) | POST /v1/payments/payouts (member1, 1.00 USD) | 201 | sender_batch_id ck-day1-43ae7a4476; payout_batch_id TJMB9J2K2SFN2; batch_status PENDING |
| C3 payout poll (2026-10-23 03:09) | GET /v1/payments/payouts/TJMB9J2K2SFN2 | 200 | batch_status SUCCESS; item 8PV87YXXMFJPG transaction_status SUCCESS; amount field keys ['currency', 'value'] |
| C3 payout create (2026-10-23 03:16) | POST /v1/payments/payouts (member1, 600.00 USD) | 422 | INSUFFICIENT_FUNDS; debug_id ca4ed954b0b24 |
| C5 order card (2026-10-23 03:16) | POST /v2/checkout/orders (test card) | 201 | order 1R398252R22874328; status COMPLETED; capture 1U6909026X012342U COMPLETED |
| C3 payout create (2026-10-23 03:16) | POST /v1/payments/payouts (member1, 600.00 USD) | 422 | INSUFFICIENT_FUNDS; debug_id ca4ed95b49b8b |
| C3 payout create (2026-10-23 03:16) | POST /v1/payments/payouts (member1, 100.00 USD) | 201 | sender_batch_id ck-day1-f1d685867b; payout_batch_id 2BEUG5PT7SABY; batch_status PENDING |
| C3 payout create (2026-10-23 03:18) | POST /v1/payments/payouts (member1, 600.00 USD) | 422 | INSUFFICIENT_FUNDS; debug_id ca4ed98e8dd31 |
| Payout funds (2026-10-23 01:00 to 01:20) | test card orders, then POST /v1/payments/payouts | 201 / 422 | $1,000.00 card order COMPLETED (capture 0BE136823B046252T, net 972.70); $1.00 payout SUCCESS (TJMB9J2K2SFN2); $600.00 payout 422 INSUFFICIENT_FUNDS (ca4ed954b0b24); $5,000.00 card order COMPLETED (capture 1U6909026X012342U); $600.00 422 (ca4ed95b49b8b); $100.00 201 (2BEUG5PT7SABY); $600.00 two minutes later 422 (ca4ed98e8dd31). Card captures do not refill the payout balance within minutes |
| Card paid invoice (2026-10-23 01:05) | POST /v2/invoicing/invoices/{id}/payments, method CREDIT_CARD | 200 | probe INV2-3SJD-PEJT-Z8R3-YU2D read back MARKED_AS_PAID |
| C1 token (2026-10-23 03:33) | POST /v1/oauth2/token | 200 | expires_in 30493 s; 31 scopes |
| C1 token (2026-10-23 04:02) | POST /v1/oauth2/token | 200 | expires_in 32370 s; 28 scopes |
| C14 invoicing on (2026-10-23 04:02) | GET /v2/invoicing/invoices | 403 | NOT_AUTHORIZED; debug_id f973630fda5f1; NOT_AUTHORIZED at |
| C8 webhook count (2026-10-23 04:02) | GET /v1/notifications/webhooks | 200 | 0 webhooks; circlekeeper ids [] |
| C9 register (2026-10-23 04:03) | POST /v1/notifications/webhooks | 201 | webhook id 10T10056XK3372843; 8 types |
| C5 order card (2026-10-23 04:03) | POST /v2/checkout/orders (test card) | 201 | order 8A033614TP7529111; status COMPLETED; capture 20986865GC1897315 COMPLETED |
| C15 invoice draft (2026-10-23 04:03) | POST /v2/invoicing/invoices (detail, invoicer, primary_recipients, items) | 403 | NOT_AUTHORIZED; debug_id f758449c02a91; NOT_AUTHORIZED at |
| C14 invoicing on (2026-10-23 04:19) | GET /v2/invoicing/invoices | 200 | total_items 636 |
| Two app split (2026-10-23 08:30) | local Worker with both apps; `npm run e2e` through the shared lock | pass | 8 of 8 end to end tests pass, including the full round: invoices on the shared app, the $600 pot paid by Circlekeeper's own app to SUCCESS; the film's payout scene recorded (85.6 s) |
| C14 invoicing on (2026-10-23 05:14) | GET /v2/invoicing/invoices | 200 | total_items 0 |
| C15 invoice draft (2026-10-23 05:14) | POST /v2/invoicing/invoices (detail, invoicer, primary_recipients, items) | 201 | invoice INV2-8UJD-L49R-SV7S-2R67; status DRAFT |
| C16 send (2026-10-23 05:14) | POST /v2/invoicing/invoices/INV2-8UJD-L49R-SV7S-2R67/send | 200 | link rels  |
| C18 cash record (2026-10-23 05:14) | POST /v2/invoicing/invoices/INV2-8UJD-L49R-SV7S-2R67/payments | 200 | payment EXTR-2JJ271868K6432006; status now MARKED_AS_PAID |
| C8 webhook count (2026-10-23 05:14) | GET /v1/notifications/webhooks | 200 | 1 webhooks; circlekeeper ids ['10T10056XK3372843'] |
| C21 transaction search (2026-10-23 05:14) | GET /v1/reporting/transactions (last 1 d) | 200 | 0 transactions |
| C14 invoicing on (2026-10-23 05:14) | GET /v2/invoicing/invoices | 200 | total_items 1 |
| webhook delete (2026-10-23 05:15) | DELETE /v1/notifications/webhooks/4G814100GL652302X | 204 |  |
| C8 webhook count (2026-10-23 05:15) | GET /v1/notifications/webhooks | 200 | 3 webhooks; circlekeeper ids [] |
| One app (2026-10-23 09:30) | Circlekeeper's own sandbox app for everything | 200 / 201 | invoice list 200, draft 201 (INV2-8UJD-L49R-SV7S-2R67), send 200, cash 200 MARKED_AS_PAID, transaction search 200, webhook 10T10056XK3372843 its only one; old shared app webhook 4G814100GL652302X deleted 204; end to end: 7 of 8 then the full round passed (1.3 min, payout SUCCESS) after the 403 re-mint fix |
| C3 payout create (2026-10-23 14:23) | POST /v1/payments/payouts (member1, 100.00 USD) | 201 | sender_batch_id ck-day1-e74b387c61; payout_batch_id 6FJA56TC49ESN; batch_status PENDING |
| C3 payout create (2026-10-23 14:23) | POST /v1/payments/payouts (member1, 600.00 USD) | 422 | INSUFFICIENT_FUNDS; debug_id ca4f1662e58b2 |
| C1 token (2026-10-23 17:49) | POST /v1/oauth2/token | 200 | expires_in 30902 s; 28 scopes |
| C8 webhook count (2026-10-23 17:49) | GET /v1/notifications/webhooks | 200 | 0 webhooks; circlekeeper ids [] |
| C9 register (2026-10-23 17:49) | POST /v1/notifications/webhooks | 201 | webhook id 2LY74939B2268944M; 5 types |
| webhook url (2026-10-23 17:51) | PATCH /v1/notifications/webhooks/10T10056XK3372843 | 200 | url now https://circlekeeper.midknight-labs.workers.dev/webhooks/paypal |
| webhook url (2026-10-23 17:51) | PATCH /v1/notifications/webhooks/2LY74939B2268944M | 200 | url now https://circlekeeper.midknight-labs.workers.dev/webhooks/paypal |
| C3 payout create (2026-10-23 17:52) | POST /v1/payments/payouts (member1, 1.00 USD) | 201 | sender_batch_id ck-day1-d4305c9c06; payout_batch_id 4NYYK8YECCGDJ; batch_status PENDING |
| C15 invoice draft (2026-10-23 17:52) | POST /v2/invoicing/invoices (detail, invoicer, primary_recipients, items) | 201 | invoice INV2-Z297-3MT8-2LE9-T8GC; status DRAFT |
| C16 send (2026-10-23 17:52) | POST /v2/invoicing/invoices/INV2-Z297-3MT8-2LE9-T8GC/send | 200 | link rels  |
| C18 cash record (2026-10-23 17:52) | POST /v2/invoicing/invoices/INV2-Z297-3MT8-2LE9-T8GC/payments | 200 | payment EXTR-9A560424HP081681N; status now MARKED_AS_PAID |
| C3 payout create (2026-10-23 18:11) | POST /v1/payments/payouts (member2, 1.00 USD) | 201 | sender_batch_id ck-day1-302375867f; payout_batch_id 9F7PZ35PTZCL6; batch_status PENDING |
| C11 events (2026-10-23 18:12) | GET /v1/notifications/webhooks-events (since 1h) | 200 | 1 events; WH-35F77869YY755763A-13D22766L4841891V PAYMENT.PAYOUTS-ITEM.SUCCEEDED |
| resend (2026-10-23 18:12) | POST /v1/notifications/webhooks-events/WH-35F77869YY755763A-13D22766L4841891V/resend | 202 | status  |
| Pot webhook live (2026-10-23 18:13) | Pot app $1 payout 9F7PZ35PTZCL6, its event resent to https://circlekeeper.midknight-labs.workers.dev/webhooks/paypal | 202 | the Worker's own log: "webhook verified", verification_status SUCCESS, event WH-35F77869YY755763A-13D22766L4841891V PAYMENT.PAYOUTS-ITEM.SUCCEEDED; then "ignored" (a test batch no circle owns) |
| C17 invoice (2026-10-23, between 17:52 and 18:10) | POST /v2/invoicing/invoices, then /send, for member1 | 201, 200 | invoice INV2-KZKN-YPER-349D-7N7Y SENT, payer link saved locally (not printed); the two rows were lost from this file by a mistaken checkout and are written again here |
| invoice get (2026-10-23 18:18) | GET /v2/invoicing/invoices/INV2-KZKN-YPER-349D-7N7Y | 200 | status PAID; payer view link present True |
| C11 events (2026-10-23 18:18) | GET /v1/notifications/webhooks-events (since 1h) | 200 | 1 events; WH-5D093991TT886070S-3UB97567SP260800S INVOICING.INVOICE.PAID |
| resend (2026-10-23 18:20) | POST /v1/notifications/webhooks-events/WH-4S487870BS638342E-9T4461441R605372Y/resend | 202 | status  |
| resend (2026-10-23 18:21) | POST /v1/notifications/webhooks-events/WH-4S487870BS638342E-9T4461441R605372Y/resend | 202 | status  |
| C17 buyer pays (2026-10-23 18:18) | member1 signs in on sandbox.paypal.com from the invoice's payer page (headless, `.wrangler/c17-pay.mjs`, not in git) and taps Complete Purchase | 200 | GET invoice INV2-KZKN-YPER-349D-7N7Y: status PAID; event WH-4S487870BS638342E-9T4461441R605372Y INVOICING.INVOICE.PAID at 18:18:47 UTC; resent at 18:27, the Worker's own log: "webhook verified", verification_status SUCCESS, then "ignored" (a test invoice no circle owns). Sign in allowed by the owner in this session on 23 Oct |
| Full round on the Pot setup (2026-10-23 18:24) | `e2e/happy.spec.ts` against a local Worker holding both apps (`CK_POT=1`), through the shared lock | 200 | 1 of 1 passed in 1.3 min; the pot went out from the Pot app: batch J3CWUSCRLFT7Q, PAYMENT.PAYOUTS-ITEM.SUCCEEDED at 18:24:17 UTC |
| Judges' path, local (2026-10-23 18:36) | `node dev/judge_run.mjs http://127.0.0.1:8795` through the lock: demo kqm37quez7, Marisol's "Pagar en PayPal", the sandbox buyer logs in on PayPal and pays | 200 | Marisol's share INV2-88MD-4VQ8-QWQW-VBNK PAID on the board 9 s after Complete Purchase (background refresh; local gets no webhooks); PayPal's page names the seller "Circlekeeper (sandbox)" |
| Hosted end to end (2026-10-24 00:03 to 00:05 UTC) | `node dev/hosted_e2e.mjs https://circlekeeper.midknight-labs.workers.dev --hosted` through the shared lock, one demo circle f79a92uszn on main 08ae97a | 11 of 11 PASS | Marisol paid on PayPal's own page as the sandbox buyer (INV2-MM7P-P2Q7-DLPM-339D), 5 shares by test card, two confirmers, payout batch 275DJE3BPBG64 item SUCCESS, receipt $0.00 and the book checks out; bad paths: early confirms 409, wrong key 403, forged webhook 400, need breaking swap refused. Pictures and ids: `shots/e2e-hosted/` (not in git) |
