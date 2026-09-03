"use strict";

/* =========================================================================
 * Fox Runner — Phase 1 (refreshed artwork + progressive difficulty)
 * Chrome-dino-style endless runner using the woodland asset pack.
 *
 * Structure notes for later phases:
 *  - Obstacle behaviour lives in Obstacle + OBSTACLE_TYPES, decoupled from
 *    scoring and collision so obstacle types can gain new behaviours
 *    (e.g. turning around and chasing) without touching the rest.
 *  - Collision uses hitboxes from getHitbox(), not raw sprite rectangles.
 *  - Difficulty is data-driven via DIFFICULTY.bands; spawning is
 *    pattern-based via SpawnDirector, with physics-derived feasibility
 *    checks so sequences are always clearable.
 * ========================================================================= */

// ---------------------------------------------------------------------------
// Themes
// ---------------------------------------------------------------------------

/* Every piece of artwork the game loads, in one place, grouped by the ROLE
 * it plays rather than by what it depicts. The folders mirror this exactly:
 *   assets/shared/fox/         the hero, who travels through every level
 *   assets/themes/<name>/      one folder per setting, same subfolders
 *
 * Level 2 keeps the same gameplay in a new setting (woodland, and a city
 * later on) with a different cast - the rabbit becomes a badger, the
 * bluebird an owl. That is a new folder under assets/themes/, a second
 * entry here, and a line in LEVELS. No engine changes.
 *
 * Sprite geometry - drawn sizes, source trims, hitboxes - deliberately
 * stays with the gameplay config below rather than in the theme, so a
 * stand-in authored to the same proportions inherits all the difficulty
 * tuning for free.
 */
const seq = (n, fn) => Array.from({ length: n }, (_, i) => fn(i));
const pad2 = (n) => String(n).padStart(2, "0");

// Shared across every level: the fox himself.
const HERO = {
  run: seq(12, (i) => `assets/shared/fox/run_${pad2(i + 1)}.png`),
  jump: "assets/shared/fox/jump.png",
  land: "assets/shared/fox/land.png",
  hit: "assets/shared/fox/hit.png",
  throw: [
    "assets/shared/fox/throw_01_glance_back.png",
    "assets/shared/fox/throw_02_windup.png",
    "assets/shared/fox/throw_03_release.png",
    "assets/shared/fox/throw_04_recover.png",
  ],
};

// Builds a theme's paths from its folder; every theme has this same shape.
/* Builds a theme's paths from its folder; every theme has this same shape.
 * `fallback` names a theme to borrow from while art is still being drawn:
 * any file missing from this theme's folder quietly loads the other
 * theme's version instead (see loadImage). That lets a new setting come
 * together one asset at a time, and the level stays playable throughout.
 */
function makeTheme(dir, label, opts) {
  opts = opts || {};
  const fb = opts.fallback ? `assets/themes/${opts.fallback}` : null;
  const files = opts.files || {};
  /* Roles this theme knowingly borrows from its fallback. Without this
   * the loader speculatively asks for a file the theme never had, takes a
   * 404, and only then falls back - about thirty wasted round-trips and a
   * console full of red every time a level loads. Naming them costs one
   * line and makes the borrowing visible.
   */
  const inherits = new Set(opts.inherits || []);
  // Either a whole folder ("chaser") or a single role ("obstacles.boulder").
  const borrowed = (sub, role) =>
    !!fb && (inherits.has(sub) || (role !== undefined && inherits.has(sub + "." + role)));
  // Each entry is [preferred, fallback] so the loader can try in order.
  // A theme may name its files whatever suits its cast (ferret.png in the
  // hedgehog role); `files` maps role -> filename and the fallback keeps
  // the default name, since that is what the other theme's folder has.
  const p = (sub, file, role) => {
    if (borrowed(role || sub)) return `${fb}/${sub}/${file}`;

    const own = `assets/themes/${dir}/${sub}/${file}`;
    return fb ? [own, `${fb}/${sub}/${file}`] : own;
  };
  const q = (sub, role, def) => {
    if (borrowed(sub, role)) return `${fb}/${sub}/${def}`;
    const named = files[sub] && files[sub][role];
    if (!named) return p(sub, def);
    const own = `assets/themes/${dir}/${sub}/${named}`;
    return fb ? [own, `${fb}/${sub}/${def}`] : own;
  };
  const qList = (sub, role, defs) => {
    const named = files[sub] && files[sub][role];
    return defs.map((def, i) => {
      if (borrowed(sub, role)) return `${fb}/${sub}/${def}`;
      if (!named) return p(sub, def, role);
      // An explicit null means "this one comes from the fallback theme":
      // the mountain has its own bush strip but not the three single
      // bushes, and asking for those would be three 404s a level.
      if (named[i] === null && fb) return `${fb}/${sub}/${def}`;
      if (!named[i]) return p(sub, def, role);
      const own = `assets/themes/${dir}/${sub}/${named[i]}`;
      return fb ? [own, `${fb}/${sub}/${def}`] : own;
    });
  };
  return {
    label,
    hero: HERO,
    cast: opts.cast, // which creature plays each role, for reference
    dog: opts.dog,   // per-level dog pacing, read via dogSetting()
    music: opts.music, // this level's looping melody
    bands: opts.bands, // parallax bands, if this setting wants its own
    obstacles: {
      hedgehog: q("obstacles", "hedgehog", "hedgehog.png"),
      rabbit: q("obstacles", "rabbit", "rabbit.png"),
      rock: q("obstacles", "rock", "rock.png"),
      log: q("obstacles", "log", "log.png"),
      stump: q("obstacles", "stump", "stump.png"),
      boulder: q("obstacles", "boulder", "rock.png"),
      sentry: q("obstacles", "sentry", "rock.png"),
    },
    // Any role may have any number of reaction poses - the ferret needs
    // two to cower, the badger four to stand all the way up.
    // A theme that names its own reaction files owns them outright, so no
    // fallback half is built - the field has no ferret_1.png to fall back to.
    reactions: opts.reactions
      ? Object.fromEntries(Object.entries(opts.reactions).map(
          ([role, names]) => [role,
            // A name with a "/" is a path inside this theme's folder, so a
            // pose can be the role's own base sprite without shipping it
            // twice; a bare name is a file in reactions/.
            names.map((n) => `assets/themes/${dir}/${
              n.includes("/") ? n : "reactions/" + n}`)]))
      : {
          hedgehog: qList("reactions", "hedgehog", ["hedgehog_1.png", "hedgehog_2.png"]),
          rabbit: qList("reactions", "rabbit", ["rabbit_1.png", "rabbit_2.png"]),
        },
    chaser: {
      sleep: p("chaser", "sleep.png"),
      waking: p("chaser", "waking.png"),
      headShake: p("chaser", "head_shake.png"),
      alert: p("chaser", "alert.png"),
      crash: p("chaser", "crash.png"),
      bite: p("chaser", "bite.png"),
      run: seq(12, (i) => p("chaser", `run_${pad2(i + 1)}.png`)),
    },
    flyer: { fly: qList("flyer", "fly", seq(6, (i) => `fly_${pad2(i + 1)}.png`)) },
    collectible: { item: p("collectible", "item.png"), icon: p("collectible", "icon.png") },
    scenery: {
      sky: q("scenery", "sky", "sky.png"),
      hillsFar: p("scenery", "hills_far.png"),
      // Optional extra parallax bands; a theme that has no such file
      // simply never names it in `bands`, so it is never requested.
      clouds: `assets/themes/${dir}/scenery/clouds.png`,
      treesMid: `assets/themes/${dir}/scenery/trees_mid.png`,
      trees: qList("scenery", "trees", seq(3, (i) => `tree_${pad2(i + 1)}.png`)),
      bushes: qList("scenery", "bushes",
        ["bush_strip.png", "bush_01.png", "bush_02.png", "bush_03.png"]),
    },
    ground: { grass: q("ground", "grass", "grass.png"),
              dirt: q("ground", "dirt", "dirt.png") },
    pages: { intro: p("pages", "intro.png"), gameOver: p("pages", "game_over.png") },
    // The burrow the fox dives into to finish a level.
    foxhole: p("scenery", "fox_hole.png", "foxhole"),
    // Backdrop for the success page. Deliberately the artwork WITHOUT
    // baked-in wording, so the title and the run's tally can be drawn
    // live over it and read correctly for whichever level just ended.
    levelCompleteBg: q("pages", "levelComplete", "level_one_complete_art_clean.png"),
    // Per-theme sprite tweaks, merged over the shared gameplay config in
    // OBSTACLE_TYPES / BIRD. Only geometry belongs here - never spacing or
    // speed, so the difficulty tuning stays identical across levels.
    sprites: opts.sprites || {},
    /* Optional crops of this theme's ground artwork. The field's surface is
     * two tiles (a grass strip over a band of soil); the mountain's is one
     * ledge tile carrying its own grass lip above the stone, so it needs its
     * own bands. A theme that says nothing uses the shared GROUND crops.
     */
    groundCrops: opts.groundCrops,
  };
}

const THEMES = {
  field: makeTheme("field", "Field", {
    dog: { gapScale: 1.35 }, // a first level: dogs stay an occasional event
    /* Bright and skipping, in C major pentatonic - no note in the scale
     * can clash, which is why it stays friendly however fast it gets.
     * Sixteen eighth notes: two bars that loop.
     */
    music: {
      root: 72, // C5
      lead: [0, 4, 7, 4, 9, 7, 4, 2, 0, 4, 7, 9, 12, 9, 7, null],
      bass: [-12, null, null, null, -5, null, null, null,
             -12, null, null, null, -5, null, null, null],
    },
    cast: { hedgehog: "hedgehog", rabbit: "rabbit", chaser: "hunting dog",
            flyer: "bluebird", collectible: "acorn" },
    sprites: {
      // Cowering poses shown as the fox bears down and leaps over. Purely
      // cosmetic — see Obstacle.draw, the collision box never changes.
      hedgehog: { poses: [
        { trim: { sx: 60, sy: 58, sw: 417, sh: 237 } },
        { trim: { sx: 66, sy: 11, sw: 403, sh: 301 }, wScale: 0.96 },
      ] },
      rabbit: { poses: [
        { trim: { sx: 30, sy: 58, sw: 477, sh: 231 } },
        { trim: { sx: 47, sy: 88, sw: 460, sh: 199 }, wScale: 0.98 },
      ] },
    },
  }),
  /* Level 2. The roles keep their level-1 names in code - the art and the
   * `cast` note say who is actually playing them - so every bit of
   * difficulty tuning carries over untouched. The woodland creatures are
   * longer and lower than the field's, so each one brings its own trim,
   * drawn height and hitbox. Anything this folder does not have (the dog,
   * the acorn, the ground, the bushes) falls back to the field art.
   */
  woodland: makeTheme("woodland", "Woodland", {
    fallback: "field",
    // Has its own cast, scenery and trees; borrows the rest for now.
    inherits: ["ground", "chaser", "collectible", "pages", "scenery.bushes",
               "obstacles.boulder", "obstacles.sentry"],
    // Dogs from the first stage here, and closer together: by level two
    // the player knows what a dog is and how to deal with one.
    dog: { availableFrom: 300, gapScale: 0.9 },
    // The same idea a shade darker: A minor pentatonic, for deeper woods.
    music: {
      root: 69, // A4
      lead: [0, 3, 7, 5, 3, 0, 3, 5, 7, 10, 12, 10, 7, 5, 3, null],
      bass: [-12, null, null, null, -5, null, null, null,
             -10, null, null, null, -5, null, null, null],
    },
    cast: { hedgehog: "ferret", rabbit: "badger", rock: "otter",
            log: "mossy log", stump: "hollow log",
            chaser: "hunting dog", flyer: "owl", collectible: "acorn" },
    files: {
      obstacles: { hedgehog: "ferret.png", rabbit: "badger.png", rock: "otter.png",
                   log: "log_mossy.png", stump: "log_hollow.png" },
      flyer: { fly: seq(6, (i) => `owl_fly_${pad2(i + 1)}.png`) },
      scenery: { sky: "woodland_background.png",
                 trees: ["tree_oak.png", "tree_birch.png", "tree_pine.png"] },
    },
    reactions: {
      hedgehog: ["ferret_1.png", "ferret_2.png"],
      rabbit: ["badger_1.png", "badger_2.png", "badger_3.png", "badger_4.png"],
      rock: ["otter_1.png", "otter_2.png"],
    },
    sprites: {
      // The ferret is long and low where the hedgehog was round.
      // The ferret and otter read alike at speed, so between them they
      // now spawn about as often as one field animal did, leaving room
      // for the logs and the boulder to carry the variety.
      hedgehog: {
        h: 32, weight: 1.7, sink: 7, trim: { sx: 31, sy: 116, sw: 450, sh: 199 },
        hitbox: { left: 0.08, right: 0.24, top: 0.14, bottom: 0.02 },
        poses: [
          { trim: { sx: 31, sy: 101, sw: 450, sh: 214 } },
          { trim: { sx: 31, sy: 196, sw: 450, sh: 119 }, wScale: 0.98 },
        ],
      },
      /* The bear sleeps across the path and wakes as the fox bears down,
       * through four poses, rearing to swipe at him.
       * It grows 36px to 66px - comfortably under the 105px jump apex,
       * so a tap alone clears it.
       */
      rabbit: {
        // Held back from the opening: a reared badger is the toughest
        // single obstacle in this level, so the ferret carries the early
        // game the way the hedgehog does in the field.
        h: 36, rearHeight: 66, availableFrom: 500, sink: 6,
        // Rears later than the default 520px, so it reads as reacting to
        // the fox rather than standing up long before he arrives. Still
        // clears the rise (0.28s) well before the latest viable jump.
        rearNotice: 400,
        weight: 2.2,
        trim: { sx: 31, sy: 102, sw: 449, sh: 213 },
        hitbox: { left: 0.12, right: 0.20, top: 0.10, bottom: 0.02 },
        poses: [
          { trim: { sx: 31, sy: 102, sw: 449, sh: 213 } },
          { trim: { sx: 115, sy: 15, sw: 281, sh: 300 } },
          { trim: { sx: 156, sy: 15, sw: 199, sh: 300 } },
          { trim: { sx: 137, sy: 15, sw: 237, sh: 300 } },
        ],
      },
      // The otter takes the rock's slot, and cowers like the ferret.
      rock: {
        // Seen as often as the ferret now, and from the same early point.
        h: 31, weight: 1.7, availableFrom: 250, animal: true, flip: true, sink: 7,
        trim: { sx: 31, sy: 135, sw: 449, sh: 180 },
        hitbox: { left: 0.08, right: 0.24, top: 0.14, bottom: 0.02 },
        poses: [
          { trim: { sx: 31, sy: 166, sw: 449, sh: 149 } },
          { trim: { sx: 31, sy: 202, sw: 449, sh: 113 }, wScale: 0.98 },
        ],
      },
      // Chunkier than the field's timber: level two should feel weightier.
      log: { h: 37, weight: 3.4, availableFrom: 250, sink: 9,
             trim: { sx: 15, sy: 34, sw: 481, sh: 204 },
             hitbox: { left: 0.08, right: 0.08, top: 0.15, bottom: 0.02 } },
      stump: { h: 49, weight: 2.6, availableFrom: 900, sink: 10,
               trim: { sx: 52, sy: 0, sw: 408, sh: 240 },
               hitbox: { left: 0.10, right: 0.10, top: 0.12, bottom: 0.02 } },
      // The field's mossy boulder, earning its place in the woodland mix.
      boulder: { h: 44, weight: 2.6, availableFrom: 400, sink: 8 },
      // The owl is a bigger bird than the bluebird.
      flyer: { w: 63, h: 42, trim: { sx: 31, sy: 15, sw: 450, sh: 300 } },
    },
  }),
  /* Level 3. The path stays flat - a real gradient would run the fox off
   * the top of the screen within seconds - so the climb is told by the
   * scenery instead: the peaks sink toward the horizon and the cloud band,
   * overhead at the start, ends up below the path by the summit. The
   * surface is a stone ledge with a grass lip, one tile carrying both.
   * The mountain has its own cast, sky and ground; the dog, the acorn, the
   * bushes and the interstitial pages come from the field.
   */
  mountain: makeTheme("mountain", "Mountain", {
    fallback: "field",
    inherits: ["chaser", "collectible", "pages", "foxhole"],
    files: {
      obstacles: { hedgehog: "skunk.png", rabbit: "bear.png", rock: "marmot.png",
                   log: "log_pine.png", stump: "spire.png", sentry: "ram.png",
                   boulder: "boulder.png" },
      flyer: { fly: seq(6, (i) => `eagle_fly_${pad2(i + 1)}.png`) },
      ground: { grass: "ledge.png", dirt: "ledge.png" },
      scenery: {
        // The mountain keeps its own bush strip - grey stones among the
        // leaves - but has no single bushes, so those come from the field.
        bushes: ["bush_strip.png", null, null, null],
        trees: ["trees/tree_01.png", "trees/tree_02.png", "trees/tree_03.png"],
      },
    },
    reactions: {
      hedgehog: ["skunk_1.png", "skunk_2.png", "skunk_3.png",
                 "skunk_4.png", "skunk_5.png"],
      rabbit: ["bear_1.png", "bear_2.png", "bear_3.png", "bear_4.png", "bear_5.png"],
      rock: ["marmot_1.png", "marmot_2.png"],
      sentry: ["ram_1.png", "ram_2.png", "ram_3.png", "ram_4.png", "ram_5.png"],
    },
    sprites: {
      /* The bear sleeps across the path, wakes as the fox bears down, gets
       * up, then LEAPS a short way at him and lands on all fours. `sheet`
       * is the rect all six frames share and `floor` the canvas row its
       * feet stand on, so one scale serves the whole set and the leap
       * frame - drawn with its feet 81px up its own canvas - floats by
       * exactly that much.
       *
       * The leap is only 28px. It is there so the bear reads as coming at
       * the fox rather than waiting to be jumped; every pixel of it is
       * room the spawner has already reserved.
       */
      rabbit: {
        h: 50, availableFrom: 1100, sink: 4, weight: 2.2,
        sheet: { sx: 25, sw: 461 }, floor: 341,
        rearNotice: 470, riseTime: 0.42,
        lungeBy: 28, lungeAt: 130, lungeTime: 0.24,
        trim: { sx: 32, sy: 129, sw: 447, sh: 212 },
        hitbox: { left: 0.14, right: 0.22, top: 0.12, bottom: 0.02 },
        poses: [
          { trim: { sx: 25, sy: 113, sw: 461, sh: 228 } }, // waking
          { trim: { sx: 50, sy: 36, sw: 412, sh: 305 } },  // up on all fours
          { trim: { sx: 108, sy: 31, sw: 296, sh: 310 } }, // reared
          { trim: { sx: 25, sy: 0, sw: 461, sh: 260 } },   // leaping, airborne
          { trim: { sx: 40, sy: 11, sw: 432, sh: 330 } },  // landed
        ],
      },
      /* The ram does the same thing earlier and smaller: it is what gives
       * the mountain something coming at the fox from its first stage,
       * where the bear is far too big to appear.
       */
      sentry: {
        h: 40, availableFrom: 500, sink: 4, weight: 2,
        sheet: { sx: 98, sw: 311 }, floor: 341,
        rearNotice: 430, riseTime: 0.38,
        lungeBy: 24, lungeAt: 130, lungeTime: 0.22,
        trim: { sx: 106, sy: 180, sw: 299, sh: 161 },
        hitbox: { left: 0.14, right: 0.20, top: 0.12, bottom: 0.02 },
        poses: [
          { trim: { sx: 125, sy: 113, sw: 261, sh: 228 } }, // head up
          { trim: { sx: 119, sy: 41, sw: 274, sh: 300 } },  // reared
          { trim: { sx: 106, sy: 94, sw: 300, sh: 247 } }, // launching forward
          { trim: { sx: 98, sy: 0, sw: 272, sh: 195 } },    // leaping, airborne
          { trim: { sx: 103, sy: 175, sw: 306, sh: 166 } }, // landed
        ],
      },
      /* The skunk is the one animal in the game NOT flipped: it is drawn
       * facing left already, and its whole defence is to turn its back and
       * spray, so it has to end up with its tail toward the oncoming fox.
       * Flipped, it faced away and fired its cloud off the wrong side.
       *
       * Five poses - alert, up on its legs, turning, back turned, and the
       * cloud - so it needs more warning than the default 190px or the
       * sequence is over before it reads.
       */
      hedgehog: {
        h: 38, weight: 1.7, sink: 6, flip: false,
        poseFit: "scale", hideNotice: 340,
        trim: { sx: 81, sy: 100, sw: 350, sh: 231 },
        // Unflipped the tail is still the trailing edge, so the generous
        // inset stays on the right where it was.
        hitbox: { left: 0.10, right: 0.22, top: 0.14, bottom: 0.02 },
        poses: [
          { trim: { sx: 81, sy: 100, sw: 350, sh: 231 } },
          { trim: { sx: 59, sy: 45, sw: 394, sh: 286 } },
          { trim: { sx: 105, sy: 16, sw: 301, sh: 315 } },
          { trim: { sx: 148, sy: 16, sw: 215, sh: 315 } },
          { trim: { sx: 79, sy: 19, sw: 354, sh: 312 } },
        ],
      },
      /* The marmot takes the rock's slot and presses itself flat as the
       * fox leaps. Its poses SPREAD as they drop - a flattening animal
       * gets wider, and holding the resting width made it look like it
       * was shrinking away into the ground instead.
       */
      rock: {
        h: 38, weight: 1.9, availableFrom: 250, animal: true, flip: true, sink: 6,
        trim: { sx: 6, sy: 76, sw: 500, sh: 265 },
        hitbox: { left: 0.08, right: 0.24, top: 0.14, bottom: 0.02 },
        poses: [
          { trim: { sx: 6, sy: 111, sw: 500, sh: 230 }, wScale: 1.07 },
          { trim: { sx: 6, sy: 169, sw: 500, sh: 172 }, wScale: 1.16 },
        ],
      },
      // A fallen pine, about the weight of the woodland's mossy log.
      log: { h: 38, weight: 3, availableFrom: 250, sink: 6,
             trim: { sx: 6, sy: 130, sw: 500, sh: 211 },
             hitbox: { left: 0.08, right: 0.08, top: 0.15, bottom: 0.02 } },
      // A rock spire in the hollow log's slot: the tallest static thing in
      // the game, but narrow with it, so it is height rather than reach.
      // The trim skips a fragment of the pine log sitting to its left in
      // the source PNG; the spire proper starts at x189.
      stump: { h: 56, weight: 2.4, availableFrom: 900, sink: 6,
               trim: { sx: 189, sy: 12, sw: 249, sh: 326 },
               hitbox: { left: 0.14, right: 0.14, top: 0.10, bottom: 0.02 } },
      // The mountain's own scree pile, in the mid-level rotation.
      // Likewise trimmed clear of a sliver of the next frame at its right.
      boulder: { h: 40, weight: 2.5, availableFrom: 400, sink: 6,
                 trim: { sx: 7, sy: 84, sw: 449, sh: 255 },
                 hitbox: { left: 0.10, right: 0.10, top: 0.12, bottom: 0.02 } },
      /* The eagle is a far bigger bird than the owl, and a taller one, so
       * it flies higher to keep the promise the bluebird made in level 1:
       * a fox on the ground can never be hit by anything in the air.
       */
      flyer: { w: 62, h: 62, altMin: 96,
               trim: { sx: 102, sy: 11, sw: 329, sh: 330 } },
    },
    /* One tile, cropped twice: the grass lip and blades on top, then the
     * stone cross-section below it. srcY values are fixed pixel bands
     * measured from ledge.png (2048x768) - grass blades from y163, solid
     * grass to y262, stone from there down to the soft edge at y700.
     */
    groundCrops: {
      grass: { srcY0: 163, srcY1: 300, drawH: 34, surfaceFrac: 0.30 },
      dirt: { srcY0: 290, srcY1: 700, drawH: 44, overlap: 12 },
      underfill: "#161f21", // dark stone behind/below everything
    },
    cast: { hedgehog: "skunk", rabbit: "bear", rock: "marmot",
            log: "fallen pine", stump: "rock spire", sentry: "ram",
            boulder: "scree", chaser: "hunting dog", flyer: "eagle",
            collectible: "acorn" },
    dog: { availableFrom: 300, gapScale: 0.85 },
    /* Peaks drop 70px and the clouds a full 210px across the level, so
     * by the summit the fox is running above the weather. The mid
     * treeline stays put: something has to hold still for the rest of it
     * to read as movement.
     */
    /* Each band names the rows of its PNG that actually hold scenery, so
     * `h` is the height of the peaks or the treeline rather than of the
     * whole canvas - roughly half of each of these files is empty sky, and
     * sizing that too was what left the mountains looking so small.
     */
    bands: [
      // Only 40: sunk any further the peaks disappear behind the treeline
      // and the last third of the climb is an empty sky.
      { img: "hillsFar", h: 118, parallax: 0.08, climb: 40,
        src: { srcY0: 299, srcY1: 512 } },
      // Starts 80px above the horizon and descends 210px, so it is
      // overhead for the first stage and gone below the path by the last.
      { img: "clouds", h: 78, parallax: 0.16, offset: -80, climb: 210,
        src: { srcY0: 109, srcY1: 341 } },
      /* Cropped to the treeline on all four sides: the bare margins left a
       * gap of sky at every tile seam, and the bottom row is a ghost of
       * half-transparent green.
       *
       * Not mirrored. Every pine in this strip leans the same way, and
       * flipping alternate tiles - which is only there to hide a seam -
       * sent half of them leaning back down the mountain.
       */
      { img: "treesMid", h: 52, parallax: 0.22, mirror: false,
        src: { srcX0: 19, srcX1: 1185, srcY0: 300, srcY1: 597 } },
    ],
    /* A yodel, in G major. The other two levels walk up and down a
     * pentatonic scale, which is why they sound like each other; this one
     * is built the way a yodel is - the voice breaking up an OCTAVE and
     * dropping back, three times in the first bar, over an oom-pah bass
     * alternating root and fifth. Every leaping note is a G major triad
     * tone, so however fast the tempo winds up it stays sweet.
     *
     * Rooted at G4 rather than D5: the leaps need somewhere to go, and
     * from any higher the top of them turns shrill.
     */
    music: {
      root: 67, // G4
      //      yo  del  ay   ee   oo        <- the breaks are the octaves
      lead: [0, 12, 4, 16, 7, 19, 12, 7,
             0, 12, 16, 12, 9, 7, 2, null],
      // Oom-pah: root on the beat, fifth off it. Last half turns to D so
      // the loop has somewhere to come home from.
      bass: [-12, null, -5, null, -12, null, -5, null,
             -12, null, -5, null, -17, null, -10, null],
    },
  }),
};

