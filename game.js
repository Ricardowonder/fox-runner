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

const PHYSICS = {
  gravityUp: 2400,     // px/s^2 while rising
  gravityDown: 2800,   // px/s^2 while falling (snappier landing)
  jumpVelocity: -760,  // px/s takeoff
  jumpCutFactor: 0.45, // vy multiplier when Space released mid-rise
};

const SCORE_DISTANCE_DIVISOR = 12; // px of travel per score point

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
 * The eight run frames share ONE union rect so they render at a single
 * common scale — per-frame differences (the gather pose sitting higher,
 * feet lifting) stay inside the box and read as animation, not size jitter.
 * Poses are drawn bottom-RIGHT anchored, so the nose and the hitbox's front
 * edge line up across poses even though their content widths differ.
 */
const FOX_TRIMS = {
  run: { sx: 78, sy: 128, sw: 1380, sh: 780 }, // union of fox_run_01..08
  foxJump: { sx: 65, sy: 24, sw: 1431, sh: 976 },
  foxLand: { sx: 0, sy: 0, sw: 1520, sh: 1000 },
  foxHit: { sx: 0, sy: 4, sw: 1536, sh: 1020 },
  // Throw sequence. hScale draws the rearing poses taller than the run
  // height (the fox stands up to throw); hitbox stays the normal box.
  foxThrow1: { sx: 84, sy: 101, sw: 1321, sh: 765, hScale: 1.0 },
  foxThrow2: { sx: 65, sy: 33, sw: 1431, sh: 991, hScale: 1.26 },
  foxThrow3: { sx: 23, sy: 10, sw: 1477, sh: 1014, hScale: 1.29 },
  foxThrow4: { sx: 49, sy: 9, sw: 1447, sh: 981, hScale: 1.06 },
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
    src: "assets/obstacles/hedgehog.png",
    h: 32, sizeClass: "small", animal: true, pairable: true,
    weight: 3, availableFrom: 0, sink: 3,
    flip: true, // face the approaching fox (hitbox insets already mirrored)
    trim: { sx: 168, sy: 30, sw: 1242, sh: 960 },
    hitbox: { left: 0.10, right: 0.08, top: 0.12, bottom: 0.02 },
  },
  rabbit: {
    src: "assets/obstacles/rabbit.png",
    h: 38, sizeClass: "small", animal: true, pairable: true,
    weight: 2.5, availableFrom: 0, sink: 3,
    flip: true, // face the approaching fox (hitbox insets already mirrored)
    trim: { sx: 192, sy: 6, sw: 1236, sh: 1008 },
    hitbox: { left: 0.10, right: 0.10, top: 0.18, bottom: 0.02 },
  },
  rock: {
    src: "assets/obstacles/rock.png",
    h: 40, sizeClass: "medium", animal: false, pairable: true,
    weight: 2.5, availableFrom: 400, sink: 4,
    trim: { sx: 42, sy: 42, sw: 1452, sh: 912 },
    hitbox: { left: 0.10, right: 0.10, top: 0.12, bottom: 0.02 },
  },
  log: {
    src: "assets/obstacles/log.png",
    h: 34, sizeClass: "medium", animal: false, pairable: true,
    weight: 3, availableFrom: 800, sink: 4,
    trim: { sx: 55, sy: 90, sw: 1670, sh: 693 },
    hitbox: { left: 0.08, right: 0.08, top: 0.15, bottom: 0.02 },
  },
  stump: {
    src: "assets/obstacles/stump.png",
    h: 46, sizeClass: "large", animal: false, pairable: false,
    trim: { sx: 102, sy: 108, sw: 1362, sh: 834 },
    weight: 2, availableFrom: 1200, sink: 5,
    hitbox: { left: 0.12, right: 0.18, top: 0.10, bottom: 0.02 },
  },
};

const TYPE_FADE_IN = 300; // score span over which a newly available type ramps to full weight

/* Difficulty bands. Parameters are interpolated smoothly between anchors by
 * score, so there are no sudden jumps at band edges. Gap values are in
 * SECONDS of travel at current speed, which keeps reaction time meaningful
 * as speed rises. Score accrues at roughly speed/12 per second (~25-50/s),
 * so these anchors correspond to ~0s / ~15s / ~45s / ~85s / ~2min survived.
 */
