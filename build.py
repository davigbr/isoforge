#!/usr/bin/env python3
"""Assemble the single-file deliverable.

Sources stay modular under src/; this script concatenates them into
src/index.tpl.html and writes isoforge.html at the project root. The output is
the only thing that ships: one file, no server, no bundler, no dependency.

Usage: python3 build.py
"""

import base64
import hashlib
import json
import os
import subprocess
import sys
import tempfile

BASE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(BASE, "src")
OUT = os.path.join(BASE, "isoforge.html")
ATLAS_PNG = os.path.join(BASE, "assets", "atlas.png")

MODULES = [
    "core/rng.js",
    "core/iso.js",
    "core/loop.js",
    "world/grid.js",
    "sim/sim.js",
    "render/atlas.js",
    "render/canvas_renderer.js",
    "ui/hud.js",
    "app.js",
]

ATLAS_ANCHOR = "var ATLAS_DATA_URI = null;"
MODULE_MARKER = "/*__MODULES__*/"
STYLE_MARKER = "<!--__STYLE__-->"


def read(path):
    with open(path, encoding="utf-8") as handle:
        return handle.read()


def main():
    template = read(os.path.join(SRC, "index.tpl.html"))
    styles = read(os.path.join(SRC, "styles.css"))

    chunks = []
    for module in MODULES:
        path = os.path.join(SRC, module)
        if not os.path.exists(path):
            sys.exit("missing module: %s" % module)
        chunks.append("// ==== %s ====\n%s" % (module, read(path).rstrip() + "\n"))
    script = "\n".join(chunks)

    # Atlas injection. Phase 2 writes assets/atlas.png; until then the engine
    # bakes placeholder art in the browser and the anchor stays null.
    if script.count(ATLAS_ANCHOR) != 1:
        sys.exit("atlas anchor not found exactly once (%d)" % script.count(ATLAS_ANCHOR))
    if os.path.exists(ATLAS_PNG):
        with open(ATLAS_PNG, "rb") as handle:
            raw = handle.read()
        uri = "data:image/png;base64," + base64.b64encode(raw).decode("ascii")
        script = script.replace(
            ATLAS_ANCHOR,
            "var ATLAS_DATA_URI = %s;" % json.dumps(uri),
        )
        atlas_state = "embedded %d KB png" % (len(raw) // 1024)
    else:
        script = script.replace(
            ATLAS_ANCHOR,
            "var ATLAS_DATA_URI = (null);  // built: no assets/atlas.png yet (phase 2)",
        )
        atlas_state = "placeholder art baked at boot (no assets/atlas.png)"

    if template.count(MODULE_MARKER) != 1 or template.count(STYLE_MARKER) != 1:
        sys.exit("template markers must appear exactly once")

    html = template.replace(STYLE_MARKER, "<style>\n%s\n</style>" % styles.rstrip())
    html = html.replace(MODULE_MARKER, script)

    for marker in (MODULE_MARKER, STYLE_MARKER, ATLAS_ANCHOR):
        if marker in html:
            sys.exit("marker survived the build: %s" % marker)
    if html.count("</script>") != 1:
        sys.exit("expected exactly one closing script tag")

    # Syntax check before shipping: a syntax error inside the single file fails
    # silently in the browser and the page just stays blank.
    start = html.index("<script>") + len("<script>")
    end = html.index("</script>", start)
    handle, temp_path = tempfile.mkstemp(suffix=".js")
    with os.fdopen(handle, "w", encoding="utf-8") as temp:
        temp.write(html[start:end])
    check = subprocess.run(["node", "--check", temp_path], capture_output=True, text=True)
    os.unlink(temp_path)
    if check.returncode != 0:
        sys.exit("assembled script has a syntax error:\n%s" % (check.stderr or check.stdout))

    with open(OUT, "w", encoding="utf-8") as handle:
        handle.write(html)

    digest = hashlib.sha1(html.encode("utf-8")).hexdigest()
    print("built %s" % os.path.relpath(OUT, BASE))
    print("  size      : %.1f KB" % (len(html.encode("utf-8")) / 1024))
    print("  sha1      : %s" % digest)
    print("  modules   : %d" % len(MODULES))
    print("  atlas     : %s" % atlas_state)
    print("  script    : node --check ok")


if __name__ == "__main__":
    main()
