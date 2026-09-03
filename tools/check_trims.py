#!/usr/bin/env python3
"""Verify the baked trim rects in game.js against the artwork they crop.

Trims are fixed pixel rects because the game must run from file://, where
canvas pixel readback is blocked - so nothing can measure them at runtime.
The cost is that re-exporting a sprite silently invalidates its trim, which
shows up as a cropped animal rather than an error. This catches that.

    python3 tools/check_trims.py        # exits 1 if anything drifted
"""
import re, sys
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
src = (ROOT / "game.js").read_text()
TRIM = re.compile(r"trim: \{ sx: (\d+), sy: (\d+), sw: (\d+), sh: (\d+) \}")


def bbox(path):
    b = Image.open(path).convert("RGBA").getbbox()
    return None if b is None else (b[0], b[1], b[2] - b[0], b[3] - b[1])


def theme_reactions(theme):
    """role -> [pose files], from that theme's `reactions:` literal."""
    m = re.search(r'%s: makeTheme\(' % theme, src)
    if not m:
        return {}
    blk = src[m.start():]
    r = re.search(r"reactions: \{(.*?)\n    \},", blk, re.S)
    if not r:
        return {}
    out = {}
    for role, body in re.findall(r"(\w+): \[(.*?)\]", r.group(1), re.S):
        out[role] = re.findall(r'"([^"]+)"', body)
    return out


def sprite_trims(theme, role):
    """The role's own trim, then one per pose, in order."""
    m = re.search(r'%s: makeTheme\(' % theme, src)
    blk = src[m.start():]
    r = re.search(r"\n      %s: \{(.*?)\n      \},\n" % role, blk, re.S)
    if not r:
        return []
    return [tuple(int(v) for v in t) for t in TRIM.findall(r.group(1))]


def obstacle_file(theme, role):
    m = re.search(r'%s: makeTheme\(' % theme, src)
    blk = src[m.start():]
    o = re.search(r"obstacles: \{(.*?)\},", blk, re.S)
    if not o:
        return None
    named = dict(re.findall(r'(\w+): "([^"]+)"', o.group(1)))
    return named.get(role)


problems, checked = [], 0
for theme in ("field", "woodland", "mountain"):
    base = ROOT / "assets" / "themes" / theme
    for role, poses in theme_reactions(theme).items():
        trims = sprite_trims(theme, role)
        if not trims:
            continue
        # trims[0] is the resting sprite; the rest line up with the poses
        files = []
        own = obstacle_file(theme, role)
        files.append(base / "obstacles" / own if own else None)
        for p in poses:
            files.append(base / (p if "/" in p else "reactions/" + p))
        for want, f in zip(trims, files):
            if f is None or not f.exists():
                continue
            checked += 1
            got = bbox(f)
            if got != want:
                problems.append(f"  {theme}/{role}: {f.name}\n"
                                f"      game.js  sx {want[0]}, sy {want[1]}, sw {want[2]}, sh {want[3]}\n"
                                f"      artwork  sx {got[0]}, sy {got[1]}, sw {got[2]}, sh {got[3]}")

print(f"checked {checked} baked trims against the artwork")
if problems:
    print(f"\n{len(problems)} out of date - the art moved since the trim was measured:\n")
    print("\n".join(problems))
    sys.exit(1)
print("all match")
