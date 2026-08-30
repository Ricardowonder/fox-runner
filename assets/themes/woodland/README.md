# Woodland theme (level 2)

Cast, and the level-1 role each one plays in code:

| file | role | behaviour |
|---|---|---|
| `obstacles/ferret.png` | hedgehog | crouches flat (`ferret_1/2`) |
| `obstacles/badger.png` | rabbit | **rears up** through `badger_1..4` |
| `obstacles/otter.png` | rock | crouches flat (`otter_1/2`) |
| `obstacles/log_mossy.png` | log | — |
| `obstacles/log_hollow.png` | stump | — |
| `flyer/owl_fly_01..06.png` | flyer | wing cycle, bigger than the bluebird |
| `scenery/woodland_background.png` | sky | painted backdrop |
| `scenery/hills_far.png` | hillsFar | transparent treeline band |
| `scenery/tree_oak/birch/pine.png` | trees | parallax trees |

Roles keep their level-1 names so all the difficulty tuning carries over.
Filenames are mapped in `THEMES.woodland.files` in game.js.

Still falling back to the field art (drop files in to override):
`ground/`, `scenery/bush_*`, `chaser/`, `collectible/`, `pages/`.
A `pages/foxhole.png` replaces the drawn burrow the fox dives into.

## Tuning notes

Drawn sizes and trims live in `THEMES.woodland.sprites`. Current values:
ferret 63x28, badger 72x34 (rearing to 58 tall), otter 65x26,
mossy log 75x32, hollow log 75x44, owl 63x42.

The badger rises from 520px away — well before any jump is committed —
and its hitbox follows each pose, so the upright shape is narrow rather
than keeping the sprawled width. It holds off until score 500 because a
reared badger is the toughest single obstacle in either level; the ferret
carries the opening the way the hedgehog does in the field.