const DIFFICULTY = {
  maxSpeed: 660,
  bands: [
    // A perceptible step roughly every 500 score: faster, denser, more
    // patterns. Full pressure arrives by ~4000 rather than 8000, so the
    // 2500-4000 stretch keeps ramping instead of plateauing.
    //          px/s   gap between patterns   pattern weights
    { score: 0,    speed: 300, gapMin: 1.05, gapMax: 1.90,
      weights: { single: 1, spacedPair: 0,    closePair: 0,    spacedTriple: 0,    comboTriple: 0 } },
    { score: 500,  speed: 380, gapMin: 0.95, gapMax: 1.60,
      weights: { single: 1, spacedPair: 0.25, closePair: 0,    spacedTriple: 0,    comboTriple: 0 } },
    { score: 1000, speed: 440, gapMin: 0.85, gapMax: 1.40,
      weights: { single: 1, spacedPair: 0.40, closePair: 0.20, spacedTriple: 0,    comboTriple: 0 } },
    { score: 1500, speed: 490, gapMin: 0.76, gapMax: 1.25,
      weights: { single: 1, spacedPair: 0.55, closePair: 0.35, spacedTriple: 0.12, comboTriple: 0 } },
    { score: 2000, speed: 530, gapMin: 0.68, gapMax: 1.10,
      weights: { single: 1, spacedPair: 0.65, closePair: 0.50, spacedTriple: 0.22, comboTriple: 0.12 } },
    { score: 2500, speed: 565, gapMin: 0.62, gapMax: 1.00,
      weights: { single: 1, spacedPair: 0.75, closePair: 0.65, spacedTriple: 0.32, comboTriple: 0.25 } },
    { score: 3000, speed: 595, gapMin: 0.55, gapMax: 0.88,
      weights: { single: 1, spacedPair: 0.85, closePair: 0.80, spacedTriple: 0.42, comboTriple: 0.40 } },
    { score: 4000, speed: 660, gapMin: 0.46, gapMax: 0.74,
      weights: { single: 1, spacedPair: 0.90, closePair: 0.95, spacedTriple: 0.50, comboTriple: 0.60 } },
  ],
};

// Gap (seconds of travel) between obstacles inside spaced sequences —
// enough room to land, re-read, and jump again.
const SEQUENCE_GAP = { min: 0.58, max: 0.78 };
const CLOSE_PAIR_MIN_GAP = 30;      // px of daylight between a close pair
const CLOSE_PAIR_SAFETY = 0.78;     // fraction of theoretical clearance we allow

/* Acorn collectibles. Caught on touch; the per-run count is future
 * ammunition for the chasing-animals phase (throw with the back arrow).
 * Mostly placed high so catching one takes a jump; the odd one sits on
 * the ground. Heights are in px above the running surface and are tuned
 * to the jump arc (apex 120px): highest acorns need a near-full jump.
 */
