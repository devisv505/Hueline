// Screens, the build bar, the goal board and the frame loop that ties the factory together.
import { COLORS, TUNE, GOALS, BUILDS, MACHINES, FACTORY_NAMES, itemName, colorOf, sizeOf, buildParts, buildKey } from './config.js?v=6';
import { World, KIND, seedWorld, saveWorld, loadWorld, canPlaceAt, canManage, inboundBelts, createDraft, draftTo, commitDraft, draftCost } from './world.js?v=6';
import { Sim } from './sim.js?v=6';
import { Renderer } from './render.js?v=6';
import { Controls } from './input.js?v=6';
import { unlockAudio, setSoundEnabled, sfx } from './audio.js?v=6';
import { burst, ring, floater, toast, confetti, pop } from './fx.js?v=6';

const $ = (id) => document.getElementById(id);
const SAVE_KEY = 'hueline.v1'; // settings
const OLD_SAVE_KEY = 'minifactory.v1'; // the prototype's name before Hueline
const FLOOR_KEY = 'hueline.floor.v1'; // the factory itself
const SPEEDS = [0, 1, 2];
const SPEED_ICONS = ['#i-pause', '#i-play', '#i-fast'];

const save = readSave();
let world;
let sim;
let renderer;
let controls;
let speedStep = 1;
let running = false;
let coachStep = -1;

function readSave() {
  try {
    const stored = localStorage.getItem(SAVE_KEY) ?? localStorage.getItem(OLD_SAVE_KEY);
    return { sound: true, ...JSON.parse(stored || '{}') };
  } catch {
    return { sound: true };
  }
}

function writeSave() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(save));
  } catch {
    // Private mode: the settings simply are not remembered.
  }
}

// ---- the floor between sessions ----

function readFloor() {
  try {
    return loadWorld(JSON.parse(localStorage.getItem(FLOOR_KEY) || 'null'));
  } catch {
    return null; // a save this build cannot read is not worth crashing over
  }
}

// Changes mark the floor dirty; the frame loop writes it at most every couple
// of seconds, and leaving the page writes it straight away.
let floorDirty = false;
let floorWritten = 0;
const touchFloor = () => (floorDirty = true);

function writeFloor() {
  if (!floorDirty || !world) return;
  floorDirty = false;
  floorWritten = performance.now();
  try {
    localStorage.setItem(FLOOR_KEY, JSON.stringify(saveWorld(world)));
  } catch {
    // Private mode: the floor lasts as long as the tab.
  }
}

function forgetFloor() {
  try {
    localStorage.removeItem(FLOOR_KEY);
  } catch {
    // Nothing was stored to begin with.
  }
}

// ---- hooks the simulation calls back into ----

const at = (b) => renderer.toClient(b.x + 0.5, b.y + 0.5);
const hub = () => world.buildings.find((b) => b.kind === KIND.HUB);
const fillOf = (key) => COLORS[colorOf(key)].fill;
const beadHtml = (key) => `<i class="bead" data-size="${sizeOf(key)}" style="--bead:${fillOf(key)}"></i>`;
let rejectNoted = -1; // the goal the "only counts" toast was last shown for

