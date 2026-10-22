// The factory floor: buildings on a grid, belts drawn between them, and the
// rules that decide where a belt may go. No DOM here, so it is unit testable.
import { COLORS, TUNE } from './config.js?v=3';
import { makeRng } from './rng.js?v=3';

const key = (x, y) => `${x},${y}`;

export const KIND = { DEPOSIT: 'deposit', MIXER: 'mixer', DEPOT: 'depot', SPLITTER: 'splitter' };

export class World {
  constructor(seed = 1, shape = TUNE) {
    this.rng = makeRng(seed);
    this.cols = shape.cols;
    this.rows = shape.rows;
    // Keep the floor from filling up on a smaller screen.
    this.maxBuildings = Math.min(TUNE.maxBuildings, Math.round((this.cols * this.rows) / 14));
    this.buildings = [];
    this.belts = [];
    this.stock = { belts: TUNE.startBelts, bridges: TUNE.startBridges, credits: TUNE.startCredits };
    this.speed = TUNE.beltSpeed;
    // Research moves these, so nothing reads the raw tunables at run time.
    this.caps = { mixer: TUNE.mixerCap, depot: TUNE.depotCap, deposit: TUNE.depositCap, splitter: TUNE.splitterCap };
    this.jamFuse = TUNE.jamFuse;
    this.unlocked = { splitter: false };
    this.techs = {}; // tech id -> levels bought
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
      pending: kind === KIND.DEPOT ? 1 : 0,
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
    const belt = {
      id: this.nextId++,
      from: from.id,
      to: to?.id ?? null,
      // Set when the belt ends on another belt instead of a machine: items are
      // slipped into that lane at `index` when there is a gap.
      feed: feed ? { beltId: feed.belt.id, index: feed.index } : null,
      color: null, // last colour carried, for a subtle tint
      cells,
      pts: cells.map((c) => ({ x: c.x + 0.5, y: c.y + 0.5 })),
      len: cells.length - 1,
      bridges: new Set(bridges.map((c) => key(c.x, c.y))),
      items: [], // head first: items[0] is nearest the destination
      born: 0,
    };
    this.belts.push(belt);
    for (let i = 1; i < cells.length - 1; i++) {
      const k = key(cells[i].x, cells[i].y);
      if (!this.cellBelts.has(k)) this.cellBelts.set(k, []);
      this.cellBelts.get(k).push({ belt, index: i });
    }
    this.stock.belts -= cells.length - 2;
    this.stock.bridges -= belt.bridges.size;
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
    this.stock.belts += belt.cells.length - 2;
    this.stock.bridges += belt.bridges.size;
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

export const canStartFrom = (b) => b.kind !== KIND.DEPOT;
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

// Where the player may drop a machine they have bought: empty floor, clear of
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

// Shops arrive on their own and are demand, not plant: you keep the machines.
export const canManage = (b) => b.kind !== KIND.DEPOT;

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
  return { belts: beltCost(draft), bridges: draft.bridges.length };
}

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
  if (!canStartFrom(draft.from)) return fail(draft, 'kind'); // a shop is the end of the line
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

  let found = route(world, from, target, draft.trail, world.stock.bridges > 0);
  if (found && found.bridges.length > world.stock.bridges) {
    found = route(world, from, target, draft.trail, false) ?? fewestBridges(found, world);
  }
  if (!found) return fail(draft, world.stock.bridges > 0 ? 'blocked' : 'no-bridges');

