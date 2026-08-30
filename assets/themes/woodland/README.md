# Woodland theme (level 2)

Drop art in here using these exact filenames and it is picked up
automatically — no code changes. Anything missing falls back to the
matching field art, so the level stays playable while it comes together.

Cast: ferret (hedgehog role), badger (rabbit role), owl (flyer),
hunting dog (chaser), acorn (collectible).

    scenery/     sky.png  hills_far.png  tree_01..03.png
                 bush_strip.png  bush_01..03.png
    ground/      grass.png  dirt.png
    obstacles/   hedgehog.png   <- ferret
                 rabbit.png     <- badger (standing on all fours)
                 rock.png  log.png  stump.png
    reactions/   hedgehog_1.png hedgehog_2.png   <- ferret cowering
                 rabbit_1.png   rabbit_2.png     <- badger part-way up,
                                                    then fully reared
    chaser/      sleep.png waking.png head_shake.png alert.png
                 crash.png bite.png  run_01..12.png
    flyer/       fly_01..06.png   <- owl wing cycle
    collectible/ item.png  icon.png
    pages/       intro.png  game_over.png
                 foxhole.png  (optional: the burrow the fox dives into;
                               drawn placeholder used until supplied)

Sizes: match the field art — 512x341 palette PNGs (the acorn is 512x512).
Draw each creature filling the frame as its field counterpart does; the
game trims transparent padding and scales to the sizes in THEMES.sprites.

## Behaviour notes

- **Badger** plays the rabbit role but rears onto its hind legs instead of
  cowering: it grows from 38px to 58px tall as the fox approaches, and the
  hitbox grows with it. So draw `rabbit.png` on all fours, `rabbit_1.png`
  part-way up and `rabbit_2.png` fully reared — the reared art is drawn at
  the taller size, so it should fill its frame standing upright.
- **Owl** is drawn bigger than the bluebird (62x43 rather than 48x33), so
  the six wing frames want the same generous framing the bluebird had.
- Sizes and heights live in `THEMES.woodland.sprites` in game.js if the
  finished art wants different proportions.
