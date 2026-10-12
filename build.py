#!/usr/bin/env python3
"""Isoforge engine build.

Two modes, one source tree:

  python3 build.py                  engine artefact -> dist/
      dist/isoforge.engine.js    the whole engine, wrapped in one IIFE namespace
      dist/isoforge.engine.css   the grid stylesheet (world layer + HUD layer)
      dist/VERSION               the engine version, for a game to pin

  python3 build.py --example arena  a game built from the engine -> examples/
      examples/arena/arena.html  engine + game inlined into one file

A GAME never builds the engine: it vendors dist/ (see the cripta project's
build.py). That is the point of the split -- the engine has its own build, its
own tests and its own release artefact, and a game only consumes it.

Why the artefact is a plain script and not an ES module: games have to open from
file:// with two clicks, and file:// refuses module imports (CORS). So the engine
is one IIFE assigning `var Isoforge`, and the build asserts the output never
grows a canvas, an image, a network call or a module import.
"""

import hashlib
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, "src")
DIST = os.path.join(ROOT, "dist")

# Dependency order matters: config first (everything reads it), engine.js last
# (it returns the surface).
MODULES = [
    "core/config.js",
    "core/rng.js",
    "core/iso.js",
    "core/loop.js",
    "core/persist.js",
    "render/text_renderer.js",
    "render/world_view.js",
    "sim/grid.js",
    "sim/actor.js",
    "sim/headless.js",
    "ui/hud.js",
    "engine.js",
]

ENGINE_MARKER = "/*__ENGINE__*/"
GAME_MARKER = "/*__GAME__*/"
STYLE_MARKER = "<!--__STYLE__-->"

# A build that grows one of these has broken the offline, text-only promise.
FORBIDDEN = [
    ("<canvas", "canvas element"),
    ("data:image", "inlined image"),
    ("http://", "network URL"),
    ("https://", "network URL"),
    ("import ", "ES module import"),
    ("fetch(", "network call"),
]


def read(path):
    with open(path, encoding="utf-8") as handle:
        return handle.read()


def write(path, text):
    directory = os.path.dirname(path)
    if directory:
        os.makedirs(directory, exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(text)


def check_syntax(javascript, label):
    """A syntax error inside a single-file game fails SILENTLY in the browser:
    blank page, empty console. node --check is the only cheap way to catch it."""
    if subprocess.run(["node", "--version"], capture_output=True).returncode != 0:
        print("  script    : node not found, syntax check skipped")
        return
    probe = os.path.join(ROOT, ".build-probe.js")
    write(probe, javascript)
    result = subprocess.run(["node", "--check", probe], capture_output=True, text=True)
    os.unlink(probe)
    if result.returncode != 0:
        sys.exit("syntax error in %s:\n%s" % (label, (result.stderr or result.stdout).strip()))
    print("  script    : node --check ok")


def assert_clean(text, label):
    lowered = text.lower()
    for needle, what in FORBIDDEN:
        if needle in lowered:
            sys.exit("%s contains a %s (%r): the offline text-only promise is broken"
                     % (label, what, needle))
    print("  offline   : no canvas, no image, no network, no module")


def engine_version():
    found = re.search(r'ENGINE_VERSION\s*=\s*"([^"]+)"', read(os.path.join(SRC, "core", "config.js")))
    if not found:
        sys.exit("ENGINE_VERSION not found in src/core/config.js")
    return found.group(1)


def assert_markers(template, *markers):
    for marker in markers:
        if template.count(marker) != 1:
            sys.exit("template marker %s must appear exactly once (%d)"
                     % (marker, template.count(marker)))


def build_engine():
    chunks = []
    for module in MODULES:
        path = os.path.join(SRC, module)
        if not os.path.exists(path):
            sys.exit("missing engine module: %s" % module)
        chunks.append("// ---- %s %s\n%s" % (module, "-" * max(0, 66 - len(module)), read(path).rstrip()))

    version = engine_version()
    javascript = (
        "// Isoforge %s -- 2:1 isometric, text-mode, deterministic, offline.\n"
        "// Assembled from src/ by build.py. DO NOT EDIT: edit the modules and rebuild.\n"
        "var Isoforge = (function () {\n"
        "\"use strict\";\n\n%s\n\nreturn engineSurface();\n})();\n"
    ) % (version, "\n\n".join(chunks))

    write(os.path.join(DIST, "isoforge.engine.js"), javascript)
    write(os.path.join(DIST, "isoforge.engine.css"), read(os.path.join(SRC, "engine.css")))
    write(os.path.join(DIST, "VERSION"), version + "\n")
    # A release file with the hashes, so a game can tell a real release from a
    # vendored copy somebody edited by hand: the version number alone does not
    # prove the bytes are the ones the engine built.
    release = {
        "version": version,
        "engine": hashlib.sha1(javascript.encode("utf-8")).hexdigest(),
        "engine_bytes": len(javascript.encode("utf-8")),
        "css": hashlib.sha1(read(os.path.join(SRC, "engine.css")).encode("utf-8")).hexdigest(),
        "modules": MODULES,
    }
    write(os.path.join(DIST, "release.json"), json.dumps(release, indent=2) + "\n")

    check_syntax(javascript, "isoforge.engine.js")
    assert_clean(javascript, "isoforge.engine.js")
    print("built dist/isoforge.engine.js")
    print("  version   : %s" % version)
    print("  size      : %.1f KB" % (len(javascript.encode("utf-8")) / 1024))
    print("  sha1      : %s" % release["engine"])
    print("  modules   : %d" % len(MODULES))
    print("  release   : dist/release.json (hashes, for the games to verify)")


def release_hash():
    """The hash of the engine release being inlined. Read from the manifest so the
    banner and the manifest cannot disagree."""
    path = os.path.join(DIST, "release.json")
    if not os.path.exists(path):
        sys.exit("dist/release.json ausente: rode o build do motor antes")
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)["engine"]


