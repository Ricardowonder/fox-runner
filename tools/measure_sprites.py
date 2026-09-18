#!/usr/bin/env python3
"""Measure a sprite set and print the trims ready to paste into a theme.

Every crop in game.js is a fixed pixel rect baked from the artwork, because
canvas pixel readback is unavailable on file:// pages and a crop must never
change quietly underneath the game. This works them out.

For a pose set it also reports the two numbers that hold the set together:

  sheet  the union of every frame's x range, so the animal does not slide
         sideways when the frame changes
  floor  the canvas row its feet stand on. Frames ending above it are drawn
         airborne by exactly that much (see Obstacle.poseGeometry)

Usage:
  python3 tools/measure_sprites.py assets/themes/jungle/reactions/leopard_*.png
  python3 tools/measure_sprites.py --name sentry assets/themes/jungle/reactions/leopard_[2-5].png
"""
import sys, os
from PIL import Image

ALPHA = 16    # below this a pixel is padding, not artwork
GAP = 8       # rows/columns of nothing that split one band of art from another
SPECK = 0.02  # a band lighter than this share of the heaviest is dirt, not artwork


def _bands(counts):
    """Contiguous runs of non-empty lines, split by gaps of GAP or more."""
    out, run, blank = [], None, 0
    for i, c in enumerate(counts):
        if c:
            if run is None: run = [i, i, 0]
            run[1] = i; run[2] += c; blank = 0
        elif run is not None:
            blank += 1
            if blank >= GAP: out.append(run); run = None
    if run is not None: out.append(run)
    return out


def bbox(path):
    """The artwork's rect, ignoring specks stranded away from it.

    Plain getbbox() trusts any stray pixel, and generated art has them: one
    jungle leopard carries 26 pixels of dirt in its very top row, a hundred
    clear of the animal, which would have stretched its crop by a third and
    drawn the leopard a third too small. So the image is split into bands of
    content and only the heaviest one - by opaque pixel count - is measured.
    """
    im = Image.open(path).convert("RGBA")
    a = im.getchannel("A").point(lambda v: 1 if v > ALPHA else 0)
    w, h = im.size
    px = a.load()
    rowc = [sum(px[x, y] for x in range(w)) for y in range(h)]
    colc = [sum(px[x, y] for y in range(h)) for x in range(w)]
    rb, cb = _bands(rowc), _bands(colc)
    if not rb or not cb:
        return None, im.size, []

    # Keep the heaviest band and everything within SPECK of it. An animal
    # comes apart into bands all the time - a thin neck, a gap between a
    # tail and a leg - and those bands are still the animal. Only the
    # genuinely tiny ones are dirt.
    def keep(bands):
        heaviest = max(b[2] for b in bands)
        good = [b for b in bands if b[2] >= heaviest * SPECK]
        return (min(b[0] for b in good), max(b[1] for b in good),
                [b for b in bands if b[2] < heaviest * SPECK])

    r0, r1, dr = keep(rb)
    c0, c1, dc = keep(cb)
    return ((c0, r0, c1 + 1 - c0, r1 + 1 - r0), im.size, dr + dc)


def main(argv):
    name = "role"
    if argv and argv[0] == "--name":
        name = argv[1]; argv = argv[2:]
    rows = []
    for p in argv:
        t, size, dropped = bbox(p)
        if dropped:
            print(f"  note: {os.path.basename(p)} has {len(dropped)} speck(s) away "
                  f"from the artwork; ignored", file=sys.stderr)
        if t is None:
            print(f"  {os.path.basename(p)}: EMPTY", file=sys.stderr)
            continue
        rows.append((os.path.basename(p), t, size))
    if not rows:
        return 1
    sx0 = min(t[0] for _, t, _ in rows)
    sx1 = max(t[0] + t[2] for _, t, _ in rows)
    floor = max(t[1] + t[3] for _, t, _ in rows)
    print(f"// {name}: {len(rows)} frames")
    for fn, t, size in rows:
        bottom = t[1] + t[3]
        tag = "" if bottom >= floor - 2 else f"   // airborne by {floor - bottom}px"
        print(f"//   {fn:<26} trim {{ sx: {t[0]}, sy: {t[1]}, sw: {t[2]}, sh: {t[3]} }}{tag}")
    print(f"sheet: {{ sx: {sx0}, sw: {sx1 - sx0} }}, floor: {floor},")
    first = rows[0][1]
    print(f"trim: {{ sx: {first[0]}, sy: {first[1]}, sw: {first[2]}, sh: {first[3]} }},")
    print("poses: [")
    for fn, t, _ in rows[1:]:
        bottom = t[1] + t[3]
        note = "" if bottom >= floor - 2 else "  // drawn airborne"
        print(f"  {{ trim: {{ sx: {t[0]}, sy: {t[1]}, sw: {t[2]}, sh: {t[3]} }} }},{note}")
    print("],")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