const hooks = {
  onDeliver(b, key) {
    const p = at(b);
    burst(p.x, p.y, colorOf(key), 8);
    if (sim.goal) floater(p.x, p.y - 10, `${world.goal.got}/${sim.goal.count}`, COLORS[colorOf(key)].deep);
    sfx.deliver();
    showGoal();
    touchFloor();
    advanceCoach();
  },
  onReject(b, key) {
    // Off to one side, clear of the count that rises off a delivery.
    const p = at(b);
    floater(p.x + 26, p.y + 4, '×', '#7d8699');
    if (rejectNoted === world.goal.index) return;
    rejectNoted = world.goal.index;
    toast(`The hub only counts ${itemName(sim.goal.item, 2)} — ${itemName(key, 2)} are scrapped`, { color: '#7d8699', icon: '#i-hub' });
  },
  onGoal(done, next) {
    const p = at(hub());
    ring(p.x, p.y, colorOf(done.item));
    burst(p.x, p.y, colorOf(done.item), 18);
    sfx.reward();
    confetti(60);
    showStock();
    showGoal();
    touchFloor();
    writeFloor();
    showGoalDone(done, next);
  },
  onCraft(b, key) {
    const p = at(b);
    ring(p.x, p.y, colorOf(key));
    sfx.craft();
  },
  onJam(b) {
    sfx.alarm();
    toast(`A ${b.kind} is stuck — tap it to dump its buffer`, { color: '#ec5a5a', icon: '#i-alarm' });
  },
  onVent(b, dumped) {
    const p = at(b);
    toast(`Buffer dumped — ${dumped} item${dumped === 1 ? '' : 's'} scrapped`, { color: '#7d8699', icon: '#i-vent' });
    burst(p.x, p.y, 'slate', dumped + 4);
    sfx.erase();
  },
};

// ---- boot and restart ----

// Cut the floor to the shape of the screen, so a phone gets a tall factory and
// a desktop a wide one, both at about the same number of cells. A saved floor
// keeps the shape it was made with.
function floorShape() {
  const rect = $('stage').getBoundingClientRect();
  if (!rect.width || !rect.height) return TUNE;
  const aspect = Math.min(2.4, Math.max(0.42, rect.width / rect.height));
  const rows = Math.round(Math.min(23, Math.max(10, Math.sqrt(TUNE.cells / aspect))));
  const cols = Math.round(Math.min(26, Math.max(10, rows * aspect)));
  return { cols, rows };
}

// Opens the saved floor unless `fresh`, and says whether it did.
function boot(fresh = false) {
  const saved = fresh ? null : readFloor();
  world = saved ?? seedWorld(new World((Math.random() * 1e9) | 0, floorShape()));
  sim = new Sim(world, hooks);
  $('factory-name').textContent = FACTORY_NAMES[world.seed % FACTORY_NAMES.length];
  if (!renderer) {
    renderer = new Renderer($('scene'), world);
    controls = new Controls($('scene'), world, renderer, controlHooks);
  } else {
    renderer.setWorld(world);
    controls.setWorld(world);
  }
  controls.locked = false;
  stopPlacing();
  coachStep = -1;
  rejectNoted = -1;
  speedStep = 1;
  showSpeed();
  showStock();
  showGoal();
  advanceCoach();
  touchFloor();
  writeFloor();
  return Boolean(saved);
}

const controlHooks = {
  onBuild(belt, cost) {
    showStock();
    const p = renderer.toClient(belt.pts.at(-1).x, belt.pts.at(-1).y);
    burst(p.x, p.y, 'slate', 5);
    if (cost.bridges) {
      const n = cost.bridges;
      toast(`${n} bridge${n > 1 ? 's' : ''} built — ${n * TUNE.bridgeTiles} extra tiles`, { color: '#3f4654', icon: '#i-bridge' });
    }
    touchFloor();
    advanceCoach();
  },
  onCancel() {
    showStock();
  },
  onBlocked(why) {
    showCoach(why, 1400);
  },
  onDraft() {
    showStock();
  },
  onPlace: (cell) => placeAt(cell),
  onHold: (building) => pickUp(building),
  onTap(target) {
    if (target.kind) return tapBuilding(target);
    // Pulling a belt up refunds its tiles and bridges.
    const p = renderer.toClient(target.pts[(target.pts.length / 2) | 0].x, target.pts[(target.pts.length / 2) | 0].y);
    world.removeBelt(target);
    burst(p.x, p.y, 'slate', 7);
    sfx.erase();
    showStock();
    touchFloor();
    advanceCoach();
  },
};

