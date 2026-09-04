#!/usr/bin/env python3
"""Build the level-select thumbnails from each theme's own artwork.

The levels screen shows one small picture per level - bright when it is
unlocked, blurred behind a padlock when it is not. Capturing those from a
running game would mean shuttling PNGs back out of a browser, so instead we
composite them here from the same files the game loads: sky, the parallax
bands, the ground tile and one obstacle from the level's cast.

They are approximations, not screenshots - a 300x100 tile cannot show
parallax anyway - but every pixel comes from the level's real art, so each
one is unmistakably its own place.

Run after adding a level or replacing scenery:  python3 tools/make_thumbs.py
"""
from PIL import Image
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
W, H = 300, 100                     # thumbnail size
S = W / 900.0                       # the game is 900 wide; scale everything by this
GROUND_Y = 250 * S                  # the running surface, in thumbnail pixels

# Per theme: the background, the bands behind, the ground tile and its crop,
# and one obstacle to stand on it. `src` crops match the game's own.
THEMES = {
    "field": {
        "sky": "scenery/sky.png",
        "bands": [("scenery/hills_far.png", 115, None)],
        "decor": ["scenery/tree_02.png", "scenery/bush_strip.png"],
        "ground": ("ground/grass.png", 230, 500, 40, 0.24),
        "dirt": ("ground/dirt.png", 435, 505, 34),
        "under": "#4a2f17",
        "cast": ["obstacles/hedgehog.png", "obstacles/rabbit.png"],
    },
    "woodland": {
        "sky": "scenery/woodland_background.png",
        "bands": [("scenery/hills_far.png", 115, None)],
        "decor": ["scenery/tree_oak.png", "../field/scenery/bush_strip.png"],
        "ground": ("../field/ground/grass.png", 230, 500, 40, 0.24),
        "dirt": ("../field/ground/dirt.png", 435, 505, 34),
        "under": "#4a2f17",
        "cast": ["obstacles/ferret.png", "obstacles/badger.png"],
    },
    "mountain": {
        "sky": "scenery/sky.png",
        "bands": [("scenery/hills_far.png", 118, (None, None, 299, 512)),
                  ("scenery/clouds.png", 78, (None, None, 109, 341)),
                  ("scenery/trees_mid.png", 52, (19, 1185, 300, 597))],
        "decor": ["scenery/bush_strip.png"],
        "ground": ("ground/ledge.png", 163, 300, 34, 0.30),
        "dirt": ("ground/ledge.png", 290, 700, 44),
        "under": "#161f21",
        "cast": ["obstacles/skunk.png", "obstacles/marmot.png"],
    },
    "swamp": {
        "sky": "scenery/sky.png",
        "bands": [("scenery/hills_far.png", 115, None),
                  ("scenery/trees_mid.png", 60, None)],
        "decor": ["scenery/trees/tree_01.png", "scenery/bush_strip.png"],
        "ground": ("ground/ground_bank.png", 280, 420, 40, 0.186),
        "dirt": ("ground/ground_bank.png", 400, 700, 44),
        "under": "#3a2c18",
        "cast": ["obstacles/frog.png", "obstacles/gator.png"],
    },
}


def load(theme, rel):
    p = os.path.join(ROOT, "assets", "themes", theme, rel)
    return Image.open(os.path.normpath(p)).convert("RGBA")


def band_crop(im, src):
    if not src:
        return im.crop(im.getbbox() or (0, 0, im.width, im.height))
    x0, x1, y0, y1 = src
    return im.crop((x0 or 0, y0 or 0, x1 or im.width, y1 or im.height))


def tile(canvas, im, y, h):
    """Repeat `im` across the full width at height `h`, its bottom at `y`."""
    w = max(1, round(im.width * h / im.height))
    im = im.resize((w, round(h)), Image.LANCZOS)
    for x in range(0, W, w):
        canvas.alpha_composite(im, (x, round(y - h)))


def build(theme, cfg):
    c = Image.new("RGBA", (W, H), cfg["under"])
    sky = load(theme, cfg["sky"])
    sc = max(W / sky.width, H / sky.height)
    sky = sky.resize((round(sky.width * sc), round(sky.height * sc)), Image.LANCZOS)
    c.alpha_composite(sky, ((W - sky.width) // 2, 0))

    for rel, h, src in cfg["bands"]:
        tile(c, band_crop(load(theme, rel), src), GROUND_Y, h * S)

    # Ground: the grass band, then the dirt band tucked under it.
    grel, gy0, gy1, gh, frac = cfg["ground"]
    g = load(theme, grel).crop((0, gy0, load(theme, grel).width, gy1))
    gh *= S
    tile(c, g, GROUND_Y + gh * (1 - frac), gh)
    drel, dy0, dy1, dh = cfg["dirt"]
    d = load(theme, drel)
    d = d.crop((0, dy0, d.width, dy1))
    # Bottom-anchored and allowed to clip, exactly as it does in the game -
    # sized to fill the gap instead, it climbed over the hills behind it.
    tile(c, d, H, dh * S)

    # Something growing, and something to jump over.
    for i, rel in enumerate(cfg["decor"]):
        im = load(theme, rel)
        im = im.crop(im.getbbox())
        h = (46 if "bush" in rel else 132) * S
        w = round(im.width * h / im.height)
        im = im.resize((w, round(h)), Image.LANCZOS)
        c.alpha_composite(im, (round(W * (0.06 + 0.70 * i)), round(GROUND_Y - h)))
    for i, rel in enumerate(cfg["cast"]):
        try:
            im = load(theme, rel)
        except FileNotFoundError:
            continue
        im = im.crop(im.getbbox())
        h = 24
        w = round(im.width * h / im.height)
        im = im.resize((w, round(h)), Image.LANCZOS)
        x = round(W * (0.38 + 0.28 * i))
        c.alpha_composite(im, (min(x, W - w - 4), round(GROUND_Y - h)))

    out = os.path.join(ROOT, "assets", "themes", theme, "thumb.jpg")
    c.convert("RGB").save(out, "JPEG", quality=78, optimize=True)
    return out, os.path.getsize(out)


if __name__ == "__main__":
    for theme, cfg in THEMES.items():
        try:
            out, n = build(theme, cfg)
            print(f"{out.replace(ROOT + os.sep, '')}  {n / 1024:.1f}KB")
        except Exception as e:
            print(f"{theme}: FAILED - {e}")
