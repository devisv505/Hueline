// The factory floor: buildings on a grid, belts drawn between them, and the
// rules that decide where a belt may go. No DOM here, so it is unit testable.
import { TUNE, START_UNLOCKED } from './config.js?v=6';
import { makeRng } from './rng.js?v=6';

const key = (x, y) => `${x},${y}`;

export const KIND = { DEPOSIT: 'deposit', MIXER: 'mixer', PRESS: 'press', SPLITTER: 'splitter', HUB: 'hub' };

export class World {
  constructor(seed = 1, shape = TUNE) {
    this.seed = seed;
    this.rng = makeRng(seed);
    this.cols = shape.cols;
    this.rows = shape.rows;
    this.buildings = [];
    this.belts = [];
    // Belt tiles are the one thing a floor runs short of; bridges are paid in them too.
    this.stock = { belts: TUNE.startBelts };
    // What the goals have opened up, each buildable as often as you like, and
    // which of those are new since the build list was last opened.
    this.unlocked = [...START_UNLOCKED];
    this.fresh = [];
    // Which goal the hub is on, and how many of its items have arrived.
    this.goal = { index: 0, got: 0 };
    this.speed = TUNE.beltSpeed;
    // Upgrades may move these later, so nothing reads the raw tunables at run time.
    this.caps = { mixer: TUNE.mixerCap, press: TUNE.pressCap, deposit: TUNE.depositCap, splitter: TUNE.splitterCap, hub: 0 };
    this.nextId = 1;
    this.cellBuilding = new Map();
    this.cellBelts = new Map(); // interior belt cells only: key -> [{ belt, index }]
  }

  inside(x, y) {
    return x >= 0 && y >= 0 && x < this.cols && y < this.rows;
  }

  buildingAt(x, y) {
    return this.cellBuilding.get(key(x, y)) ?? null;
  }

  beltsAt(x, y) {
    return this.cellBelts.get(key(x, y)) ?? [];
  }

  addBuilding(kind, x, y, extra = {}) {
    const b = {
      id: this.nextId++,
      kind,
      x,
      y,
      born: 0, // stamped by the sim so the renderer can pop it in
      buffer: [],
      out: null,
      craft: 0,
      jam: 0,
      cool: 0,
      pendingOut: null,
      rr: 0,
      ...extra,
    };
    this.buildings.push(b);
    this.cellBuilding.set(key(x, y), b);
    return b;
  }

  // Belts leaving / arriving at a building, cached per frame by the sim.
  beltsFrom(b) {
    return this.belts.filter((belt) => belt.from === b.id);
  }

  beltsTo(b) {
    return this.belts.filter((belt) => belt.to === b.id);
  }

  addBelt(cells, bridges, feed = null) {
    const from = this.buildingAt(cells[0].x, cells[0].y);
    const to = this.buildingAt(cells.at(-1).x, cells.at(-1).y);
    const belt = this.placeBelt({
      id: this.nextId++,
      from: from.id,
      to: to?.id ?? null,
      // Set when the belt ends on another belt instead of a machine: items are
      // slipped into that lane at `index` when there is a gap.
      feed: feed ? { beltId: feed.belt.id, index: feed.index } : null,
      cells,
      bridges: bridges.map((c) => key(c.x, c.y)),
    });
    this.stock.belts -= beltTiles(cells.length - 2, belt.bridges.size);
    return belt;
  }

  // Lay a belt that has already been paid for: a new one, or one coming back
  // from a save.
  placeBelt({ id, from, to, feed, cells, bridges }) {
    const belt = {
      id,
      from,
      to,
      feed,
      cells,
      pts: cells.map((c) => ({ x: c.x + 0.5, y: c.y + 0.5 })),
      len: cells.length - 1,
      bridges: new Set(bridges),
      items: [], // head first: items[0] is nearest the destination
      born: 0,
    };
    this.belts.push(belt);
    for (let i = 1; i < cells.length - 1; i++) {
      const k = key(cells[i].x, cells[i].y);
      if (!this.cellBelts.has(k)) this.cellBelts.set(k, []);
      this.cellBelts.get(k).push({ belt, index: i });
    }
    return belt;
  }

  beltById(id) {
    return this.belts.find((b) => b.id === id) ?? null;
  }

  // Belts feeding into `belt`, which have nowhere to go once it is gone.
  feeders(belt) {
    return this.belts.filter((b) => b.feed?.beltId === belt.id);
  }

