# Circlekeeper page API

The pages are plain HTML and JavaScript. They talk to the Worker with these calls. Every call that changes something sends
the viewer's key `k` (the organiser key or a member key) in the JSON body. Amounts are integer cents.

## Read

`GET /api/circles/:id/state?k=<key>` answers:

```json
{
  "version": 12,
  "now": "2026-12-03T14:02:00.000Z",
  "viewer": { "role": "organiser" },
  "circle": {
    "id": "demo", "name": "Saturday circle", "currency": "USD", "shareCents": 10000, "startMonth": "2026-12",
    "status": "active", "demo": true,
    "rules": { "privacy": true, "confirmers": ["dana", "theo"], "shortShare": { "allowed": true, "minNowCents": 5000, "laterDays": 14 } },
    "members": [ { "id": "keisha", "name": "Keisha", "lang": "en" } ],
    "rotation": [ { "round": 1, "memberId": "marisol", "month": "2026-12", "date": "2026-12-15" } ]
  },
  "rounds": [
    {
      "round": 1, "month": "2026-12", "date": "2026-12-15", "recipientId": "marisol",
      "pot": { "status": "waiting", "cents": 60000, "confirmations": ["dana"], "payoutBatchId": null, "itemStatus": null },
      "shares": [
        { "memberId": "keisha", "state": "paid", "reminded": false,
          "parts": [ { "cents": 10000, "status": "PAID", "invoiceId": "INV2-XXXX", "dueDate": "2026-12-10", "paidAt": "2026-12-02T10:00:00Z", "payerUrl": "https://..." } ] }
      ]
    }
  ],
  "swaps": [ { "id": "s1", "from": "dana", "to": "theo", "fromRound": 6, "toRound": 4, "status": "asked", "consents": { "theo": "yes" } } ],
  "splits": [ { "id": "p1", "round": 2, "memberId": "marisol", "nowCents": 6000, "laterCents": 4000, "dueDate": "2027-01-20", "status": "proposed" } ],
  "messages": [ { "id": "m1", "to": "group", "from": "treasurer", "text": "...", "at": "...", "kind": "chat", "recorded": true } ],
  "changes": [ { "at": "...", "text": "Dana and Theo swapped turns, both agreed" } ],
  "log": [ { "at": "...", "kind": "paypal", "method": "POST", "path": "/v2/invoicing/invoices", "status": 201, "ids": ["INV2-XXXX"] },
           { "at": "...", "kind": "tool", "tool": "find_swap_partners", "callId": "call_3", "note": "2 partners" },
           { "at": "...", "kind": "drop", "note": "dropped: not backed by a tool result" } ],
  "treasurer": { "live": false, "resting": false, "callsLeft": 6 }
}
```

- `viewer.role` is `organiser` or `member`; a member also gets `viewer.memberId`. A member sees only the group messages
  and messages to `member:<their id>`. A member does not get `log`.
- share `state`: `none`, `sent`, `paid`, `partial`, `cancelled`. part `status`: `DRAFT`, `SENT`, `UNPAID`, `PAID`,
  `MARKED_AS_PAID`, `CANCELLED`, `PAYER_ACTION`, `COMPLETED`.
- pot `status`: `waiting`, `drafted`, `paying`, `paid`, `failed`.
- swap `status`: `asked`, `applied`, `declined`. split `status`: `proposed`, `applied`, `declined`, `failed`.
- `recorded: true` on a message or log line means it was played from the recorded demo run. Show the words
  "recorded run" next to it.

## Write

| Call | Body | Who |
| --- | --- | --- |
| `POST /api/circles` | `{ "text": "6 of us, $100 a month from December..." }` | anyone; answers `{ id, organiserToken, memberLinks: [{memberId, name, url}] }` |
| `POST /api/circles/:id/start` | `{ k }` | organiser: sends round 1's invoices |
| `POST /api/circles/:id/rules` | `{ k, rules }` | organiser of an own draft circle: saves privacy, short share settings, missed share action, grace days and two distinct confirmers; refuses after Start and for recorded demo circles |
| `POST /api/circles/:id/member/split` | `{ k, nowCents }` | member: proposes their own current share split using the circle rule; the existing split consent route still needs their yes |
| `POST /api/circles/:id/member/partners` | `{ k }` | member: lists turn swap partners and the reasons a partner does not fit |
| `POST /api/circles/:id/member/swap` | `{ k, to }` | member: proposes their own turn swap; both members still consent |
| `POST /api/circles/:id/guard` | `{ k }` | organiser: runs isolated release and tool gate checks; returns each row's result, attempted POST payloads and observed write count |
| `POST /api/circles/:id/chat` | `{ k, text }` | organiser or member |
| `POST /api/circles/:id/swaps/:swapId/consent` | `{ k, answer: "yes" or "no" }` | the two members of the swap |
| `POST /api/circles/:id/splits/:splitId/consent` | `{ k, answer }` | the member of the split |
| `POST /api/circles/:id/missed/check` | `{ k }` | organiser of a demo circle: moves the demo clock to the round's due date plus the grace days plus one, and runs the late share check (real circles run it in the daily cron) |
| `POST /api/circles/:id/missed/:missedId/consent` | `{ k, answer }` | a confirmer who is not the late member |
| `POST /api/circles/:id/whatif` | `{ k, change }`, change one of `{ kind: "leave", memberId, month }`, `{ kind: "join", name }`, `{ kind: "need", memberId, needKind, month }` | organiser: a preview only, no PayPal call |
| `POST /api/circles/:id/whatif/clear` | `{ k }` | organiser: removes the preview |
| `POST /api/circles/:id/rounds/:n/release/confirm` | `{ k }` | a confirmer |
| `POST /api/circles/:id/shares/:n/:memberId/cash` | `{ k }` | organiser: records a cash share with PayPal |
| `POST /api/circles/:id/shares/:n/:memberId/order` | `{ k }` | the member: answers `{ approveUrl }` |
| `POST /api/demo/reset` | `{}` | anyone, at most once in 10 minutes |

Every write answers `{ ok: true, ... }` or `{ ok: false, error: "<words for a person>" }` with a 4xx code.

The organiser state includes `circle.unused`, the clauses the words reader understood nothing from. The board shows
these under "Not used:" above Start. Rule controls save on change, and Start awaits a final save before locking them.
The rules body has the same shape as `circle.rules`, with an optional `payDay` integer from 1 to 28. It updates
`circle.payDay` and the rotation dates without changing the turn order. Omitting it keeps the current pay day.
`shortShare.laterDays` keeps the circle's existing value. State includes `circle.payDay` for every viewer and
`circle.brokenNeeds` for the organiser. These unmet need texts stay on the draft and after Start, including after rule edits.

Guard rows carry `result` (`stopped`, `not_stopped` or `not_exercised`), translated `resultText`, and `attempted` entries
with method, path, payout items (`receiver`, `amount`) or `invoiceAmount`.
`paypalWrites` counts passed business POSTs; authentication is excluded. A release with no payout attempt is not exercised.
An interrupted check is not exercised, and the other checks still run. Without a matching recorded answer, the message
attack uses a fixed script through the real tool validator at zero neurons. It is labelled as a scripted attempt.

With live answers off, typed messages on an own circle explain that site setting in the member's language. Waiting
until tomorrow is said only for a daily allowance. The member's split and swap buttons call code and do not call a model.