/* The levels, in order. Each finishes at its goal score, then the fox
 * dives into his hole and the next one begins.
 */
const LEVELS = [
  { theme: "field", goal: 3000 },
  { theme: "woodland", goal: 3000 },
  { theme: "mountain", goal: 3000 },
];
let levelIndex = 0;
let THEME = THEMES[LEVELS[levelIndex].theme];

/* TESTING ONLY - remove before this goes to real players.
 * Unlocks every level on the title and game-over screens so a level can be
 * checked without playing up to it. Switch it on with ?test=1 (it sticks,
 * so a tablet only needs the URL once) and off again with ?test=0.
 * Letting a player pick their level would be cheating; this is scaffolding.
 */
const TEST_LEVELS = (() => {
  const KEY = "foxRunnerTestLevels";
  try {
    const q = new URLSearchParams(location.search).get("test");
    if (q === "1") localStorage.setItem(KEY, "1");
    else if (q === "0") localStorage.removeItem(KEY);
    return localStorage.getItem(KEY) === "1";
  } catch (e) {
    return false; // private browsing: just stay off
  }
})();
// How many settings the picker may offer right now.
function pickableLevels(furthest) {
  return TEST_LEVELS ? LEVELS.length : furthest + 1;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const GAME_W = 900;
const GAME_H = 300;

const GROUND_Y = 250; // y of the running surface (fox/obstacle feet)

/* The ground is two tiles merged into one simple flat surface:
 * ground_tile_2's plain grass strip laid over a band of ground_tile_5's
 * pebbly dirt. Source crops are FIXED pixel bands measured from the artwork
 * (not measured at runtime — canvas pixel readback is unavailable on file://
 * pages, and the crops must not silently change). ground_tile_5 ships on an
 * opaque white/checker canvas; its crop stays well inside the dirt, away
 * from every white margin.
 *  - srcY0/srcY1: vertical band of the source image to draw
 *  - drawH: on-screen height of that band
 *  - surfaceFrac: how far down the band the running surface sits
 */
const GROUND = {
  grass: { srcY0: 230, srcY1: 500, drawH: 40, surfaceFrac: 0.24 },
  dirt: { srcY0: 435, srcY1: 505, drawH: 34, overlap: 10 },
  underfill: "#4a2f17", // dark soil behind/below everything
};

/* Jump physics, tuned so that a plain TAP is always a full, safe jump:
 * young players tap rather than hold, and a tap must clear every obstacle
 * available at the speed it can appear. Holding adds extra lift on top
 * (softer gravity for a moment) for high acorns - never the other way
 * round, so a quick press can never produce a fatal little hop.
 */
const PHYSICS = {
  apex: 108,             // peak height of a TAP jump, px (constant)
  riseFrac: 0.52,        // share of airtime spent rising (fall is snappier)
  // Airtime scales with game speed so the jump carries the fox a similar
  // DISTANCE at any speed. Without this the opening is the hardest part
  // of the game: a slow scroll means a short hop and a cruelly narrow
  // timing window, which is exactly what young players struggle with.
  airtimeSlow: 1.05,     // seconds, at slowSpeed
  airtimeFast: 0.76,     // seconds, at fastSpeed
  slowSpeed: 215,
  fastSpeed: 515,
  // Holding lifts the fox roughly half again as high as a tap, so a tap
  // is a modest hop and a held press is a big soaring jump. The tap is
  // still sized to clear every obstacle on its own - a genuinely tiny
  // tap would leave a young player unable to get over anything.
  holdGravityFactor: 0.40, // gravity multiplier while the button is held...
  holdTime: 0.25,          // ...for this long -> hold apex ~155px
};

// Jump arc for a given scroll speed: constant apex, longer airtime when
// the game is slow. Returns takeoff velocity and the two gravities.
function jumpArc(speed) {
  const p = PHYSICS;
  const t = (speed - p.slowSpeed) / (p.fastSpeed - p.slowSpeed);
  const airtime = p.airtimeSlow + (p.airtimeFast - p.airtimeSlow) * Math.min(Math.max(t, 0), 1);
  const rise = airtime * p.riseFrac;
  const fall = airtime - rise;
  return {
    v: (2 * p.apex) / rise,
    gravityUp: (2 * p.apex) / (rise * rise),
    gravityDown: (2 * p.apex) / (fall * fall),
  };
}

const SCORE_DISTANCE_DIVISOR = 12; // px of travel per score point

/* Scoring. Distance survived is the bulk of it and carries across levels,
 * so a run that reaches the woodland scores what it earned in the field
 * plus whatever it adds. Acorns and dogs top it up without overshadowing
 * how far you got: a good level is 3000 from distance, against maybe 500
 * from acorns and 500 from dogs.
 */
const SCORING = { acorn: 25, dog: 100 };
function levelGoal() { return LEVELS[levelIndex].goal; }

/* Finishing a level: the spawners stop, the fox's burrow scrolls in, and
 * he dives home. Then the success page, and on to the next setting.
 */
/* Progress bar, sunk into the dirt strip below the grass. Each level is
 * three stages; reaching a stage banks it, and dying restarts from there
 * rather than from the very beginning - young players die a lot, and
 * replaying the same opening every time is what makes them give up. The
 * banked stage lives in memory only, so closing the game starts afresh.
 * Kept clear of the left/right thumb buttons, which cover the bottom
 * corners of the canvas and eat proportionally more room on small screens.
 */
const PROGRESS = {
  stages: 3,
  y: 283, h: 11,
  markerR: 6.5,
  edgeMargin: 16, // from the canvas edge when nothing is in the way
  buttonGap: 10,  // clearance either side of a thumb button
};

const FINISH = {
  holeLeadIn: 1.6,  // seconds of clear ground before the burrow appears
  diveTime: 0.55,   // seconds to disappear down it
  holeW: 132,
  holeH: 34,
  trim: { sx: 6, sy: 81, sw: 500, sh: 256 }, // content box of fox_hole.png
  sink: 10,        // how far the burrow sits into the grass
  mouthFrac: 0.42, // height of the dark mouth above the burrow's base
};

// Fox drawn CONTENT size (the visible artwork, not the padded PNG canvas).
const FOX_H = 62;
const FOX_W = 110;
const FOX_X = GAME_W * 0.14;       // normal spot: left quarter of the screen
const FOX_CHASE_X = GAME_W * 0.36; // during a dog chase: near mid-screen —
                                   // the dog fits on screen behind and the
                                   // player has less reaction room ahead
const FOX_SHIFT_FORWARD = 150;     // px/s ease toward the chase position
const FOX_SHIFT_BACK = 70;         // px/s ease home after the chase

/* Source trims for the fox poses (fixed pixel rects measured from the art).
 * NOTE: all trim rects in this file are in the pixel space of the SHIPPED
 * art (downscaled to max 512px for load size). If the art is ever
 * re-exported at another resolution, rescale every trim with it.
 * The eight run frames share ONE union rect so they render at a single
 * common scale — per-frame differences (the gather pose sitting higher,
 * feet lifting) stay inside the box and read as animation, not size jitter.
 * Poses are drawn bottom-RIGHT anchored, so the nose and the hitbox's front
 * edge line up across poses even though their content widths differ.
 */
const FOX_TRIMS = {
  run: { sx: 26, sy: 43, sw: 460, sh: 260 }, // union of fox_run_01..08
  foxJump: { sx: 22, sy: 8, sw: 477, sh: 325 },
  foxLand: { sx: 0, sy: 0, sw: 507, sh: 333 },
  foxHit: { sx: 0, sy: 1, sw: 512, sh: 340 },
  // Throw sequence. hScale draws the rearing poses taller than the run
  // height (the fox stands up to throw); hitbox stays the normal box.
  foxThrow1: { sx: 28, sy: 34, sw: 440, sh: 255, hScale: 1.0 },
  foxThrow2: { sx: 22, sy: 11, sw: 477, sh: 330, hScale: 1.26 },
  foxThrow3: { sx: 8, sy: 3, sw: 492, sh: 338, hScale: 1.29 },
  foxThrow4: { sx: 16, sy: 3, sw: 482, sh: 327, hScale: 1.06 },
};

// Throw animation timing: 4 frames; the projectile leaves the paw at the
// start of the release frame, not at the key press.
const THROW_ANIM = { frameDur: 0.09, releaseAt: 0.18, duration: 0.36 };

// Hitbox insets as fractions of the content box. The big tail plume is on
// the left and the ears on top — both are trimmed away so skimming feels fair.
const FOX_HITBOX = { left: 0.36, right: 0.08, top: 0.22, bottom: 0.04 };

/* Run-cycle playback.
 * fps 20 divides a 60Hz display evenly (every frame shows for exactly 3
 * refreshes) — 24fps alternated 2/3 refreshes per frame, and that uneven
 * cadence read as stutter. speedCoupling softens how much the cycle speeds
 * up with game speed (rate = 0.7 + 0.3*speed/base), keeping the cadence
 * near the clean rate instead of doubling into arbitrary timings.
 * `blend` crossfade was tried and rejected (read as two overlaid foxes).
 */
const FOX_ANIM = { fps: 20, blend: false, speedCoupling: 0.3 };

/* Per-frame horizontal corrections (screen px). Measured from the frames'
 * alpha centroids: a few frames sit off the cycle's smooth forward-surge
 * path (worst: 04, 05, 11), making the fox zigzag a couple of px each
 * step. Each value nudges its frame back onto the smoothed path.
 */
const FOX_RUN_DX = [-1.1, 0.5, -0.5, 1.9, -2.0, 0.6, 0.1, -0.4, 0.6, 1.0, -2.3, 1.6];

/* Obstacle registry.
 *  - h is the drawn CONTENT height; width comes from each sprite's trimmed
 *    aspect ratio at load time (auto-trim removes transparent padding).
 *  - sizeClass/animal are spawn metadata (small|medium|large).
 *  - pairable marks low obstacles that may appear as a close pair cleared
 *    by a single jump. Large/tall obstacles are never paired closely.
 *  - availableFrom fades a type in once the score passes that threshold.
 *  - hitbox insets are fractions of the trimmed content box.
 */
const OBSTACLE_TYPES = {
  // `sink` nudges the sprite down into the grass so soft anti-aliased
  // bottom edges don't leave a visible gap above the ground.
  // Animals come first; the long log waits until the game is faster —
  // at low speed a jump covers little distance, making long obstacles
  // disproportionately hard for beginners.
  hedgehog: {
    src: THEME.obstacles.hedgehog,
    h: 32, sizeClass: "small", animal: true, pairable: true,
    weight: 3, availableFrom: 0, sink: 3,
    flip: true, // face the approaching fox (hitbox insets already mirrored)
    trim: { sx: 56, sy: 10, sw: 414, sh: 320 },
    hitbox: { left: 0.10, right: 0.08, top: 0.12, bottom: 0.02 },
  },
  rabbit: {
    src: THEME.obstacles.rabbit,
    h: 38, sizeClass: "small", animal: true, pairable: true,
    weight: 2.5, availableFrom: 0, sink: 3,
    flip: true, // face the approaching fox (hitbox insets already mirrored)
    trim: { sx: 64, sy: 2, sw: 412, sh: 336 },
    hitbox: { left: 0.10, right: 0.10, top: 0.18, bottom: 0.02 },
  },
  rock: {
    src: THEME.obstacles.rock,
    h: 40, sizeClass: "medium", animal: false, pairable: true,
    weight: 2.5, availableFrom: 500, sink: 4,
    trim: { sx: 14, sy: 14, sw: 484, sh: 304 },
    hitbox: { left: 0.10, right: 0.10, top: 0.12, bottom: 0.02 },
  },
  log: {
    src: THEME.obstacles.log,
    h: 34, sizeClass: "medium", animal: false, pairable: true,
    weight: 3, availableFrom: 1000, sink: 4,
    trim: { sx: 16, sy: 26, sw: 482, sh: 200 },
    hitbox: { left: 0.08, right: 0.08, top: 0.15, bottom: 0.02 },
  },
  /* A sixth slot, used only by themes that ask for it (the field's mix is
   * already tuned, so it never appears there). Its default filename is
   * rock.png, so a theme without its own boulder art falls back to the
   * field's mossy grey one - which suits a wood as well as a meadow.
   */
  boulder: {
    src: THEME.obstacles.boulder,
    h: 40, sizeClass: "medium", animal: false, pairable: true,
    weight: 2.5, availableFrom: 999999, sink: 4,
    trim: { sx: 14, sy: 14, sw: 484, sh: 304 },
    hitbox: { left: 0.10, right: 0.10, top: 0.12, bottom: 0.02 },
  },
  /* A seventh slot for a second REARING animal, so a level can have one
   * that stands up early and modestly as well as a late, big one. Like
   * the boulder it defaults to rock.png and to never appearing, so the
   * levels that do not want it are untouched.
   */
  sentry: {
    src: THEME.obstacles.sentry,
    h: 34, sizeClass: "medium", animal: true, pairable: false,
    weight: 2, availableFrom: 999999, sink: 4,
    flip: true, // whoever plays this role faces the approaching fox
    trim: { sx: 14, sy: 14, sw: 484, sh: 304 },
    hitbox: { left: 0.12, right: 0.20, top: 0.10, bottom: 0.02 },
  },
  stump: {
    src: THEME.obstacles.stump,
    h: 46, sizeClass: "large", animal: false, pairable: false,
    trim: { sx: 34, sy: 36, sw: 454, sh: 278 },
    weight: 2, availableFrom: 1500, sink: 5,
    hitbox: { left: 0.12, right: 0.18, top: 0.10, bottom: 0.02 },
  },
};

const TYPE_FADE_IN = 300; // score span over which a newly available type ramps to full weight

// Cowering animals: how close the fox must be to spook them, how near
// "overhead" counts as a leap-over, and how long the pose lingers after.
const OBSTACLE_HIDE = { noticeDistance: 190, overhead: 105, hold: 0.45 };

/* Difficulty bands. Parameters are interpolated smoothly between anchors by
 * score, so there are no sudden jumps at band edges. Gap values are in
 * SECONDS of travel at current speed, which keeps reaction time meaningful
 * as speed rises. Score accrues at roughly speed/12 per second (~25-50/s),
 * so these anchors correspond to ~0s / ~15s / ~45s / ~85s / ~2min survived.
 */
const DIFFICULTY = {
  maxSpeed: 520,
  bands: [
    // Level 1 runs 0 -> LEVEL_GOAL. It opens very slow and sparse so a
    // young player can learn the timing, then climbs steadily: faster,
    // tighter gaps, and more elaborate patterns fading in one at a time.
    //          px/s   gap between patterns   pattern weights
    { score: 0,    speed: 215, gapMin: 1.85, gapMax: 2.90,
      weights: { single: 1, spacedPair: 0,    closePair: 0,    spacedTriple: 0,    comboTriple: 0 } },
    { score: 250,  speed: 235, gapMin: 1.70, gapMax: 2.70,
      weights: { single: 1, spacedPair: 0,    closePair: 0,    spacedTriple: 0,    comboTriple: 0 } },
    { score: 500,  speed: 260, gapMin: 1.55, gapMax: 2.45,
      weights: { single: 1, spacedPair: 0,    closePair: 0,    spacedTriple: 0,    comboTriple: 0 } },
    { score: 1000, speed: 300, gapMin: 1.35, gapMax: 2.15,
      weights: { single: 1, spacedPair: 0.15, closePair: 0,    spacedTriple: 0,    comboTriple: 0 } },
    { score: 1500, speed: 340, gapMin: 1.18, gapMax: 1.90,
      weights: { single: 1, spacedPair: 0.30, closePair: 0,    spacedTriple: 0,    comboTriple: 0 } },
    { score: 2000, speed: 380, gapMin: 1.02, gapMax: 1.65,
      weights: { single: 1, spacedPair: 0.45, closePair: 0.15, spacedTriple: 0,    comboTriple: 0 } },
    { score: 2500, speed: 415, gapMin: 0.90, gapMax: 1.45,
      weights: { single: 1, spacedPair: 0.55, closePair: 0.30, spacedTriple: 0.10, comboTriple: 0 } },
    { score: 3000, speed: 450, gapMin: 0.80, gapMax: 1.30,
      weights: { single: 1, spacedPair: 0.65, closePair: 0.45, spacedTriple: 0.20, comboTriple: 0.10 } },
    // The bands past LEVEL_GOAL are unused by level 1; kept for level 2.
    { score: 3500, speed: 485, gapMin: 0.73, gapMax: 1.18,
      weights: { single: 1, spacedPair: 0.72, closePair: 0.55, spacedTriple: 0.28, comboTriple: 0.18 } },
    { score: 4000, speed: 515, gapMin: 0.68, gapMax: 1.08,
      weights: { single: 1, spacedPair: 0.78, closePair: 0.65, spacedTriple: 0.32, comboTriple: 0.25 } },
  ],
};

// Gap (seconds of travel) between obstacles inside spaced sequences —
// enough room to land, re-read, and jump again.
const SEQUENCE_GAP = { min: 0.72, max: 0.95 };
const CLOSE_PAIR_MIN_GAP = 30;      // px of daylight between a close pair
const CLOSE_PAIR_SAFETY = 0.78;     // fraction of theoretical clearance we allow

/* Acorn collectibles. Caught on touch; the per-run count is future
 * ammunition for the chasing-animals phase (throw with the back arrow).
 * Mostly placed high so catching one takes a jump; the odd one sits on
 * the ground. Heights are in px above the running surface and are tuned
 * to the jump arc (apex 120px): highest acorns need a near-full jump.
 */
const ACORN = {
  src: THEME.collectible.item,
  trim: { sx: 0, sy: 22, sw: 505, sh: 490 },
  w: 26, h: 25,
  pickupPad: 4,          // extra px around the sprite for a forgiving catch
  availableFrom: 250,    // score at which acorns start appearing
  gapMin: 900,           // px of travel between acorn spawns
  gapMax: 2000,
  highChance: 0.8,       // the rest sit on the ground
  highMin: 75,           // center height above the surface (jumping catch)
  highMax: 145,
  // Below this score, acorns are placed directly above obstacles so the
  // jump the player must make anyway collects them — building ammo before
  // the dog arrives. Past it, placement goes random and catching becomes
  // a choice.
  guidedUntil: 1500,
  guidedHeight: 62,      // acorn center this far above the obstacle's top
  guidedMaxUp: 118,      // ...but never higher than the jump arc reaches
};

/* The hunting dog. Spawns asleep on the path like an obstacle; when the
 * fox jumps over it, it wakes (waking → head shake → alert) and gives
 * chase from behind. A thrown acorn stops it; otherwise it closes in with
 * a rubber-band (fast from far away, creeping when near) until either it
 * catches the fox or its stamina runs out and it falls behind.
 * One dog at a time. Per-pose trims/sizes because each source frame fills
 * its canvas at a different real-world scale.
 */
const DOG = {
  availableFrom: 700,    // score at which dogs start appearing (per theme via THEME.dog)
  gapMin: 2600,          // px of travel between dog encounters
  gapMax: 4800,
  frames: THEME.chaser, // sleep / waking / headShake / alert / crash / bite
  // Per-pose `sink` pushes the sprite down into the grass (art has soft
  // transparent edges at the bottom); default is 3 when unset.
  poses: {
    sleep: { trim: { sx: 5, sy: 11, sw: 503, sh: 330 }, h: 44, sink: 7 },
    waking: { trim: { sx: 11, sy: 75, sw: 486, sh: 177 }, h: 34, sink: 5 },
    headShake: { trim: { sx: 0, sy: 10, sw: 508, sh: 331 }, h: 50 },
    alert: { trim: { sx: 8, sy: 6, sw: 494, sh: 319 }, h: 48 },
    run: { trim: { sx: 0, sy: 0, sw: 512, sh: 341 }, h: 56 },
    crash: { trim: { sx: 0, sy: 6, sw: 507, sh: 335 }, h: 54 },
    bite: { trim: { sx: 8, sy: 4, sw: 500, sh: 337 }, h: 58 },
  },
  wakeDurations: { waking: 0.35, headShake: 0.3, alert: 0.25 },
  runFps: 20,
  chase: {
    base: 60,            // closing speed px/s at full rubber-band...
    perSpeed: 0.10,      // ...plus this fraction of current game speed
    rubberBandDist: 250, // full closing speed beyond this gap
    rubberBandMin: 0.55, // slowdown when right behind the fox — a real
                         // threat (~4s to catch), but time enough to throw
    stamina: 9,          // seconds of chasing before it tires and falls back
    entryX: -150,        // where the chase starts if the wake drifted off-screen
  },
  sleepHitbox: { left: 0.08, right: 0.08, top: 0.18, bottom: 0.04 },
  runHitbox: { left: 0.12, right: 0.15, top: 0.20, bottom: 0.04 },
  // Seconds of obstacle-free travel bought when the sleeping dog spawns:
  // covers approaching him, the wake-up, and the fox's surge to mid-screen,
  // so nothing else demands a jump until the chase is properly underway.
  spawnGraceSeconds: 4.2,
  // Pack size by score: one dog at a time early, two from 2000, three
  // from 4000 — if you can't clear them with acorns, they accumulate.
  // Two at once through the closing third, so the run home is the
  // busiest stretch rather than more of the same.
  packSizes: [
    { score: 0, max: 1 },
    { score: 2000, max: 2 },
  ],
  packStagger: 65, // px: each extra pack member hangs this much further back
  // In pack territory dogs spawn closer together, and each chaser burns
  // slower (creeps rather than pounces) so a second dog has time to join
  // the hunt before the first one bites. It still bites in the end.
  packGapMin: 1500,
  packGapMax: 3000,
  packJoinGraceSeconds: 1.5, // obstacle grace for dogs joining an active chase
  // Encounters close up as the level goes on: gaps shrink to this
  // fraction of their base by the time the burrow is in sight.
  lateFrequency: 0.35,
  gapScale: 1, // per-theme multiplier on every gap
  chaseTuning: [
    { score: 0, rubberBandMin: 0.55, stamina: 9 },
    { score: 2000, rubberBandMin: 0.26, stamina: 16 },
  ],
};

/* Dog pacing can differ per level: the woodland meets them sooner and
 * more often than the field, which is a player's first encounter.
 */
function dogSetting(key) {
  const over = THEME.dog;
  if (over && over[key] !== undefined) return over[key];
  return DOG[key];
}

function dogChaseTuning(score) {
  let t = DOG.chaseTuning[0];
  for (const band of DOG.chaseTuning) if (score >= band.score) t = band;
  return t;
}

// Thrown acorns (ArrowLeft). Screen-relative backward flight with a
// gentle arc; hitting any dog stops it.
const THROW = { vx: -430, vy: -140, gravity: 900, cooldown: 0.4, size: 20 };

/* The bluebird: a flying hazard. It crosses at jump height, so a fox on
 * the ground is always safe — it punishes being airborne at the wrong
 * moment (mid-jump for an acorn or an obstacle). Touching it ends the run.
 */
const BIRD = {
  // Six-frame wing beat. One shared union trim keeps the body steady
  // while the wings sweep, the same trick the fox run cycle uses.
  frameCount: 6,
  trim: { sx: 20, sy: 0, sw: 480, sh: 327 },
  flapFps: 14,
  w: 48, h: 33,
  availableFrom: 1600,   // score at which bluebirds start appearing
  gapMin: 2400,          // px of travel between bird spawns
  gapMax: 4600,
  // Flies at exactly the scroll speed: any faster and a bird that spawned
  // in a clear corridor drifts into an obstacle before reaching the fox,
  // turning a forced jump into an unavoidable collision.
  speedFactor: 1.0,
  altMin: 88,            // center height above the surface; the minimum
  altMax: 135,           // keeps it clear of a grounded fox (62 tall)
  bobAmp: 7,             // gentle sine bob
  bobRate: 3.5,
  // No obstacle/dog/acorn may sit in this corridor around the spawn point,
  // so a bird never crosses right where a jump is being forced.
  // Wide enough to cover a whole jump arc either side, so a bird is never
  // overhead while the fox is committed to clearing something.
  corridorBehind: 420,
  corridorAhead: 240,
  hitbox: { left: 0.14, right: 0.12, top: 0.18, bottom: 0.18 },
};

const HISCORE_KEY = "foxRunnerHiScore";

// ---------------------------------------------------------------------------
// Difficulty interpolation
// ---------------------------------------------------------------------------

function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Smoothly interpolated difficulty parameters for a given score.
function difficultyAt(score) {
  const bands = DIFFICULTY.bands;
  let lo = bands[0];
  let hi = bands[bands.length - 1];
  for (let i = 0; i < bands.length - 1; i++) {
    if (score >= bands[i].score && score < bands[i + 1].score) {
      lo = bands[i];
      hi = bands[i + 1];
      break;
    }
  }
  const span = hi.score - lo.score;
  let t = span > 0 ? (score - lo.score) / span : 1;
  t = Math.min(Math.max(t, 0), 1);
  t = t * t * (3 - 2 * t); // smoothstep

  const weights = {};
  for (const key of Object.keys(lo.weights)) {
    weights[key] = lerp(lo.weights[key], hi.weights[key], t);
  }
  return {
    speed: Math.min(lerp(lo.speed, hi.speed, t), DIFFICULTY.maxSpeed),
    gapMin: lerp(lo.gapMin, hi.gapMin, t),
    gapMax: lerp(lo.gapMax, hi.gapMax, t),
    weights,
  };
}

// ---------------------------------------------------------------------------
// Jump physics helpers (used by the spawner for fairness guarantees)
// ---------------------------------------------------------------------------

function jumpApexHeight() {
  return PHYSICS.apex;
}

// Seconds a tap jump spends above height y, at the given scroll speed.
function timeAboveHeight(y, speed) {
  const apex = PHYSICS.apex;
  if (y >= apex) return 0;
  const arc = jumpArc(speed);
  const riseTotal = arc.v / arc.gravityUp;
  // Rising: solve v*t - 0.5*gUp*t^2 = y for the earlier root.
  const t1 = (arc.v - Math.sqrt(arc.v * arc.v - 2 * arc.gravityUp * y)) / arc.gravityUp;
  const fallAbove = Math.sqrt((2 * (apex - y)) / arc.gravityDown);
  return (riseTotal - t1) + fallAbove;
}

// Max horizontal span (obstacle widths + gap) a single jump can carry the
// fox's hitbox across, above obstacles of height obstacleH, at given speed.
function maxSingleJumpSpan(speed, obstacleH, foxHitboxW) {
  const clearance = timeAboveHeight(obstacleH + 8, speed); // 8px of headroom
  return speed * clearance * CLOSE_PAIR_SAFETY - foxHitboxW;
}

// ---------------------------------------------------------------------------
// Asset loading & processing
// ---------------------------------------------------------------------------

let IMAGE_SOURCES = {};

/* Re-points every theme-derived binding at the current THEME. Must run
 * before each load, because advancing a level swaps the theme and these
 * were otherwise frozen at the values the first level happened to have.
 */
function bindTheme() {
  applyThemeSprites();
  IMAGE_SOURCES = {
    sky: THEME.scenery.sky,
    hillsFar: THEME.scenery.hillsFar,
    tree1: THEME.scenery.trees[0],
    tree2: THEME.scenery.trees[1],
    tree3: THEME.scenery.trees[2],
    bushStrip: THEME.scenery.bushes[0],
    bush1: THEME.scenery.bushes[1],
    bush2: THEME.scenery.bushes[2],
    bush3: THEME.scenery.bushes[3],
    groundDirt: THEME.ground.dirt,
    groundGrass: THEME.ground.grass,
    acorn: THEME.collectible.item,
    acornIcon: THEME.collectible.icon,
    foxJump: THEME.hero.jump,
    foxLand: THEME.hero.land,
    foxHit: THEME.hero.hit,
    foxThrow1: THEME.hero.throw[0],
    foxThrow2: THEME.hero.throw[1],
    foxThrow3: THEME.hero.throw[2],
    foxThrow4: THEME.hero.throw[3],
    introBg: THEME.pages.intro,
    gameOverBg: THEME.pages.gameOver,
  };
  THEME.hero.run.forEach((src, i) => { IMAGE_SOURCES["foxRun" + (i + 1)] = src; });
  /* Reaction poses: each role's list can be any length (two to cower,
   * four for the badger's rise). Register an image per pose and hand the
   * obstacle a `hide` list pairing each key with its trim.
   */
  for (const [role, paths] of Object.entries(THEME.reactions || {})) {
    const type = OBSTACLE_TYPES[role];
    const poses = (THEME.sprites && THEME.sprites[role] && THEME.sprites[role].poses) || [];
    if (!type || !poses.length) continue;
    type.hide = paths.slice(0, poses.length).map((src, i) => {
      const key = `react_${role}_${i}`;
      IMAGE_SOURCES[key] = src;
      return { key, trim: poses[i].trim, wScale: poses[i].wScale || 1 };
    });
  }
  /* A pouncing animal is tallest in mid-leap, and that is the height the
   * spawner has to leave room to clear. Derived from the frames rather
   * than written by hand, so re-cut artwork cannot silently make one
   * unjumpable.
   */
  for (const type of Object.values(OBSTACLE_TYPES)) {
    if (!type.lungeBy || !type.hide || !type.hide.length) continue;
    const px = type.h / type.trim.sh;
    const floor = type.floor || (type.trim.sy + type.trim.sh);
    type.rearHeight = Math.max(
      type.h,
      ...type.hide.map((p) => (floor - p.trim.sy) * px)
    );
  }
  DOG.frames = THEME.chaser;
  ACORN.src = THEME.collectible.item;
  for (const [name, type] of Object.entries(OBSTACLE_TYPES)) {
    type.src = THEME.obstacles[name];
  }
}

/* Loads an image. `src` may be a single path, or [preferred, fallback]:
 * a theme still being drawn borrows the other theme's art for anything
 * its own folder does not have yet, so a missing file is not an error.
 */
function loadImage(src, opts) {
  const chain = Array.isArray(src) ? src.slice() : [src];
  const tryNext = () => {
    const path = chain.shift();
    return new Promise((resolve, reject) => {
      const img = new Image();
      if (opts && opts.priority) {
        try { img.fetchPriority = opts.priority; } catch (e) { /* unsupported */ }
      }
      img.onload = () => resolve(img);
      img.onerror = () => {
        if (chain.length) resolve(tryNext());
        else reject(new Error("Failed to load " + path));
      };
      img.src = path;
    });
  };
  return tryNext();
}

/* Applies the active theme's sprite tweaks over the shared gameplay
 * config. Geometry only - the owl is a bigger bird than the bluebird, the
 * badger rears where the rabbit cowers - so spacing, speed and every other
 * difficulty number stays identical from level to level.
 */
// The shared gameplay config, before any theme touches it. Themes only
// override geometry, and switching level must not leak one theme's
// proportions into the next, so every bind starts from these.
const BASE_OBSTACLES = JSON.parse(JSON.stringify(OBSTACLE_TYPES));
// Deep-cloned whole, not just w/h/trim: a theme that changes any other
// number (the eagle's flight altitude) must not leak it into the next level.
const BASE_BIRD = JSON.parse(JSON.stringify(BIRD));

function applyThemeSprites() {
  for (const [name, base] of Object.entries(BASE_OBSTACLES)) {
    const t = OBSTACLE_TYPES[name];
    for (const k of Object.keys(t)) {
      if (k !== "image") delete t[k];
    }
    Object.assign(t, JSON.parse(JSON.stringify(base)));
  }
  Object.assign(BIRD, JSON.parse(JSON.stringify(BASE_BIRD)));

  for (const [role, over] of Object.entries(THEME.sprites || {})) {
    const target = role === "flyer" ? BIRD : OBSTACLE_TYPES[role];
    if (!target) continue;
    const { poses, ...geometry } = over;
    Object.assign(target, geometry);
  }
  // Anything that rears is too tall to be half of a one-jump close pair.
  for (const t of Object.values(OBSTACLE_TYPES)) {
    if (t.rearHeight || t.lungeBy) t.pairable = false;
  }
}

/* Every image a theme needs, as loader entries (a path, or a
 * [preferred, fallback] pair). Mirrors what bindTheme wires up.
 */
function themeImageEntries(theme) {
  const out = [];
  const push = (v) => { if (v) out.push(v); };
  theme.hero.run.forEach(push);
  push(theme.hero.jump);
  push(theme.hero.land);
  push(theme.hero.hit);
  theme.hero.throw.forEach(push);
  Object.values(theme.obstacles).forEach(push);
  Object.values(theme.reactions).forEach((poses) => poses.forEach(push));
  ["sleep", "waking", "headShake", "alert", "crash", "bite"]
    .forEach((k) => push(theme.chaser[k]));
  theme.chaser.run.forEach(push);
  theme.flyer.fly.forEach(push);
  push(theme.collectible.item);
  push(theme.collectible.icon);
  push(theme.scenery.sky);
  push(theme.scenery.hillsFar);
  for (const band of theme.bands || []) {
    if (OPTIONAL_BAND_IMAGES.includes(band.img)) push(theme.scenery[band.img]);
  }
  theme.scenery.trees.forEach(push);
  theme.scenery.bushes.forEach(push);
  push(theme.ground.grass);
  push(theme.ground.dirt);
  push(theme.pages.intro);
  push(theme.pages.gameOver);
  push(theme.foxhole);
  push(theme.levelCompleteBg);
  return out;
}

/* Quietly pull the next level's artwork into the browser cache while the
 * current one is being played, so moving on is instant instead of sitting
 * on a loading screen. Two at a time and started once the run has settled,
 * so it never competes with the game for bandwidth; failures are ignored,
 * because this is only ever an optimisation - advanceLevel still loads
 * whatever is missing.
 */
const prefetched = {};

function prefetchTheme(theme) {
  if (!theme || prefetched[theme.label]) return;
  prefetched[theme.label] = true;
  const queue = themeImageEntries(theme);
  let active = 0;
  const pump = () => {
    while (active < 2 && queue.length) {
      const entry = queue.shift();
      active++;
      loadImage(entry, { priority: "low" })
        .catch(() => {})
        .then(() => { active--; pump(); });
    }
  };
  pump();
}

function loadAssets() {
  bindTheme();
  const images = {};
  const jobs = [];
  for (const [key, src] of Object.entries(IMAGE_SOURCES)) {
    jobs.push(loadImage(src).then((img) => (images[key] = img)));
  }
  images.dog = {};
  for (const [key, src] of Object.entries(DOG.frames)) {
    if (key === "run") continue; // the run cycle is loaded as a list below
    jobs.push(loadImage(src).then((img) => (images.dog[key] = img)));
  }
  images.birdFly = [];
  THEME.flyer.fly.forEach((src, i) => {
    jobs.push(loadImage(src).then((img) => (images.birdFly[i] = img)));
  });
  images.dogRun = [];
  THEME.chaser.run.forEach((src, i) => {
    jobs.push(loadImage(src).then((img) => (images.dogRun[i] = img)));
  });
  for (const type of Object.values(OBSTACLE_TYPES)) {
    jobs.push(
      loadImage(type.src).then((img) => {
        type.image = img;
        // Drawn width follows the baked trim's aspect ratio, so the drawn
        // size and hitbox track the visible artwork, not the PNG canvas.
        type.w = type.h * (type.trim.sw / type.trim.sh);
      })
    );
  }
  // Optional art: absent files simply leave the key undefined.
  jobs.push(loadImage(THEME.foxhole).then((img) => { images.foxhole = img; }, () => {}));
  for (const band of THEME.bands || []) {
    if (!OPTIONAL_BAND_IMAGES.includes(band.img)) continue;
    const src = THEME.scenery[band.img];
    jobs.push(loadImage(src).then((img) => { images[band.img] = img; }, () => {}));
  }
  jobs.push(loadImage(THEME.levelCompleteBg).then((img) => { images.levelCompleteBg = img; }, () => {}));
  return Promise.all(jobs).then(() => images);
}

// ---------------------------------------------------------------------------
// Music and sound
// ---------------------------------------------------------------------------

/* Everything is synthesised with the Web Audio API rather than loaded as
 * files: it costs nothing to download, works offline, and - the point of
 * the exercise - the tempo can be changed continuously, which sampled
 * music cannot do without going sour.
 *
 * Each level has a short looping melody on a sixteen-step grid of eighth
 * notes (two bars). The tempo climbs with progress through the level, so
 * the same friendly tune quietly winds the player up as the burrow gets
 * closer.
 */
const MUSIC = {
  bpmStart: 96,
  bpmEnd: 158,
  stepBeats: 0.5,   // each grid step is an eighth note
  lookahead: 0.12,  // seconds of audio scheduled ahead of the clock
  tickMs: 25,
  volume: 0.20,
};

const MUTE_KEY = "foxRunnerMuted";

class Sound {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.timer = null;
    this.pattern = null;
    this.step = 0;
    this.nextTime = 0;
    this.progress = 0;
    this.muted = false;
    try {
      this.muted = localStorage.getItem(MUTE_KEY) === "1";
    } catch (e) {
      /* storage unavailable; default to on */
    }
  }

  // Browsers only allow audio to begin from a user gesture, so every
  // input path calls this before anything is expected to be heard.
  unlock() {
    if (this.muted) return;
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      /* iOS treats Web Audio as "ambient" by default, which the hardware
       * silent switch mutes - but only on the built-in speaker, not over
       * Bluetooth. That is why a phone on silent plays the music to
       * headphones or hearing aids and nothing through its own speaker.
       * Declaring it as playback audio opts out of the switch. Needs
       * Safari 16.4+; on older phones the silent switch still wins, which
       * is the expected behaviour rather than a fault.
       */
      try {
        if (navigator.audioSession) navigator.audioSession.type = "playback";
      } catch (e) {
        /* not supported; the silent switch keeps control */
      }
      this.master = this.ctx.createGain();
      this.master.gain.value = MUSIC.volume;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
  }

  setMuted(muted) {
    this.muted = muted;
    try {
      localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
    } catch (e) {
      /* ignore */
    }
    if (muted) {
      this.stopMusic();
      if (this.ctx && this.ctx.state === "running") this.ctx.suspend();
    } else {
      this.unlock();
    }
  }

  /* One note. `type` picks the timbre; the envelope is a fast attack and
   * an exponential tail, which reads as a soft chime rather than a beep.
   */
  note(midi, when, dur, type, level) {
    if (!this.ctx || this.muted) return;
    const t = Math.max(when, this.ctx.currentTime);
    const freq = 440 * Math.pow(2, (midi - 69) / 12);
    const gain = this.ctx.createGain();
    gain.connect(this.master);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(level, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    osc.connect(gain);
    osc.start(t);
    osc.stop(t + dur + 0.02);

    // A quiet octave above puts a little sparkle on the lead line.
    if (type === "triangle") {
      const shimmer = this.ctx.createGain();
      shimmer.connect(this.master);
      shimmer.gain.setValueAtTime(0.0001, t);
      shimmer.gain.exponentialRampToValueAtTime(level * 0.25, t + 0.012);
      shimmer.gain.exponentialRampToValueAtTime(0.0001, t + dur * 0.7);
      const o2 = this.ctx.createOscillator();
      o2.type = "sine";
      o2.frequency.setValueAtTime(freq * 2, t);
      o2.connect(shimmer);
      o2.start(t);
      o2.stop(t + dur);
    }
  }

  startMusic(pattern) {
    this.pattern = pattern;
    if (this.muted || !pattern) return;
    this.unlock();
    if (!this.ctx || this.timer) return;
    this.step = 0;
    this.nextTime = this.ctx.currentTime + 0.08;
    this.timer = setInterval(() => this.schedule(), MUSIC.tickMs);
  }

  stopMusic() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  // How far through the level we are, 0..1 - drives the tempo.
  setProgress(p) {
    this.progress = Math.min(1, Math.max(0, p));
  }

  get bpm() {
    return MUSIC.bpmStart + (MUSIC.bpmEnd - MUSIC.bpmStart) * this.progress;
  }

  /* Lookahead scheduler: queue up any steps falling inside the next
   * window. Scheduling against the audio clock rather than firing notes
   * from a timer is what keeps the rhythm steady while the game runs.
   */
  schedule() {
    if (!this.ctx || !this.pattern || this.muted) return;
    const stepDur = (60 / this.bpm) * MUSIC.stepBeats;
    while (this.nextTime < this.ctx.currentTime + MUSIC.lookahead) {
      const i = this.step % this.pattern.lead.length;
      const lead = this.pattern.lead[i];
      const bass = this.pattern.bass[i];
      if (lead !== null && lead !== undefined) {
        this.note(this.pattern.root + lead, this.nextTime, stepDur * 1.6, "triangle", 0.30);
      }
      if (bass !== null && bass !== undefined) {
        this.note(this.pattern.root + bass, this.nextTime, stepDur * 1.9, "sine", 0.34);
      }
      this.nextTime += stepDur;
      this.step++;
    }
  }

  // Short one-off sounds. Kept quiet so they sit under the music.
  sfx(name) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const r = this.pattern ? this.pattern.root : 72;
    switch (name) {
      case "jump":
        this.note(r + 12, t, 0.12, "sine", 0.16);
        this.note(r + 19, t + 0.05, 0.10, "sine", 0.10);
        break;
      case "collect":
        this.note(r + 24, t, 0.10, "sine", 0.18);
        this.note(r + 28, t + 0.06, 0.16, "sine", 0.14);
        break;
      case "throw":
        this.note(r + 7, t, 0.09, "square", 0.05);
        break;
      case "stun":
        this.note(r - 17, t, 0.20, "square", 0.09);
        this.note(r - 5, t + 0.04, 0.14, "sine", 0.10);
        break;
      case "death":
        [0, -3, -7, -12].forEach((n, i) =>
          this.note(r + n, t + i * 0.11, 0.30, "triangle", 0.22));
        break;
      case "win":
        [0, 4, 7, 12, 16].forEach((n, i) =>
          this.note(r + n, t + i * 0.10, 0.45, "triangle", 0.26));
        break;
      case "checkpoint":
        this.note(r + 12, t, 0.14, "sine", 0.16);
        this.note(r + 16, t + 0.09, 0.22, "sine", 0.14);
        break;
    }
  }
}

