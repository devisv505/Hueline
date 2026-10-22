// Screens, upgrades and the frame loop that ties the factory together.
import { COLORS, TUNE, FACTORY_NAMES, PRIMARIES, GOODS, TECHS, techCost } from './config.js';
import { World, KIND, seedWorld, canPlaceAt, makeableColors, createDraft, draftTo, commitDraft } from './world.js';
import { Sim } from './sim.js';
import { Renderer } from './render.js';
import { Controls } from './input.js';
import { unlockAudio, setSoundEnabled, sfx } from './audio.js';
import { burst, ring, floater, toast, confetti, shake, pop } from './fx.js';

const $ = (id) => document.getElementById(id);
const SAVE_KEY = 'minifactory.v1';
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
    return { best: 0, sound: true, ...JSON.parse(localStorage.getItem(SAVE_KEY) || '{}') };
  } catch {
    return { best: 0, sound: true };
  }
}

function writeSave() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(save));
  } catch {
    // Private mode: the run simply is not remembered.
  }
}

// ---- hooks the simulation calls back into ----

function at(b) {
  const p = renderer.toClient(b.x + 0.5, b.y + 0.5);
  return p;
}

const hooks = {
  onDeliver(b, color, total, paid) {
    const p = at(b);
    burst(p.x, p.y, color, 10);
    floater(p.x, p.y - 10, `+${paid}`, COLORS[color].deep);
    sfx.deliver();
    bumpScore();
    showStock();
    if (total % 10 === 0) confetti(24);
    advanceCoach();
  },
  onCraft(b, color) {
    const p = at(b);
    ring(p.x, p.y, color);
    sfx.craft();
  },
  onJam(b) {
    sfx.alarm();
    toast(`${label(b)} is overflowing — tap it to dump the buffer`, { color: '#ec5a5a', icon: true });
  },
  onVent(b, dumped) {
    const p = at(b);
    burst(p.x, p.y, 'slate', dumped + 4);
    floater(p.x, p.y - 10, `−${TUNE.ventCost}`, '#ec5a5a');
    sfx.erase();
    bumpScore();
  },
  onSpawn(b) {
    const p = at(b);
    ring(p.x, p.y, b.color ?? 'slate');
    sfx.arrive();
    if (b.kind === KIND.DEPOT) toast(`New shop wants ${COLORS[b.color].name}`, { color: COLORS[b.color].fill, icon: true });
  },
  onFail(b) {
    sfx.fail();
    shake($('app'));
    const p = at(b);
    burst(p.x, p.y, 'slate', 16);
    setTimeout(() => showGameOver(b), 500);
  },
};

const label = (b) => (b.kind === KIND.MIXER ? 'A mixer' : b.kind === KIND.DEPOT ? `The ${COLORS[b.color].name} shop` : b.kind === KIND.SPLITTER ? 'A splitter' : 'A deposit');

// ---- boot and restart ----

// Cut the floor to the shape of the screen, so a phone gets a tall factory and
// a desktop a wide one, both at about the same number of cells.
function floorShape() {
  const rect = $('stage').getBoundingClientRect();
  if (!rect.width || !rect.height) return TUNE;
  const aspect = Math.min(2.4, Math.max(0.42, rect.width / rect.height));
  const rows = Math.round(Math.min(23, Math.max(10, Math.sqrt(TUNE.cells / aspect))));
  const cols = Math.round(Math.min(26, Math.max(10, rows * aspect)));
  return { cols, rows };
}

function boot(seed = (Math.random() * 1e9) | 0) {
  world = seedWorld(new World(seed, floorShape()));
  sim = new Sim(world, hooks);
  sim.relaxed = false;
  $('factory-name').textContent = FACTORY_NAMES[seed % FACTORY_NAMES.length];
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
  speedStep = 1;
  showSpeed();
  showStock();
  showScore();
  advanceCoach();
}

