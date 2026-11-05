r"""Records the treasurer's real answers for the demo, and measures neurons per turn.

Usage: python dev/record_turns.py [base url, default http://127.0.0.1:8795]

Needs a local Worker started with live answers and raw capture on:
  python dev/cf.py dev --port 8795 --ip 127.0.0.1 --var LIVE_AI:1 --var DEV_ROUTES:1 --var LOCAL_AI_CAP:80
Makes a visitor circle from the demo text (so the setup turn is live), starts it, then sends each recorded turn's text
as its speaker. Writes samples/recorded-<date>.json with each turn's raw model steps, neurons and what was said.
Every model call is charged in the shared ledger by the Worker itself.
"""
import datetime as dt
import json
import os
import re
import sys
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8795"


def call(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method,
                                 headers={"content-type": "application/json", "user-agent": "circlekeeper-record/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def recorded_turns():
    src = open(os.path.join(ROOT, "src", "demo.ts"), encoding="utf-8").read()
    demo_text = re.search(r'export const DEMO_TEXT =\s*"([^"]+)"', src).group(1)
    turns = []
    for m in re.finditer(r'key: "([^"]+)",\s*speaker: "([^"]+)",\s*text: ("[^"]*"|DEMO_TEXT),', src):
        key, speaker, text = m.group(1), m.group(2), m.group(3).strip()
        text = demo_text if text == "DEMO_TEXT" else json.loads(text)
        turns.append((key, speaker, text))
    return demo_text, turns


def main():
    demo_text, turns = recorded_turns()
    code, d = call("POST", "/api/circles", {"text": demo_text})
    print("make circle", code, d.get("error", ""))
    if code != 200:
        return 1
    cid, org = d["id"], d["organiserToken"]
    tok = {m["memberId"]: m["url"].rsplit("/", 1)[1] for m in d["memberLinks"]}
    seen = set()

    def new_model_steps():
        _, s = call("GET", f"/api/circles/{cid}/state?k={org}")
        fresh = [l for l in reversed(s.get("log", [])) if l["kind"] in ("model", "drop", "tool") and (l["at"], l.get("note"), l.get("raw")) not in seen]
        for l in fresh:
            seen.add((l["at"], l.get("note"), l.get("raw")))
        return fresh

    out = {"recordedAt": dt.datetime.now(dt.timezone.utc).isoformat(), "circle": cid, "turns": []}

    def record(key, speaker, said_text):
        lines = new_model_steps()
        steps = [l["raw"] for l in lines if l["kind"] == "model" and l.get("raw")]
        neurons = round(sum(l.get("neurons") or 0 for l in lines if l["kind"] == "model"), 2)
        drops = [l["note"] for l in lines if l["kind"] == "drop"]
        tools = [f'{l.get("tool")}: {l.get("note")}' for l in lines if l["kind"] == "tool"]
        out["turns"].append({"key": key, "speaker": speaker, "text": said_text, "steps": steps, "neurons": neurons,
                             "drops": drops, "tools": tools})
        print(f"{key:<18} steps {len(steps)} neurons {neurons} drops {len(drops)} tools {tools}")

    record("setup", "organiser", demo_text)
    code, _ = call("POST", f"/api/circles/{cid}/start", {"k": org})
    print("start", code)
    new_model_steps()
    only = [a.split("=", 1)[1] for a in sys.argv[2:] if a.startswith("--only=")]
    only = only[0].split(",") if only else None
    for key, speaker, text in turns:
        if key == "setup" or (only and key not in only):
            continue
        k = org if speaker == "organiser" else tok[speaker]
        code, r = call("POST", f"/api/circles/{cid}/chat", {"k": k, "text": text})
        print("chat", key, code, r.get("error", ""), "neurons", r.get("neurons"), "dropped", r.get("dropped"))
        record(key, speaker, text)
    # What each person was told
    for key, speaker, _ in turns:
        k = org if speaker == "organiser" else tok[speaker]
        _, s = call("GET", f"/api/circles/{cid}/state?k={k}")
        said = [m["text"] for m in s["messages"] if m["from"] == "treasurer" and m["to"] in (f"member:{speaker}", "organiser")]
        for t in out["turns"]:
            if t["key"] == key:
                t["said"] = said
    os.makedirs(os.path.join(ROOT, "samples"), exist_ok=True)
    path = os.path.join(ROOT, "samples", f"recorded-{dt.date.today().isoformat()}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    total = round(sum(t["neurons"] for t in out["turns"]), 2)
    print("written", path, "total neurons", total)
    return 0


if __name__ == "__main__":
    sys.exit(main())