  removeBelt(belt) {
    const i = this.belts.indexOf(belt);
    if (i < 0) return;
    this.belts.splice(i, 1);
    this.feeders(belt).forEach((b) => this.removeBelt(b));
    for (let j = 1; j < belt.cells.length - 1; j++) {
      const k = key(belt.cells[j].x, belt.cells[j].y);
      const list = this.cellBelts.get(k)?.filter((e) => e.belt !== belt) ?? [];
      if (list.length) this.cellBelts.set(k, list);
      else this.cellBelts.delete(k);
    }
    this.stock.belts += beltTiles(belt.cells.length - 2, belt.bridges.size);
  }

  removeBuilding(b) {
    this.belts.filter((belt) => belt.from === b.id || belt.to === b.id).forEach((belt) => this.removeBelt(belt));
    this.buildings.splice(this.buildings.indexOf(b), 1);
    this.cellBuilding.delete(key(b.x, b.y));
  }

  // Which way a belt runs through one of its interior cells.
  axisAt(belt, index) {
    const a = belt.cells[index - 1];
    const b = belt.cells[index + 1];
    if (!a || !b) return 'end';
    if (a.x === b.x) return 'v';
    if (a.y === b.y) return 'h';
    return 'turn';
  }

  pointAt(belt, d) {
    const clamped = Math.max(0, Math.min(belt.len, d));
    const i = Math.min(belt.cells.length - 2, Math.floor(clamped));
    const f = clamped - i;
    const a = belt.pts[i];
    const b = belt.pts[i + 1];
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
  }
}

// ---- drawing a belt ----

// What a belt costs: a tile for every cell it runs over, and a bridge on top.
export const beltTiles = (cells, bridges) => cells + bridges * TUNE.bridgeTiles;

export const canStartFrom = (b) => b.kind !== KIND.HUB;
export const canEndAt = (b) => b.kind !== KIND.DEPOSIT;

// Every belt whose load ends up at this building, following the ones that
// merge into other lanes rather than arriving on their own.
export function inboundBelts(world, building) {
  const found = world.belts.filter((belt) => belt.to === building.id);
  const seen = new Set(found.map((b) => b.id));
  for (let i = 0; i < found.length; i++) {
    for (const feeder of world.feeders(found[i])) {
      if (seen.has(feeder.id)) continue;
      seen.add(feeder.id);
      found.push(feeder);
    }
  }
  return found;
}

// A belt may join another belt mid-lane. Not on a bridge — that cell is an
// overpass, with no way down — and not where something already merges in.
export function mergeTargetAt(world, x, y) {
  const here = world.beltsAt(x, y);
  if (here.length !== 1) return null;
  const { belt, index } = here[0];
  if (belt.bridges.has(`${x},${y}`)) return null;
  if (world.belts.some((b) => b.feed?.beltId === belt.id && b.feed.index === index)) return null;
  return { belt, index };
}

// Where the player may drop a machine: empty floor, clear of
// the belts already running, with a cell of air between it and its neighbours.
// `ignore` is the machine being picked up and moved, which should not block
// its own new spot or the cells around it.
export function canPlaceAt(world, x, y, ignore = null) {
  if (!world.inside(x, y)) return false;
  const sitting = world.buildingAt(x, y);
  if (sitting && sitting !== ignore) return false;
  if (world.beltsAt(x, y).some((e) => e.belt.from !== ignore?.id && e.belt.to !== ignore?.id)) return false;
  return !world.buildings.some((b) => b !== ignore && Math.max(Math.abs(b.x - x), Math.abs(b.y - y)) < 2);
}

// Everything on the floor is yours to move except the hub, which the goals live in.
export const canManage = (b) => b.kind !== KIND.HUB;

export function createDraft(world, building) {
  return {
    from: building,
    cells: [{ x: building.x, y: building.y }],
    bridges: [],
    end: null,
    endFeed: null, // set when the belt lands on another belt instead of a machine
    trail: new Set(), // cells the cursor has swept, so the route follows your hand
    blocked: null, // why the route stopped, for the cursor hint
  };
}

const beltCost = (draft) => Math.max(0, draft.cells.length - (draft.end || draft.endFeed ? 2 : 1));

export function draftCost(draft) {
  return { belts: beltTiles(beltCost(draft), draft.bridges.length), bridges: draft.bridges.length };
}

const routeTiles = (found) => beltTiles(found.cells.length - (found.terminal ? 2 : 1), found.bridges.length);

const DIRS = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];
const TRAIL_BONUS = 0.6; // a cell you dragged over is cheaper than a fresh one
const TURN_COST = 0.4; // ...and a straight run is cheaper than a corner
const BRIDGE_COST = 5; // bridges are a last resort, not a shortcut
const CROWD_COST = 0.3; // belts would rather not squeeze past a building