const sound = new Sound();

// ---------------------------------------------------------------------------
// High score (session-scoped)
// ---------------------------------------------------------------------------

/* Scores survive between visits, so a table set on Sunday is still there
 * to beat on Monday. localStorage rather than sessionStorage, which is
 * what the single high score used before and lost on every tab close.
 * Each entry keeps the level it was set on, since a 3000 in the woodland
 * is a different achievement from a 3000 in the field.
 */
const SCORES_KEY = "foxRunnerScores";
const NAME_KEY = "foxRunnerLastName";
const SCORE_SLOTS = 5;
const NAME_MAX = 8;

function readScores() {
  try {
    const raw = JSON.parse(localStorage.getItem(SCORES_KEY));
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((e) => e && typeof e.score === "number")
      .sort((a, b) => b.score - a.score)
      .slice(0, SCORE_SLOTS);
  } catch (e) {
    return []; // unreadable or storage blocked: start empty rather than break
  }
}

function writeScores(list) {
  try {
    localStorage.setItem(SCORES_KEY, JSON.stringify(list.slice(0, SCORE_SLOTS)));
  } catch (e) {
    /* private mode: the table just will not persist */
  }
}

// A score earns a place if the table has room or it beats the last entry.
function scoreQualifies(score, list) {
  if (score <= 0) return false;
  if (list.length < SCORE_SLOTS) return true;
  return score > list[list.length - 1].score;
}