const ACORN = {
  src: "assets/collectibles/acorn.png",
  trim: { sx: 0, sy: 53, sw: 1236, sh: 1201 },
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
  guidedUntil: 1000,
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
  availableFrom: 500,    // score at which dogs start appearing
  gapMin: 2600,          // px of travel between dog encounters
  gapMax: 4800,
  frames: {
    sleep: "assets/hunting-dog-wake-run-cycle/assets/dog/hunting_dog_01_sleep.png",
    waking: "assets/hunting-dog-wake-run-cycle/assets/dog/hunting_dog_02_waking.png",
    headShake: "assets/hunting-dog-wake-run-cycle/assets/dog/hunting_dog_03_head_shake.png",
    alert: "assets/hunting-dog-wake-run-cycle/assets/dog/hunting_dog_04_alert.png",
    crash: "assets/hunting-dog-wake-run-cycle/assets/dog/hunting_dog_acorn_crash.png",
    bite: "assets/hunting-dog-wake-run-cycle/assets/dog/hunting_dog_run_bite.png",
    // 05..16 run cycle appended at load
  },
  // Per-pose `sink` pushes the sprite down into the grass (art has soft
  // transparent edges at the bottom); default is 3 when unset.
  poses: {
    sleep: { trim: { sx: 15, sy: 34, sw: 1509, sh: 990 }, h: 44, sink: 7 },
    waking: { trim: { sx: 32, sy: 226, sw: 1458, sh: 533 }, h: 34, sink: 5 },
    headShake: { trim: { sx: 0, sy: 30, sw: 1523, sh: 994 }, h: 50 },
    alert: { trim: { sx: 23, sy: 19, sw: 1481, sh: 957 }, h: 48 },
    run: { trim: { sx: 0, sy: 0, sw: 1536, sh: 1024 }, h: 56 },
    crash: { trim: { sx: 0, sy: 19, sw: 1522, sh: 1005 }, h: 54 },
    bite: { trim: { sx: 23, sy: 11, sw: 1499, sh: 1013 }, h: 58 },
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
  packSizes: [
    { score: 0, max: 1 },
    { score: 2000, max: 2 },
    { score: 4000, max: 3 },
  ],
  packStagger: 65, // px: each extra pack member hangs this much further back
  // In pack territory dogs spawn closer together, and each chaser burns
  // slower (creeps rather than pounces) so a second dog has time to join
  // the hunt before the first one bites. It still bites in the end.
  packGapMin: 1500,
  packGapMax: 3000,
  packJoinGraceSeconds: 1.5, // obstacle grace for dogs joining an active chase
  chaseTuning: [
    { score: 0, rubberBandMin: 0.55, stamina: 9 },
    { score: 2000, rubberBandMin: 0.26, stamina: 16 },
  ],
};

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
  src: "assets/obstacles/bluebird.png",
  trim: { sx: 33, sy: 0, sw: 1489, sh: 1024 },
  w: 48, h: 33,
  availableFrom: 1250,   // score at which bluebirds start appearing
  gapMin: 1900,          // px of travel between bird spawns
  gapMax: 3800,
  speedFactor: 1.12,     // flies a little faster than the ground scrolls
  altMin: 88,            // center height above the surface; the minimum
  altMax: 135,           // keeps it clear of a grounded fox (62 tall)
  bobAmp: 7,             // gentle sine bob
  bobRate: 3.5,
  // No obstacle/dog/acorn may sit in this corridor around the spawn point,
  // so a bird never crosses right where a jump is being forced.
  corridorBehind: 250,
  corridorAhead: 160,
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
  const v = -PHYSICS.jumpVelocity;
  return (v * v) / (2 * PHYSICS.gravityUp);
}

// Seconds a full (uncut) jump spends above height y.
function timeAboveHeight(y) {
  const v = -PHYSICS.jumpVelocity;
  const apex = jumpApexHeight();
  if (y >= apex) return 0;
  const riseTotal = v / PHYSICS.gravityUp;
  // Rising: solve v*t - 0.5*gUp*t^2 = y for the earlier root.
  const t1 = (v - Math.sqrt(v * v - 2 * PHYSICS.gravityUp * y)) / PHYSICS.gravityUp;
  const fallAbove = Math.sqrt((2 * (apex - y)) / PHYSICS.gravityDown);
  return (riseTotal - t1) + fallAbove;
}

// Max horizontal span (obstacle widths + gap) a single jump can carry the
// fox's hitbox across, above obstacles of height obstacleH, at given speed.
function maxSingleJumpSpan(speed, obstacleH, foxHitboxW) {
  const clearance = timeAboveHeight(obstacleH + 8); // 8px of headroom
  return speed * clearance * CLOSE_PAIR_SAFETY - foxHitboxW;
}

// ---------------------------------------------------------------------------
// Asset loading & processing
// ---------------------------------------------------------------------------