  draft.blocked = null;
  const interior = found.cells.length - (found.terminal ? 2 : 1);
  if (interior > world.stock.belts) {
    // Show as much line as there are tiles for, so running out is visible.
    draft.cells = found.cells.slice(0, world.stock.belts + 1);
    draft.bridges = found.bridges.filter((c) => draft.cells.some((p) => p.x === c.x && p.y === c.y));
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

// Out of bridges mid-route: keep the part that is still affordable.
function fewestBridges(found, world) {
  let used = 0;
  const cells = [];
  for (const cell of found.cells) {
    if (found.bridges.some((b) => b.x === cell.x && b.y === cell.y)) {
      if (used >= world.stock.bridges) break;
      used++;
    }
    cells.push(cell);
  }
  return cells.length > 1 ? { cells, bridges: found.bridges.slice(0, used), terminal: false } : null;
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

// ---- starting layout and later arrivals ----

export function makeableColors(world) {
  const have = new Set(world.buildings.filter((b) => b.kind === KIND.DEPOSIT).map((b) => b.color));
  const mixers = world.buildings.filter((b) => b.kind === KIND.MIXER).length;
  return Object.keys(COLORS).filter((c) => {
    const parts = COLORS[c].parts;
    return parts.every((p) => have.has(p)) && mixers >= parts.length - 1;
  });
}

// Somewhere with elbow room, and near enough to the plant to be worth wiring up.
export function freeSpot(world, rng) {
  let best = null;
  let bestScore = -Infinity;
  let fallback = null; // used only if the floor is too busy to be fussy
  for (let tries = 0; tries < 240; tries++) {
    const x = 1 + rng.int(world.cols - 2);
    const y = 1 + rng.int(world.rows - 2);
    if (world.buildingAt(x, y) || world.beltsAt(x, y).length) continue;
    let near = Infinity;
    let clear = true;
    for (const b of world.buildings) {
      const d = Math.max(Math.abs(b.x - x), Math.abs(b.y - y));
      if (d < 3) clear = false;
      near = Math.min(near, d);
    }
    if (!clear) continue;
    fallback ??= { x, y };
    // Keep off the shoulder of a running belt, or the new arrival sits on the line.
    if (DIRS.some((d) => world.beltsAt(x + d.x, y + d.y).length)) continue;
    // Prefer a gap of about five cells: close enough to reach, far enough to route.
    const score = -Math.abs(near - 5) + rng() * 1.5;
    if (score > bestScore) {
      bestScore = score;
      best = { x, y };
    }
  }
  return best ?? fallback;
}

// Two ores, one mixer, one shop: the smallest floor that teaches the whole loop.
export function seedWorld(world) {
  const mid = { x: (world.cols / 2) | 0, y: (world.rows / 2) | 0 };
  const tall = world.rows > world.cols;
  world.addBuilding(KIND.MIXER, mid.x, mid.y);
  if (tall) {
    world.addBuilding(KIND.DEPOSIT, mid.x - 3, mid.y - 5, { color: 'blue' });
    world.addBuilding(KIND.DEPOSIT, mid.x + 3, mid.y - 5, { color: 'yellow' });
    world.addBuilding(KIND.DEPOT, mid.x, mid.y + 5, { color: 'green' });
  } else {
    world.addBuilding(KIND.DEPOSIT, mid.x - 5, mid.y - 3, { color: 'blue' });
    world.addBuilding(KIND.DEPOSIT, mid.x - 5, mid.y + 3, { color: 'yellow' });
    world.addBuilding(KIND.DEPOT, mid.x + 5, mid.y, { color: 'green' });
  }
  return world;
}

// Only demand arrives on its own now — machines and deposits are bought — and a
// new shop only ever asks for a colour the floor can already make.
export function nextArrival(world, rng) {
  const open = world.buildings.filter((b) => b.kind === KIND.DEPOT);
  const wanted = (color) => open.filter((b) => b.color === color).length;

  // Only colours the floor is not already saturated with. Without this the
  // first makeable mix wins every roll and the map fills with one colour.
  const options = makeableColors(world).filter((c) => wanted(c) < TUNE.sameColorCap);
  if (!options.length) return null;

  // Rarest first, so demand spreads instead of piling onto one shop colour,
  // and lean towards the deeper recipes once the plant can handle them.
  const fewest = Math.min(...options.map(wanted));
  const rarest = options.filter((c) => wanted(c) === fewest);
  const deep = rarest.filter((c) => COLORS[c].parts.length > 1);
  const pool = deep.length && rng() < 0.8 ? deep : rarest;
  return { kind: KIND.DEPOT, color: rng.pick(pool) };
}
