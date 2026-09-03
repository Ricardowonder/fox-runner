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

## Roles in the engine

The engine's obstacle slots keep their level-one names, so the difficulty
tuning carries across settings. In this theme they are cast as:

| slot | mountain cast |
| --- | --- |
| `hedgehog` | skunk (five cowering poses) |
| `rock` | marmot (two cowering poses) |
| `sentry` | ram (rears to 58px, from score 500) |
| `rabbit` | bear (rears to 74px, from score 1100) |
| `log` | fallen pine |
| `stump` | rock spire |
| `boulder` | scree pile |
| `flyer` | eagle |

The dog, the acorn, the bushes and the interstitial pages come from the
field theme.

## Known art problems

- `reactions/ram_1.png` and `ram_2.png` are sliced through: the ram's body
  ends at a straight vertical edge and a piece of another frame is stuck to
  its left. Both are unused - the ram rises straight from `obstacles/ram.png`
  to `ram_3` and `ram_4` - so a regenerated pair would give it a smoother rise.
- `obstacles/spire.png` carries a fragment of the pine log to the left of the
  spire, and `obstacles/boulder.png` a sliver of another frame at its right
  edge. Both are excluded by the trims in `game.js` rather than erased.
- Stray fragments of neighbouring frames were erased from
  `flyer/eagle_fly_03/04/05.png` and `scenery/trees/tree_02.png`, which are
  drawn without a trim. Originals are kept in `_source/mountain_raw/`.
- `reactions/skunk_stink_cloud.png` is not used: nothing in the engine draws
  a loose effect puff yet. (The cloud is already baked into `skunk_5.png`.)