function tapBuilding(b) {
  if (b.jam > 0 && sim.vent(b)) return;
  sfx.click();
  const holding = b.buffer.map((key) => itemName(key)).join(', ');
  if (b.kind === KIND.HUB) {
    const goal = sim.goal;
    toast(goal ? goal.hint : 'Every goal is done — the hub takes anything now', { color: goal ? fillOf(goal.item) : '#3f4654', icon: '#i-hub' });
  } else if (b.kind === KIND.MIXER) {
    toast(holding ? `Mixer holding ${holding}` : 'Mixer is empty — feed it two different colours', { color: '#3f4654', icon: '#i-mixer' });
  } else if (b.kind === KIND.PRESS) {
    toast(holding ? `Press holding ${holding}` : 'Press is empty — feed it two matching items', { color: '#3f4654', icon: '#i-press' });
  } else if (b.kind === KIND.SPLITTER) {
    toast('Splitter — it feeds its outgoing belts in turn', { color: '#3f4654', icon: '#i-splitter' });
  } else {
    toast(`${COLORS[b.color].name} ore, one bead every ${TUNE.oreInterval}s`, { color: COLORS[b.color].fill, icon: '#i-ore' });
  }
}

// ---- heads-up display ----

function showStock() {
  const draft = controls?.draft;
  const belts = world.stock.belts - (draft ? draftCost(draft).belts : 0);
  $('belt-count').textContent = belts;
  $('pill-belts').classList.toggle('low', belts <= 6);
  renderDock();
}

// The board under the floor: what the hub wants, how many have arrived, and a
// bar along the rule that fills in the item's colour.
function showGoal() {
  const goal = sim.goal;
  const bead = $('goal-bead');
  const bar = $('goal-fill');
  if (!goal) {
    bead.dataset.size = 1;
    bead.style.setProperty('--bead', '#60bd81');
    $('goal-count').textContent = '✓';
    $('goal-name').textContent = 'Every goal done';
    $('goal-step').textContent = 'The hub takes anything now';
    bar.style.background = '#60bd81';
    bar.style.transform = 'scaleX(1)';
    return;
  }
  bead.dataset.size = sizeOf(goal.item);
  bead.style.setProperty('--bead', fillOf(goal.item));
  $('goal-count').textContent = `${world.goal.got} / ${goal.count}`;
  $('goal-name').textContent = itemName(goal.item, goal.count);
  $('goal-step').textContent = `Goal ${world.goal.index + 1} of ${GOALS.length}`;
  bar.style.background = fillOf(goal.item);
  bar.style.transform = `scaleX(${(world.goal.got / goal.count).toFixed(3)})`;
}

function showSpeed() {
  $('speed-icon').setAttribute('href', SPEED_ICONS[speedStep]);
}

let coachTimer = 0;
function showCoach(text, ms = 0) {
  const el = $('coach');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(coachTimer);
  if (ms) coachTimer = setTimeout(() => (el.hidden = true), ms);
}

// Only the very first goal is coached on the floor; after that each goal card
// says what is new.
function advanceCoach() {
  if (coachStep === 99) return;
  let step = 0;
  if (world.goal.index > 0 || sim.delivered > 0) step = 99;
  else if (inboundBelts(world, hub()).length) step = 1;
  if (step === coachStep) return;
  coachStep = step;
  if (step === 99) return void ($('coach').hidden = true);
  const lines = ['Drag from the Cobalt deposit to the hub to lay a belt', 'Cobalt beads ride the belt into the hub'];
  showCoach(lines[step], step === 1 ? 3500 : 0);
}

// ---- the build bar, and putting machines down ----

const machineName = ({ kind, color }) => (kind === KIND.DEPOSIT ? `${COLORS[color].name} deposit` : kind);
const machineInfo = (kind) => MACHINES[kind === KIND.DEPOSIT ? 'ore' : kind];

// One button per building unlocked so far, in a fixed order so a machine is
// always where you last saw it. The buttons are only rebuilt when that set
// changes, so a newly unlocked one can pop in on its own.
let dockKeys = '';
function renderDock() {
  const keys = BUILDS.filter((key) => world.unlocked.includes(key));
  if (keys.join() !== dockKeys) {
    const before = dockKeys ? dockKeys.split(',') : null;
    dockKeys = keys.join();
    $('dock').replaceChildren(...keys.map((key, i) => dockButton(key, i, Boolean(before) && !before.includes(key))));
  }
  const armed = placing && !placing.moving ? buildKey(placing.kind, placing.color) : null;
  for (const btn of $('dock').children) {
    btn.classList.toggle('on', btn.dataset.key === armed);
    btn.classList.toggle('fresh', world.fresh.includes(btn.dataset.key));
  }
}

