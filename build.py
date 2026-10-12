#!/usr/bin/env python3
"""Assemble the single-file deliverable.

Sources stay modular under src/; this script concatenates them into
src/index.tpl.html and writes isoforge.html at the project root. The output is
the only thing that ships: one file, no server, no bundler, no dependency.

Usage: python3 build.py
"""

import hashlib
import json
import os
import subprocess
import sys
import tempfile

BASE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(BASE, "src")
OUT = os.path.join(BASE, "isoforge.html")
ART_JSON = os.path.join(BASE, "assets", "art.json")

MODULES = [
    "core/rng.js",
    "core/iso.js",
    "core/loop.js",
    "world/grid.js",
    "sim/sim.js",
    "render/text_renderer.js",
    "render/art.js",
    "render/world_view.js",
    "ui/hud.js",
    "app.js",
]

# Phase 2 replaces the procedural shapes with templates sampled from the PIL
# scene through the ship's pipeline; they travel as JSON through this anchor.
ART_ANCHOR = "var ART_TEMPLATES = null;"
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

    if script.count(ART_ANCHOR) != 1:
        sys.exit("art anchor not found exactly once (%d)" % script.count(ART_ANCHOR))
    if os.path.exists(ART_JSON):
        with open(ART_JSON, encoding="utf-8") as handle:
            payload = handle.read()
        json.loads(payload)          # fail the build on malformed art
        script = script.replace(ART_ANCHOR, "var ART_TEMPLATES = %s;" % payload)
        art_state = "templates injected from assets/art.json (%d KB)" % (len(payload) // 1024)
    else:
        script = script.replace(
            ART_ANCHOR,
            "var ART_TEMPLATES = (null);  // built: procedural art (no assets/art.json yet)",
        )
        art_state = "procedural art in art.js (no assets/art.json)"

    if template.count(MODULE_MARKER) != 1 or template.count(STYLE_MARKER) != 1:
        sys.exit("template markers must appear exactly once")

    html = template.replace(STYLE_MARKER, "<style>\n%s\n</style>" % styles.rstrip())
    html = html.replace(MODULE_MARKER, script)

    for marker in (MODULE_MARKER, STYLE_MARKER, ART_ANCHOR):
        if marker in html:
            sys.exit("marker survived the build: %s" % marker)
    if html.count("</script>") != 1:
        sys.exit("expected exactly one closing script tag")
    if "<canvas" in html:
        sys.exit("the engine is text-only: no canvas allowed in the build")
    if "data:image" in html:
        sys.exit("the engine is text-only: no embedded image allowed in the build")

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
    print("  art       : %s" % art_state)
    print("  text-only : no canvas, no image")
    print("  script    : node --check ok")


if __name__ == "__main__":
    main()