def build_example(name):
    directory = os.path.join(ROOT, "examples", name)
    if not os.path.isdir(directory):
        sys.exit("no such example: %s" % name)

    engine_js = read(os.path.join(DIST, "isoforge.engine.js"))
    engine_css = read(os.path.join(DIST, "isoforge.engine.css"))
    template = read(os.path.join(directory, "index.tpl.html"))
    game_js = read(os.path.join(directory, "game.js"))
    game_css = read(os.path.join(directory, "styles.css")) if os.path.exists(
        os.path.join(directory, "styles.css")) else ""

    assert_markers(template, ENGINE_MARKER, GAME_MARKER, STYLE_MARKER)
    banner = "<!-- engine: isoforge %s %s -->" % (engine_version(), release_hash())
    html = template.replace(STYLE_MARKER, banner + "\n<style>\n%s\n%s\n</style>" % (engine_css.rstrip(), game_css.rstrip()))
    html = html.replace(ENGINE_MARKER, engine_js.rstrip())
    html = html.replace(GAME_MARKER, game_js.rstrip())
    for marker in (ENGINE_MARKER, GAME_MARKER, STYLE_MARKER):
        if marker in html:
            sys.exit("marker survived the build: %s" % marker)

    out = os.path.join(directory, "%s.html" % name)
    write(out, html)
    check_syntax(engine_js + "\n" + game_js, "%s.js" % name)
    assert_clean(html, "%s.html" % name)
    print("built examples/%s/%s.html" % (name, name))
    print("  engine    : %s" % engine_version())
    print("  size      : %.1f KB" % (len(html.encode("utf-8")) / 1024))
    print("  sha1      : %s" % hashlib.sha1(html.encode("utf-8")).hexdigest())
    print("  open      : file://%s" % out)


def main(argv):
    if "--example" in argv:
        index = argv.index("--example")
        name = argv[index + 1] if len(argv) > index + 1 else "arena"
        print("isoforge %s -- example %s" % (engine_version(), name))
        build_example(name)
        return
    print("isoforge %s -- engine" % engine_version())
    build_engine()


if __name__ == "__main__":
    main(sys.argv[1:])