function dockButton(key, i, arriving) {
  const { kind, color } = buildParts(key);
  const info = machineInfo(kind);
  const btn = document.createElement('button');
  btn.className = `dock-btn${arriving ? ' arrive' : ''}`;
  btn.dataset.key = key;
  btn.title = `${color ? machineName({ kind, color }) : info.label} (${i + 1}) — ${info.note}`;
  btn.setAttribute('aria-label', `Build a ${machineName({ kind, color })}`);
  if (color) btn.style.setProperty('--tint', COLORS[color].fill);
  btn.innerHTML = `<svg class="icon"><use href="${info.icon}"></use></svg><small>${i + 1}</small><i class="dot"></i>`;
  btn.addEventListener('click', () => pickTool(key));
  return btn;
}

// Picking a building arms it for one drop on the floor; picking it again
// changes your mind. Picking it is also what clears its New dot.
function pickTool(key) {
  sfx.click();
  if (placing && !placing.moving && buildKey(placing.kind, placing.color) === key) {
    stopPlacing();
    return;
  }
  if (world.fresh.includes(key)) {
    world.fresh = world.fresh.filter((k) => k !== key);
    touchFloor();
  }
  startPlacing(buildParts(key));
}

let placing = null;

function startPlacing(what) {
  placing = { kind: what.kind, color: what.color ?? null };
  controls.setPlacing(placing);
  $('placing-text').textContent = `Tap an empty spot for your ${machineName(placing)}`;
  $('btn-scrap').hidden = true;
  $('placing-bar').hidden = false;
  $('coach').hidden = true;
  renderDock();
  resume();
}

// Held long enough: the machine comes up in hand, to drop somewhere else or remove.
function pickUp(building) {
  if (!canManage(building) || placing) return;
  placing = { kind: building.kind, color: building.color ?? null, moving: building };
  controls.setPlacing(placing);
  $('placing-text').textContent = `Moving the ${machineName(placing)} — tap a new spot`;
  $('btn-scrap').hidden = false;
  $('placing-bar').hidden = false;
  $('coach').hidden = true;
  renderDock();
  sfx.grab();
  resume();
}

function stopPlacing() {
  placing = null;
  controls.setPlacing(null);
  $('placing-bar').hidden = true;
  $('btn-scrap').hidden = true;
  renderDock();
}

// Removing a machine pulls up its belts and hands their tiles back; it can be
// built again whenever you like.
function removeHeld() {
  const victim = placing?.moving;
  if (!victim) return;
  const p = at(victim);
  world.removeBuilding(victim);
  burst(p.x, p.y, victim.color ?? 'slate', 10);
  sfx.erase();
  stopPlacing();
  showStock();
  touchFloor();
  advanceCoach();
}

function placeAt(cell) {
  if (!placing) return;
  if (!canPlaceAt(world, cell.x, cell.y, placing.moving ?? null)) {
    sfx.nope();
    showCoach('Not enough room there — machines need a cell of air', 1600);
    return;
  }
  if (!placing.moving && !world.unlocked.includes(buildKey(placing.kind, placing.color))) {
    sfx.nope();
    stopPlacing();
    return;
  }
  // Moving one takes its belts with it: they would run to the wrong place now.
  if (placing.moving) world.removeBuilding(placing.moving);
  const b = world.addBuilding(placing.kind, cell.x, cell.y, placing.color ? { color: placing.color } : {});
  b.born = sim.time;
  const p = at(b);
  ring(p.x, p.y, placing.color ?? 'slate');
  burst(p.x, p.y, placing.color ?? 'slate', 8);
  sfx.lay();
  stopPlacing();
  showStock();
  touchFloor();
  advanceCoach();
}

