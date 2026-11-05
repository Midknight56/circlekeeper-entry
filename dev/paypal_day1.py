r"""Day one checks against the PayPal sandbox. Prints HTTP codes, PayPal ids and status words only.

Usage: python dev/paypal_day1.py <check> [args]

Reads `paypal-sandbox.local.txt` from the secrets folder (MIDKNIGHT_SECRETS, else ~/.cloudflare). Never prints a key, a
token, a password, a persona email or a payer link. Each result is appended to docs/DAY1-RECEIPTS.md. A connection that
could not be made is retried (nothing was sent, so a retry is safe for a write too).

Checks: token, event-types, payout-one, poll-payout, order-one, order-card, webhooks-list, webhook-register,
webhook-delete, simulate, events, resend, invoice-read, invoice-one, invoice-send, invoice-get, invoice-cash,
invoice-cancel, invoice-remind, transactions.
"""
import argparse
import base64
import datetime as dt
import json
import os
import sys
import time
import urllib.error
import urllib.request
import uuid

BASE = "https://api-m.sandbox.paypal.com"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RECEIPTS = os.path.join(ROOT, "docs", "DAY1-RECEIPTS.md")

WANTED_EVENTS = [
    "INVOICING.INVOICE.PAID",
    "INVOICING.INVOICE.CANCELLED",
    "PAYMENT.PAYOUTSBATCH.SUCCESS",
    "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
    "PAYMENT.PAYOUTSBATCH.DENIED",
    "PAYMENT.PAYOUTS-ITEM.FAILED",
    "PAYMENT.PAYOUTS-ITEM.UNCLAIMED",
    "PAYMENT.CAPTURE.COMPLETED",
]


def secrets_dir():
    env = os.environ.get("MIDKNIGHT_SECRETS")
    if env and os.path.isdir(env):
        return env
    return os.path.join(os.path.expanduser("~"), ".cloudflare")


APP_FILE = "paypal-sandbox-circlekeeper.local.txt"
APP_KEYS = ("PAYPAL_SANDBOX_CLIENT_ID", "PAYPAL_SANDBOX_SECRET", "PAYPAL_SANDBOX_MERCHANT_EMAIL")


def overlay_app_keys(kv):
    """Circlekeeper's own sandbox app (since 23 Oct): its keys and merchant come from APP_FILE when it exists;
    the member personas stay in the shared file."""
    # Circlekeeper's own app does everything since 23 Oct; CK_PAYPAL_APP=shared goes back to the shared app.
    if os.environ.get("CK_PAYPAL_APP") == "shared":
        return kv
    path = os.path.join(secrets_dir(), os.environ.get("CK_PAYPAL_APP_FILE", APP_FILE))
    if not os.path.exists(path):
        return kv
    with open(path, encoding="utf-8") as f:
        for line in f:
            if "=" in line and not line.startswith("#"):
                k, v = line.rstrip(chr(10)).split("=", 1)
                if k.strip() in APP_KEYS:
                    kv[k.strip()] = v.strip()
    return kv


def read_secrets():
    kv = {}
    with open(os.path.join(secrets_dir(), os.environ.get("CK_PAYPAL_FILE", "paypal-sandbox.local.txt")), encoding="utf-8") as f:
        for line in f:
            if "=" in line and not line.startswith("#"):
                k, v = line.rstrip("\n").split("=", 1)
                kv[k.strip()] = v.strip()
    return overlay_app_keys(kv)


def member_email(kv, name):
    """member1 is the existing buyer; member2..6 come from PAYPAL_SANDBOX_MEMBERn_EMAIL."""
    if name == "member1":
        return kv["PAYPAL_SANDBOX_BUYER_EMAIL"]
    key = f"PAYPAL_SANDBOX_{name.upper()}_EMAIL"
    if key not in kv:
        sys.exit(f"{key} is not in the secrets file yet (see the README, Run it)")
    return kv[key]


def call(method, path, token=None, body=None, headers=None, tries=4):
    url = path if path.startswith("http") else BASE + path
    h = {"Content-Type": "application/json"}
    if token:
        h["Authorization"] = "Bearer " + token
    if headers:
        h.update(headers)
    data = body if isinstance(body, (bytes, type(None))) else json.dumps(body).encode()
    if method == "POST" and "PayPal-Request-Id" not in h and "oauth2" not in url:
        h["PayPal-Request-Id"] = str(uuid.uuid4())
    req = urllib.request.Request(url, method=method, data=data, headers=h)
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                raw = r.read().decode("utf-8", "replace")
                return r.status, parse(raw)
        except urllib.error.HTTPError as e:
            return e.code, parse(e.read().decode("utf-8", "replace"))
        except (urllib.error.URLError, OSError) as e:
            if attempt == tries - 1:
                return 0, {"name": "NO_CONNECTION", "message": type(e).__name__}
            time.sleep(1.5)