const controlHooks = {
  onBuild(belt, cost) {
    showStock();
    const p = renderer.toClient(belt.pts.at(-1).x, belt.pts.at(-1).y);
    burst(p.x, p.y, 'slate', 5);
    if (cost.bridges) toast(`${cost.bridges} bridge${cost.bridges > 1 ? 's' : ''} built`, { color: '#3f4654', icon: true });
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
  onTap(target) {
    if (target.kind) return tapBuilding(target);
    // Pulling a belt up refunds its tiles and bridges.
    const p = renderer.toClient(target.pts[(target.pts.length / 2) | 0].x, target.pts[(target.pts.length / 2) | 0].y);
    world.removeBelt(target);
    burst(p.x, p.y, 'slate', 7);
    sfx.erase();
    showStock();
  },
};

function tapBuilding(b) {
  if (b.jam > 0 && sim.vent(b)) return;
  sfx.click();
  if (b.kind === KIND.DEPOT) {
    const parts = COLORS[b.color].parts.map((p) => COLORS[p].name).join(' + ');
    toast(`Wants ${COLORS[b.color].name} (${parts})`, { color: COLORS[b.color].fill, icon: true });
  } else if (b.kind === KIND.MIXER) {
    toast(b.buffer.length ? `Holding ${b.buffer.map((c) => COLORS[c].name).join(', ')}` : 'Mixer is empty — feed it two colours', { color: '#3f4654', icon: true });
  } else if (b.kind === KIND.SPLITTER) {
    toast('Splitter — it feeds its outgoing belts in turn', { color: '#3f4654', icon: true });
  } else {
    toast(`${COLORS[b.color].name} ore, one every ${TUNE.oreInterval}s`, { color: COLORS[b.color].fill, icon: true });
  }
}

// ---- heads-up display ----

function showStock() {
  const draft = controls?.draft;
  const spentBelts = draft ? Math.max(0, draft.cells.length - (draft.end ? 2 : 1)) : 0;
  const spentBridges = draft ? draft.bridges.length : 0;
  const belts = world.stock.belts - spentBelts;
  const bridges = world.stock.bridges - spentBridges;
  $('belt-count').textContent = belts;
  $('bridge-count').textContent = bridges;
  $('pill-belts').classList.toggle('low', belts <= 6);
  $('pill-bridges').classList.toggle('low', bridges === 0);
  $('credit-count').textContent = world.stock.credits;
  $('store-credits').textContent = world.stock.credits;
  $('tech-credits').textContent = world.stock.credits;
}

function showScore() {
  $('score').textContent = sim.score;
}

function bumpScore() {
  showScore();
  const el = $('score');
  el.classList.remove('bump');
  void el.offsetWidth;
  el.classList.add('bump');
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

// A four-beat tutorial that reads the floor rather than scripting the player.
function advanceCoach() {
  if (coachStep === 99) return;
  const mixer = world.buildings.find((b) => b.kind === KIND.MIXER);
  if (!mixer) return;
  const feeds = world.beltsTo(mixer).length;
  const sends = world.beltsFrom(mixer).length;
  let step = 0;
  if (sim.delivered > 0) step = 99;
  else if (feeds === 0) step = 0;
  else if (feeds === 1) step = 1;
  else if (sends === 0) step = 2;
  else step = 3;
  if (step === coachStep) return;
  coachStep = step;
  if (step === 99) return $('coach') && ($('coach').hidden = true);
  const lines = [
    'Drag from an ore deposit onto the mixer to lay a belt',
    'Now feed in the other colour — two different ores make a new one',
    'Send the mix on: drag from the mixer to the shop',
    'That is the whole loop. Keep the orders coming.',
  ];
  showCoach(lines[step], step === 3 ? 4200 : 0);
}

// ---- store, research and placing what you buy ----

function afford(cost) {
  return world.stock.credits >= cost;
}

function spend(cost) {
  world.stock.credits -= cost;
  showStock();
}

function row(icon, title, text, cost, { owned = false, locked = false, tag = '' } = {}) {
  const btn = document.createElement('button');
  const can = !locked && !owned && afford(cost);
  btn.className = `choice${owned ? ' owned' : ''}${locked || (!can && !owned) ? ' locked' : ''}`;
  btn.disabled = !can;
  btn.innerHTML =
    `<span class="badge"><svg class="icon"><use href="${icon}"></use></svg></span>` +
    `<span class="choice-text"><h3>${title}${tag ? ` <i class="tag">${tag}</i>` : ''}</h3><p>${text}</p></span>` +
    `<span class="price">${owned ? 'owned' : locked ? 'locked' : cost}</span>`;
  return btn;
}

function renderStore() {
  const list = $('store-list');
  list.innerHTML = '';
  for (const [id, good] of Object.entries(GOODS)) {
    const locked = Boolean(good.needs) && !world.unlocked[good.needs];
    const note = locked ? 'Research it first, over in the lab.' : good.note;
    if (id === 'deposit') {
      list.append(oreRow(good));
      continue;
    }
    const btn = row(good.icon, good.label, note, good.cost, { locked });
    btn.addEventListener('click', () => buy(id, good));
    list.append(btn);
  }
}

function openStore() {
  renderStore();
  sfx.click();
  pause();
  openPopup('store');
}

// Ore comes in three flavours, so it gets one row with three buttons.
function oreRow(good) {
  const wrap = document.createElement('div');
  wrap.className = 'ore-row';
  wrap.innerHTML = `<p class="ore-label">${good.label} <span class="price">${good.cost}</span></p>`;
  const buttons = document.createElement('div');
  buttons.className = 'ore-buttons';
  for (const color of PRIMARIES) {
    const btn = document.createElement('button');
    btn.className = 'ore-pick';
    btn.disabled = !afford(good.cost);
    btn.style.setProperty('--ore', COLORS[color].fill);
    btn.innerHTML = `<i></i><span>${COLORS[color].name}</span>`;
    btn.addEventListener('click', () => buy('deposit', good, color));
    buttons.append(btn);
  }
  wrap.append(buttons);
  return wrap;
}

function buy(id, good, color) {
  if (!afford(good.cost)) return sfx.nope();
  if (good.place) {
    // Pay on the drop, not on the click, so a cancelled placement costs nothing.
    closePopup('store').then(() => startPlacing({ kind: good.place, color }, good.cost));
    return;
  }
  spend(good.cost);
  if (id === 'belts') world.stock.belts += good.amount;
  if (id === 'bridge') world.stock.bridges += good.amount;
  sfx.reward();
  toast(`${good.label} bought`, { color: '#3f4654', icon: true });
  renderStore();
}

function renderTech() {
  const list = $('tech-list');
  list.innerHTML = '';
  for (const tech of TECHS) {
    const level = world.techs[tech.id] ?? 0;
    const max = tech.levels ?? 1;
    const owned = level >= max;
    const cost = techCost(tech, level);
    const tag = max > 1 ? `${level}/${max}` : '';
    const btn = row(tech.icon, tech.name, tech.text, cost, { owned, tag });
    btn.addEventListener('click', () => {
      if (!afford(cost)) return sfx.nope();
      spend(cost);
      world.techs[tech.id] = level + 1;
      tech.apply(world);
      sfx.reward();
      confetti(34);
      toast(`${tech.name} researched`, { color: '#ef7f9c', icon: true });
      renderTech();
    });
    list.append(btn);
  }
}

function openTech() {
  renderTech();
  sfx.click();
  pause();
  openPopup('tech');
}

let placing = null;
const PLACE_NAMES = { mixer: 'mixer', splitter: 'splitter', deposit: 'deposit' };

function startPlacing(what, cost) {
  placing = { ...what, cost };
  controls.setPlacing(placing);
  const name = what.color ? `${COLORS[what.color].name} ${PLACE_NAMES[what.kind]}` : PLACE_NAMES[what.kind];
  $('placing-text').textContent = `Tap an empty spot for your ${name}`;
  $('placing-bar').hidden = false;
  $('coach').hidden = true;
  resume();
}

function stopPlacing() {
  placing = null;
  controls.setPlacing(null);
  $('placing-bar').hidden = true;
}

function placeAt(cell) {
  if (!placing) return;
  if (!canPlaceAt(world, cell.x, cell.y)) {
    sfx.nope();
    showCoach('Not enough room there — machines need a cell of air', 1600);
    return;
  }
  if (!afford(placing.cost)) {
    sfx.nope();
    stopPlacing();
    return;
  }
  spend(placing.cost);
  const b = world.addBuilding(placing.kind, cell.x, cell.y, placing.color ? { color: placing.color } : {});
  b.born = sim.time;
  const p = at(b);
  ring(p.x, p.y, placing.color ?? 'slate');
  burst(p.x, p.y, placing.color ?? 'slate', 8);
  sfx.lay();
  stopPlacing();
  advanceCoach();
}

// ---- game over ----

function showGameOver(b) {
  controls.locked = true;
  running = false;
  $('over-title').textContent = b.kind === KIND.MIXER ? 'A mixer overflowed' : 'A shop drowned in the wrong colour';
  $('over-text').textContent =
    b.kind === KIND.MIXER
      ? `Six loads of ${COLORS[b.buffer[0]]?.name ?? 'one colour'} with nothing to mix them with. Split the flow, or add a second mixer next time.`
      : 'Deliveries it never ordered piled up at the door. Check where each belt ends.';
  $('final-score').textContent = sim.score;
  const best = Math.max(save.best, sim.score);
  $('best-line').textContent = sim.score > save.best && sim.score > 0 ? 'New best run!' : `Best so far: ${best}`;
  save.best = best;
  writeSave();
  openPopup('over');
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
  if (sim.over) return;
  running = true;
}

// ---- recipe reference in the help card ----

function fillRecipes() {
  const grid = $('recipe-grid');
  const compounds = Object.keys(COLORS).filter((c) => COLORS[c].parts.length > 1);
  grid.innerHTML = compounds
    .map((c) => {
      const parts = COLORS[c].parts;
      // Show the three-part colour as a real pair, e.g. Ruby + Fern, not "any mix".
      const rest = parts.slice(1);
      const left =
        parts.length === 3
          ? [parts[0], compounds.find((k) => COLORS[k].parts.length === 2 && COLORS[k].parts.every((p) => rest.includes(p)))]
          : parts;
      const chips = left.map((p) => `<span class="chip" style="background:${COLORS[p].fill}"></span>`).join('<b>+</b>');
      return `<div class="recipe">${chips}<b>→</b><span class="chip" style="background:${COLORS[c].fill}"></span>${COLORS[c].name}</div>`;
    })
    .join('');
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

$('btn-again').addEventListener('click', async () => {
  sfx.click();
  await closePopup('over');
  boot();
  resume();
});

$('btn-store').addEventListener('click', openStore);
$('btn-tech').addEventListener('click', openTech);
$('btn-cancel-place').addEventListener('click', () => {
  sfx.click();
  stopPlacing();
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
  } else if (e.key === 'b') {
    openStore();
  } else if (e.key === 't') {
    openTech();
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
      canPlace: Boolean(placing && cell && canPlaceAt(world, cell.x, cell.y)),
    },
    now / 1000
  );
  showScore();
  requestAnimationFrame(frame);
}

setSoundEnabled(save.sound);
$('sound-icon').setAttribute('href', save.sound ? '#i-sound' : '#i-mute');
fillRecipes();
boot();
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
    boot,
    resume,
    makeableColors,
  };
  window.factoryDraft = { createDraft, draftTo, commitDraft };
}