// ---- a goal finished ----

function giftHtml(icon, text, color) {
  return `<span class="gift"><svg class="icon"${color ? ` style="color:${color}"` : ''}><use href="${icon}"></use></svg>${text}</span>`;
}

function giftsHtml(gives) {
  const unlocked = gives.unlocks.map((key) => {
    const parts = buildParts(key);
    const name = parts.color ? machineName(parts) : machineInfo(parts.kind).label;
    return giftHtml(machineInfo(parts.kind).icon, `${name} unlocked`, parts.color && COLORS[parts.color].fill);
  });
  return [...unlocked, giftHtml('#i-belt', `+${gives.belts} belt tiles`)].join('');
}

let doneAction = null; // the machine the card's button puts straight down
function showGoalDone(done, next) {
  $('done-kicker').textContent = `Goal ${GOALS.indexOf(done) + 1} of ${GOALS.length} complete`;
  $('done-title').textContent = `${done.count} ${itemName(done.item, done.count)} delivered`;
  $('done-gifts').innerHTML = giftsHtml(done.gives);
  $('done-next').innerHTML = next
    ? `<p class="next-label">Next goal</p><p class="next-goal">${beadHtml(next.item)}<b>${next.count} ${itemName(next.item, next.count)}</b></p><p class="next-hint">${next.hint}</p>`
    : '<p class="next-label">That is every goal for now</p><p class="next-hint">The hub takes anything from here on. Keep building.</p>';
  doneAction = done.gives.unlocks.length ? buildParts(done.gives.unlocks[0]) : null;
  $('done-action').textContent = doneAction ? `Build a ${machineName(doneAction)}` : 'Keep building';
  // Let the confetti land before the card covers the floor.
  setTimeout(() => {
    pause();
    openPopup('goal-done');
  }, 700);
}

// ---- popups ----

function openPopup(id) {
  const el = $(id);
  el.classList.remove('closing');
  el.hidden = false;
}

function closePopup(id) {
  const el = $(id);
  if (el.hidden) return Promise.resolve();
  el.classList.add('closing');
  return new Promise((done) =>
    setTimeout(() => {
      el.hidden = true;
      el.classList.remove('closing');
      done();
    }, 200)
  );
}

document.querySelectorAll('[data-close]').forEach((btn) =>
  btn.addEventListener('click', () => {
    sfx.click();
    closePopup(btn.closest('.overlay').id).then(resume);
  })
);

function pause() {
  running = false;
}

function resume() {
  running = true;
}

// ---- recipe reference in the help card ----

function fillRecipes() {
  const chip = (color) => `<span class="chip" style="background:${COLORS[color].fill}"></span>`;
  const compounds = Object.keys(COLORS).filter((c) => COLORS[c].parts.length > 1);
  const mixes = compounds.map((c) => {
    const parts = COLORS[c].parts;
    // Show the three-part colour as a real pair, e.g. Ruby + Fern, not "any mix".
    const rest = parts.slice(1);
    const left =
      parts.length === 3
        ? [parts[0], compounds.find((k) => COLORS[k].parts.length === 2 && COLORS[k].parts.every((p) => rest.includes(p)))]
        : parts;
    return `<div class="recipe">${left.map(chip).join('<b>+</b>')}<b>→</b>${chip(c)}${COLORS[c].name}</div>`;
  });
  const press = `<div class="recipe">${chip('yellow')}<b>+</b>${chip('yellow')}<b>→</b>${beadHtml('yellow:2')}Amber pearl</div>`;
  $('recipe-grid').innerHTML = [...mixes, press].join('');
}

// ---- buttons and keys ----

$('btn-play').addEventListener('click', () => {
  unlockAudio();
  sfx.click();
  closePopup('title').then(resume);
});

$('btn-how').addEventListener('click', () => {
  sfx.click();
  openPopup('help');
});

$('btn-help').addEventListener('click', () => {
  sfx.click();
  pause();
  openPopup('help');
});