function recordScore(name, score) {
  const list = readScores();
  list.push({ name: name.slice(0, NAME_MAX) || "FOX", score });
  list.sort((a, b) => b.score - a.score);
  const kept = list.slice(0, SCORE_SLOTS);
  writeScores(kept);
  return kept;
}

function readLastName() {
  try {
    return localStorage.getItem(NAME_KEY) || "";
  } catch (e) {
    return "";
  }
}

function writeLastName(name) {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch (e) {
    /* ignore */
  }
}

/* How far the fox has ever got. Unlocks the settings beyond the first so
 * a returning player is not made to replay the field every time; kept in
 * localStorage, so unlike a run's checkpoints it survives closing the game.
 */
const FURTHEST_KEY = "foxRunnerFurthest";

function readFurthest() {
  try {
    const n = parseInt(localStorage.getItem(FURTHEST_KEY), 10);
    return Number.isFinite(n) ? Math.min(Math.max(n, 0), LEVELS.length - 1) : 0;
  } catch (e) {
    return 0;
  }
}

function writeFurthest(index) {
  try {
    localStorage.setItem(FURTHEST_KEY, String(index));
  } catch (e) {
    /* ignore */
  }
}

function bestScore() {
  const list = readScores();
  return list.length ? list[0].score : 0;
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

/* Rounded-rectangle path. Safari only gained ctx.roundRect in 16.4, and
 * an older iPad threw here on the very first frame of the start screen,
 * which killed the animation loop and left a blank canvas.
 */
function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  const rr = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function intersects(a, b) {
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}

function shrinkBox(x, y, w, h, inset) {
  return {
    x: x + w * inset.left,
    y: y + h * inset.top,
    w: w * (1 - inset.left - inset.right),
    h: h * (1 - inset.top - inset.bottom),
  };
}

class Fox {
  constructor(images, groundY) {
    this.images = images;
    this.groundY = groundY; // y of the running surface (fox feet rest here)
    this.w = FOX_W;
    this.h = FOX_H;
    this.x = FOX_X;
    this.reset();
  }

  reset() {
    this.x = FOX_X;
    this.targetX = FOX_X;
    this.y = this.groundY - this.h;
    this.vy = 0;
    this.onGround = true;
    this.animTime = 0;
    this.dead = false;
    this.holding = false;
    this.holdElapsed = 0;
    this.arc = null;
    this.fallScale = null;
    this.throwTime = null; // non-null while the throw animation plays
  }

  startThrow() {
    this.throwTime = 0;
  }

  jump(speed) {
    if (this.onGround && !this.dead) {
      this.arc = jumpArc(speed || DIFFICULTY.bands[0].speed);
      this.vy = -this.arc.v;
      this.fallScale = null;
      sound.sfx("jump");
      this.onGround = false;
      this.holding = true;   // extra lift while the button stays down
      this.holdElapsed = 0;
    }
  }

  // Button released: stop adding lift. The jump already in flight keeps
  // its full arc, so letting go early is never punished.
  releaseJump() {
    this.holding = false;
  }

  update(dt, speed) {
    if (!this.onGround) {
      const arc = this.arc || jumpArc(speed);
      let g;
      if (this.vy < 0) {
        g = arc.gravityUp;
        if (this.holding && this.holdElapsed < PHYSICS.holdTime) {
          this.holdElapsed += dt;
          g *= PHYSICS.holdGravityFactor;
        }
      } else {
        // Coming down: a held jump falls proportionally faster, so extra
        // height does not also mean hanging in the air and overshooting
        // onto whatever is next. Holding buys height, not airtime.
        if (this.fallScale === null) {
          const peak = (this.groundY - this.h) - this.y;
          this.fallScale = Math.max(1, peak / PHYSICS.apex);
        }
        g = arc.gravityDown * this.fallScale;
      }
      this.vy += g * dt;
      this.y += this.vy * dt;
      if (this.y >= this.groundY - this.h) {
        this.y = this.groundY - this.h;
        this.vy = 0;
        this.onGround = true;
      }
    }
    // Run animation rate rises gently with scroll speed (softened so the
    // cadence stays near the display-friendly base rate).
    const ratio = speed / DIFFICULTY.bands[0].speed;
    this.animTime += dt * (1 - FOX_ANIM.speedCoupling + FOX_ANIM.speedCoupling * ratio);
    if (this.throwTime !== null) {
      this.throwTime += dt;
      if (this.throwTime >= THROW_ANIM.duration) this.throwTime = null;
    }
    // Ease toward the current screen position (forward fast when a chase
    // starts, drifting home slowly after it ends).
    if (this.x !== this.targetX) {
      const rate = this.targetX > this.x ? FOX_SHIFT_FORWARD : FOX_SHIFT_BACK;
      const step = rate * dt;
      this.x += Math.min(Math.abs(this.targetX - this.x), step) * Math.sign(this.targetX - this.x);
    }
  }

  getHitbox() {
    return shrinkBox(this.x, this.y, this.w, this.h, FOX_HITBOX);
  }

  runFrames() {
    return [
      this.images.foxRun1,
      this.images.foxRun2,
      this.images.foxRun3,
      this.images.foxRun4,
      this.images.foxRun5,
      this.images.foxRun6,
      this.images.foxRun7,
      this.images.foxRun8,
      this.images.foxRun9,
      this.images.foxRun10,
      this.images.foxRun11,
      this.images.foxRun12,
    ];
  }

  // The current pose, plus (while running with blending on) the next frame
  // and how far we are into the crossfade towards it.
  currentPose(state) {
    if (this.dead) return { img: this.images.foxHit, trim: FOX_TRIMS.foxHit };
    if (!this.onGround) return { img: this.images.foxJump, trim: FOX_TRIMS.foxJump };
    if (this.throwTime !== null) {
      const i = Math.min(Math.floor(this.throwTime / THROW_ANIM.frameDur), 3);
      const key = "foxThrow" + (i + 1);
      return { img: this.images[key], trim: FOX_TRIMS[key] };
    }
    if (state === "ready") {
      return { img: this.images.foxLand, trim: FOX_TRIMS.foxLand }; // calm standing pose
    }
    const frames = this.runFrames();
    const phase = this.animTime * FOX_ANIM.fps;
    const idx = Math.floor(phase) % frames.length;
    const pose = { img: frames[idx], trim: FOX_TRIMS.run, dx: FOX_RUN_DX[idx] };
    if (FOX_ANIM.blend) {
      pose.nextImg = frames[(idx + 1) % frames.length];
      const t = phase - Math.floor(phase);
      pose.blend = t * t * (3 - 2 * t); // ease the fade so frames still register
    }
    return pose;
  }

  draw(ctx, state) {
    const pose = this.currentPose(state);
    const trim = pose.trim;
    // hScale lets a pose draw taller than the physics box (the rearing
    // throw frames); it stays bottom-anchored so the feet don't move.
    const drawnH = this.h * (trim.hScale || 1);
    const scale = drawnH / trim.sh;
    const contentW = trim.sw * scale;
    // Bottom-right anchored: the nose stays put while content width varies.
    // pose.dx applies the per-frame jitter correction (run frames only).
    const dx = this.x + this.w - contentW + (pose.dx || 0);
    const dy = this.y + this.h - drawnH;
    ctx.drawImage(pose.img, trim.sx, trim.sy, trim.sw, trim.sh, dx, dy, contentW, drawnH);
    if (pose.nextImg && pose.blend > 0.01) {
      // Crossfade tween: the next frame fades in OVER the fully opaque
      // current frame, so the fox never goes translucent against the scene.
      ctx.save();
      ctx.globalAlpha = pose.blend;
      ctx.drawImage(pose.nextImg, trim.sx, trim.sy, trim.sw, trim.sh, dx, this.y, contentW, this.h);
      ctx.restore();
    }
  }
}

/* Some animals rear onto their hind legs instead of cowering: the badger
 * makes itself TALLER as the fox bears down. Unlike hiding this changes
 * the hitbox, so it has to be honest - it rears from far enough out that
 * it is already at full height before the player commits to a jump (jumps
 * commit inside ~230px even at top speed), and the spawner plans every
 * sequence around the reared height.
 */
const OBSTACLE_REAR = {
  noticeDistance: 520, // px of gap at which it starts standing up
  riseTime: 0.28,      // seconds to reach full height
};

// The height the spawner must plan for: reared, if this one rears.
function plannedHeight(type) {
  return type.rearHeight || type.h;
}

class Obstacle {
  constructor(typeName, x, groundY) {
    this.typeName = typeName;
    this.type = OBSTACLE_TYPES[typeName];
    this.groundY = groundY;
    this.w = this.type.w;
    this.h = this.type.h;
    this.x = x;
    this.y = groundY - this.h + (this.type.sink || 0);
    /* Pouncing animals are drawn from one shared stage rect at a constant
     * scale, so `anchorX` - where that stage sits in the world - is what
     * scrolls, and each frame's own place within it follows.
     */
    if (this.type.lungeBy) {
      this.anchorX = x;
      this.phase = "resting";
      this.leap = 0;
    }
    this.passed = false; // hook for later phases (chasing behaviour, etc.)
    this.hideLevel = 0;  // 0 normal, 1 crouching, 2 fully tucked
    this.hideHold = 0;   // keeps the pose a moment after the fox passes
    this.rear = 0;       // 0..1 how far up on its hind legs (rearing types)
    this.baseH = this.h;
  }

  update(dt, speed, fox, images) {
    this.x -= speed * dt;
    if (this.type.lungeBy && fox) this.updatePounce(dt, speed, fox, images);
    else if (this.type.rearHeight && fox) this.updateRear(dt, fox, images);
    else if (this.type.hide && fox) this.updateHide(dt, fox, images);
  }

  /* Where one frame of a pounce sequence sits, in world pixels.
   * Every frame shares a stage rect and a single scale, so the artist's
   * own baseline is kept: the leap frames are drawn genuinely airborne -
   * the bear's feet 81px up its canvas, the ram's 146px - and land at the
   * right height above the ground without any per-frame fudging.
   */
  poseGeometry(frame) {
    const t = this.type;
    const px = t.h / t.trim.sh;                  // constant across the set
    const sheet = t.sheet || { sx: t.trim.sx, sw: t.trim.sw };
    const floor = t.floor || (t.trim.sy + t.trim.sh);
    // Mirrored sets measure their offset from the stage's other edge, or
    // the animal slides sideways every time the frame changes.
    const dx = t.flip
      ? (sheet.sx + sheet.sw) - (frame.sx + frame.sw)
      : frame.sx - sheet.sx;
    return {
      w: frame.sw * px,
      h: frame.sh * px,
      x: this.anchorX + dx * px,
      lift: (floor - (frame.sy + frame.sh)) * px, // 0 when its feet are down
    };
  }

  /* Wake, get up, then LEAP a short way at the fox and land. The leap is
   * deliberately small - it is there so the animal reads as coming at him
   * rather than waiting to be jumped, and every px of it is room the
   * spawner has already reserved (see plannedHeight and lungeBy).
   */
  updatePounce(dt, speed, fox, images) {
    const t = this.type;
    const poses = t.hide;
    if (!poses || poses.length < 3) return;
    this.anchorX -= speed * dt;

    const fb = fox.getHitbox();
    const gap = this.x - (fb.x + fb.w);
    if (this.phase === "resting" && gap < (t.rearNotice || OBSTACLE_REAR.noticeDistance)) {
      this.phase = "rising";
    }
    if (this.phase === "rising") {
      this.rear = Math.min(1, this.rear + dt / (t.riseTime || OBSTACLE_REAR.riseTime));
      if (this.rear >= 1) this.phase = "ready";
    }
    if ((this.phase === "rising" || this.phase === "ready") && gap < (t.lungeAt || 160)) {
      this.phase = "leaping";
      this.leap = 0;
    }
    if (this.phase === "leaping") {
      const was = this.leap;
      this.leap = Math.min(1, this.leap + dt / (t.lungeTime || 0.24));
      // Ease out: off the mark quickly, settling into the landing.
      const ease = (v) => 1 - (1 - v) * (1 - v);
      this.anchorX -= t.lungeBy * (ease(this.leap) - ease(was));
      /* Stay in the air until it has actually gone past him. The pose the
       * fox has to clear should be the leap - that is the whole point of
       * a pounce - and not the tidy four-legged landing after it, which
       * on the ram is barely half the height.
       */
      if (this.leap >= 1 && gap < -this.w) this.phase = "landed";
    }

    // Last two poses are the leap and the landing; the rest are the rise.
    const rise = Math.max(1, poses.length - 2);
    let idx;
    if (this.phase === "resting") idx = -1;
    else if (this.phase === "rising") idx = Math.min(rise - 1, Math.floor(this.rear * rise));
    else if (this.phase === "ready") idx = rise - 1;
    else if (this.phase === "leaping") idx = poses.length - 2;
    else idx = poses.length - 1;

    this.hideLevel = idx + 1;
    this.hideImage = idx >= 0 ? images[poses[idx].key] : null;
    const frame = idx >= 0 ? poses[idx].trim : t.trim;
    const g = this.poseGeometry(frame);
    this.w = g.w;
    this.h = g.h;
    this.x = g.x;
    this.y = this.groundY - this.h - g.lift + (t.sink || 0);
  }

  // Stand up as the fox approaches, growing the drawn size AND the hitbox.
  updateRear(dt, fox, images) {
    const fb = fox.getHitbox();
    const gap = this.x - (fb.x + fb.w);
    if (gap < (this.type.rearNotice || OBSTACLE_REAR.noticeDistance)) {
      const rise = this.type.riseTime || OBSTACLE_REAR.riseTime;
      this.rear = Math.min(1, this.rear + dt / rise);
    }
    const groundLine = this.y + this.h; // keep the feet planted
    const centre = this.x + this.w / 2;
    this.h = this.baseH + (this.type.rearHeight - this.baseH) * this.rear;
    this.y = groundLine - this.h;
    // Step through the rise poses: on all fours, half up, upright, reaching.
    const poses = this.type.hide;
    if (poses && poses.length) {
      const idx = Math.min(poses.length - 1, Math.floor(this.rear * poses.length));
      this.hideLevel = idx + 1;
      this.hideImage = images[poses[idx].key];
      // An upright badger is much narrower than one on all fours, so the
      // hitbox follows the pose rather than staying at the sprawled width.
      const t = poses[idx].trim;
      this.w = this.h * (t.sw / t.sh);
      this.x = centre - this.w / 2;
    }
  }

  /* Animals react as the fox bears down and hold their last pose while he
   * leaps over them. Cosmetic only: this.w/this.h and the hitbox never
   * change.
   *
   * The LAST pose is the one shown overhead - the hedgehog fully tucked,
   * the skunk letting go of its cloud - and any poses before it are spread
   * across the approach. With only two poses that is exactly the old
   * behaviour (notice, then tuck); with five the animal has somewhere to
   * go instead of sitting on pose two for the whole run-in.
   */
  updateHide(dt, fox, images) {
    const poses = this.type.hide;
    if (!poses || !poses.length) return;
    const fb = fox.getHitbox();
    const foxFront = fb.x + fb.w;
    const myCenter = this.x + this.w / 2;
    const gap = this.x - foxFront;
    const notice = this.type.hideNotice || OBSTACLE_HIDE.noticeDistance;
    const approach = Math.max(1, poses.length - 1);

    let want = 0;
    if (gap < notice && myCenter > fb.x) {
      const closed = Math.max(0, Math.min(1, 1 - gap / notice));
      want = Math.min(approach, 1 + Math.floor(closed * approach));
    }
    if (!fox.onGround && Math.abs(myCenter - (fb.x + fb.w / 2)) < OBSTACLE_HIDE.overhead) {
      want = poses.length;
    }
    if (want > this.hideLevel) this.hideLevel = want;
    if (want > 0) {
      this.hideHold = OBSTACLE_HIDE.hold;
    } else if (this.hideLevel > 0) {
      this.hideHold -= dt;
      if (this.hideHold <= 0) this.hideLevel = 0;
    }
    this.hideImage = this.hideLevel > 0
      ? images[this.type.hide[this.hideLevel - 1].key]
      : null;
  }

  isOffscreen() {
    return this.x + this.w < -20;
  }

  getHitbox() {
    return shrinkBox(this.x, this.y, this.w, this.h, this.type.hitbox);
  }

  draw(ctx) {
    let img = this.type.image;
    let t = this.type.trim;
    // Hiding animals swap pose: drawn a touch smaller (they shrink down),
    // bottom-anchored and centred on the same spot, so only the artwork
    // changes — never the collision box.
    let w = this.w;
    let h = this.h;
    if (this.hideLevel > 0 && this.hideImage) {
      const pose = this.type.hide[this.hideLevel - 1];
      img = this.hideImage;
      t = pose.trim;
      if (this.type.lungeBy) {
        // updatePounce already placed and sized this frame.
        w = this.w;
        h = this.h;
      } else if (this.type.rearHeight) {
        // Rearing types already grew this.h; draw the pose at full height.
        h = this.h;
        w = h * (t.sw / t.sh);
      } else if (this.type.poseFit === "scale") {
        /* One constant scale across every pose. An animal that stands up
         * and turns - the skunk, before it sprays - is a NARROWER shape,
         * so holding its width would balloon it at each step, the mirror
         * of the bug that squashed the cowering ones.
         */
        const px = this.w / this.type.trim.sw;
        w = t.sw * px * (pose.wScale || 1);
        h = t.sh * px * (pose.wScale || 1);
      } else {
        /* Cowering keeps the animal's FOOTPRINT and drops its height. A
         * flattened pose is a much wider shape, so scaling it by height
         * (as this used to) made the sprite balloon sideways - the animal
         * appeared to grow as it ducked.
         */
        w = this.w * (pose.wScale || 1);
        h = w / (t.sw / t.sh);
      }
    }
    const dx = this.x + (this.w - w) / 2;
    const dy = this.y + this.h - h;
    if (this.type.flip) {
      ctx.save();
      ctx.translate(dx + w, dy);
      ctx.scale(-1, 1);
      ctx.drawImage(img, t.sx, t.sy, t.sw, t.sh, 0, 0, w, h);
      ctx.restore();
    } else {
      ctx.drawImage(img, t.sx, t.sy, t.sw, t.sh, dx, dy, w, h);
    }
  }
}

/* The hunting dog. States:
 *  sleeping → (fox passes over) → waking → headShake → alert → chasing
 *  chasing → caught the fox (game over) | stunned (acorn hit) | tiring
 * `done` marks it ready for cleanup. Movement is screen-relative: while
 * grounded it scrolls with the world; while chasing it out-runs the scroll.
 */
class Dog {
  constructor(x, groundY, images) {
    this.images = images;
    this.groundY = groundY;
    this.state = "sleeping";
    this.stateTime = 0;
    this.chaseTime = 0;
    this.animTime = 0;
    this.done = false;
    this.packOffset = 0; // set by DogDirector for extra pack members
    const p = DOG.poses.sleep;
    this.h = p.h;
    this.w = p.h * (p.trim.sw / p.trim.sh);
    this.x = x;
  }

  // Current pose's draw box (bottom-anchored at the running surface).
  currentPose() {
    if (this.state === "sleeping") return { key: "sleep", img: this.images.dog.sleep };
    if (this.state === "waking") return { key: "waking", img: this.images.dog.waking };
    if (this.state === "headShake") return { key: "headShake", img: this.images.dog.headShake };
    if (this.state === "alert") return { key: "alert", img: this.images.dog.alert };
    if (this.state === "stunned") return { key: "crash", img: this.images.dog.crash };
    if (this.state === "biting") return { key: "bite", img: this.images.dog.bite };
    const frames = this.images.dogRun;
    const img = frames[Math.floor(this.animTime * DOG.runFps) % frames.length];
    return { key: "run", img };
  }

  syncBoxToPose() {
    const p = DOG.poses[this.currentPose().key];
    // Keep the bottom-center fixed when the pose (and its box) changes.
    const cx = this.x + this.w / 2;
    this.h = p.h;
    this.w = p.h * (p.trim.sw / p.trim.sh);
    this.x = cx - this.w / 2;
  }

  get y() {
    const sink = DOG.poses[this.currentPose().key].sink || 3;
    return this.groundY - this.h + sink;
  }

  wake() {
    if (this.state === "sleeping") {
      this.state = "waking";
      this.stateTime = 0;
      this.syncBoxToPose();
    }
  }

  stun() {
    if (this.state !== "stunned" && this.state !== "biting") {
      this.state = "stunned";
      this.syncBoxToPose();
    }
  }

  bite() {
    this.state = "biting"; // frozen into the game-over scene
    this.syncBoxToPose();
  }

  update(dt, speed, fox, score) {
    this.stateTime += dt;
    switch (this.state) {
      case "sleeping": {
        this.x -= speed * dt;
        // Wake the moment the fox sails over him mid-jump (so the player
        // sees it), or once fully passed as a fallback.
        const fb = fox.getHitbox();
        const foxMid = fb.x + fb.w / 2;
        if ((!fox.onGround && foxMid > this.x + this.w / 2) || this.x + this.w < fox.x - 4) {
          this.wake();
        }
        break;
      }
      case "waking":
      case "headShake":
      case "alert": {
        this.x -= speed * dt;
        const order = ["waking", "headShake", "alert"];
        const dur = DOG.wakeDurations[this.state];
        if (this.stateTime >= dur) {
          const next = order[order.indexOf(this.state) + 1];
          if (next) {
            this.state = next;
          } else {
            this.state = "chasing";
            this.chaseTime = 0;
            // If the wake played out off-screen, rejoin just off the edge.
            if (this.x < DOG.chase.entryX) this.x = DOG.chase.entryX;
          }
          this.stateTime = 0;
          this.syncBoxToPose();
        }
        break;
      }
      case "chasing": {
        this.chaseTime += dt;
        this.animTime += dt;
        const tuning = dogChaseTuning(score);
        // packOffset staggers pack members so they don't overlap.
        const gap = fox.x - (this.x + this.w) - this.packOffset;
        const band = Math.min(Math.max(gap / DOG.chase.rubberBandDist, tuning.rubberBandMin), 1);
        this.x += (DOG.chase.base + speed * DOG.chase.perSpeed) * band * dt;
        if (this.chaseTime > tuning.stamina) this.state = "tiring";
        break;
      }
      case "tiring":
        this.animTime += dt;
        this.x -= 130 * dt; // falls behind and exits
        break;
      case "stunned":
        this.x -= speed * dt; // stands dazed, scrolls away with the world
        break;
    }
    // Only states that exit leftward may despawn off-screen — a chasing
    // (or waking) dog is off-screen left on purpose, on its way in.
    const exiting = this.state === "tiring" || this.state === "stunned" || this.state === "sleeping";
    if (exiting && this.x + this.w < -60) this.done = true;
  }

  // The fox dies on touching the dog while it sleeps or is still waking
  // on the ground (it's an obstacle — undershot jumps land on him), or
  // while it chases (it caught him). Later wake phases don't collide.
  getHitbox() {
    if (this.state === "sleeping" || this.state === "waking") {
      return shrinkBox(this.x, this.y, this.w, this.h, DOG.sleepHitbox);
    }
    if (this.state === "chasing" || this.state === "tiring") {
      return shrinkBox(this.x, this.y, this.w, this.h, DOG.runHitbox);
    }
    return null;
  }

  // Generous box for acorn hits — any state, so a well-aimed throw can
  // even take out a sleeping dog before reaching it.
  getShotBox() {
    return { x: this.x, y: this.y, w: this.w, h: this.h };
  }

  draw(ctx) {
    const pose = this.currentPose();
    const t = DOG.poses[pose.key].trim;
    ctx.drawImage(pose.img, t.sx, t.sy, t.sw, t.sh, this.x, this.y, this.w, this.h);
  }
}

/* Spawns dogs once the score allows, with clear ground around each
 * sleeping dog so the jump over it is always fair. Early game allows one
 * dog at a time; past DOG.packSizes thresholds a pack can build up if
 * chasers aren't cleared with acorns. A new sleeping dog only appears once
 * every existing dog is already up and chasing (or on its way out), so
 * two sleeping dogs never stack on the path.
 */
class DogDirector {
  constructor(groundY) {
    this.groundY = groundY;
    this.reset();
  }

  reset() {
    this.dogs = [];
    this.distanceUntilNext = dogSetting("gapMin") * dogSetting("gapScale");
  }

  // Convenience for collision/draw code.
  get dog() {
    return this.dogs[0] || null;
  }

  maxConcurrent(score) {
    let max = 1;
    for (const band of DOG.packSizes) if (score >= band.score) max = band.max;
    return max;
  }

  update(dt, speed, score, fox, obstacles, spawner, images) {
    for (const d of this.dogs) d.update(dt, speed, fox, score);
    this.dogs = this.dogs.filter((d) => !d.done);

    // Keep the chasing pack staggered: front-most dog presses the fox,
    // the others hang progressively further back — and promote when the
    // leader is stunned.
    const chasers = this.dogs
      .filter((d) => d.state === "chasing")
      .sort((a, b) => b.x - a.x);
    chasers.forEach((d, i) => (d.packOffset = i * DOG.packStagger));

    if (score < dogSetting("availableFrom")) return;
    if (this.dogs.length >= this.maxConcurrent(score)) return;
    // Only one dog may be in its sleeping/waking phase at a time.
    if (this.dogs.some((d) => d.state !== "chasing" && d.state !== "tiring" && d.state !== "stunned")) {
      return;
    }
    this.distanceUntilNext -= speed * dt;
    if (this.distanceUntilNext > 0) return;

    /* Need clear ground: no obstacle within jumping distance either side
     * of the sleeping dog's spawn point. Rather than waiting for a gap to
     * happen along - which in a dense level means the dog barely ever
     * arrives - hold the obstacle spawner off and take the room. Without
     * this the woodland, whose obstacles are bigger and closer together,
     * saw FEWER dogs than the field despite asking for more.
     */
    if (obstacles.some((o) => o.x + o.w > GAME_W - 260) || spawner.distanceUntilNext < 220) {
      spawner.distanceUntilNext = Math.max(spawner.distanceUntilNext, 300);
      this.distanceUntilNext = 40; // check again as soon as the ground clears
      return;
    }
    // Breathing room for the encounter opening — full grace for a fresh
    // encounter, a shorter one for dogs joining an already-active chase
    // (late game shouldn't become obstacle-free).
    const joining = this.dogs.length > 0;
    this.dogs.push(new Dog(GAME_W + 40, this.groundY, images));
    spawner.distanceUntilNext = Math.max(
      spawner.distanceUntilNext,
      speed * (joining ? DOG.packJoinGraceSeconds : DOG.spawnGraceSeconds)
    );
    // Pack territory spawns dogs closer together.
    const pack = this.maxConcurrent(score) > 1;
    const gapMin = pack ? dogSetting("packGapMin") : dogSetting("gapMin");
    const gapMax = pack ? dogSetting("packGapMax") : dogSetting("gapMax");
    const progress = Math.min(1, score / levelGoal());
    const closeUp = 1 - (1 - dogSetting("lateFrequency")) * progress;
    this.distanceUntilNext =
      (gapMin + Math.random() * (gapMax - gapMin)) * closeUp * dogSetting("gapScale");
  }
}

// An acorn thrown backward (ArrowLeft). Screen-relative arc; stops a dog.
class AcornShot {
  constructor(x, y, image) {
    this.image = image;
    this.x = x;
    this.y = y;
    this.vx = THROW.vx;
    this.vy = THROW.vy;
    this.spin = 0;
    this.dead = false;
  }

  update(dt, groundY) {
    this.vy += THROW.gravity * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.spin -= 9 * dt;
    if (this.y > groundY + 10 || this.x < -40) this.dead = true;
  }

  getBox() {
    const s = THROW.size;
    return { x: this.x - s / 2, y: this.y - s / 2, w: s, h: s };
  }

  draw(ctx) {
    const t = ACORN.trim;
    const s = THROW.size;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.spin);
    ctx.drawImage(this.image, t.sx, t.sy, t.sw, t.sh, -s / 2, -s / 2, s, s);
    ctx.restore();
  }
}

