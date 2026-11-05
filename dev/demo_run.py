r"""Plays the demo circle end to end against a running Worker, with real PayPal sandbox calls.

Usage: python dev/demo_run.py [base url, default http://127.0.0.1:8795]

Steps: make a demo copy, start it (6 invoices), Marisol's short share (recorded treasurer turn, then her tap),
Dana's swap (recorded turn, then Theo's and Dana's taps), cash records for every share, both confirmers, then wait for
the payout to reach SUCCESS. Prints HTTP codes, statuses and PayPal ids only, never a private link.
"""
import json
import sys
import time
import urllib.error
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8795"


def call(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method, headers={"content-type": "application/json", "user-agent": "circlekeeper-demo-run/1.0"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.status, json.loads(r.read() or b"{}")
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read() or b"{}")
        except (urllib.error.URLError, OSError):
            if attempt == 3:
                raise
            time.sleep(1.5)


def step(name, code, note=""):
    print(f"{name:<34} {code}  {note}")


def main():
    code, d = call("POST", "/api/demo")
    step("make demo copy", code, f"circle {d.get('id')}")
    if code != 200:
        print(d)
        return 1
    cid, org = d["id"], d["organiserToken"]
    tok = {m["memberId"]: m["url"].rsplit("/", 1)[1] for m in d["memberLinks"]}

    def state(k):
        c, s = call("GET", f"/api/circles/{cid}/state?k={k}")
        return s

    s = state(org)
    setup = [m for m in s["messages"] if m["from"] == "treasurer"]
    step("setup message (recorded)", 200, f"{len(setup)} treasurer messages; recorded={setup[-1].get('recorded') if setup else None}")
    rot = {r["memberId"]: r["month"] for r in s["circle"]["rotation"]}
    step("rotation", 200, ", ".join(f"{k} {v}" for k, v in rot.items()))

    code, r = call("POST", f"/api/circles/{cid}/start", {"k": org})
    step("start (round 1 invoices)", code, json.dumps(r)[:120])
    s = state(org)
    r1 = s["rounds"][0]
    inv = [p["invoiceId"] for sh in r1["shares"] for p in sh["parts"]]
    step("round 1 invoices", 200, f"{len(inv)}: " + " ".join(inv))

    code, r = call("POST", f"/api/circles/{cid}/chat", {"k": tok["marisol"], "text": "Solo tengo 60 esta semana."})
    step("marisol chat (recorded)", code, f"said {r.get('said')} dropped {r.get('dropped')} recorded {r.get('recorded')} neurons {r.get('neurons')}")
    ms = state(tok["marisol"])
    reply = [m["text"] for m in ms["messages"] if m["from"] == "treasurer" and m["to"] == "member:marisol"]
    step("marisol sees", 200, (reply[0][:90] + "...") if reply else "NO REPLY")
    split = [x for x in ms["splits"] if x["status"] == "proposed"]
    code, r = call("POST", f"/api/circles/{cid}/splits/{split[0]['id']}/consent", {"k": tok["marisol"], "answer": "yes"})
    step("marisol taps yes", code, json.dumps(r)[:80])
    s = state(org)
    msh = [sh for sh in s["rounds"][0]["shares"] if sh["memberId"] == "marisol"][0]
    step("marisol parts", 200, "; ".join(f"{p['cents']} {p['status']} {p['invoiceId']}" for p in msh["parts"]))
    group = [m["text"] for m in s["messages"] if m["to"] == "group"]
    step("group notice", 200, group[-1][:90] if group else "none")

    code, r = call("POST", f"/api/circles/{cid}/chat", {"k": tok["dana"], "text": "My rent went up. Can I take March instead of May?"})
    step("dana chat (recorded)", code, f"said {r.get('said')} dropped {r.get('dropped')} recorded {r.get('recorded')}")
    ds = state(tok["dana"])
    sw = [x for x in ds["swaps"] if x["status"] == "asked"]
    code, r = call("POST", f"/api/circles/{cid}/swaps/{sw[0]['id']}/consent", {"k": tok["theo"], "answer": "yes"})
    step("theo taps yes", code, json.dumps(r))
    s = state(org)
    step("rotation after one tap", 200, f"dana {[x['month'] for x in s['circle']['rotation'] if x['memberId'] == 'dana']}")
    code, r = call("POST", f"/api/circles/{cid}/swaps/{sw[0]['id']}/consent", {"k": tok["dana"], "answer": "yes"})
    step("dana taps yes", code, json.dumps(r))
    s = state(org)
    step("rotation after both taps", 200, f"dana {[x['month'] for x in s['circle']['rotation'] if x['memberId'] == 'dana']}, theo {[x['month'] for x in s['circle']['rotation'] if x['memberId'] == 'theo']}")
    step("change log", 200, s["changes"][-1]["text"] if s["changes"] else "none")

    code, r = call("POST", f"/api/circles/{cid}/rounds/1/release/confirm", {"k": tok["dana"]})
    step("dana confirms early (refused)", code, r.get("error", ""))

    # Each member pays by the sandbox test card, so the pot is funded by real sandbox share payments.
    s = state(org)
    r1 = s["rounds"][0]
    for sh in r1["shares"]:
        m = sh["memberId"]
        for p in sh["parts"]:
            if p["status"] not in ("CANCELLED", "PAID", "MARKED_AS_PAID"):
                code, r = call("POST", f"/api/circles/{cid}/shares/1/{m}/card", {"k": tok[m], "part": p["number"]})
                step(f"card share {m} part {p['number']}", code, r.get("error", ""))
    s = state(org)
    step("pot round 1", 200, s["rounds"][0]["pot"]["status"])

    code, r = call("POST", f"/api/circles/{cid}/rounds/1/release/confirm", {"k": tok["sam"]})
    step("sam confirms (not a confirmer)", code, r.get("error", ""))
    code, r = call("POST", f"/api/circles/{cid}/rounds/1/release/confirm", {"k": tok["dana"]})
    step("dana confirms", code, json.dumps(r))
    code, r = call("POST", f"/api/circles/{cid}/rounds/1/release/confirm", {"k": tok["theo"]})
    step("theo confirms (payout)", code, json.dumps(r))
    s = state(org)
    pot = s["rounds"][0]["pot"]
    step("pot after confirms", 200, f"{pot['status']} batch {pot['payoutBatchId']}")

    for _ in range(18):
        time.sleep(20)
        s = state(org)
        pot = s["rounds"][0]["pot"]
        if pot["status"] in ("paid", "failed"):
            break
    step("pot final", 200, f"{pot['status']} item {pot['itemStatus']} batch {pot['payoutBatchId']}")
    r2 = s["rounds"][1]
    step("round 2 invoices", 200, f"{sum(len(sh['parts']) for sh in r2['shares'])} parts sent")
    paypal = [l for l in s.get("log", []) if l["kind"] == "paypal"]
    step("PayPal calls in the panel", 200, f"{len(paypal)} calls; codes {sorted(set(l['status'] for l in paypal))}")
    drops = [l for l in s.get("log", []) if l["kind"] == "drop"]
    step("dropped sentences", 200, str(len(drops)))
    print("circle", cid)
    return 0


if __name__ == "__main__":
    sys.exit(main())