const IMAGE_SOURCES = {
  sky: "assets/background/bg_sky.png",
  hillsFar: "assets/background/bg_hills_far.png",
  tree1: "assets/background/tree.png",
  tree2: "assets/background/tree-2.png",
  tree3: "assets/background/tree-3.png",
  bushStrip: "assets/background/bg_bushes_near.png",
  bush1: "assets/background/bg_bushes_1.png",
  bush2: "assets/background/bg_bushes_2.png",
  bush3: "assets/background/bg_bushes_3.png",
  groundDirt: "assets/environment/ground_tile_5.png",
  groundGrass: "assets/environment/ground_tile_2.png",
  acorn: "assets/collectibles/acorn.png",
  acornIcon: "assets/ui/acorn_icon.png",
  bluebird: "assets/obstacles/bluebird.png",
  foxRun1: "assets/fox/fox/fox_run_01.png",
  foxRun2: "assets/fox/fox/fox_run_02.png",
  foxRun3: "assets/fox/fox/fox_run_03.png",
  foxRun4: "assets/fox/fox/fox_run_04.png",
  foxRun5: "assets/fox/fox/fox_run_05.png",
  foxRun6: "assets/fox/fox/fox_run_06.png",
  foxRun7: "assets/fox/fox/fox_run_07.png",
  foxRun8: "assets/fox/fox/fox_run_08.png",
  foxRun9: "assets/fox/fox/fox_run_09.png",
  foxRun10: "assets/fox/fox/fox_run_10.png",
  foxRun11: "assets/fox/fox/fox_run_11.png",
  foxRun12: "assets/fox/fox/fox_run_12.png",
  foxJump: "assets/fox/fox_jump.png",
  foxLand: "assets/fox/fox_land.png",
  foxHit: "assets/fox/fox_hit_game_over.png",
  foxThrow1: "assets/fox/fox-acorn-throw-action/assets/fox/fox_throw_acorn_01_glance_back.png",
  foxThrow2: "assets/fox/fox-acorn-throw-action/assets/fox/fox_throw_acorn_02_windup.png",
  foxThrow3: "assets/fox/fox-acorn-throw-action/assets/fox/fox_throw_acorn_03_release.png",
  foxThrow4: "assets/fox/fox-acorn-throw-action/assets/fox/fox_throw_acorn_04_recover.png",
  introBg: "assets/fox-runner-loading-page/fox_runner_loading_art_wide_clean.png",
  gameOverBg: "assets/fox-runner-game-over-page-wide 2/fox_runner_game_over_art_wide_clean.png",
};

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load " + src));
    img.src = src;
  });
}

function loadAssets() {
  const images = {};
  const jobs = [];
  for (const [key, src] of Object.entries(IMAGE_SOURCES)) {
    jobs.push(loadImage(src).then((img) => (images[key] = img)));
  }
  images.dog = {};
  for (const [key, src] of Object.entries(DOG.frames)) {
    jobs.push(loadImage(src).then((img) => (images.dog[key] = img)));
  }
  images.dogRun = [];
  for (let i = 5; i <= 16; i++) {
    const src = `assets/hunting-dog-wake-run-cycle/assets/dog/hunting_dog_${String(i).padStart(2, "0")}_run.png`;
    const slot = i - 5;
    jobs.push(loadImage(src).then((img) => (images.dogRun[slot] = img)));
  }
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
  return Promise.all(jobs).then(() => images);
}

// ---------------------------------------------------------------------------
// High score (session-scoped)
// ---------------------------------------------------------------------------

function readHiScore() {
  try {
    return Number(sessionStorage.getItem(HISCORE_KEY)) || 0;
  } catch (e) {
    return 0;
  }
}

