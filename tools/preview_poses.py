#!/usr/bin/env python3
"""Render a pose set the way Obstacle.poseGeometry will place it.

Baked trims are easy to get subtly wrong - a frame that slides sideways or
floats above the ground looks fine as a number and awful in motion. This
draws the whole set at the game's scale, anchored the way the game anchors
it, on a ground line, so the set can be judged before it ships.

  python3 tools/preview_poses.py out.png 40 assets/.../leopard_[2-5].png
                                  ^       ^ drawn height of the FIRST frame
"""
import sys, os
from PIL import Image, ImageDraw
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from measure_sprites import bbox

def main(out, h, paths):
    frames = []
    for p in paths:
        t, size, _ = bbox(p)
        if t: frames.append((p, t, Image.open(p).convert("RGBA")))
    sx0 = min(t[0] for _, t, _ in frames)
    floor = max(t[1] + t[3] for _, t, _ in frames)
    px = h / frames[0][1][3]                      # scale from the first frame
    CW = 260; GROUND = 190
    im = Image.new("RGB", (CW * len(frames), 240), (46, 52, 44))
    d = ImageDraw.Draw(im)
    for i, (p, t, src) in enumerate(frames):
        x0 = i * CW
        d.line([(x0, GROUND), (x0 + CW, GROUND)], fill=(150, 170, 140), width=1)
        crop = src.crop((t[0], t[1], t[0] + t[2], t[1] + t[3]))
        w2, h2 = max(1, round(t[2] * px)), max(1, round(t[3] * px))
        crop = crop.resize((w2, h2), Image.LANCZOS)
        dx = (t[0] - sx0) * px
        lift = (floor - (t[1] + t[3])) * px
        bg = Image.new("RGBA", (CW, 240), (0, 0, 0, 0))
        bg.alpha_composite(crop, (round(30 + dx), round(GROUND - h2 - lift)))
        im.paste(Image.alpha_composite(
            Image.new("RGBA", (CW, 240), (46, 52, 44, 255)), bg).convert("RGB"), (x0, 0))
        d.text((x0 + 4, 4), os.path.basename(p), fill=(255, 220, 140))
        d.text((x0 + 4, 18), f"{w2}x{h2}  lift {lift:.0f}", fill=(180, 210, 170))
    im.save(out)
    print(f"{out}  scale {px:.3f}  floor {floor}")

if __name__ == "__main__":
    main(sys.argv[1], float(sys.argv[2]), sys.argv[3:])
