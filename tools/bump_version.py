#!/usr/bin/env python3
"""Stamp a new ?v= on every local asset, so a deploy is not served from cache.

GitHub Pages lets a browser hold on to js and css for a while, and an ES module
graph is cached per URL: versioning only the entry script leaves every import it
pulls in stale, which is how a half-old build ends up running. This rewrites the
marker on the stylesheet, the entry script and every relative import at once, so
one bump invalidates the whole set.

    python3 tools/bump_version.py          # next version
    python3 tools/bump_version.py 12       # or an explicit one
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
TARGETS = [ROOT / "index.html", *sorted((ROOT / "js").glob("*.js"))]
# (file pattern, the part to keep) — each captures an optional existing ?v=.
RULES = [
    (re.compile(r"""(href="css/style\.css)(\?v=\d+)?(")"""), None),
    (re.compile(r"""(src="js/main\.js)(\?v=\d+)?(")"""), None),
    (re.compile(r"""(from '\./[A-Za-z0-9_-]+\.js)(\?v=\d+)?(')"""), None),
]


def current():
    seen = [0]
    for path in TARGETS:
        seen += [int(m) for m in re.findall(r"\?v=(\d+)", path.read_text())]
    return max(seen)


def stamp(version):
    touched = 0
    for path in TARGETS:
        text = original = path.read_text()
        for pattern, _ in RULES:
            text = pattern.sub(rf"\g<1>?v={version}\g<3>", text)
        if text != original:
            path.write_text(text)
            touched += 1
    return touched


version = int(sys.argv[1]) if len(sys.argv) > 1 else current() + 1
print(f"stamped v{version} across {stamp(version)} files")