$('btn-done').addEventListener('click', () => {
  sfx.click();
  const action = doneAction;
  closePopup('goal-done').then(() => {
    if (action) {
      // Going straight from the card to the floor counts as having seen it.
      world.fresh = world.fresh.filter((key) => key !== buildKey(action.kind, action.color));
      showStock();
      startPlacing(action);
    } else {
      resume();
    }
  });
});

$('btn-cancel-place').addEventListener('click', () => {
  sfx.click();
  stopPlacing();
});

$('btn-scrap').addEventListener('click', () => {
  sfx.click();
  removeHeld();
});

// Wiping the floor takes two taps, so a stray one never costs a factory.
let resetArmed = 0;
$('btn-reset').addEventListener('click', () => {
  sfx.click();
  const btn = $('btn-reset');
  const disarm = () => {
    clearTimeout(resetArmed);
    resetArmed = 0;
    btn.textContent = 'Start a new factory';
    btn.classList.remove('danger');
  };
  if (!resetArmed) {
    btn.textContent = 'Tap again to clear this floor';
    btn.classList.add('danger');
    resetArmed = setTimeout(disarm, 3000);
    return;
  }
  disarm();
  forgetFloor();
  boot(true);
  closePopup('help').then(resume);
});

$('btn-speed').addEventListener('click', () => {
  speedStep = (speedStep + 1) % SPEEDS.length;
  showSpeed();
  pop($('btn-speed'));
  sfx.click();
});

$('btn-sound').addEventListener('click', () => {
  save.sound = !save.sound;
  setSoundEnabled(save.sound);
  writeSave();
  $('sound-icon').setAttribute('href', save.sound ? '#i-sound' : '#i-mute');
  sfx.click();
});

addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && placing) {
    stopPlacing();
    sfx.back?.();
  } else if (/^[1-9]$/.test(e.key) && !document.querySelector('.overlay:not([hidden])')) {
    // The number keys pick from the build bar, in the order it shows.
    const btn = $('dock').children[Number(e.key) - 1];
    if (btn) pickTool(btn.dataset.key);
  } else if (e.key === ' ') {
    e.preventDefault();
    speedStep = speedStep === 0 ? 1 : 0;
    showSpeed();
  } else if (e.key === '?' || e.key === 'h') {
    pause();
    openPopup('help');
  }
});

addEventListener('resize', () => renderer.resize());
document.fonts?.ready.then(() => renderer.resize());
addEventListener('pagehide', writeFloor);
document.addEventListener('visibilitychange', () => document.hidden && writeFloor());

// ---- frame loop ----

let last = performance.now();
function frame(now) {
  const raw = (now - last) / 1000;
  last = now;
  if (running) sim.tick(Math.min(0.05, raw) * SPEEDS[speedStep]);
  const cell = controls.cell;
  renderer.draw(
    sim,
    {
      draft: controls.draft,
      hover: controls.hover,
      placing,
      cell,
      canPlace: Boolean(placing && cell && canPlaceAt(world, cell.x, cell.y, placing.moving ?? null)),
      hold: { building: controls.holdOn, progress: controls.holdProgress() },
    },
    now / 1000
  );
  if (floorDirty && now - floorWritten > 2000) writeFloor();
  requestAnimationFrame(frame);
}

setSoundEnabled(save.sound);
$('sound-icon').setAttribute('href', save.sound ? '#i-sound' : '#i-mute');
fillRecipes();
if (boot()) {
  $('title-kicker').textContent = 'Welcome back';
  $('play-text').textContent = 'Back to the floor';
}
requestAnimationFrame(frame);

// Lets a browser test poke at the running factory; inert for players.
if (new URLSearchParams(location.search).has('test')) {
  window.factory = {
    get world() {
      return world;
    },
    get sim() {
      return sim;
    },
    get renderer() {
      return renderer;
    },
    get controls() {
      return controls;
    },
    boot,
    resume,
    writeFloor: () => (touchFloor(), writeFloor()),
  };
  window.factoryDraft = { createDraft, draftTo, commitDraft };
}
