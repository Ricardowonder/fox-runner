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
- `obstacles/ram.png` with `reactions/ram_1.png` through `ram_4.png`
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
| `sentry` | ram (rears to 58px, from score 500) |
| `rabbit` | bear (rears to 74px, from score 1100) |
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

- `reactions/ram_1.png` and `ram_2.png` are sliced through: the ram's body
  ends at a straight vertical edge and a piece of another frame is stuck to
  its left. Both are unused - the ram rises straight from `obstacles/ram.png`
  to `ram_3` and `ram_4` - so a regenerated pair would give it a smoother
  rise. Three poses over half a second is watchable; five would be better.
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