const crowded = (world, cell) => DIRS.some((d) => world.buildingAt(cell.x + d.x, cell.y + d.y));

// Can a belt enter this cell heading `dir`? `dest` is the only building it may land on.
function cellRule(world, cell, dir, dest, merge) {
  if (!world.inside(cell.x, cell.y)) return { blocked: true };

  const building = world.buildingAt(cell.x, cell.y);
  if (building) return building === dest ? { terminal: true } : { blocked: true };

  const here = world.beltsAt(cell.x, cell.y);
  if (!here.length) return {};
  // The one belt cell a route may stop on is the lane it was aimed at.
  if (merge && cell.x === merge.x && cell.y === merge.y) return { terminal: true };
  if (here.length > 1) return { blocked: true };
  const other = world.axisAt(here[0].belt, here[0].index);
  if (other === 'turn' || other === 'end') return { blocked: true }; // nothing to bridge over
  if (other === (dir.x ? 'h' : 'v')) return { blocked: true }; // belts cannot share a lane
  return { bridge: true };
}

class Heap {
  constructor() {
    this.a = [];
  }

  push(node) {
    const a = this.a;
    a.push(node);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }

  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

// Cheapest legal belt from `from` to `to`, biased towards straight runs and the
// path the cursor actually took. State is (cell, heading) so turns can be priced
// and so a belt on a bridge is made to carry straight on.
function route(world, from, to, trail, allowBridges) {
  const dest = world.buildingAt(to.x, to.y);
  const merge = !dest && mergeTargetAt(world, to.x, to.y) ? to : null;
  const h = (x, y) => (Math.abs(x - to.x) + Math.abs(y - to.y)) * TRAIL_BONUS;
  const open = new Heap();
  const seen = new Map();
  const startKey = `${from.x},${from.y},-1`;
  seen.set(startKey, { g: 0, cell: from, dir: -1, from: null, bridge: false });
  open.push({ f: h(from.x, from.y), key: startKey });

  while (open.a.length) {
    const node = open.pop();
    const state = seen.get(node.key);
    if (node.f - state.g > h(state.cell.x, state.cell.y) + 1e-9) continue; // stale entry
    if (state.cell.x === to.x && state.cell.y === to.y && state.dir >= 0) {
      const cells = [];
      const bridges = [];
      for (let s = state; s; s = s.from) {
        cells.unshift(s.cell);
        if (s.bridge) bridges.unshift(s.cell);
      }
      return { cells, bridges, terminal: Boolean(dest || merge) };
    }

    for (let d = 0; d < 4; d++) {
      // A belt on a bridge is already committed to its heading.
      if (state.bridge && state.dir !== d) continue;
      const dir = DIRS[d];
      const cell = { x: state.cell.x + dir.x, y: state.cell.y + dir.y };
      const rule = cellRule(world, cell, dir, dest, merge);
      if (rule.blocked) continue;
      if (rule.bridge && !allowBridges) continue;
      if (rule.terminal && (cell.x !== to.x || cell.y !== to.y)) continue;

      let step = trail.has(`${cell.x},${cell.y}`) ? TRAIL_BONUS : 1;
      if (state.dir >= 0 && state.dir !== d) step += TURN_COST;
      if (rule.bridge) step += BRIDGE_COST;
      if (!rule.terminal && crowded(world, cell)) step += CROWD_COST;

      const key = `${cell.x},${cell.y},${d}`;
      const g = state.g + step;
      const known = seen.get(key);
      if (known && known.g <= g + 1e-9) continue;
      seen.set(key, { g, cell, dir: d, from: state, bridge: Boolean(rule.bridge) });
      open.push({ f: g + h(cell.x, cell.y), key });
    }
  }
  return null;
}

// Re-route the whole belt towards the cursor on every move: the line stays
// smooth and legal while still hugging the detours the player dragged.
export function draftTo(world, draft, target) {
  if (!canStartFrom(draft.from)) return fail(draft, 'kind'); // the hub is the end of the line
  if (!world.inside(target.x, target.y)) return draft;
  draft.trail.add(`${target.x},${target.y}`);

  const from = draft.cells[0];
  if (target.x === from.x && target.y === from.y) {
    draft.cells = [from];
    draft.bridges = [];
    draft.end = null;
    draft.endFeed = null;
    draft.blocked = null;
    return draft;
  }

  const building = world.buildingAt(target.x, target.y);
  if (building) {
    if (!canEndAt(building)) return fail(draft, 'kind');
    if (world.belts.some((b) => b.from === draft.from.id && b.to === building.id)) return fail(draft, 'duplicate');
  }
  const merge = building ? null : mergeTargetAt(world, target.x, target.y);
  if (!building && world.beltsAt(target.x, target.y).length && !merge) return fail(draft, 'occupied');

  // A bridge costs tiles, so when the route over one is more than you can pay
  // for, the long way round may still fit.
  let found = route(world, from, target, draft.trail, true);
  if (found && routeTiles(found) > world.stock.belts) found = route(world, from, target, draft.trail, false) ?? found;
  if (!found) return fail(draft, 'blocked');

  draft.blocked = null;
  if (routeTiles(found) > world.stock.belts) {
    // Show as much line as there are tiles for, so running out is visible.
    const part = affordable(found, world.stock.belts);
    draft.cells = part.cells;
    draft.bridges = part.bridges;
    draft.end = null;
    draft.endFeed = null;
    draft.blocked = 'no-belts';
    return draft;
  }

  draft.cells = found.cells;
  draft.bridges = found.bridges;
  draft.end = found.terminal ? building : null;
  draft.endFeed = found.terminal && !building ? merge : null;
  return draft;
}

// The front of a route that the tiles in hand will pay for.
function affordable(found, budget) {
  const cells = [found.cells[0]];
  const bridges = [];
  let spent = 0;
  for (const cell of found.cells.slice(1)) {
    const bridge = found.bridges.some((b) => b.x === cell.x && b.y === cell.y);
    const cost = beltTiles(1, bridge ? 1 : 0);
    if (spent + cost > budget) break;
    spent += cost;
    cells.push(cell);
    if (bridge) bridges.push(cell);
  }
  return { cells, bridges };
}

function fail(draft, why) {
  draft.blocked = why;
  draft.end = null;
  draft.endFeed = null;
  return draft;
}

export function commitDraft(world, draft) {
  if ((!draft.end && !draft.endFeed) || draft.cells.length < 2) return null;
  return world.addBelt(draft.cells.map((c) => ({ ...c })), draft.bridges, draft.endFeed);
}

// ---- the opening floor ----

// The hub in the middle and two ores to feed it: everything else is built as
// the goals open it up.
export function seedWorld(world) {
  const mid = { x: (world.cols / 2) | 0, y: (world.rows / 2) | 0 };
  const tall = world.rows > world.cols;
  world.addBuilding(KIND.HUB, mid.x, mid.y);
  if (tall) {
    world.addBuilding(KIND.DEPOSIT, mid.x - 3, mid.y - 5, { color: 'blue' });
    world.addBuilding(KIND.DEPOSIT, mid.x + 3, mid.y - 5, { color: 'yellow' });
  } else {
    world.addBuilding(KIND.DEPOSIT, mid.x - 5, mid.y - 3, { color: 'blue' });
    world.addBuilding(KIND.DEPOSIT, mid.x - 5, mid.y + 3, { color: 'yellow' });
  }
  return world;
}

// ---- saving the floor ----

// The layout, belt tiles, what is unlocked and the goal progress. What is
// riding the belts or sitting in a buffer is not kept: a floor comes back empty
// and starts up again.
export function saveWorld(world) {
  return {
    version: 2,
    seed: world.seed,
    cols: world.cols,
    rows: world.rows,
    nextId: world.nextId,
    stock: { ...world.stock },
    unlocked: [...world.unlocked],
    fresh: [...world.fresh],
    goal: { ...world.goal },
    buildings: world.buildings.map(({ id, kind, x, y, color }) => ({ id, kind, x, y, color })),
    belts: world.belts.map(({ id, from, to, feed, cells, bridges }) => ({ id, from, to, feed, cells, bridges: [...bridges] })),
  };
}

export function loadWorld(data) {
  if (data?.version !== 2) return null;
  const world = new World(data.seed, { cols: data.cols, rows: data.rows });
  for (const { id, kind, x, y, color } of data.buildings) {
    world.addBuilding(kind, x, y, color ? { id, color } : { id });
  }
  // Belts were saved in the order they were laid, so a lane is always back
  // before anything that merges into it.
  for (const belt of data.belts) world.placeBelt(belt);
  world.nextId = data.nextId;
  world.stock = { ...world.stock, ...data.stock };
  world.unlocked = [...data.unlocked];
  world.fresh = [...data.fresh];
  world.goal = { ...data.goal };
  return world;
}
