"""Copies the Bryntum trial builds from node_modules into public/vendor/bryntum/ (ignored by git), so the Worker serves
them and the repo never carries vendor files. Run by `python dev/cf.py deploy` and `python dev/cf.py dev` before
wrangler starts.

Usage: python dev/vendor_bryntum.py
"""
import os
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "vendor", "bryntum")
# package folder, module file, the theme css it uses
PACKAGES = [("schedulerpro-trial", "schedulerpro.module.js", "schedulerpro.css"),
            ("calendar-trial", "calendar.module.js", "calendar.css")]
FOLDERS = ("fonts", "fontawesome")
LOCALES = ("En", "Es", "Fr", "FrFr")  # the languages the app speaks


def main():
    if os.path.isdir(OUT):
        shutil.rmtree(OUT)
    copied = 0
    for pkg, module, css in PACKAGES:
        src = os.path.join(ROOT, "node_modules", "@bryntum", pkg)
        if not os.path.isdir(src):
            print(f"vendor_bryntum: {pkg} is not installed; the pages fall back to the basic views")
            continue
        dst = os.path.join(OUT, pkg.replace("-trial", ""))
        os.makedirs(dst)
        for name in (module, css, "svalbard-light.css"):
            shutil.copy2(os.path.join(src, name), dst)
            copied += 1
        for folder in FOLDERS:
            shutil.copytree(os.path.join(src, folder), os.path.join(dst, folder))
            copied += 1
        os.makedirs(os.path.join(dst, "locales"))
        stem = module.split(".")[0]
        for lang in LOCALES:
            name = f"{stem}.locale.{lang}.js"
            if os.path.exists(os.path.join(src, "locales", name)):
                shutil.copy2(os.path.join(src, "locales", name), os.path.join(dst, "locales"))
                copied += 1
    print(f"vendor_bryntum: {copied} items in {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
