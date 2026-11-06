"""Checks that the configured Workers AI model is not marked for retirement."""
import re
import sys
from html.parser import HTMLParser
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class Text(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []

    def handle_data(self, data):
        self.parts.append(data)


def configured_model():
    source = (ROOT / "src" / "caps.ts").read_text(encoding="utf-8")
    match = re.search(r'export const MODEL_ID = "([^"]+)"', source)
    if not match:
        raise ValueError("MODEL_ID was not found in src/caps.ts")
    return match.group(1)


def deprecation_notice(text):
    patterns = (
        r"Planned Deprecation",
        r"Model Info.{0,200}Deprecat",
        r"deprecated, removed, or not found",
    )
    match = re.search("|".join(f"(?:{pattern})" for pattern in patterns), text, re.IGNORECASE | re.DOTALL)
    return match.group(0) if match else None


def self_test():
    cases = (
        ("Planned Deprecation: 2027-01-01", True),
        ("max_tokens integer | null Deprecated in favor of max_completion_tokens", False),
        ("Model not available. This model is deprecated, removed, or not found.", True),
        ("Model Info: current model details", False),
    )
    for text, expected in cases:
        if bool(deprecation_notice(text)) != expected:
            print(f"Self-test failed for: {text}", file=sys.stderr)
            return 1
    print("Deprecation notice self-test passed (4 cases).")
    return 0


def main():
    model = sys.argv[1] if len(sys.argv) > 1 else configured_model()
    slug = model.rsplit("/", 1)[-1]
    url = "https://developers.cloudflare.com/workers-ai/models/" + slug + "/"
    try:
        request = Request(url, headers={"User-Agent": "circlekeeper-model-check"})
        with urlopen(request, timeout=15) as response:
            if response.status != 200:
                print(f"Could not check model {model}: model page returned HTTP {response.status}.", file=sys.stderr)
                return 2
            page = response.read().decode("utf-8", errors="replace")
    except HTTPError as error:
        print(f"Could not check model {model}: model page returned HTTP {error.code}.", file=sys.stderr)
        return 2
    except (URLError, TimeoutError, OSError) as error:
        print(f"Could not check model {model}: {error}.", file=sys.stderr)
        return 2
    parser = Text()
    parser.feed(page)
    if deprecation_notice(" ".join(parser.parts)):
        print(f"Model {model} is marked deprecated or planned for deprecation at {url}.", file=sys.stderr)
        return 1
    print(f"Model {model} page has no deprecation notice.")
    return 0


if __name__ == "__main__":
    sys.exit(self_test() if "--self-test" in sys.argv[1:] else main())
