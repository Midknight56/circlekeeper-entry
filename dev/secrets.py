r"""Moves the PayPal sandbox values into the Worker without printing them.

Usage:
  python dev/secrets.py dev-vars        writes .dev.vars (ignored by git) for `wrangler dev`
  python dev/secrets.py put [--env X]   runs `npx wrangler secret put NAME` for each, the value on stdin

Reads `paypal-sandbox.local.txt` from the secrets folder (MIDKNIGHT_SECRETS, else ~/.cloudflare) for member personas only. Local runs use the older Pot app because the shared app also pays other live entries and must not be used here. Prints names only.
The webhook id, once registered, is read from .wrangler/webhook-id.txt.
"""
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def secrets_dir():
    env = os.environ.get("MIDKNIGHT_SECRETS")
    return env if env and os.path.isdir(env) else os.path.join(os.path.expanduser("~"), ".cloudflare")


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


def read_kv():
    kv = {}
    with open(os.path.join(secrets_dir(), os.environ.get("CK_PAYPAL_FILE", "paypal-sandbox.local.txt")), encoding="utf-8") as f:
        for line in f:
            if "=" in line and not line.startswith("#"):
                k, v = line.rstrip("\n").split("=", 1)
                kv[k.strip()] = v.strip()
    return overlay_app_keys(kv)


def values():
    kv = read_kv()
    members = [kv["PAYPAL_SANDBOX_BUYER_EMAIL"]]
    for n in range(2, 7):
        e = kv.get(f"PAYPAL_SANDBOX_MEMBER{n}_EMAIL")
        if e:
            members.append(e)
    out = {
        "PAYPAL_CLIENT_ID": kv["PAYPAL_SANDBOX_CLIENT_ID"],
        "PAYPAL_CLIENT_SECRET": kv["PAYPAL_SANDBOX_SECRET"],
        "PAYPAL_PERSONAS": json.dumps({"merchant": kv["PAYPAL_SANDBOX_MERCHANT_EMAIL"], "members": members}),
        "VISITOR_SALT": kv.get("CIRCLEKEEPER_VISITOR_SALT") or os.urandom(16).hex(),
    }
    # The webhook registered on the app in use (Circlekeeper's own app unless CK_PAYPAL_APP=shared).
    name = "webhook-id-shared-app.txt" if os.environ.get("CK_PAYPAL_APP") == "shared" else "webhook-id-payout-app.txt"
    hook = os.path.join(ROOT, ".wrangler", name)
    if os.path.exists(hook):
        out["PAYPAL_WEBHOOK_ID"] = open(hook, encoding="utf-8").read().strip()
    # The older "Circlekeeper Pot" app, when CK_POT=1. Since 2 Nov the main app sends every pot; this app only reads
    # the batches it already sent. Keep CK_POT=1 on a put to the Worker. Its own payout webhook id is in .wrangler/webhook-id-pot-app.txt.
    pot = os.path.join(secrets_dir(), "paypal-sandbox-circlekeeper-pot.local.txt")
    if os.environ.get("CK_POT") == "1" and os.path.exists(pot):
        own = {}
        with open(pot, encoding="utf-8") as f:
            for line in f:
                if "=" in line and not line.startswith("#"):
                    k, v = line.rstrip(chr(10)).split("=", 1)
                    own[k.strip()] = v.strip()
        out["PAYPAL_PAYOUT_CLIENT_ID"] = own["PAYPAL_SANDBOX_CLIENT_ID"]
        out["PAYPAL_PAYOUT_CLIENT_SECRET"] = own["PAYPAL_SANDBOX_SECRET"]
        hook = os.path.join(ROOT, ".wrangler", "webhook-id-pot-app.txt")
        if os.path.exists(hook):
            out["PAYPAL_PAYOUT_WEBHOOK_ID"] = open(hook, encoding="utf-8").read().strip()
    return out, len(members)


def local_pot_values():
    path = os.path.join(secrets_dir(), "paypal-sandbox-circlekeeper-pot.local.txt")
    if not os.path.exists(path):
        raise ValueError("missing paypal-sandbox-circlekeeper-pot.local.txt")
    own = {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            if "=" in line and not line.startswith("#"):
                k, v = line.rstrip(chr(10)).split("=", 1)
                own[k.strip()] = v.strip()
    required = {"PAYPAL_SANDBOX_CLIENT_ID": "LOCAL_POT_CLIENT_ID", "PAYPAL_SANDBOX_SECRET": "LOCAL_POT_CLIENT_SECRET"}
    missing = [name for key, name in required.items() if not own.get(key)]
    if missing:
        raise ValueError("missing keys in paypal-sandbox-circlekeeper-pot.local.txt: " + ", ".join(missing))
    return {name: own[key] for key, name in required.items()}


def wrangler_env():
    """The hackathon account's id and token, from dev/cf.py, so secrets land on the right account."""
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import cf
    return cf.env_for_wrangler()


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else ""
    vals, n_members = values()
    if mode == "dev-vars":
        try:
            local_pot = local_pot_values()
        except ValueError as error:
            sys.exit(str(error))
        path = os.path.join(ROOT, ".dev.vars")
        with open(path, "w", encoding="utf-8") as f:
            for k, v in vals.items():
                # Single quotes keep the JSON literal in a .dev.vars file.
                f.write(f"{k}='{v}'\n" if k == "PAYPAL_PERSONAS" else f"{k}={v}\n")
            # Local runs only: keep live payouts on the Pot app, not the shared app used by other live entries.
            f.write("LOCAL_CIRCLE_CAP=200\n")
            f.write("LOCAL_PAYPAL_WRITE_CAP=20000\n")
            f.write("LOCAL_PAYOUT_CAP_CENTS=100000000\n")
            f.write(f"LOCAL_POT_CLIENT_ID={local_pot['LOCAL_POT_CLIENT_ID']}\n")
            f.write(f"LOCAL_POT_CLIENT_SECRET={local_pot['LOCAL_POT_CLIENT_SECRET']}\n")
            f.write("LOCAL_POT_SEND_CENTS=100\n")
            f.write("LOCAL_LIVE_POT_CAP=200\n")
            f.write("DEV_ROUTES=1\n")
        print("wrote .dev.vars:", ", ".join(vals.keys()), f"({n_members} member personas)")
    elif mode == "put":
        extra = sys.argv[2:]
        for k, v in vals.items():
            r = subprocess.run(["npx", "wrangler", "secret", "put", k, *extra], input=v, text=True, cwd=ROOT,
                               capture_output=True, shell=(os.name == "nt"), env=wrangler_env(),
                               encoding="utf-8", errors="replace")
            print(k, "exit", r.returncode)
            if r.returncode != 0:
                tail = (r.stderr or r.stdout or "").strip().splitlines()[-1:]
                # The error line names the problem, never the value (the value went in on stdin).
                print("  ", tail[0] if tail else "")
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