def parse(raw):
    try:
        return json.loads(raw) if raw else {}
    except ValueError:
        return {"raw_len": len(raw)}


def get_token(kv):
    basic = base64.b64encode(f"{kv['PAYPAL_SANDBOX_CLIENT_ID']}:{kv['PAYPAL_SANDBOX_SECRET']}".encode()).decode()
    code, j = call("POST", "/v1/oauth2/token", body=b"grant_type=client_credentials",
                   headers={"Authorization": "Basic " + basic, "Content-Type": "application/x-www-form-urlencoded"})
    return code, j


def err(j):
    """The error name and debug_id, never a message that could echo input."""
    parts = []
    if j.get("name"):
        parts.append(j["name"])
    if j.get("error"):
        parts.append(j["error"])
    if j.get("debug_id"):
        parts.append("debug_id " + j["debug_id"])
    for d in (j.get("details") or [])[:4]:
        parts.append(f"{d.get('issue', '')} at {d.get('field', '')}".strip())
    return "; ".join(parts)


def receipt(check, call_text, code, note):
    line = f"| {check} | {call_text} | {code} | {note} |"
    print(line)
    os.makedirs(os.path.dirname(RECEIPTS), exist_ok=True)
    new = not os.path.exists(RECEIPTS)
    with open(RECEIPTS, "a", encoding="utf-8") as f:
        if new:
            f.write("# Day one receipts\n\nWritten by `python dev/paypal_day1.py`. HTTP codes, PayPal ids and status "
                    "words only. Times are UTC.\n\n| Check | Call | HTTP | Note |\n| --- | --- | --- | --- |\n")
        stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M")
        f.write(f"| {check} ({stamp}) | {call_text} | {code} | {note} |\n")


def link_rels(j):
    return ",".join(l.get("rel", "?") for l in j.get("links", []))


