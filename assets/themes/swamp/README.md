# Swamp theme

Level four. The bank stops and starts here: the fox can fall in the water,
and a wide crossing has a stepping stone in the middle of it.

## Roles in the engine

The obstacle slots keep their level-one names so the difficulty tuning
carries across settings. Cast here as:

| slot | swamp cast |
| --- | --- |
| `hedgehog` | frog (sits up, then presses flat) |
| `rock` | turtle (withdraws into its shell) |
| `sentry` | snake (rears, then strikes forward - from score 500) |
| `rabbit` | gator (basks, rises, then lunges - from score 1100) |
| `log` | mangrove log |
| `stump` | mangrove roots |
| `boulder` | river rock |
| `flyer` | heron |

## The baseline

Unlike the other themes, this cast stands on **y=300** rather than the
bottom of its 341px canvas, so `floor: 300` runs through the whole theme.
The gator's lunge and the snake's strike are drawn genuinely airborne above
that line and float by exactly that much.

`gator_5.png` is the exception: it is the landing frame, drawn at the same
height as the lunge rather than back on the line, so its pose carries
`sit: true` to put its feet down.

Measured tap windows, against the levels before it:

| | tightest | widest |
| --- | --- | --- |
| field | 0.425s | 0.496s |
| woodland | 0.354s | 0.458s |
| mountain | 0.325s | 0.462s |
| swamp | 0.317s | 0.512s |

The gator is the tightest thing in the game at 0.317s; the snake is 0.446s.

## Still to be drawn

Everything below is currently the FIELD's artwork or an engine-drawn
stand-in, which is why a swamp presently runs through a green meadow:

- `ground/ground_bank.png` - the riverbank, tiling left to right
- `ground/bank_edge.png` - the cut face where the bank stops at the water
- `scenery/water.png` - a tiling river surface
- `obstacles/platform.png` - the stepping stone standing in the water
- `scenery/sky.png`, `hills_far.png`, `trees_mid.png`, `bush_strip.png`
- `scenery/trees/tree_01..03.png`

Until they land the engine draws the water, the bank faces and the stones
as plain shapes - see `drawWater` and `drawCrossings` in game.js. Those
come out when the artwork does.
