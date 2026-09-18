#!/usr/bin/env python3
"""Erase stray marks stranded away from a sprite's artwork.

Generated art arrives with dirt in it: one jungle leopard carried 26 pixels
in its very top row, a hundred clear of the animal. Nothing renders them -
they are invisible - but every crop in the game is measured from the image's
bounding box, so a speck in a corner silently stretches the crop and draws
the animal smaller. Rather than teach every tool to ignore them, take them
out of the file.

Only bands of content that are tiny next to the main mass are removed, so a
tail with a gap before it, or a frill held away from a head, is safe.

    python3 tools/despeckle.py assets/themes/jungle/**/*.png
    python3 tools/despeckle.py --dry-run <files>
"""
import sys, os
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from measure_sprites import bbox


def clean(path, dry=False):
    keep, size, dropped = bbox(path)
    if keep is None or not dropped:
        return 0
    im = Image.open(path).convert("RGBA")
    raw = im.getbbox()
    box = (keep[0], keep[1], keep[0] + keep[2], keep[1] + keep[3])
    if raw and raw[0] >= box[0] and raw[1] >= box[1] and \
       raw[2] <= box[2] and raw[3] <= box[3]:
        return 0                                  # nothing outside the artwork
    a = im.getchannel("A")
    px = a.load()
    n = 0
    for y in range(im.height):
        inside_y = box[1] <= y < box[3]
        for x in range(im.width):
            if inside_y and box[0] <= x < box[2]:
                continue
            if px[x, y]:
                px[x, y] = 0
                n += 1
    if n and not dry:
        im.putalpha(a)
        im.save(path)
    return n


if __name__ == "__main__":
    args = sys.argv[1:]
    dry = "--dry-run" in args
    total = 0
    for p in [a for a in args if not a.startswith("--")]:
        n = clean(p, dry)
        if n:
            total += 1
            print(f"  {'would clear' if dry else 'cleared'} {n:>6} px  {p}")
    print(f"{total} file(s) {'would be' if dry else ''} cleaned")