def main():
    p = argparse.ArgumentParser()
    p.add_argument("check")
    p.add_argument("arg", nargs="?")
    p.add_argument("--to", default="member1")
    p.add_argument("--value", default="1.00")
    p.add_argument("--url")
    p.add_argument("--event", default="PAYMENT.PAYOUTSBATCH.SUCCESS")
    p.add_argument("--since", default="1h")
    p.add_argument("--webhook-id")
    a = p.parse_args()
    kv = read_secrets()
    code, tj = get_token(kv)
    if a.check == "token":
        note = f"expires_in {tj.get('expires_in')} s; {len(tj.get('scope', '').split())} scopes" if code == 200 else err(tj)
        receipt("C1 token", "POST /v1/oauth2/token", code, note)
        return
    if code != 200:
        receipt(a.check, "POST /v1/oauth2/token", code, err(tj))
        sys.exit(1)
    tok = tj["access_token"]
    c = a.check

    if c == "event-types":
        code, j = call("GET", "/v1/notifications/webhooks-event-types", tok)
        names = {e.get("name") for e in j.get("event_types", [])}
        found = [f"{n} {'FOUND' if n in names else 'MISSING'}" for n in WANTED_EVENTS]
        receipt("C2 event names", "GET /v1/notifications/webhooks-event-types", code,
                f"{len(names)} types; " + "; ".join(found))

    elif c == "payout-one":
        sid = "ck-day1-" + uuid.uuid4().hex[:10]
        body = {
            "sender_batch_header": {"sender_batch_id": sid, "email_subject": "Circlekeeper test payout",
                                    "email_message": "Sandbox test money from Circlekeeper."},
            "items": [{"recipient_type": "EMAIL", "amount": {"value": a.value, "currency": "USD"},
                       "receiver": member_email(kv, a.to), "note": "Circlekeeper day one test",
                       "sender_item_id": sid + "-" + a.to}],
        }
        code, j = call("POST", "/v1/payments/payouts", tok, body)
        bh = j.get("batch_header", {})
        note = (f"sender_batch_id {sid}; payout_batch_id {bh.get('payout_batch_id')}; batch_status "
                f"{bh.get('batch_status')}" if code in (200, 201) else err(j))
        receipt("C3 payout create", f"POST /v1/payments/payouts ({a.to}, {a.value} USD)", code, note)

    elif c == "poll-payout":
        bid = a.arg
        status, code, j = None, 0, {}
        for _ in range(30):
            code, j = call("GET", f"/v1/payments/payouts/{bid}", tok)
            status = j.get("batch_header", {}).get("batch_status")
            if status in ("SUCCESS", "DENIED", "CANCELED") or code != 200:
                break
            time.sleep(10)
        items = j.get("items", [])
        item = items[0] if items else {}
        note = (f"batch_status {status}; item {item.get('payout_item_id')} transaction_status "
                f"{item.get('transaction_status')}; amount field keys {sorted(item.get('payout_item', {}).get('amount', {}).keys())}"
                if code == 200 else err(j))
        receipt("C3 payout poll", f"GET /v1/payments/payouts/{bid}", code, note)

    elif c == "order-one":
        body = {"intent": "CAPTURE",
                "purchase_units": [{"amount": {"currency_code": "USD", "value": a.value}, "custom_id": "CK-day1-order"}],
                "payment_source": {"paypal": {"experience_context": {
                    "return_url": "https://example.com/return", "cancel_url": "https://example.com/cancel"}}}}
        code, j = call("POST", "/v2/checkout/orders", tok, body)
        rels = link_rels(j)
        note = (f"order {j.get('id')}; status {j.get('status')}; link rels {rels}" if code in (200, 201) else err(j))
        receipt("C4 order create", "POST /v2/checkout/orders (paypal source, return_url in experience_context)", code, note)

    elif c == "order-card":
        body = {"intent": "CAPTURE",
                "purchase_units": [{"amount": {"currency_code": "USD", "value": a.value}, "custom_id": "CK-day1-card"}],
                "payment_source": {"card": {"number": "4111111111111111", "expiry": "2027-12",
                                            "name": "Test Buyer", "security_code": "123"}}}
        code, j = call("POST", "/v2/checkout/orders", tok, body)
        cap = (((j.get("purchase_units") or [{}])[0].get("payments") or {}).get("captures") or [{}])[0]
        note = (f"order {j.get('id')}; status {j.get('status')}; capture {cap.get('id')} {cap.get('status')}"
                if code in (200, 201) else err(j))
        receipt("C5 order card", "POST /v2/checkout/orders (test card)", code, note)

    elif c == "webhooks-list":
        code, j = call("GET", "/v1/notifications/webhooks", tok)
        hooks = j.get("webhooks", [])
        mine = [h["id"] for h in hooks if "circlekeeper" in h.get("url", "")]
        receipt("C8 webhook count", "GET /v1/notifications/webhooks", code,
                f"{len(hooks)} webhooks; circlekeeper ids {mine}" if code == 200 else err(j))

    elif c == "webhook-register":
        body = {"url": a.url, "event_types": [{"name": n} for n in (a.arg.split(",") if a.arg else WANTED_EVENTS)]}
        code, j = call("POST", "/v1/notifications/webhooks", tok, body)
        receipt("C9 register", "POST /v1/notifications/webhooks", code,
                f"webhook id {j.get('id')}; {len(j.get('event_types', []))} types" if code in (200, 201) else err(j))
        if code in (200, 201):
            out = os.path.join(ROOT, ".wrangler", "webhook-id.txt")
            os.makedirs(os.path.dirname(out), exist_ok=True)
            with open(out, "w", encoding="utf-8") as f:
                f.write(j["id"])

    elif c == "webhook-update":
        body = [{"op": "replace", "path": "/url", "value": a.url}]
        code, j = call("PATCH", f"/v1/notifications/webhooks/{a.arg}", tok, body)
        receipt("webhook url", f"PATCH /v1/notifications/webhooks/{a.arg}", code,
                f"url now {j.get('url')}" if code == 200 else err(j))

    elif c == "webhook-delete":
        code, j = call("DELETE", f"/v1/notifications/webhooks/{a.arg}", tok)
        receipt("webhook delete", f"DELETE /v1/notifications/webhooks/{a.arg}", code, "" if code == 204 else err(j))

    elif c == "simulate":
        body = {"event_type": a.event}
        if a.webhook_id:
            body["webhook_id"] = a.webhook_id
        else:
            body["url"] = a.url
        code, j = call("POST", "/v1/notifications/simulate-event", tok, body)
        receipt("C10 simulate", f"POST /v1/notifications/simulate-event ({a.event})", code,
                f"event {j.get('id')}" if code in (200, 202) else err(j))

    elif c == "events":
        hours = int(a.since.rstrip("hd")) * (24 if a.since.endswith("d") else 1)
        start = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=hours)).strftime("%Y-%m-%dT%H:%M:%SZ")
        code, j = call("GET", f"/v1/notifications/webhooks-events?page_size=50&start_time={start}", tok)
        evs = j.get("events", [])
        rows = [f"{e.get('id')} {e.get('event_type')} {e.get('resource', {}).get('batch_header', {}).get('payout_batch_id', '')}".strip()
                for e in evs if e.get("event_type", "").startswith(("PAYMENT.PAYOUTS", "INVOICING", "PAYMENT.CAPTURE"))]
        receipt("C11 events", f"GET /v1/notifications/webhooks-events (since {a.since})", code,
                f"{len(evs)} events; " + "; ".join(rows[:8]) if code == 200 else err(j))

    elif c == "resend":
        body = {"webhook_ids": [a.webhook_id]} if a.webhook_id else {}
        code, j = call("POST", f"/v1/notifications/webhooks-events/{a.arg}/resend", tok, body)
        receipt("resend", f"POST /v1/notifications/webhooks-events/{a.arg}/resend", code,
                f"status {j.get('status', '')}" if code in (200, 202) else err(j))

    elif c == "invoice-read":
        code, j = call("GET", "/v2/invoicing/invoices?page=1&page_size=1&total_required=true", tok)
        receipt("C14 invoicing on", "GET /v2/invoicing/invoices", code,
                f"total_items {j.get('total_items')}" if code == 200 else err(j))

    elif c == "invoice-one":
        due = (dt.date.today() + dt.timedelta(days=10)).isoformat()
        body = {
            "detail": {"currency_code": "USD", "invoice_number": "CK-day1-" + uuid.uuid4().hex[:8],
                       "note": "Your share for the circle.", "payment_term": {"due_date": due}},
            "invoicer": {"email_address": kv["PAYPAL_SANDBOX_MERCHANT_EMAIL"]},
            "primary_recipients": [{"billing_info": {"email_address": member_email(kv, a.to),
                                                     "name": {"given_name": "Test", "surname": "Member"}}}],
            "items": [{"name": "Circle share", "quantity": "1",
                       "unit_amount": {"currency_code": "USD", "value": a.value}}],
        }
        code, j = call("POST", "/v2/invoicing/invoices", tok, body, headers={"Prefer": "return=representation"})
        note = f"invoice {j.get('id')}; status {j.get('status')}" if code in (200, 201) else err(j)
        receipt("C15 invoice draft", "POST /v2/invoicing/invoices (detail, invoicer, primary_recipients, items)", code, note)

    elif c == "invoice-send":
        code, j = call("POST", f"/v2/invoicing/invoices/{a.arg}/send", tok,
                       {"send_to_recipient": True, "subject": "Your circle share", "note": "Thank you."})
        receipt("C16 send", f"POST /v2/invoicing/invoices/{a.arg}/send", code,
                f"link rels {link_rels(j)}" if code in (200, 202) else err(j))

    elif c == "invoice-get":
        code, j = call("GET", f"/v2/invoicing/invoices/{a.arg}", tok)
        meta = j.get("detail", {}).get("metadata", {})
        receipt("invoice get", f"GET /v2/invoicing/invoices/{a.arg}", code,
                f"status {j.get('status')}; payer view link present {'recipient_view_url' in meta}" if code == 200 else err(j))

    elif c == "invoice-cash":
        body = {"method": "CASH", "payment_date": dt.date.today().isoformat(),
                "amount": {"currency_code": "USD", "value": a.value}}
        code, j = call("POST", f"/v2/invoicing/invoices/{a.arg}/payments", tok, body)
        code2, j2 = call("GET", f"/v2/invoicing/invoices/{a.arg}", tok)
        receipt("C18 cash record", f"POST /v2/invoicing/invoices/{a.arg}/payments", code,
                (f"payment {j.get('payment_id', '')}; status now {j2.get('status')}") if code < 300 else err(j))

    elif c == "invoice-cancel":
        code, j = call("POST", f"/v2/invoicing/invoices/{a.arg}/cancel", tok,
                       {"subject": "Share replaced", "note": "This share was replaced.", "send_to_recipient": True})
        code2, j2 = call("GET", f"/v2/invoicing/invoices/{a.arg}", tok)
        receipt("C19 cancel", f"POST /v2/invoicing/invoices/{a.arg}/cancel", code,
                f"status now {j2.get('status')}" if code < 300 else err(j))

    elif c == "invoice-remind":
        code, j = call("POST", f"/v2/invoicing/invoices/{a.arg}/remind", tok,
                       {"subject": "A kind reminder", "note": "Your share is due soon."})
        receipt("C20 remind", f"POST /v2/invoicing/invoices/{a.arg}/remind", code, "" if code < 300 else err(j))

    elif c == "transactions":
        days = int(a.since.rstrip("d"))
        end = dt.datetime.now(dt.timezone.utc)
        start = end - dt.timedelta(days=days)
        f = "%Y-%m-%dT%H:%M:%S-0000"
        code, j = call("GET", f"/v1/reporting/transactions?start_date={start.strftime(f)}&end_date={end.strftime(f)}"
                              "&fields=transaction_info&page_size=100", tok)
        receipt("C21 transaction search", f"GET /v1/reporting/transactions (last {days} d)", code,
                f"{len(j.get('transaction_details', []))} transactions" if code == 200 else err(j))
    else:
        sys.exit("unknown check " + c)


if __name__ == "__main__":
    main()