// A bluebird crossing the sky at jump height. Lethal on contact.
class Bird {
  constructor(x, centerY, frames) {
    this.frames = frames;
    // Start mid-cycle so a flock never beats in unison.
    this.flapPhase = Math.random() * BIRD.frameCount;
    this.w = BIRD.w;
    this.h = BIRD.h;
    this.x = x;
    this.baseY = centerY - this.h / 2;
    this.y = this.baseY;
    this.age = 0;
  }

  update(dt, speed) {
    this.age += dt;
    this.x -= speed * BIRD.speedFactor * dt;
    this.y = this.baseY + Math.sin(this.age * BIRD.bobRate * 2) * BIRD.bobAmp;
  }

  isOffscreen() {
    return this.x + this.w < -30;
  }

  getHitbox() {
    return shrinkBox(this.x, this.y, this.w, this.h, BIRD.hitbox);
  }

  draw(ctx) {
    const t = BIRD.trim;
    const i = Math.floor(this.flapPhase + this.age * BIRD.flapFps) % BIRD.frameCount;
    const img = this.frames[i];
    if (!img) return;
    // Flip to fly leftward; a touch of tilt on top of the wing beat.
    ctx.save();
    ctx.translate(this.x + this.w / 2, this.y + this.h / 2);
    ctx.scale(-1, 1);
    ctx.rotate(Math.sin(this.age * BIRD.bobRate * 2) * 0.04);
    ctx.drawImage(img, t.sx, t.sy, t.sw, t.sh, -this.w / 2, -this.h / 2, this.w, this.h);
    ctx.restore();
  }
}

// Sends the odd bluebird across once the score allows, only through
// airspace where no jump is being forced.
class BirdSpawner {
  constructor(groundY) {
    this.groundY = groundY;
    this.reset();
  }

  reset() {
    this.distanceUntilNext = BIRD.gapMin;
  }

  update(dt, speed, score, birds, obstacles, dogs, acorns, spawner, frames) {
    if (score < BIRD.availableFrom) return;
    this.distanceUntilNext -= speed * dt;
    if (this.distanceUntilNext > 0) return;

    // One threat at a time: no birds during an active dog chase.
    if (dogs.some((d) => d.state !== "sleeping" && d.state !== "stunned")) {
      this.distanceUntilNext = 200;
      return;
    }
    const spawnX = GAME_W + 40;
    const inCorridor = (x, w) =>
      x + w > spawnX - BIRD.corridorBehind && x < spawnX + BIRD.corridorAhead;
    if (
      spawner.distanceUntilNext < 220 || // an obstacle is about to appear
      obstacles.some((o) => inCorridor(o.x, o.w)) ||
      dogs.some((d) => d.state === "sleeping" && inCorridor(d.x, d.w)) ||
      acorns.some((a) => inCorridor(a.x, a.w))
    ) {
      this.distanceUntilNext = 130; // try again shortly
      return;
    }
    const centerY = this.groundY - (BIRD.altMin + Math.random() * (BIRD.altMax - BIRD.altMin));
    birds.push(new Bird(spawnX, centerY, frames));
    // Hold obstacles back too: one spawned just behind the bird would
    // force a jump straight into it, since both now travel at the same
    // speed and stay side by side all the way to the fox.
    spawner.distanceUntilNext = Math.max(spawner.distanceUntilNext, BIRD.corridorBehind);
    this.distanceUntilNext = BIRD.gapMin + Math.random() * (BIRD.gapMax - BIRD.gapMin);
  }
}

// A floating (or grounded) acorn the fox catches by touching it.
class Acorn {
  constructor(x, centerY, image) {
    this.image = image;
    this.w = ACORN.w;
    this.h = ACORN.h;
    this.x = x;
    this.y = centerY - this.h / 2;
    this.collected = false;
  }

  update(dt, speed) {
    this.x -= speed * dt;
  }

  isOffscreen() {
    return this.x + this.w < -20;
  }

  getHitbox() {
    const p = ACORN.pickupPad;
    return { x: this.x - p, y: this.y - p, w: this.w + 2 * p, h: this.h + 2 * p };
  }

  draw(ctx) {
    const t = ACORN.trim;
    ctx.drawImage(this.image, t.sx, t.sy, t.sw, t.sh, this.x, this.y, this.w, this.h);
  }
}

// Drops the odd acorn into the world once the score is high enough.
class AcornSpawner {
  constructor(groundY) {
    this.groundY = groundY;
    this.reset();
  }

  reset() {
    this.distanceUntilNext = ACORN.gapMin;
    this.pendingGuided = false;
  }

  resetGap() {
    this.distanceUntilNext = ACORN.gapMin + Math.random() * (ACORN.gapMax - ACORN.gapMin);
  }

  update(dt, speed, score, acorns, obstacles, image) {
    if (score < ACORN.availableFrom) return;
    if (this.pendingGuided) return; // waiting for the next obstacle spawn
    this.distanceUntilNext -= speed * dt;
    if (this.distanceUntilNext > 0) return;

    if (score < ACORN.guidedUntil) {
      // Early game: hold the acorn until an obstacle spawns, then hang it
      // over that obstacle (see notifyObstacleSpawned).
      this.pendingGuided = true;
      return;
    }

    const spawnX = GAME_W + 40;
    let high = Math.random() < ACORN.highChance;
    // A ground acorn right next to an obstacle is a death trap — if
    // anything solid is near the spawn point, float this one instead.
    if (!high && obstacles.some((o) => Math.abs(o.x - spawnX) < 300)) {
      high = true;
    }
    const centerY = high
      ? this.groundY - (ACORN.highMin + Math.random() * (ACORN.highMax - ACORN.highMin))
      : this.groundY - ACORN.h / 2;
    acorns.push(new Acorn(spawnX, centerY, image));
    this.resetGap();
  }

  // Called when a new obstacle appears; places a held guided acorn right
  // above it, in the band the jump arc passes through.
  notifyObstacleSpawned(obstacle, acorns, image) {
    if (!this.pendingGuided) return;
    this.pendingGuided = false;
    const centerX = obstacle.x + obstacle.w / 2;
    const up = Math.min(obstacle.h + ACORN.guidedHeight, ACORN.guidedMaxUp);
    const centerY = this.groundY - up;
    acorns.push(new Acorn(centerX - ACORN.w / 2, centerY, image));
    this.resetGap();
  }
}

/* Decides what to spawn and when.
 * Generates whole patterns (single / spacedPair / closePair / spacedTriple)
 * into a queue; queue items spawn one at a time as scroll distance elapses.
 * Close pairs are validated against jump physics at the current speed so a
 * single well-timed jump can always clear them.
 */
class SpawnDirector {
  constructor(groundY, foxHitboxW) {
    this.groundY = groundY;
    this.foxHitboxW = foxHitboxW;
    this.reset();
  }