function writeHiScore(score) {
  try {
    sessionStorage.setItem(HISCORE_KEY, String(score));
  } catch (e) {
    /* sessionStorage unavailable — in-memory value still works */
  }
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

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
    this.throwTime = null; // non-null while the throw animation plays
  }

  startThrow() {
    this.throwTime = 0;
  }

  jump() {
    if (this.onGround && !this.dead) {
      this.vy = PHYSICS.jumpVelocity;
      this.onGround = false;
    }
  }

  cutJump() {
    if (!this.onGround && this.vy < 0) {
      this.vy *= PHYSICS.jumpCutFactor;
    }
  }

  update(dt, speed) {
    if (!this.onGround) {
      const g = this.vy < 0 ? PHYSICS.gravityUp : PHYSICS.gravityDown;
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

class Obstacle {
  constructor(typeName, x, groundY) {
    this.typeName = typeName;
    this.type = OBSTACLE_TYPES[typeName];
    this.w = this.type.w;
    this.h = this.type.h;
    this.x = x;
    this.y = groundY - this.h + (this.type.sink || 0);
    this.passed = false; // hook for later phases (chasing behaviour, etc.)
  }

  update(dt, speed) {
    this.x -= speed * dt;
  }

  isOffscreen() {
    return this.x + this.w < -20;
  }

  getHitbox() {
    return shrinkBox(this.x, this.y, this.w, this.h, this.type.hitbox);
  }

  draw(ctx) {
    const t = this.type.trim;
    if (this.type.flip) {
      ctx.save();
      ctx.translate(this.x + this.w, this.y);
      ctx.scale(-1, 1);
      ctx.drawImage(this.type.image, t.sx, t.sy, t.sw, t.sh, 0, 0, this.w, this.h);
      ctx.restore();
    } else {
      ctx.drawImage(
        this.type.image,
        t.sx, t.sy, t.sw, t.sh,
        this.x, this.y, this.w, this.h
      );
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
    this.distanceUntilNext = DOG.gapMin;
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

    if (score < DOG.availableFrom) return;
    if (this.dogs.length >= this.maxConcurrent(score)) return;
    // Only one dog may be in its sleeping/waking phase at a time.
    if (this.dogs.some((d) => d.state !== "chasing" && d.state !== "tiring" && d.state !== "stunned")) {
      return;
    }
    this.distanceUntilNext -= speed * dt;
    if (this.distanceUntilNext > 0) return;

    // Need clear ground: no obstacle within jumping distance either side
    // of the sleeping dog's spawn point. (Tighter windows than this never
    // open at high difficulty — patterns are too dense.)
    if (obstacles.some((o) => o.x + o.w > GAME_W - 260) || spawner.distanceUntilNext < 220) {
      this.distanceUntilNext = 140; // try again shortly
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
    const gapMin = this.maxConcurrent(score) > 1 ? DOG.packGapMin : DOG.gapMin;
    const gapMax = this.maxConcurrent(score) > 1 ? DOG.packGapMax : DOG.gapMax;
    this.distanceUntilNext = gapMin + Math.random() * (gapMax - gapMin);
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
  constructor(x, centerY, image) {
    this.image = image;
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
    // Flip to fly leftward, with a slight wing-beat tilt.
    ctx.save();
    ctx.translate(this.x + this.w / 2, this.y + this.h / 2);
    ctx.scale(-1, 1);
    ctx.rotate(Math.sin(this.age * 9) * 0.05);
    ctx.drawImage(this.image, t.sx, t.sy, t.sw, t.sh, -this.w / 2, -this.h / 2, this.w, this.h);
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

  update(dt, speed, score, birds, obstacles, dogs, acorns, image) {
    if (score < BIRD.availableFrom) return;
    this.distanceUntilNext -= speed * dt;
    if (this.distanceUntilNext > 0) return;

    const spawnX = GAME_W + 40;
    const inCorridor = (x, w) =>
      x + w > spawnX - BIRD.corridorBehind && x < spawnX + BIRD.corridorAhead;
    if (
      obstacles.some((o) => inCorridor(o.x, o.w)) ||
      dogs.some((d) => d.state === "sleeping" && inCorridor(d.x, d.w)) ||
      acorns.some((a) => inCorridor(a.x, a.w))
    ) {
      this.distanceUntilNext = 130; // try again shortly
      return;
    }
    const centerY = this.groundY - (BIRD.altMin + Math.random() * (BIRD.altMax - BIRD.altMin));
    birds.push(new Bird(spawnX, centerY, image));
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
        const tallest = Math.max(a.h, b.h);
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
    this.score = 0;
    this.hiScore = readHiScore();
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
  }

  bindInput() {
    document.addEventListener("keydown", (e) => {
      if (e.code === "Enter" || e.code === "NumpadEnter") {
        e.preventDefault();
        if (this.state === "ready" || this.state === "gameover") this.startRun();
      } else if (e.code === "Space") {
        e.preventDefault();
        if (this.state === "running" && !e.repeat) this.fox.jump();
      } else if (e.code === "ArrowLeft") {
        e.preventDefault();
        if (this.state === "running" && !e.repeat) this.throwAcorn();
      }
    });
    document.addEventListener("keyup", (e) => {
      if (e.code === "Space" && this.state === "running") this.fox.cutJump();
    });

    this.bindTouchButtons();
  }

  // On-screen thumb buttons (left = jump, right = throw), shared by touch
  // and mouse. While the game isn't running, either button starts a run,
  // with a short grace period after death so mashing jump at the moment
  // of a crash doesn't instantly restart.
  bindTouchButtons() {
    const jumpBtn = document.getElementById("btn-jump");
    const throwBtn = document.getElementById("btn-throw");
    if (!jumpBtn || !throwBtn) return;

    // preventDefault on pointerdown also stops the buttons from taking
    // focus, which would otherwise make Space "click" them.
    const press = (action) => (e) => {
      e.preventDefault();
      if (this.state === "running") action();
      else this.tryStartFromButton();
    };
    jumpBtn.addEventListener("pointerdown", press(() => this.fox.jump()));
    throwBtn.addEventListener("pointerdown", press(() => this.throwAcorn()));

    // Releasing the jump button cuts the jump short, like releasing Space.
    const release = (e) => {
      e.preventDefault();
      if (this.state === "running") this.fox.cutJump();
    };
    jumpBtn.addEventListener("pointerup", release);
    jumpBtn.addEventListener("pointercancel", release);

    for (const btn of [jumpBtn, throwBtn]) {
      btn.addEventListener("contextmenu", (e) => e.preventDefault());
    }

    // Tapping the play field itself also starts/restarts.
    this.canvas.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      if (this.state !== "running") this.tryStartFromButton();
    });
  }

  tryStartFromButton() {
    if (this.state === "ready") this.startRun();
    else if (this.state === "gameover" && performance.now() - this.gameOverAt > 600) this.startRun();
  }

  startRun() {
    this.state = "running";
    this.obstacles = [];
    this.acorns = [];
    this.acornCount = 0;
    this.shots = [];
    this.throwCooldown = 0;
    this.pendingRelease = null;
    this.distance = 0;
    this.score = 0;
    this.speed = DIFFICULTY.bands[0].speed;
    this.fox.reset();
    this.spawner.reset();
    this.acornSpawner.reset();
    this.dogDirector.reset();
    this.birdSpawner.reset();
    this.birds = [];
  }

  throwAcorn() {
    if (this.acornCount <= 0 || this.throwCooldown > 0) return;
    this.acornCount--;
    this.throwCooldown = THROW.cooldown;
    this.fox.startThrow();
    // The projectile leaves on the release frame, not at the key press.
    this.pendingRelease = THROW_ANIM.releaseAt;
  }

  endRun() {
    this.state = "gameover";
    this.gameOverAt = performance.now();
    this.fox.dead = true;
    if (this.score > this.hiScore) {
      this.hiScore = this.score;
      writeHiScore(this.hiScore);
    }
  }

  frame(time) {
    const dt = Math.min((time - this.lastTime) / 1000, 0.05); // clamp tab-switch spikes
    this.lastTime = time;
    this.blinkTime += dt;

    if (this.state === "running") this.update(dt);
    this.draw();

    requestAnimationFrame((t) => this.frame(t));
  }

  update(dt) {
    this.speed = difficultyAt(this.score).speed;
    this.distance += this.speed * dt;
    this.scroll += this.speed * dt;
    this.score = Math.floor(this.distance / SCORE_DISTANCE_DIVISOR);

    this.fox.update(dt, this.speed);
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

    for (const ob of this.obstacles) ob.update(dt, this.speed);
    this.obstacles = this.obstacles.filter((ob) => !ob.isOffscreen());
    for (const ac of this.acorns) ac.update(dt, this.speed);
    this.acorns = this.acorns.filter((ac) => !ac.isOffscreen() && !ac.collected);
    for (const shot of this.shots) shot.update(dt, this.groundY);
    this.shots = this.shots.filter((s) => !s.dead);
    this.birdSpawner.update(
      dt, this.speed, this.score, this.birds,
      this.obstacles, this.dogDirector.dogs, this.acorns, this.images.bluebird
    );
    for (const b of this.birds) b.update(dt, this.speed);
    this.birds = this.birds.filter((b) => !b.isOffscreen());

    // Thrown acorns vs the dogs — one acorn takes out one dog.
    for (const shot of this.shots) {
      for (const d of this.dogDirector.dogs) {
        if (d.state !== "stunned" && intersects(shot.getBox(), d.getShotBox())) {
          shot.dead = true;
          d.stun();
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
    const scale = drawH / sh;
    const drawW = img.width * scale;
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
        ctx.drawImage(img, 0, sy, img.width, sh, -0.5, 0, drawW + 1, drawH);
        ctx.restore();
      } else {
        ctx.drawImage(img, 0, sy, img.width, sh, x - 0.5, bottomY - drawH, drawW + 1, drawH);
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
    for (const band of BG_BANDS) {
      this.drawTiledLayer(images[band.img], band.h, bandBottom, this.scroll * band.parallax, true);
    }

    this.drawDecorStrips();

    // Merged ground, drawn back to front: dark soil fill, then the dirt
    // cross-section from ground_tile, then ground_tile_2's grass strip whose
    // drippy underside hangs over the dirt. All scroll at full game speed
    // with mirrored tiling (neither tile is seamless).
    const grassTop = this.groundY - GROUND.grass.drawH * GROUND.grass.surfaceFrac;
    const grassBottom = grassTop + GROUND.grass.drawH;
    const dirtTop = grassBottom - GROUND.dirt.overlap;
    ctx.fillStyle = GROUND.underfill;
    ctx.fillRect(0, dirtTop + 6, GAME_W, GAME_H - dirtTop - 6);
    this.drawTiledLayer(images.groundDirt, GROUND.dirt.drawH, dirtTop + GROUND.dirt.drawH,
      this.scroll, true, GROUND.dirt);
    this.drawTiledLayer(images.groundGrass, GROUND.grass.drawH, grassBottom,
      this.scroll, true, GROUND.grass);
  }

  drawHud() {
    const { ctx } = this;
    ctx.save();
    ctx.font = "bold 17px 'Courier New', Courier, monospace";
    ctx.textBaseline = "top";
    ctx.fillStyle = "#2e4222";
    ctx.textAlign = "right";

    const pad = (n) => String(n).padStart(5, "0");
    const scoreText = `SCORE ${pad(this.score)}`;
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
    ctx.beginPath();
    ctx.roundRect(x, y, keyW, keyH, 5);
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
    ctx.beginPath();
    ctx.roundRect(px, py, panelW, panelH, 10);
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

    if (this.blinkTime % 1 < 0.65) {
      ctx.save();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = "bold 19px 'Courier New', Courier, monospace";
      ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
      ctx.strokeStyle = "rgba(40, 55, 30, 0.85)";
      ctx.lineWidth = 4;
      ctx.strokeText("Press ENTER or tap to start", GAME_W / 2, 281);
      ctx.fillText("Press ENTER or tap to start", GAME_W / 2, 281);
      ctx.restore();
    }
  }

  draw() {
    const { ctx } = this;
    ctx.clearRect(0, 0, GAME_W, GAME_H);

    if (this.state === "ready") {
      this.drawIntro();
      return;
    }

    // Game over: hold the caught moment for a beat, then cut to the
    // dedicated game-over page.
    if (this.state === "gameover" && performance.now() - this.gameOverAt > 800) {
      this.drawGameOver();
      return;
    }

    this.drawBackground();
    for (const ob of this.obstacles) ob.draw(ctx);
    for (const ac of this.acorns) ac.draw(ctx);
    for (const d of this.dogDirector.dogs) d.draw(ctx);
    for (const b of this.birds) b.draw(ctx);
    this.fox.draw(ctx, this.state);
    for (const shot of this.shots) shot.draw(ctx);
    if (this.debugHitboxes) this.drawHitboxes();
    this.drawHud();
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
    outlined("GAME OVER", GAME_W / 2, 108, "bold 44px 'Courier New', Courier, monospace", 6);

    const pad = (n) => String(n).padStart(5, "0");
    outlined(`SCORE ${pad(this.score)}   HI ${pad(this.hiScore)}`, GAME_W / 2, 150,
      "bold 18px 'Courier New', Courier, monospace");

    if (this.blinkTime % 1 < 0.65) {
      outlined("Press ENTER or tap to restart", GAME_W / 2, 281,
        "bold 19px 'Courier New', Courier, monospace");
    }
    ctx.restore();
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

loadAssets()
  .then((images) => {
    // Exposed for debugging/testing only — not part of the game API.
    window.foxRunner = new Game(document.getElementById("game"), images);
  })
  .catch((err) => {
    console.error(err);
    const ctx = document.getElementById("game").getContext("2d");
    ctx.font = "16px monospace";
    ctx.fillStyle = "#000";
    ctx.fillText("Failed to load game assets: " + err.message, 20, 40);
  });
