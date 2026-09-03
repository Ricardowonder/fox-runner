# Mountain theme

Background and ground assets for the level three mountain climb illusion. The play surface stays flat; the cloud, peak, tree, and scrub layers provide the sense of altitude.

## Scenery

- `scenery/sky.png` - cold high-altitude sky
- `scenery/clouds.png` - transparent cloud band
- `scenery/hills_far.png` - transparent snow-capped distant peaks
- `scenery/trees_mid.png` - transparent wind-shaped pines, crag, and cairn
- `scenery/bush_strip.png` - transparent restrained alpine scrub

## Ground

- `ground/ledge.png` - single deep rocky ledge with a flat grassy running surface

The ledge is intended to replace the normal grass and dirt layers for this theme, avoiding a busy double-ground stack.

## Obstacles and reactions

- `obstacles/marmot.png` with `reactions/marmot_1.png` and `marmot_2.png`
- `obstacles/ram.png` with `reactions/ram_1.png` through `ram_5.png` - wake, stand, pounce, land
- `obstacles/boulder.png`, `log_pine.png`, and `spire.png`

## Flyer

- `flyer/eagle_fly_01.png` through `eagle_fly_06.png` - looping six-frame wing cycle

## Trees

- `scenery/trees/tree_01.png` - wind-bent pine
- `scenery/trees/tree_02.png` - bare weathered snag
- `scenery/trees/tree_03.png` - stone cairn

Everything that leans is drawn leaning RIGHT, the way the fox is running:
the pines in `scenery/trees_mid.png` and the two bent trees above all
arrived leaning left, which read as being blown back down the mountain
rather than climbing it. They were mirrored in place (originals kept in
`_source/mountain_raw/preflip_*`), and the treeline band is drawn with
`mirror: false` - the alternate-tile flip that hides a seam was sending
every second tree back the other way. The cairns are symmetrical and are
left alone. The field and woodland trees are all upright, so neither was
touched.

## Roles in the engine

The engine's obstacle slots keep their level-one names, so the difficulty
tuning carries across settings. In this theme they are cast as:

| slot | mountain cast |
| --- | --- |
| `hedgehog` | skunk (five poses, ending in the spray) |
| `rock` | marmot (two cowering poses) |
| `sentry` | ram (wakes, pounces, lands - from score 500) |
| `rabbit` | bear (wakes, pounces, lands - from score 1100) |
| `log` | fallen pine |
| `stump` | rock spire |
| `boulder` | scree pile |
| `flyer` | eagle |

The dog, the acorn, the bushes and the interstitial pages come from the
field theme.

The skunk is the one animal NOT flipped. Everything else is drawn facing
right and mirrored to meet the fox; the skunk is drawn facing left already,
and its defence is to turn its back, so it has to end up tail-first toward
him or the cloud fires off the wrong side.

Its five poses run across the whole approach rather than the usual two,
which is what `poseFit: "scale"` and `hideNotice` in `game.js` are for: the
skunk stands UP where the other reaction animals flatten, so holding its
resting width would balloon it at every step.

## Known art problems

- The ram and bear reaction sets were regenerated as six-pose wake-to-pounce
  sequences, ending with a four-legged landing frame. They are clean - the
  sliced ram frames noted here before are gone.
- `obstacles/spire.png` carries a fragment of the pine log to the left of the
  spire, and `obstacles/boulder.png` a sliver of another frame at its right
  edge. Both are excluded by the trims in `game.js` rather than erased.
- Stray fragments of neighbouring frames were erased from
  `flyer/eagle_fly_03/04/05.png` and `scenery/trees/tree_02.png`, which are
  drawn without a trim. Originals are kept in `_source/mountain_raw/`.
- `reactions/skunk_stink_cloud.png` is not used: nothing in the engine draws
  a loose effect puff yet. (The cloud is already baked into `skunk_5.png`.)

## Testing

`?test=1` unlocks every setting on the title and game-over screens so a
level can be checked without playing up to it. It sticks (a tablet only
needs the URL once); `?test=0` turns it off again. It is scaffolding -
`TEST_LEVELS` in `game.js`, and the two short blocks that read it, come out
before the game goes to real players.

## How a pounce is put together

The bear and the ram do not just stand up: they wake, get up, LEAP a short
way at the fox, and land. Four things in `game.js` make that work.

`sheet` and `floor` say that all six frames share one stage rect and one
canvas row for the ground, so a single scale serves the set. That matters
because the leap frames are drawn genuinely airborne - the bear's feet 81px
up its own canvas, the ram's 146px - and floor-anchoring floats them by
exactly that much instead of dumping them back on the grass.

`lungeBy` is how far it actually travels at the fox: 28px for the bear,
24px for the ram, eased so it is quick off the mark and settles into the
landing. Small on purpose. The point is that it reads as coming at him.

The leap POSE is held until the animal has gone past the fox, not just
until the movement finishes. Without that the fox meets the tidy landing
frame, which on the ram is barely half the height, and the whole pounce
counts for nothing - it measured as the easiest obstacle in the game.

`plannedHeight` is derived from the frames rather than written by hand, so
the spawner reserves room for the leap's full height and re-cut artwork
cannot quietly make one unjumpable.

Measured tap windows, against the levels either side:

| | tightest | widest |
| --- | --- | --- |
| field | 0.425s | 0.496s |
| woodland | 0.354s | 0.458s |
| mountain | 0.325s | 0.462s |

The bear is 0.329s and the ram 0.408s.