  reset() {
    this.queue = [];              // [{typeName, gapBefore}] gapBefore = px after prev obstacle's right edge
    this.distanceUntilNext = 550; // breathing room at run start
  }

  eligibleTypes(score, filter) {
    const out = [];
    for (const [name, t] of Object.entries(OBSTACLE_TYPES)) {
      if (score < t.availableFrom) continue;
      if (filter && !filter(t)) continue;
      const ramp = Math.min(1, (score - t.availableFrom + 60) / TYPE_FADE_IN);
      out.push({ name, weight: t.weight * ramp });
    }
    return out;
  }

  pickWeighted(entries) {
    const total = entries.reduce((s, e) => s + e.weight, 0);
    let roll = Math.random() * total;
    for (const e of entries) {
      roll -= e.weight;
      if (roll <= 0) return e.name;
    }
    return entries[entries.length - 1].name;
  }

  pickType(score, filter) {
    const entries = this.eligibleTypes(score, filter);
    if (!entries.length) return null;
    return this.pickWeighted(entries);
  }

  pickPattern(weights) {
    const entries = Object.entries(weights)
      .filter(([, w]) => w > 0)
      .map(([name, weight]) => ({ name, weight }));
    return this.pickWeighted(entries);
  }

  // Build the next pattern into the queue. Every arrangement is validated
  // against jump physics so there is always a legitimate way through.
  generatePattern(score, speed, diff) {
    const seqGap = () =>
      speed * (SEQUENCE_GAP.min + Math.random() * (SEQUENCE_GAP.max - SEQUENCE_GAP.min));
    let pattern = this.pickPattern(diff.weights);

    // comboTriple = close pair, then a breather, then one more obstacle —
    // the pair logic runs first and the extra single is appended after.
    let appendSingleAfter = false;
    if (pattern === "comboTriple") {
      pattern = "closePair";
      appendSingleAfter = true;
    }

    if (pattern === "closePair") {
      const filter = (t) => t.pairable;
      const aName = this.pickType(score, filter);
      const bName = this.pickType(score, filter);
      if (aName && bName) {
        const a = OBSTACLE_TYPES[aName];
        const b = OBSTACLE_TYPES[bName];
        const tallest = Math.max(plannedHeight(a), plannedHeight(b));
        const maxSpan = maxSingleJumpSpan(speed, tallest, this.foxHitboxW);
        const maxGap = maxSpan - a.w - b.w;
        if (maxGap >= CLOSE_PAIR_MIN_GAP) {
          const gap = CLOSE_PAIR_MIN_GAP + Math.random() * (maxGap - CLOSE_PAIR_MIN_GAP);
          this.queue.push({ typeName: aName, gapBefore: 0 });
          this.queue.push({ typeName: bName, gapBefore: gap });
          if (appendSingleAfter) {
            const cName = this.pickType(score);
            if (cName) this.queue.push({ typeName: cName, gapBefore: seqGap() });
          }
          return true; // multi-obstacle pattern
        }
      }
      pattern = "spacedPair"; // infeasible at current speed — degrade gracefully
    }

    if (pattern === "spacedPair" || pattern === "spacedTriple") {
      const count = pattern === "spacedTriple" ? 3 : 2;
      for (let i = 0; i < count; i++) {
        const name = this.pickType(score);
        if (!name) break;
        this.queue.push({ typeName: name, gapBefore: i === 0 ? 0 : seqGap() });
      }
      return true;
    }

    const name = this.pickType(score);
    if (name) this.queue.push({ typeName: name, gapBefore: 0 });
    return false;
  }

  update(dt, speed, score, obstacles) {
    this.distanceUntilNext -= speed * dt;
    if (this.distanceUntilNext > 0) return;

    const diff = difficultyAt(score);

    if (!this.queue.length) {
      const wasMulti = this.generatePattern(score, speed, diff);
      // Recovery gap between patterns, in seconds of travel; multi-obstacle
      // patterns earn a little extra breathing room after them.
      this.pendingPatternGap =
        speed * (diff.gapMin + Math.random() * (diff.gapMax - diff.gapMin)) *
        (wasMulti ? 1.18 : 1);
    }

    const item = this.queue.shift();
    if (!item) return;
    const ob = new Obstacle(item.typeName, GAME_W + 40, this.groundY);
    obstacles.push(ob);

    if (this.queue.length) {
      // Distance until the NEXT queue item: this obstacle's width plus the
      // requested edge-to-edge gap.
      this.distanceUntilNext = ob.w + this.queue[0].gapBefore;
    } else {
      this.distanceUntilNext = ob.w + this.pendingPatternGap;
    }
  }
}

// ---------------------------------------------------------------------------
// Decoration layers (parallax)
// ---------------------------------------------------------------------------

/* Each strip is a repeating virtual band of bottom-anchored sprites.
 * Layout is deterministic (no per-frame randomness) so scenery is stable.
 * yOffset is relative to the RUNNING SURFACE (groundY); positive values sink
 * bases below it, so the ground strip's grass (drawn later) overlaps and
 * plants them instead of letting them float.
 */
const DECOR_STRIPS = [
  {
    // All three tree variants, merged into the treeline band behind them.
    parallax: 0.35,
    length: 1900,
    yOffset: 8,
    items: [
      { img: "tree1", h: 150, x: 60 },
      { img: "tree2", h: 168, x: 430 },
      { img: "tree1", h: 132, x: 760 },
      { img: "tree3", h: 158, x: 1090 },
      { img: "tree2", h: 140, x: 1450 },
      { img: "tree3", h: 126, x: 1690 },
    ],
  },
  {
    // Bush row: every bush variant, mixed sizes for variety.
    parallax: 0.55,
    length: 1750,
    yOffset: 6,
    items: [
      { img: "bushStrip", h: 46, x: 0 },
      { img: "bush2", h: 34, x: 440 },
      { img: "bush1", h: 40, x: 660 },
      { img: "bushStrip", h: 38, x: 900 },
      { img: "bush3", h: 30, x: 1240 },
      { img: "bush1", h: 26, x: 1440 },
      { img: "bush2", h: 42, x: 1580 },
    ],
  },
];

// Full-width parallax band behind the decor, bottom-anchored just behind
// the grass lip. Mirrored tiling hides its non-seamless edges. (The dense
// bg_trees_mid band was dropped — hills alone are easier on the eye.)
/* Full-width parallax bands behind the decor. `climb` slides a band DOWN
 * over the course of a level, which is how a mountain reads as being
 * climbed without the ground ever leaving the flat: the peaks sink
 * toward the horizon and the cloud band, which starts overhead, ends up
 * below the path. Themes override this list.
 */
// Parallax art that only some settings have. Requested for a theme only
// when its own `bands` name it: the field has no clouds and no treeline.
const OPTIONAL_BAND_IMAGES = ["clouds", "treesMid"];

const BG_BANDS = [
  { img: "hillsFar", h: 115, parallax: 0.1 },
];

// ---------------------------------------------------------------------------
// Game
// ---------------------------------------------------------------------------

class Game {
  constructor(canvas, images) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.images = images;

    this.groundY = GROUND_Y;

    this.fox = new Fox(images, this.groundY);
    const foxHb = this.fox.getHitbox();
    this.spawner = new SpawnDirector(this.groundY, foxHb.w);
    this.acornSpawner = new AcornSpawner(this.groundY);
    this.dogDirector = new DogDirector(this.groundY);
    this.birdSpawner = new BirdSpawner(this.groundY);
    this.birds = [];

    this.state = "ready"; // ready | running | gameover
    this.obstacles = [];
    this.acorns = [];
    this.acornCount = 0; // ammunition for throws
    this.shots = [];
    this.throwCooldown = 0;
    this.distance = 0;
    this.score = 0;   // distance score WITHIN the current level
    this.carried = 0;       // banked from levels finished in this life
    this.bonus = 0;         // acorns and dogs this level
    this.runStartScore = 0; // level score where this life began
    this.popups = [];
    this.uiButtons = [];
    this.checkpointFlash = 0;
    this.resetProgress(); // banked stages live only as long as the page
    this.hiScore = bestScore();
    this.scores = readScores();
    this.furthest = readFurthest();
    // Returning players start at the furthest setting they have reached.
    this.levelChoice = this.furthest;
    this.levelChips = [];
    this.speed = DIFFICULTY.bands[0].speed;
    this.scroll = 0; // total scrolled px, drives parallax offsets
    this.blinkTime = 0;
    this.gameOverAt = 0;

    // Debug hitbox overlay: open the page with ?hitboxes to enable.
    this.debugHitboxes = new URLSearchParams(location.search).has("hitboxes");

    this.lastTime = 0;
    this.setupCanvas();
    this.bindInput();

