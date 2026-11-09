# Review packet

Date: 2026-11-09
Published commit: 9e8e5ed

The published commit is the source commit the hosted demo was deployed from; this repository holds the same application
files and tests.

This page ties the code judges read to the hosted demo, the test results and one sandbox payout. The numbers in the
configuration table are checked against the code by `tests/docs/review-package.test.ts`, so they cannot drift.

## Hosted demo

https://circlekeeper.midknight-labs.workers.dev, deployed from the published commit above (Cloudflare version
a720e11d-911c-41ad-a67f-096585cfedee, 9 Nov 2026). PayPal sandbox only: test money.

## Demo configuration

| Setting | Value |
| --- | --- |
| Live model replies | off |
| Model | @cf/ibm-granite/granite-4.0-h-micro |
| New circles per visitor per day | 10 |
| Live pots per visitor per day | 3 |
| PayPal calls per circle per day | 80 |
| Model calls per visitor per day | 6 |
| Members per circle | 6 |
| PayPal base | https://api-m.sandbox.paypal.com |

With live model replies off, the treasurer's answers to the suggested messages are recorded model replies, marked
"recorded run" on screen. They still run through the same tool loop and the same checks. Daily limits reset at 00:00 UTC.

## Test results at the published commit

| Check | Result |
| --- | --- |
| Type check (`npx tsc --noEmit`) | 0 errors |
| Unit tests (`npx vitest run`) | 629 of 629 pass |
| Browser tests (`npx playwright test`) | 42 of 42 pass, against a local server |

## One sandbox payout, end to end

A full demo round run against the hosted site on 9 Nov 2026 at commit 89ba156 (the payment code has not changed since) (`python dev/demo_run.py <url>`), circle ytm8x38wn2:

| Step | Result |
| --- | --- |
| Round 1 invoices | 6 sent |
| Marisol's split | $100 invoice cancelled; $60 and $40 invoices sent |
| Swap | applied only after both Dana and Theo said yes |
| Shares | 7 parts paid with the sandbox test card |
| Early confirm | refused: "the round is not fully paid yet" |
| Confirmations | Dana, then Theo |
| Payout | batch FY9GN496BN4P2, item status SUCCESS |
| Round 2 | 6 invoices sent |

## How to check it yourself

Open the hosted demo and follow the judge path in the README. To run the tests locally, see Setup in the README.