    window.addEventListener("resize", () => this.setupCanvas());
    // Switching apps or tabs mid-run should not cost a life.
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.pauseRun();
    });
    window.addEventListener("blur", () => this.pauseRun());
    requestAnimationFrame((t) => this.frame(t));
  }

  setupCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = GAME_W * dpr;
    this.canvas.height = GAME_H * dpr;
    this.canvas.style.aspectRatio = `${GAME_W} / ${GAME_H}`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = "high";
    this.progressBounds = null; // re-measured against the buttons on next draw
  }

  bindInput() {
    document.addEventListener("keydown", (e) => {
      if (this.nameOpen) return; // the name prompt owns the keyboard
      sound.unlock(); // browsers only allow audio to start from a gesture
      if (e.code === "Enter" || e.code === "NumpadEnter") {
        e.preventDefault();
        if (this.state === "levelcomplete") this.advanceLevel();
        else if (this.state !== "running" && this.state !== "loading") this.startRun();
      } else if (e.code === "Escape" || e.code === "KeyP") {
        e.preventDefault();
        if (e.repeat) return;
        if (this.state === "gameover") this.exitToMenu();
        else this.togglePause();
      } else if (e.code === "KeyR") {
        e.preventDefault();
        if (this.state === "gameover" && !e.repeat &&
            performance.now() - this.gameOverAt > 600) {
          this.resetProgress();
          this.startRun();
        }
      } else if (e.code === "Space") {
        e.preventDefault();
        if (this.state === "paused" && !e.repeat) { this.resumeRun(); return; }
        if (this.state === "running" && !e.repeat) this.fox.jump(this.speed);
      } else if (e.code === "ArrowLeft" || e.code === "ArrowRight") {
        e.preventDefault();
        if (this.state === "running") {
          if (e.code === "ArrowLeft" && !e.repeat) this.throwAcorn();
        } else if (this.state === "ready" && pickableLevels(this.furthest) > 1) {
          // On the intro the arrows pick a setting instead.
          const step = e.code === "ArrowRight" ? 1 : -1;
          const top = pickableLevels(this.furthest) - 1;
          this.levelChoice = Math.min(Math.max(this.levelChoice + step, 0), top);
        }
      }
    });
    document.addEventListener("keyup", (e) => {
      if (e.code === "Space") this.fox.releaseJump();
    });

    this.bindTouchButtons();
  }

  // On-screen thumb buttons (left = jump, right = throw), shared by touch
  // and mouse. While the game isn't running, either button starts a run,
  // with a short grace period after death so mashing jump at the moment
  // of a crash doesn't instantly restart.
  bindTouchButtons() {
    const nameForm = document.getElementById("name-entry");
    if (nameForm) {
      nameForm.addEventListener("submit", (e) => {
        e.preventDefault();
        this.commitScore(document.getElementById("name-input").value);
      });
      // Typing a name must not also drive the fox.
      for (const ev of ["keydown", "keyup", "pointerdown"]) {
        nameForm.addEventListener(ev, (e) => e.stopPropagation());
      }
    }

    const soundBtn = document.getElementById("btn-sound");
    if (soundBtn) {
      const paint = () => { soundBtn.textContent = sound.muted ? "🔇" : "🔊"; };
      paint();
      soundBtn.addEventListener("click", () => {
        soundBtn.blur(); // keep Space from re-triggering the button
        sound.setMuted(!sound.muted);
        paint();
        if (!sound.muted && this.state === "running") sound.startMusic(THEME.music);
      });
    }

    const jumpBtn = document.getElementById("btn-jump");
    const throwBtn = document.getElementById("btn-throw");
    if (!jumpBtn || !throwBtn) return;

    // preventDefault on pointerdown also stops the buttons from taking
    // focus, which would otherwise make Space "click" them.
    const press = (action) => (e) => {
      if (this.nameOpen) return;
      e.preventDefault();
      sound.unlock();
      if (this.state === "paused") this.resumeRun();
      else if (this.state === "running") action();
      else this.tryStartFromButton();
    };
    jumpBtn.addEventListener("pointerdown", press(() => this.fox.jump(this.speed)));
    throwBtn.addEventListener("pointerdown", press(() => this.throwAcorn()));

    // Releasing the jump button just stops the extra lift, like Space.
    const release = (e) => {
      e.preventDefault();
      this.fox.releaseJump();
    };
    jumpBtn.addEventListener("pointerup", release);
    jumpBtn.addEventListener("pointercancel", release);

    for (const btn of [jumpBtn, throwBtn]) {
      btn.addEventListener("contextmenu", (e) => e.preventDefault());
    }

    // Tapping the play field itself also starts/restarts.
    this.canvas.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      if (this.nameOpen) return;
      const r = this.canvas.getBoundingClientRect();
      if (r.width && this.uiButtons.length) {
        const bx = (e.clientX - r.left) * (GAME_W / r.width);
        const by = (e.clientY - r.top) * (GAME_H / r.height);
        const action = this.buttonAt(bx, by);
        if (action) {
          if (action === "continue" || action === "restart") {
            if (performance.now() - this.gameOverAt < 600) return; // mis-tap guard
          }
          this.runUiAction(action);
          return;
        }
      }
      if (this.state === "running") {
        if (r.width) {
          const cx = (e.clientX - r.left) * (GAME_W / r.width);
          const cy = (e.clientY - r.top) * (GAME_H / r.height);
          if (this.inThumbZone(cx, cy)) return; // a near-miss on JUMP/THROW
        }
        this.pauseRun();
        return;
      }
      if (this.state === "paused") { this.resumeRun(); return; }
      if (this.levelChips.length &&
          (this.state === "ready" || (TEST_LEVELS && this.state === "gameover"))) {
        // Map the tap into canvas coordinates before hit-testing the chips.
        const r2 = this.canvas.getBoundingClientRect();
        const cx = (e.clientX - r2.left) * (GAME_W / r2.width);
        const cy = (e.clientY - r2.top) * (GAME_H / r2.height);
        const hit = this.chipAt(cx, cy);
        if (hit >= 0) {
          if (this.state === "ready") {
            this.levelChoice = hit;
          } else {
            // TESTING ONLY: straight into the chosen setting.
            if (performance.now() - this.gameOverAt < 600) return;
            this.beginNewRun(hit);
            return;
          }
        }
      }
      if (this.state !== "running") this.tryStartFromButton();
    });
  }

  tryStartFromButton() {
    if (this.state === "ready") this.beginNewRun(this.levelChoice);
    else if (this.state === "gameover" && performance.now() - this.gameOverAt > 600) this.startRun();
    else if (this.state === "levelcomplete" && performance.now() - this.levelDoneAt > 600) this.advanceLevel();
  }

  /* Once a run is underway, start pulling the next level's art down in
   * the background. Deferred to idle time (or a few seconds in) so the
   * opening of the level, which is when the game is least forgiving of a
   * stutter, has the connection to itself.
   */
  schedulePrefetch() {
    if (this.prefetchQueued) return;
    const next = LEVELS[levelIndex + 1];
    if (!next) return;
    this.prefetchQueued = true;
    const go = () => prefetchTheme(THEMES[next.theme]);
    if (window.requestIdleCallback) {
      requestIdleCallback(go, { timeout: 6000 });
    } else {
      setTimeout(go, 4000);
    }
  }

  // Wipes banked stages: a new level, or a deliberate fresh start.
  resetProgress() {
    this.checkpoint = { stage: 0, score: 0 };
  }

  /* Bonus points, with the figure floating up from wherever it was
   * earned - otherwise the score just jumps and nobody knows why.
   */
  awardBonus(points, x, y) {
    this.bonus += points;
    this.popups.push({ x, y, text: "+" + points, life: 0.9 });
  }

  // What the player sees and what goes in the table: the whole run.
  /* Distance counts from where THIS life began, not from the start of
   * the level: a checkpoint hands back the position, so difficulty and
   * the progress bar are right, but not the score that died with the
   * previous life.
   */
  get totalScore() {
    return this.carried + (this.score - this.runStartScore) + this.bonus;
  }

  // A brand new run from the intro, at whichever setting was picked.
  beginNewRun(levelChoice) {
    this.resetProgress();
    this.goToLevel(levelChoice);
  }

  startRun(keepTotal) {
    this.state = "running";
    this.finish = null;
    sound.startMusic(THEME.music);
    this.schedulePrefetch();
    this.obstacles = [];
    this.acorns = [];
    this.shots = [];
    this.throwCooldown = 0;
    this.pendingRelease = null;
    // Resume from the furthest stage banked this session.
    this.score = this.checkpoint.score;
    // Dying ends a score for good. A checkpoint only says where to rejoin.
    if (!keepTotal) {
      this.carried = 0;
      this.bonus = 0;
    }
    this.runStartScore = this.score;
    this.distance = this.score * SCORE_DISTANCE_DIVISOR;
    this.popups = [];
    this.acornCount = 0; // acorns are lost on death, wherever you restart
    this.dogsStopped = 0;
    this.acornsCollected = 0;
    this.checkpointFlash = 0;
    this.speed = DIFFICULTY.bands[0].speed;
    this.fox.reset();
    this.spawner.reset();
    this.acornSpawner.reset();
    this.dogDirector.reset();
    this.birdSpawner.reset();
    this.birds = [];
  }

  /* Moves to the next level: swaps the theme, loads whatever art that
   * setting has (missing pieces fall back to the field's), and starts the
   * run. Shows a brief loading line because a new setting means new files.
   */
  advanceLevel() {
    if (levelIndex + 1 >= LEVELS.length) {
      this.resetProgress();
      this.prefetchQueued = false;
      this.startRun();
      return;
    }
    this.goToLevel(levelIndex + 1, true); // same life, so the total carries
  }

  /* Switches setting and starts a run there, loading that theme's art
   * first if it is not the one already in memory. Used both by finishing
   * a level and by picking one on the intro screen.
   */
  goToLevel(index, keepTotal) {
    this.resetProgress(); // a new setting starts from its own beginning
    this.prefetchQueued = false; // so the level after this one gets queued too
    if (index === levelIndex) { this.startRun(keepTotal); return; }
    const previous = levelIndex;
    levelIndex = index;
    THEME = THEMES[LEVELS[levelIndex].theme];
    this.state = "loading";
    loadAssets()
      .then((images) => {
        this.images = images;
        this.fox.images = images;
        this.startRun(keepTotal);
      })
      .catch((err) => {
        console.error(err);
        levelIndex = previous; // could not load it; stay where we were
        THEME = THEMES[LEVELS[levelIndex].theme];
        this.startRun(keepTotal);
      });
  }

  /* Pausing freezes the run: update() only ever runs in the "running"
   * state, so stopping the music and changing state is the whole job.
   * The frame loop already clamps dt, so however long the pause lasts
   * nothing leaps forward on resume.
   */
  togglePause() {
    if (this.state === "running") this.pauseRun();
    else if (this.state === "paused") this.resumeRun();
  }

  pauseRun() {
    if (this.state !== "running") return;
    this.state = "paused";
    this.pausedAt = performance.now();
    sound.stopMusic();
  }

  resumeRun() {
    if (this.state !== "paused") return;
    this.state = "running";
    sound.unlock();
    sound.startMusic(THEME.music);
  }

  throwAcorn() {
    if (this.acornCount <= 0 || this.throwCooldown > 0) return;
    this.acornCount--;
    this.throwCooldown = THROW.cooldown;
    this.fox.startThrow();
    sound.sfx("throw");
    // The projectile leaves on the release frame, not at the key press.
    this.pendingRelease = THROW_ANIM.releaseAt;
  }

  /* Goal reached: stop sending hazards, let the fox run on, then slide his
   * burrow in from the right for him to dive into. Reaching home should
   * feel earned, not like the game simply stopped.
   */
  beginFinish() {
    this.finish = { holeX: null, lead: FINISH.holeLeadIn, diveT: 0 };
    this.spawner.distanceUntilNext = Infinity;
    this.acornSpawner.distanceUntilNext = Infinity;
    this.dogDirector.distanceUntilNext = Infinity;
    this.birdSpawner.distanceUntilNext = Infinity;
    for (const d of this.dogDirector.dogs) {
      if (d.state === "chasing") d.state = "tiring"; // any pursuer gives up
    }
  }

  updateFinish(dt) {
    const f = this.finish;
    if (f.holeX === null) {
      f.lead -= dt;
      // Wait for a clear run-in before the burrow appears.
      if (f.lead <= 0 && !this.obstacles.length && !this.birds.length) {
        f.holeX = GAME_W + 60;
      }
      return;
    }
    if (f.diveT === 0) {
      f.holeX -= this.speed * dt;
      const fb = this.fox.getHitbox();
      /* Start the dive while the burrow is still a little ahead of him,
       * so he runs forward into its mouth. Triggering on its trailing
       * edge meant it had already slid past and he dived backwards.
       */
      if (f.holeX <= fb.x + fb.w / 2 + 26 && this.fox.onGround) {
        f.diveT = 0.0001; // reached home
      }
      return;
    }
    f.diveT += dt / FINISH.diveTime;
    if (f.diveT >= 1) this.completeLevel();
  }

  completeLevel() {
    sound.stopMusic();
    sound.sfx("win");
    this.state = "levelcomplete";
    this.levelDoneAt = performance.now();
    this.fox.releaseJump();
    // Finishing the last level ends the run, so the score is final there.
    // Otherwise the run carries on into the next setting and is banked
    // when it eventually ends.
    if (LEVELS[levelIndex + 1] && levelIndex + 1 > this.furthest) {
      this.furthest = levelIndex + 1;
      writeFurthest(this.furthest);
      this.levelChoice = this.furthest;
    }
    if (!LEVELS[levelIndex + 1]) {
      this.finishRunScore(); // last level: the run is over, so this is final
    } else {
      // Fold the finished level into the total; the next one starts its
      // own distance count at zero, so nothing is counted twice.
      // Only what this life actually covered: rejoining at a checkpoint
      // two thirds in earns the last third, not the whole level.
      this.carried += (this.score - this.runStartScore) + this.bonus;
      this.bonus = 0;
      this.score = 0;
      this.runStartScore = 0;

      if (this.totalScore > this.hiScore) this.hiScore = this.totalScore;
    }
  }

  /* A run has ended for good. Bank the score, and if it earned a place in
   * the table ask who it belongs to.
   */
  finishRunScore() {
    this.scores = readScores();
    this.pendingScore = null;
    const total = this.totalScore;
    if (total > this.hiScore) this.hiScore = total;
    if (scoreQualifies(total, this.scores)) {
      this.pendingScore = { score: total };
      this.openNameEntry();
    }
  }

  // The name prompt is a real text field over the canvas: it works with a
  // keyboard, and brings up the on-screen one on a tablet.
  openNameEntry() {
    const form = document.getElementById("name-entry");
    const input = document.getElementById("name-input");
    if (!form || !input) {
      // No prompt available: still record the score under the last name.
      this.commitScore(readLastName() || "FOX");
      return;
    }
    input.value = readLastName();
    form.hidden = false;
    this.nameOpen = true;
    setTimeout(() => { input.focus(); input.select(); }, 30);
  }

  commitScore(name) {
    if (!this.pendingScore) return;
    const clean = name.trim().toUpperCase().slice(0, NAME_MAX) || "FOX";
    writeLastName(clean);
    this.scores = recordScore(clean, this.pendingScore.score);
    this.hiScore = bestScore();
    this.justSet = clean + "|" + this.pendingScore.score;
    this.pendingScore = null;
    const form = document.getElementById("name-entry");
    if (form) form.hidden = true;
    this.nameOpen = false;
  }

  endRun() {
    sound.stopMusic();
    sound.sfx("death");
    this.state = "gameover";
    this.gameOverAt = performance.now();
    this.fox.dead = true;
    this.finishRunScore();
  }

  frame(time) {
    this.frameCount = (this.frameCount || 0) + 1;
    try {
      const dt = Math.min((time - this.lastTime) / 1000, 0.05); // clamp tab-switch spikes
      this.lastTime = time;
      this.blinkTime += dt;

      if (this.state === "running") this.update(dt);
      this.draw();
    } catch (err) {
      // Never let one bad frame stop the game for good; log once and carry on.
      if (!this.loggedFrameError) {
        this.loggedFrameError = true;
        console.error("frame error", err);
      }
    }
    requestAnimationFrame((t) => this.frame(t));
  }

  update(dt) {
    this.speed = difficultyAt(this.score).speed;
    // Once he is going down the hole, everything stops. Otherwise the
    // ground kept scrolling under a burrow that had stopped moving with
    // it, and the burrow appeared to slide across the world.
    if (this.finish && this.finish.diveT > 0) this.speed = 0;
    this.distance += this.speed * dt;
    this.scroll += this.speed * dt;
    this.score = Math.floor(this.distance / SCORE_DISTANCE_DIVISOR);
    // The goal is the level's ceiling: the run-in to the burrow should
    // not quietly add a few hundred more.
    if (this.finish) this.score = Math.min(this.score, levelGoal());
    sound.setProgress(this.score / levelGoal()); // tempo climbs with progress
    // Bank a stage as it is passed.
    const stage = Math.min(
      PROGRESS.stages - 1,
      Math.floor((this.score / levelGoal()) * PROGRESS.stages)
    );
    if (stage > this.checkpoint.stage) {
      this.checkpoint = {
        stage,
        score: Math.round((levelGoal() * stage) / PROGRESS.stages),
      };
      this.checkpointFlash = 1.6;
      sound.sfx("checkpoint");
    }
    if (this.checkpointFlash > 0) this.checkpointFlash -= dt;

    if (this.score >= levelGoal() && !this.finish) {
      this.score = levelGoal();
      this.beginFinish();
    }

    this.fox.update(dt, this.speed);
    if (this.finish) {
      this.updateFinish(dt);
      if (this.state !== "running") return;
    }
    const obstacleCountBefore = this.obstacles.length;
    this.spawner.update(dt, this.speed, this.score, this.obstacles);
    this.acornSpawner.update(dt, this.speed, this.score, this.acorns, this.obstacles, this.images.acorn);
    if (this.obstacles.length > obstacleCountBefore) {
      this.acornSpawner.notifyObstacleSpawned(
        this.obstacles[this.obstacles.length - 1], this.acorns, this.images.acorn
      );
    }
    this.dogDirector.update(dt, this.speed, this.score, this.fox, this.obstacles, this.spawner, this.images);
    // A woken dog pushes the fox toward mid-screen: the chase fits on
    // screen behind him and obstacles arrive with less warning.
    const dogPressure = this.dogDirector.dogs.some(
      (d) => d.state !== "sleeping" && d.state !== "stunned" && d.state !== "tiring"
    );
    this.fox.targetX = dogPressure ? FOX_CHASE_X : FOX_X;
    this.throwCooldown = Math.max(0, this.throwCooldown - dt);
    if (this.pendingRelease != null) {
      this.pendingRelease -= dt;
      if (this.pendingRelease <= 0) {
        this.pendingRelease = null;
        const fb = this.fox.getHitbox();
        this.shots.push(new AcornShot(fb.x, fb.y + fb.h * 0.35, this.images.acorn));
      }
    }

    for (const ob of this.obstacles) ob.update(dt, this.speed, this.fox, this.images);
    this.obstacles = this.obstacles.filter((ob) => !ob.isOffscreen());
    for (const ac of this.acorns) ac.update(dt, this.speed);
    this.acorns = this.acorns.filter((ac) => !ac.isOffscreen() && !ac.collected);
    for (const p of this.popups) { p.life -= dt; p.y -= 34 * dt; p.x -= this.speed * dt; }
    this.popups = this.popups.filter((p) => p.life > 0);
    for (const shot of this.shots) shot.update(dt, this.groundY);
    this.shots = this.shots.filter((s) => !s.dead);
    this.birdSpawner.update(
      dt, this.speed, this.score, this.birds,
      this.obstacles, this.dogDirector.dogs, this.acorns, this.spawner, this.images.birdFly
    );
    for (const b of this.birds) b.update(dt, this.speed);
    this.birds = this.birds.filter((b) => !b.isOffscreen());

    // Thrown acorns vs the dogs — one acorn takes out one dog.
    for (const shot of this.shots) {
      for (const d of this.dogDirector.dogs) {
        if (d.state !== "stunned" && intersects(shot.getBox(), d.getShotBox())) {
          shot.dead = true;
          d.stun();
          this.dogsStopped++;
          this.awardBonus(SCORING.dog, d.x + d.w / 2, d.y);
          sound.sfx("stun");
          break;
        }
      }
    }

    // Collision check is separate from obstacle behaviour on purpose.
    const foxBox = this.fox.getHitbox();
    for (const ob of this.obstacles) {
      if (intersects(foxBox, ob.getHitbox())) {
        this.endRun();
        break;
      }
    }
    if (this.state === "running") {
      for (const b of this.birds) {
        if (intersects(foxBox, b.getHitbox())) {
          this.endRun();
          break;
        }
      }
    }
    if (this.state === "running") {
      for (const d of this.dogDirector.dogs) {
        const dogBox = d.getHitbox();
        if (dogBox && intersects(foxBox, dogBox)) {
          d.bite(); // teeth out for the game-over scene
          this.endRun();
          break;
        }
      }
    }

    // Acorn catches (checked after obstacles; a dead fox catches nothing).
    if (this.state === "running") {
      for (const ac of this.acorns) {
        if (!ac.collected && intersects(foxBox, ac.getHitbox())) {
          ac.collected = true;
          this.acornCount++;
          this.acornsCollected++;
          this.awardBonus(SCORING.acorn, ac.x + ac.w / 2, ac.y);
          sound.sfx("collect");
        }
      }
    }
  }

  // ------------------------------------------------------------------ draw

  // Tiles an image horizontally at a fixed drawn height, bottom-anchored.
  // mirror=true flips alternate tiles, which hides non-seamless edges.
  // src (optional) draws only the {srcY0..srcY1} vertical band of the image.
  drawTiledLayer(img, drawH, bottomY, offset, mirror, src) {
    const sy = src ? src.srcY0 : 0;
    const sh = src ? src.srcY1 - src.srcY0 : img.height;
    const sx = (src && src.srcX0) || 0;
    const sw = (src && src.srcX1 ? src.srcX1 : img.width) - sx;
    const scale = drawH / sh;
    const drawW = sw * scale;
    let x = -(offset % drawW);
    if (x > 0) x -= drawW;
    let index = Math.round((offset + x) / drawW); // stable tile index for mirroring
    for (; x < GAME_W; x += drawW, index++) {
      const ctx = this.ctx;
      if (mirror && index % 2 !== 0) {
        ctx.save();
        ctx.translate(x + drawW, bottomY - drawH);
        ctx.scale(-1, 1);
        // 1px overlap hides antialiasing seams between tiles.
        ctx.drawImage(img, sx, sy, sw, sh, -0.5, 0, drawW + 1, drawH);
        ctx.restore();
      } else {
        ctx.drawImage(img, sx, sy, sw, sh, x - 0.5, bottomY - drawH, drawW + 1, drawH);
      }
    }
  }

  drawDecorStrips() {
    for (const strip of DECOR_STRIPS) {
      const off = (this.scroll * strip.parallax) % strip.length;
      for (const item of strip.items) {
        const img = this.images[item.img];
        const w = item.h * (img.width / img.height);
        for (const rep of [-1, 0, 1]) {
          const x = item.x - off + rep * strip.length;
          if (x + w < -20 || x > GAME_W + 20) continue;
          this.ctx.drawImage(img, x, this.groundY + strip.yOffset - item.h, w, item.h);
        }
      }
    }
  }

  drawBackground() {
    const { ctx, images } = this;

    // Sky: static cover-crop over the whole canvas (lower layers paint over
    // it, so nothing can peek through between bands).
    const sky = images.sky;
    const srcH = (GAME_H / GAME_W) * sky.width;
    ctx.drawImage(sky, 0, sky.height - srcH, sky.width, srcH, 0, 0, GAME_W, GAME_H);

    // Distant hills and mid treeline bands, tucked in behind the grass.
    const bandBottom = this.groundY + 4;
    const climbed = Math.min(1, this.score / levelGoal()); // how far up we are
    for (const band of (THEME.bands || BG_BANDS)) {
      if (!images[band.img]) continue; // optional band, art not in this theme
      // `offset` lifts a band off the horizon at the start; `climb` slides
      // it down over the level. Together they let the cloud band begin
      // overhead and end up below the path.
      const drop = (band.offset || 0) + (band.climb || 0) * climbed;
      this.drawTiledLayer(images[band.img], band.h, bandBottom + drop,
        this.scroll * band.parallax, band.mirror !== false, band.src);
    }

    this.drawDecorStrips();

    // Merged ground, drawn back to front: dark soil fill, then the dirt
    // cross-section from ground_tile, then ground_tile_2's grass strip whose
    // drippy underside hangs over the dirt. All scroll at full game speed
    // with mirrored tiling (neither tile is seamless).
    const gc = THEME.groundCrops || GROUND;
    const grassTop = this.groundY - gc.grass.drawH * gc.grass.surfaceFrac;
    const grassBottom = grassTop + gc.grass.drawH;
    const dirtTop = grassBottom - gc.dirt.overlap;
    ctx.fillStyle = gc.underfill || GROUND.underfill;
    ctx.fillRect(0, dirtTop + 6, GAME_W, GAME_H - dirtTop - 6);
    this.drawTiledLayer(images.groundDirt, gc.dirt.drawH, dirtTop + gc.dirt.drawH,
      this.scroll, true, gc.dirt);
    this.drawTiledLayer(images.groundGrass, gc.grass.drawH, grassBottom,
      this.scroll, true, gc.grass);
  }

  /* The fox's burrow. Uses the theme's art when it exists; otherwise it is
   * drawn - an earth mound with a dark mouth - so the ending works before
   * the artwork lands.
   */
  // Where the burrow sits, and where its mouth is - the point the fox
  // aims for as he dives.
  foxholeBox() {
    const t = FINISH.trim;
    const w = FINISH.holeW;
    const h = w / (t.sw / t.sh);
    const bottom = this.groundY + FINISH.sink;
    return { x: this.finish.holeX, w, h, bottom, mouthY: bottom - h * FINISH.mouthFrac };
  }

  drawFoxhole(ctx) {
    const x = this.finish.holeX;
    const img = this.images.foxhole;
    const w = FINISH.holeW;
    const h = FINISH.holeH;
    if (img) {
      const t = FINISH.trim;
      const box = this.foxholeBox();
      ctx.drawImage(img, t.sx, t.sy, t.sw, t.sh,
        x - w / 2, box.bottom - box.h, w, box.h);
      return;
    }
    ctx.save();
    ctx.translate(x, this.groundY + 2);
    ctx.fillStyle = "#5b3a1c";
    ctx.beginPath();
    ctx.ellipse(0, 0, w / 2, h / 2 + 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#20140a";
    ctx.beginPath();
    ctx.ellipse(0, 1, w / 2 - 9, h / 2 - 3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /* The progress bar in the dirt: how far through the level you are, the
   * two stage markers that bank your place, and the burrow at the end.
   */
  /* The bar runs as wide as the thumb buttons allow. Their size is set in
   * vw units, so they cover proportionally more of the canvas on a small
   * screen; measuring them beats guessing a fixed inset that is either
   * too timid on a desktop or overlapped on a phone.
   */
  computeProgressBounds() {
    let left = PROGRESS.edgeMargin;
    let right = GAME_W - PROGRESS.edgeMargin;
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width > 0) {
      const toCanvas = (clientX) => (clientX - rect.left) * (GAME_W / rect.width);
      const clear = (id, side) => {
        const el = document.getElementById(id);
        if (!el || !el.offsetParent) return; // absent or hidden
        const r = el.getBoundingClientRect();
        if (!r.width) return;
        if (side === "left") left = Math.max(left, toCanvas(r.right) + PROGRESS.buttonGap);
        else right = Math.min(right, toCanvas(r.left) - PROGRESS.buttonGap);
      };
      clear("btn-jump", "left");
      clear("btn-throw", "right");
    }
    if (right - left < 160) { // degenerate layout: fall back to a centred bar
      left = GAME_W * 0.2;
      right = GAME_W * 0.8;
    }
    this.progressBounds = { x: left, w: right - left };
  }

  drawProgress(ctx) {
    // Re-measure periodically: a first reading taken before the buttons
    // have finished laying out is wrong, and fullscreen toggles do not
    // always fire a resize.
    if (!this.progressBounds || this.frameCount % 30 === 0) {
      this.computeProgressBounds();
    }
    const { x, w } = this.progressBounds;
    const { y, h, markerR } = PROGRESS;
    const goal = levelGoal();
    const p = Math.max(0, Math.min(1, this.score / goal));

    ctx.save();
    // Track, sunk into the soil.
    roundRectPath(ctx, x, y, w, h, h / 2);
    ctx.fillStyle = "rgba(28, 16, 8, 0.72)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 240, 210, 0.22)";
    ctx.lineWidth = 1;
    ctx.stroke();

    // Filled portion.
    if (p > 0.002) {
      ctx.save();
      roundRectPath(ctx, x, y, w, h, h / 2);
      ctx.clip();
      const grad = ctx.createLinearGradient(x, 0, x + w, 0);
      grad.addColorStop(0, "#c8862c");
      grad.addColorStop(1, "#ffd76b");
      ctx.fillStyle = grad;
      ctx.fillRect(x, y, w * p, h);
      ctx.restore();
    }

    // Where the fox is right now.
    if (p > 0.002 && p < 1) {
      ctx.beginPath();
      ctx.arc(x + w * p, y + h / 2, h / 2 + 1.5, 0, Math.PI * 2);
      ctx.fillStyle = "#fff4d8";
      ctx.fill();
    }

    // Stage markers at a third and two thirds; lit once banked.
    for (let i = 1; i < PROGRESS.stages; i++) {
      const mx = x + (w * i) / PROGRESS.stages;
      const reached = this.checkpoint.stage >= i;
      ctx.beginPath();
      ctx.arc(mx, y + h / 2, markerR, 0, Math.PI * 2);
      ctx.fillStyle = reached ? "#ffe08a" : "rgba(28, 16, 8, 0.9)";
      ctx.fill();
      ctx.strokeStyle = reached ? "rgba(255,255,255,0.9)" : "rgba(255, 240, 210, 0.45)";
      ctx.lineWidth = reached ? 2 : 1.5;
      ctx.stroke();
    }

    // The burrow at the finish.
    const ex = x + w;
    ctx.beginPath();
    ctx.arc(ex, y + h / 2, markerR + 3, 0, Math.PI * 2);
    ctx.fillStyle = p >= 1 ? "#ffe08a" : "#3b2410";
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 240, 210, 0.7)";
    ctx.lineWidth = 2;
    ctx.stroke();
    if (p < 1) {
      ctx.beginPath(); // a dark mouth, so it reads as a hole to aim for
      ctx.arc(ex, y + h / 2, markerR - 2, 0, Math.PI * 2);
      ctx.fillStyle = "#140c05";
      ctx.fill();
    }

    if (this.checkpointFlash > 0) {
      ctx.globalAlpha = Math.min(1, this.checkpointFlash / 0.4);
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.font = "bold 14px 'Courier New', Courier, monospace";
      ctx.strokeStyle = "rgba(30, 45, 25, 0.9)";
      ctx.lineWidth = 4;
      ctx.strokeText("CHECKPOINT!", x + w / 2, y - 5);
      ctx.fillStyle = "#ffe08a";
      ctx.fillText("CHECKPOINT!", x + w / 2, y - 5);
    }
    ctx.restore();
  }

  /* The saved table, on the game-over page. Hidden while the name prompt
   * is up, so the two never fight for the same space.
   */
  drawScoreTable(ctx, outlined) {
    if (this.nameOpen) return;
    const rows = this.scores || [];
    if (!rows.length) return;

    const top = 152;
    const rowH = 18;
    const panelW = 340;
    const left = GAME_W / 2 - panelW / 2;

    ctx.save();
    roundRectPath(ctx, left, top - 22, panelW, rows.length * rowH + 28, 10);
    ctx.fillStyle = "rgba(20, 32, 18, 0.62)";
    ctx.fill();

    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
    ctx.strokeStyle = "rgba(40, 55, 30, 0.85)";
    outlined("BEST RUNS", GAME_W / 2, top - 10,
      "bold 11px 'Courier New', Courier, monospace", 3);

    rows.forEach((entry, i) => {
      const y = top + 8 + i * rowH;
      const mine = this.justSet === entry.name + "|" + entry.score;
      ctx.fillStyle = mine ? "#ffe08a" : "rgba(255, 255, 255, 0.95)";
      ctx.font = "bold 13px 'Courier New', Courier, monospace";
      ctx.lineWidth = 3;
      ctx.textAlign = "left";
      ctx.strokeText(`${i + 1}. ${entry.name}`, left + 18, y);
      ctx.fillText(`${i + 1}. ${entry.name}`, left + 18, y);
      ctx.textAlign = "right";
      const tail = String(entry.score).padStart(5, "0");
      ctx.strokeText(tail, left + panelW - 18, y);
      ctx.fillText(tail, left + panelW - 18, y);
    });
    ctx.restore();
  }

  drawHud() {
    const { ctx } = this;
    ctx.save();
    ctx.font = "bold 17px 'Courier New', Courier, monospace";
    ctx.textBaseline = "top";
    ctx.fillStyle = "#2e4222";
    ctx.textAlign = "right";

    const pad = (n) => String(n).padStart(5, "0");
    const scoreText = `SCORE ${pad(this.totalScore)}`;
    const hiText = `HI ${pad(this.hiScore)}`;
    // Right margin leaves room for the fullscreen button overlay.
    ctx.fillText(scoreText, GAME_W - 70, 16);
    ctx.globalAlpha = 0.65;
    ctx.fillText(hiText, GAME_W - 70 - ctx.measureText(scoreText).width - 24, 16);

    // Acorn counter, top-left (opposite the score).
    ctx.globalAlpha = 1;
    ctx.textAlign = "left";
    ctx.drawImage(this.images.acornIcon, 20, 12, 22, 22);
    ctx.fillText(`x ${this.acornCount}`, 48, 16);
    ctx.restore();
    this.drawProgress(ctx);
  }

  drawHitboxes() {
    const { ctx } = this;
    ctx.save();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "rgba(255, 40, 40, 0.9)";
    const fb = this.fox.getHitbox();
    ctx.strokeRect(fb.x, fb.y, fb.w, fb.h);
    ctx.strokeStyle = "rgba(40, 90, 255, 0.9)";
    for (const ob of this.obstacles) {
      const hb = ob.getHitbox();
      ctx.strokeRect(hb.x, hb.y, hb.w, hb.h);
    }
    ctx.strokeStyle = "rgba(255, 140, 0, 0.9)";
    for (const d of this.dogDirector.dogs) {
      const hb = d.getHitbox();
      if (hb) ctx.strokeRect(hb.x, hb.y, hb.w, hb.h);
    }
    ctx.strokeStyle = "rgba(120, 40, 255, 0.9)";
    for (const b of this.birds) {
      const hb = b.getHitbox();
      ctx.strokeRect(hb.x, hb.y, hb.w, hb.h);
    }
    ctx.restore();
  }

  // A keyboard keycap of fixed width with a label to its right.
  // Used by the start-screen controls panel.
  drawKeycap(x, y, keyW, keyText, label) {
    const { ctx } = this;
    const keyH = 24;
    ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
    ctx.strokeStyle = "rgba(40, 55, 30, 0.9)";
    ctx.lineWidth = 2;
    roundRectPath(ctx, x, y, keyW, keyH, 5);
    ctx.fill();
    ctx.stroke();
    ctx.font = "bold 14px 'Courier New', Courier, monospace";
    ctx.fillStyle = "#2e4222";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(keyText, x + keyW / 2, y + keyH / 2 + 1);
    ctx.font = "bold 15px 'Courier New', Courier, monospace";
    ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
    ctx.textAlign = "left";
    ctx.fillText(label, x + keyW + 14, y + keyH / 2 + 1);
  }

  // Start-screen controls panel: one row per key, on a soft dark panel.
  /* Settings unlocked so far, as tappable chips. Only appears once there
   * is a choice to make - a lone chip would just be furniture.
   */
  drawLevelPicker(ctx, y = 246) {
    this.levelChips = [];
    const count = pickableLevels(this.furthest);
    if (count < 2) return;
    const chipH = 26;
    const gap = 10;
    ctx.save();
    ctx.font = "bold 13px 'Courier New', Courier, monospace";
    const widths = [];
    for (let i = 0; i < count; i++) {
      widths.push(ctx.measureText(THEMES[LEVELS[i].theme].label.toUpperCase()).width + 26);
    }
    const total = widths.reduce((a, b) => a + b, 0) + gap * (count - 1);
    let x = GAME_W / 2 - total / 2;

    for (let i = 0; i < count; i++) {
      const w = widths[i];
      const on = i === this.levelChoice;
      roundRectPath(ctx, x, y - chipH / 2, w, chipH, 7);
      ctx.fillStyle = on ? "rgba(255, 224, 138, 0.95)" : "rgba(20, 32, 18, 0.62)";
      ctx.fill();
      ctx.strokeStyle = on ? "rgba(255, 255, 255, 0.95)" : "rgba(255, 255, 255, 0.45)";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = on ? "#17241b" : "rgba(255, 255, 255, 0.92)";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(THEMES[LEVELS[i].theme].label.toUpperCase(), x + w / 2, y + 1);
      this.levelChips.push({ x, y: y - chipH / 2, w, h: chipH, index: i });
      x += w + gap;
    }
    ctx.restore();
  }

  // Which chip, if any, a tap landed on. Canvas coordinates.
  chipAt(cx, cy) {
    for (const c of this.levelChips) {
      if (cx >= c.x && cx <= c.x + c.w && cy >= c.y && cy <= c.y + c.h) return c.index;
    }
    return -1;
  }

  drawControlsPanel() {
    const { ctx } = this;
    const rows = [
      ["ENTER", "start / restart"],
      ["SPACE", "jump"],
      ["LEFT", "throw acorn"],
    ];
    const rowH = 32;
    const panelW = 260;
    const panelH = rows.length * rowH + 18;
    const px = GAME_W / 2 - panelW / 2;
    const py = 108;
    ctx.save();
    ctx.fillStyle = "rgba(30, 45, 25, 0.55)";
    roundRectPath(ctx, px, py, panelW, panelH, 10);
    ctx.fill();
    // All keycaps share the widest key's width so the labels line up.
    ctx.font = "bold 14px 'Courier New', Courier, monospace";
    const keyW = Math.max(...rows.map(([k]) => ctx.measureText(k).width + 22));
    rows.forEach(([key, label], i) => {
      this.drawKeycap(px + 18, py + 12 + i * rowH, keyW, key, label);
    });
    ctx.restore();
  }

  // Intro page: the loading-page art (dog chasing the fox, acorn mid-arc)
  // as a full-canvas backdrop, with the title and controls drawn on top.
  drawIntro() {
    const { ctx } = this;
    const img = this.images.introBg;

    // Cover the canvas, anchored to the bottom so the ground edge in the
    // art lines up with the bottom of the canvas and only sky is cropped.
    const scale = Math.max(GAME_W / img.width, GAME_H / img.height);
    const dw = img.width * scale;
    const dh = img.height * scale;
    ctx.drawImage(img, (GAME_W - dw) / 2, GAME_H - dh, dw, dh);

    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
    ctx.strokeStyle = "rgba(40, 55, 30, 0.85)";
    ctx.lineWidth = 6;
    ctx.font = "bold 44px 'Courier New', Courier, monospace";
    ctx.strokeText("FOX RUNNER", GAME_W / 2, 42);
    ctx.fillText("FOX RUNNER", GAME_W / 2, 42);
    ctx.lineWidth = 4;
    ctx.font = "bold 16px 'Courier New', Courier, monospace";
    ctx.strokeText("Outrun the dog. Toss acorns. Keep moving.", GAME_W / 2, 76);
    ctx.fillText("Outrun the dog. Toss acorns. Keep moving.", GAME_W / 2, 76);
    ctx.restore();

    this.drawControlsPanel();
    this.drawLevelPicker(ctx);

    if (this.blinkTime % 1 < 0.65) {
      ctx.save();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = "bold 19px 'Courier New', Courier, monospace";
      ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
      ctx.strokeStyle = "rgba(40, 55, 30, 0.85)";
      ctx.lineWidth = 4;
      // When there is a choice of setting, say so rather than leaving the
      // chips looking like decoration.
      const prompt = this.furthest > 0
        ? "Tap a level, or press ENTER to start"
        : "Press ENTER or tap to start";
      ctx.strokeText(prompt, GAME_W / 2, 281);
      ctx.fillText(prompt, GAME_W / 2, 281);
      ctx.restore();
    }
  }

  draw() {
    const { ctx } = this;
    ctx.clearRect(0, 0, GAME_W, GAME_H);
    this.uiButtons = [];

    if (this.state === "ready") {
      this.drawIntro();
      return;
    }

    if (this.state === "loading") {
      ctx.fillStyle = "#1c2a1e";
      ctx.fillRect(0, 0, GAME_W, GAME_H);
      ctx.fillStyle = "#ffffff";
      ctx.textAlign = "center";
      ctx.font = "bold 22px 'Courier New', Courier, monospace";
      ctx.fillText(`${THEME.label}...`, GAME_W / 2, GAME_H / 2);
      return;
    }
    if (this.state === "levelcomplete") {
      this.drawLevelComplete();
      return;
    }
    if (this.state === "paused") {
      this.drawScene();
      this.drawPaused();
      return;
    }

    // Game over: hold the caught moment for a beat, then cut to the
    // dedicated game-over page.
    if (this.state === "gameover" && performance.now() - this.gameOverAt > 800) {
      this.drawGameOver();
      return;
    }

    this.drawScene();
  }

  // The playfield itself. Shared by the live game and the pause overlay,
  // which draws the frozen scene underneath its panel.
  drawScene() {
    const { ctx } = this;
    this.drawBackground();
    for (const ob of this.obstacles) ob.draw(ctx);
    for (const ac of this.acorns) ac.draw(ctx);
    for (const d of this.dogDirector.dogs) d.draw(ctx);
    for (const b of this.birds) b.draw(ctx);
    const diving = this.finish && this.finish.diveT > 0;
    if (diving) {
      /* Draw the fox first so the burrow covers him: he shrinks into the
       * dark mouth and the mound hides him, which reads as going in
       * rather than sinking through the grass in front of it.
       */
      const t = Math.min(1, this.finish.diveT);
      const ease = t * t; // gathers pace as he disappears
      const box = this.foxholeBox();
      const cx = this.fox.x + this.fox.w / 2;
      const cy = this.fox.y + this.fox.h / 2;
      const toX = cx + (box.x - cx) * ease;
      const toY = cy + (box.mouthY - cy) * ease;
      const scale = 1 - 0.72 * ease;
      ctx.save();
      ctx.translate(toX, toY);
      ctx.scale(scale, scale);
      ctx.translate(-cx, -cy);
      this.fox.draw(ctx, this.state);
      ctx.restore();
    }
    if (this.finish && this.finish.holeX !== null) this.drawFoxhole(ctx);
    if (!diving) this.fox.draw(ctx, this.state);
    for (const shot of this.shots) shot.draw(ctx);
    this.drawPopups(ctx);
    if (this.debugHitboxes) this.drawHitboxes();
    this.drawHud();
  }

  drawPopups(ctx) {
    if (!this.popups.length) return;
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "bold 16px 'Courier New', Courier, monospace";
    ctx.lineWidth = 4;
    for (const p of this.popups) {
      ctx.globalAlpha = Math.min(1, p.life / 0.35);
      ctx.strokeStyle = "rgba(30, 45, 25, 0.9)";
      ctx.strokeText(p.text, p.x, p.y);
      ctx.fillStyle = "#ffe08a";
      ctx.fillText(p.text, p.x, p.y);
    }
    ctx.restore();
  }

  /* On-canvas buttons. Rebuilt each frame for whichever screen is up and
   * hit-tested on tap, so the pause and game-over screens share one path
   * and work identically with a mouse or a finger.
   */
  drawButtonRow(ctx, buttons, y) {
    ctx.save();
    ctx.font = "bold 15px 'Courier New', Courier, monospace";
    const h = 32;
    const pad = 22;
    const gap = 12;
    const widths = buttons.map((b) => ctx.measureText(b.label).width + pad * 2);
    const total = widths.reduce((a, b) => a + b, 0) + gap * (buttons.length - 1);
    let x = GAME_W / 2 - total / 2;

    buttons.forEach((b, i) => {
      const w = widths[i];
      roundRectPath(ctx, x, y - h / 2, w, h, 8);
      ctx.fillStyle = b.primary ? "rgba(255, 224, 138, 0.95)" : "rgba(20, 32, 18, 0.78)";
      ctx.fill();
      ctx.strokeStyle = b.primary ? "rgba(255, 255, 255, 0.95)" : "rgba(255, 255, 255, 0.55)";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = b.primary ? "#17241b" : "rgba(255, 255, 255, 0.95)";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(b.label, x + w / 2, y + 1);
      this.uiButtons.push({ x, y: y - h / 2, w, h, action: b.action });
      x += w + gap;
    });
    ctx.restore();
  }

  /* The corners the thumbs live in, in canvas coordinates, generously
   * padded. A tap that lands here while playing does nothing at all: it
   * was aimed at JUMP or THROW, and treating a near-miss as "pause the
   * game" cost players runs.
   */
  inThumbZone(cx, cy) {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width) return false;
    const toCanvasX = (v) => (v - rect.left) * (GAME_W / rect.width);
    const toCanvasY = (v) => (v - rect.top) * (GAME_H / rect.height);
    // Generous: while playing there is no reason to tap the bottom
    // corners other than aiming for JUMP or THROW.
    const pad = 55;
    for (const id of ["btn-jump", "btn-throw"]) {
      const el = document.getElementById(id);
      if (!el || !el.offsetParent) continue;
      const r = el.getBoundingClientRect();
      if (!r.width) continue;
      if (cx >= toCanvasX(r.left) - pad && cx <= toCanvasX(r.right) + pad &&
          cy >= toCanvasY(r.top) - pad && cy <= toCanvasY(r.bottom) + pad) {
        return true;
      }
    }
    return false;
  }

  buttonAt(cx, cy) {
    for (const b of this.uiButtons) {
      if (cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h) return b.action;
    }
    return null;
  }

  runUiAction(action) {
    if (action === "resume") this.resumeRun();
    else if (action === "exit") this.exitToMenu();
    else if (action === "continue") this.startRun();
    else if (action === "restart") { this.resetProgress(); this.startRun(); }
  }

  // Back to the title screen. The run is over either way, so the banked
  // stages go with it: coming back in should be a clean start.
  exitToMenu() {
    sound.stopMusic();
    this.resetProgress();
    this.carried = 0;
    this.bonus = 0;
    this.state = "ready";
    this.finish = null;
    this.obstacles = [];
    this.acorns = [];
    this.birds = [];
    this.shots = [];
    this.popups = [];
    this.dogDirector.reset();
    this.fox.reset();
    this.levelChoice = Math.min(levelIndex, pickableLevels(this.furthest) - 1);
  }

  // Pause panel over the frozen scene.
  drawPaused() {
    const { ctx } = this;
    ctx.save();
    ctx.fillStyle = "rgba(20, 32, 18, 0.58)";
    ctx.fillRect(0, 0, GAME_W, GAME_H);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const line = (text, font, y, fill) => {
      ctx.font = font;
      ctx.strokeStyle = "rgba(30, 45, 25, 0.92)";
      ctx.lineWidth = 5;
      ctx.strokeText(text, GAME_W / 2, y);
      ctx.fillStyle = fill || "rgba(255, 255, 255, 0.97)";
      ctx.fillText(text, GAME_W / 2, y);
    };
    line("PAUSED", "bold 42px 'Courier New', Courier, monospace", 116);
    ctx.restore();
    this.drawButtonRow(ctx, [
      { label: "KEEP GOING", action: "resume", primary: true },
      { label: "EXIT GAME", action: "exit" },
    ], 172);
  }

  /* Level-complete page: the woodland scene held still with the fox
   * standing proud, and the run's tally on top. Deliberately warm and
   * calm - finishing the level should feel nothing like being caught.
   */
  drawLevelComplete() {
    const { ctx } = this;
    const img = this.images.levelCompleteBg;
    if (img) {
      // Cover-crop the artwork across the canvas.
      const scale = Math.max(GAME_W / img.width, GAME_H / img.height);
      const dw = img.width * scale;
      const dh = img.height * scale;
      ctx.drawImage(img, (GAME_W - dw) / 2, (GAME_H - dh) / 2, dw, dh);
    } else {
      this.drawBackground();
      this.fox.draw(ctx, "ready");
      ctx.fillStyle = "rgba(24, 40, 20, 0.55)";
      ctx.fillRect(0, 0, GAME_W, GAME_H);
    }

    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const line = (text, font, y, fill) => {
      ctx.font = font;
      ctx.strokeStyle = "rgba(30, 45, 25, 0.92)";
      ctx.lineWidth = 5;
      ctx.strokeText(text, GAME_W / 2, y);
      ctx.fillStyle = fill || "rgba(255, 255, 255, 0.97)";
      ctx.fillText(text, GAME_W / 2, y);
    };
    const next = LEVELS[levelIndex + 1];
    line(`${THEME.label.toUpperCase()} COMPLETE!`,
         "bold 40px 'Courier New', Courier, monospace", 46);
    line(next ? `Get ready for the ${THEMES[next.theme].label}` : "You made it home",
         "bold 17px 'Courier New', Courier, monospace", 80);

    // The run's tally, on a panel sized to sit between the sulking dog on
    // the left and the celebrating fox on the right rather than across them.
    roundRectPath(ctx, 258, 104, 384, 58, 10);
    ctx.fillStyle = "rgba(24, 40, 20, 0.62)";
    ctx.fill();
    line(`Acorns collected  ${this.acornsCollected}`,
         "bold 18px 'Courier New', Courier, monospace", 122, "#ffe08a");
    line(`Dogs sent packing  ${this.dogsStopped}`,
         "bold 18px 'Courier New', Courier, monospace", 146, "#ffe08a");

    if (this.blinkTime % 1 < 0.65) {
      line("Press ENTER to continue",
           "bold 18px 'Courier New', Courier, monospace", 268);
    }
    ctx.restore();
  }

  // Game-over page: the smug dog / sheepish fox art as a full-canvas
  // backdrop, with the title, speech lines, final score, and restart
  // prompt drawn on top.
  drawGameOver() {
    const { ctx } = this;
    const img = this.images.gameOverBg;

    // Cover the canvas, bottom-anchored — same treatment as the intro.
    const scale = Math.max(GAME_W / img.width, GAME_H / img.height);
    const dw = img.width * scale;
    const dh = img.height * scale;
    ctx.drawImage(img, (GAME_W - dw) / 2, GAME_H - dh, dw, dh);

    const outlined = (text, x, y, font, lineWidth = 4) => {
      ctx.font = font;
      ctx.lineWidth = lineWidth;
      ctx.strokeText(text, x, y);
      ctx.fillText(text, x, y);
    };

    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
    ctx.strokeStyle = "rgba(40, 55, 30, 0.85)";
    outlined("GAME OVER", GAME_W / 2, 84, "bold 40px 'Courier New', Courier, monospace", 6);

    const pad = (n) => String(n).padStart(5, "0");
    outlined(`SCORE ${pad(this.totalScore)}`, GAME_W / 2, 114,
      "bold 18px 'Courier New', Courier, monospace");
    ctx.restore();

    this.drawScoreTable(ctx, outlined);

    // TESTING ONLY: jump to any setting without replaying the earlier ones.
    if (TEST_LEVELS && !this.nameOpen) this.drawLevelPicker(ctx, 42);

    if (!this.nameOpen) {
      const buttons = [{ label: "CONTINUE", action: "continue", primary: true }];
      // Continuing rejoins at a banked stage; with none there is nothing
      // to continue FROM, so offer the run again instead.
      if (this.checkpoint.stage === 0) buttons[0].label = "PLAY AGAIN";
      else buttons.push({ label: "RESTART", action: "restart" });
      buttons.push({ label: "EXIT", action: "exit" });
      this.drawButtonRow(ctx, buttons, 273);
    }
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

(function showLoading() {
  const ctx = document.getElementById("game").getContext("2d");
  const c = ctx.canvas;
  c.width = GAME_W;
  c.height = GAME_H;
  ctx.fillStyle = "#87b45c";
  ctx.fillRect(0, 0, GAME_W, GAME_H);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 20px 'Courier New', Courier, monospace";
  ctx.textAlign = "center";
  ctx.fillText("LOADING...", GAME_W / 2, GAME_H / 2);
})();

const REPAIR_KEY = "foxRunnerRepaired";

/* If the artwork fails to load, the most likely cause is a stale cached
 * build pointing at asset paths that have since been renamed. Clear the
 * service worker and caches and reload once - otherwise the device stays
 * broken until someone manually clears site data. The flag keeps it to a
 * single attempt so a genuine outage cannot cause a reload loop.
 */
async function repairAndReload(err) {
  console.error(err);
  let alreadyTried = false;
  try {
    alreadyTried = sessionStorage.getItem(REPAIR_KEY) === "1";
    sessionStorage.setItem(REPAIR_KEY, "1");
  } catch (e) {
    /* private mode: fall through and just show the message */
  }
  if (alreadyTried) {
    const ctx = document.getElementById("game").getContext("2d");
    ctx.fillStyle = "#1c2a1e";
    ctx.fillRect(0, 0, GAME_W, GAME_H);
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.font = "bold 20px 'Courier New', Courier, monospace";
    ctx.fillText("Could not load the game", GAME_W / 2, GAME_H / 2 - 14);
    ctx.font = "15px 'Courier New', Courier, monospace";
    ctx.fillText("Check your connection and reload", GAME_W / 2, GAME_H / 2 + 16);
    return;
  }
  try {
    if (navigator.serviceWorker) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
    if (window.caches) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch (e) {
    /* best effort */
  }
  location.reload();
}

loadAssets()
  .then((images) => {
    try {
      sessionStorage.removeItem(REPAIR_KEY); // healthy boot; allow future repairs
    } catch (e) {
      /* ignore */
    }
    // Exposed for debugging/testing only — not part of the game API.
    window.foxRunner = new Game(document.getElementById("game"), images);
  })
  .catch(repairAndReload);
