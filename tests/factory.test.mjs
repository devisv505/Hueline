import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mix, mixItems, pressItems, findRecipe, findPress, itemKey, colorOf, sizeOf, itemName, TUNE, GOALS, START_UNLOCKED, BUILDS, buildParts, buildKey } from '../js/config.js';
import { World, KIND, seedWorld, saveWorld, loadWorld, createDraft, draftTo, commitDraft, draftCost, canPlaceAt, canManage, mergeTargetAt, inboundBelts } from '../js/world.js';
import { Sim } from '../js/sim.js';

const connect = (world, from, to) => {
  const draft = createDraft(world, from);
  draftTo(world, draft, to);
  return commitDraft(world, draft);
};

const find = (world, kind, color) => world.buildings.find((b) => b.kind === kind && (!color || b.color === color));
const goalFor = (item) => ({ index: GOALS.findIndex((g) => g.item === item), got: 0 });
const run = (sim, seconds) => {
  for (let i = 0; i < 60 * seconds; i++) sim.tick(1 / 60);
};

// The opening floor with a mixer between the ores and the hub, and the hub
// asking for Fern: the shape most of these tests want.
const fernFloor = (seed = 3) => {
  const world = seedWorld(new World(seed));
  const hub = find(world, KIND.HUB);
  const mixer = world.addBuilding(KIND.MIXER, hub.x - 3, hub.y);
  world.goal = goalFor('green');
  return { world, hub, mixer, blue: find(world, KIND.DEPOSIT, 'blue'), yellow: find(world, KIND.DEPOSIT, 'yellow') };
};

// ---- colours and items ----

test('mixing is set union, and only when both sides add something', () => {
  assert.equal(mix('blue', 'yellow'), 'green');
  assert.equal(mix('yellow', 'blue'), 'green');
  assert.equal(mix('red', 'blue'), 'purple');
  assert.equal(mix('red', 'yellow'), 'orange');
  assert.equal(mix('green', 'red'), 'slate');
  assert.equal(mix('purple', 'yellow'), 'slate');
  assert.equal(mix('green', 'purple'), 'slate');
  // No reaction: same colour, or one already contains the other.
  assert.equal(mix('blue', 'blue'), null);
  assert.equal(mix('green', 'blue'), null);
  assert.equal(mix('slate', 'red'), null);
});

test('findRecipe picks a pair that reacts and ignores one that does not', () => {
  assert.equal(findRecipe(['blue', 'blue', 'blue']), null);
  const r = findRecipe(['blue', 'blue', 'yellow']);
  assert.deepEqual([r.i, r.j, r.out], [0, 2, 'green']);
});

test('an item is a colour and a size, and a plain bead is just its colour', () => {
  assert.equal(itemKey('blue'), 'blue');
  assert.equal(itemKey('blue', 2), 'blue:2');
  assert.equal(colorOf('green:3'), 'green');
  assert.equal(sizeOf('green'), 1);
  assert.equal(sizeOf('green:3'), 3);
  assert.equal(itemName('yellow:2'), 'Amber pearl');
  assert.equal(itemName('blue', 10), 'Cobalt beads');
});

test('only items of the same size mix, and the mix keeps that size', () => {
  assert.equal(mixItems('red', 'blue'), 'purple');
  assert.equal(mixItems('red:2', 'blue:2'), 'purple:2');
  assert.equal(mixItems('red', 'blue:2'), null, 'a bead and a pearl do not react');
  assert.equal(mixItems('green:2', 'blue:2'), null, 'the colour rule still holds');
});

test('a press turns two matching items into one a size up, as far as an orb', () => {
  assert.equal(pressItems('yellow', 'yellow'), 'yellow:2');
  assert.equal(pressItems('yellow:2', 'yellow:2'), 'yellow:3');
  assert.equal(pressItems('yellow:3', 'yellow:3'), null, 'an orb is as big as it gets');
  assert.equal(pressItems('yellow', 'blue'), null);
  assert.equal(pressItems('yellow', 'yellow:2'), null, 'sizes have to match too');
  const r = findPress(['blue', 'yellow', 'blue']);
  assert.deepEqual([r.i, r.j, r.out], [0, 2, 'blue:2']);
});

test('build keys name a machine, or a deposit and its colour', () => {
  assert.deepEqual(buildParts('ore:red'), { kind: KIND.DEPOSIT, color: 'red' });
  assert.deepEqual(buildParts('mixer'), { kind: KIND.MIXER, color: null });
  assert.equal(buildKey(KIND.DEPOSIT, 'red'), 'ore:red');
  assert.equal(buildKey(KIND.PRESS, null), 'press');
});

test('everything a goal unlocks is something the build list can place', () => {
  const unlocks = [...START_UNLOCKED, ...GOALS.flatMap((g) => g.gives.unlocks)];
  for (const key of unlocks) assert.ok(BUILDS.includes(key), `${key} is not on the build list`);
  assert.equal(new Set(unlocks).size, unlocks.length, 'nothing is unlocked twice');
  assert.ok(GOALS.every((g) => g.gives.belts > 0), 'every goal adds belt tiles');
});

// ---- drawing belts ----

test('a drawn belt runs from building to building and costs its inner cells', () => {
  const { world, mixer, blue } = fernFloor(11);
  const draft = createDraft(world, blue);
  draftTo(world, draft, mixer);

  assert.equal(draft.end, mixer, 'the drag should land on the mixer');
  assert.deepEqual(draft.cells[0], { x: blue.x, y: blue.y });
  assert.deepEqual(draft.cells.at(-1), { x: mixer.x, y: mixer.y });
  for (let i = 1; i < draft.cells.length; i++) {
    const a = draft.cells[i - 1];
    const b = draft.cells[i];
    assert.equal(Math.abs(a.x - b.x) + Math.abs(a.y - b.y), 1, 'steps are single orthogonal moves');
  }

  const before = world.stock.belts;
  const cost = draftCost(draft);
  commitDraft(world, draft);
  assert.equal(cost.belts, draft.cells.length - 2, 'you pay for the road, not the buildings');
  assert.equal(world.stock.belts, before - cost.belts);
});

test('dragging back over the path shortens it again', () => {
  const world = seedWorld(new World(5));
  const blue = find(world, KIND.DEPOSIT, 'blue');
  const draft = createDraft(world, blue);
  draftTo(world, draft, { x: blue.x + 4, y: blue.y });
  assert.equal(draft.cells.length, 5);
  draftTo(world, draft, { x: blue.x + 2, y: blue.y });
  assert.equal(draft.cells.length, 3);
  assert.equal(draftCost(draft).belts, 2);
});

test('deposits only send, the hub only receives, and belts never double up', () => {
  const { world, hub, mixer, blue } = fernFloor(2);

  const toOre = createDraft(world, mixer);
  draftTo(world, toOre, blue);
  assert.equal(toOre.end, null, 'a deposit cannot receive');
  assert.equal(toOre.blocked, 'kind');

  const fromHub = createDraft(world, hub);
  draftTo(world, fromHub, mixer);
  assert.equal(fromHub.end, null, 'the hub is the end of the line');

  connect(world, blue, mixer);
  const again = createDraft(world, blue);
  draftTo(world, again, mixer);
  assert.equal(again.end, null, 'the same pair cannot be wired twice');
  assert.equal(again.blocked, 'duplicate');
});

test('belts cannot cross without a bridge, and a bridge costs extra tiles', () => {
  const world = new World(1);
  world.cols = 11;
  world.rows = 11;
  const src = world.addBuilding(KIND.DEPOSIT, 5, 0, { color: 'blue' });
  const dst = world.addBuilding(KIND.MIXER, 5, 10);
  const src2 = world.addBuilding(KIND.DEPOSIT, 0, 5, { color: 'yellow' });
  const dst2 = world.addBuilding(KIND.MIXER, 10, 5);
  connect(world, src, dst); // straight down the middle, so there is no way round

  // Nine cells across plus the bridge is more than eight tiles will pay for.
  world.stock.belts = 8;
  const short = createDraft(world, src2);
  draftTo(world, short, dst2);
  assert.equal(short.end, null);
  assert.equal(short.blocked, 'no-belts');
  assert.ok(draftCost(short).belts <= 8, 'the line shown is only as long as the tiles in hand');

  world.stock.belts = 40;
  const crossing = createDraft(world, src2);
  draftTo(world, crossing, dst2);
  assert.equal(crossing.end, dst2);
  assert.equal(crossing.bridges.length, 1);
  assert.deepEqual(crossing.bridges[0], { x: 5, y: 5 });
  const cost = draftCost(crossing);
  assert.equal(cost.belts, crossing.cells.length - 2 + TUNE.bridgeTiles);

  const belt = commitDraft(world, crossing);
  assert.equal(world.stock.belts, 40 - cost.belts, 'the bridge is paid for in tiles');
  world.removeBelt(belt);
  assert.equal(world.stock.belts, 40, 'and comes back with the belt');
});

test('however the floor is wired, belts only ever meet on a bridge', () => {
  const world = new World(77);
  world.stock.belts = 4000;
  const kinds = [KIND.DEPOSIT, KIND.MIXER, KIND.PRESS];
  for (let i = 0; i < 12; i++) {
    const spot = { x: 1 + world.rng.int(world.cols - 2), y: 1 + world.rng.int(world.rows - 2) };
    if (world.buildingAt(spot.x, spot.y)) continue;
    const kind = kinds[i % 3];
    world.addBuilding(kind, spot.x, spot.y, kind === KIND.DEPOSIT ? { color: 'blue' } : {});
  }

  for (let i = 0; i < 120; i++) {
    const from = world.buildings[world.rng.int(world.buildings.length)];
    const to = world.buildings[world.rng.int(world.buildings.length)];
    if (from === to) continue;
    const draft = createDraft(world, from);
    draftTo(world, draft, to);
    if (draft.end) commitDraft(world, draft);
  }
  assert.ok(world.belts.length > 3, 'some belts were actually laid');

  for (let x = 0; x < world.cols; x++) {
    for (let y = 0; y < world.rows; y++) {
      const here = world.beltsAt(x, y);
      if (here.length < 2) continue;
      assert.equal(here.length, 2, `${here.length} belts stacked on ${x},${y}`);
      const [a, b] = here;
      const bridged = here.filter((e) => e.belt.bridges.has(`${x},${y}`));
      assert.equal(bridged.length, 1, `one belt should be carried over ${x},${y}`);
      assert.notEqual(world.axisAt(a.belt, a.index), world.axisAt(b.belt, b.index), 'crossings are at right angles');
      assert.ok(['h', 'v'].includes(world.axisAt(a.belt, a.index)), 'nobody turns on a bridge');
      assert.ok(['h', 'v'].includes(world.axisAt(b.belt, b.index)), 'nobody turns on a bridge');
    }
  }
});

test('removing a belt hands the tiles back', () => {
  const { world, mixer, blue } = fernFloor(9);
  const before = { ...world.stock };
  const belt = connect(world, blue, mixer);
  assert.ok(world.stock.belts < before.belts);
  world.removeBelt(belt);
  assert.deepEqual(world.stock, before);
  assert.equal(world.beltsAt(belt.cells[1].x, belt.cells[1].y).length, 0);
});

// ---- the line running ----

test('two ores reach a mixer, come out mixed and count towards the goal', () => {
  const { world, hub, mixer, blue, yellow } = fernFloor();
  connect(world, blue, mixer);
  connect(world, yellow, mixer);
  connect(world, mixer, hub);

  const made = [];
  const sim = new Sim(world, { onCraft: (b, key) => made.push(key) });
  run(sim, 30);

  assert.ok(made.length > 0, 'the mixer produced something');
  assert.ok(made.every((c) => c === 'green'), `blue + yellow is green, got ${[...new Set(made)]}`);
  assert.ok(world.goal.got > 0, 'the hub counted them');
  assert.equal(world.goal.got, sim.delivered);
});

test('a press turns matching beads into pearls', () => {
  const world = seedWorld(new World(3));
  const hub = find(world, KIND.HUB);
  const press = world.addBuilding(KIND.PRESS, hub.x - 2, hub.y + 4);
  world.goal = goalFor('yellow:2');
  connect(world, find(world, KIND.DEPOSIT, 'yellow'), press);
  connect(world, press, hub);

  const made = [];
  const sim = new Sim(world, { onCraft: (b, key) => made.push(key) });
  run(sim, 40);
  assert.ok(made.length >= 4, `the press should keep up with one deposit, made ${made.length}`);
  assert.ok(made.every((k) => k === 'yellow:2'));
  assert.equal(world.goal.got, made.length - (press.out ? 1 : 0) - inFlight(world, 'yellow:2'));
});

const inFlight = (world, key) => world.belts.reduce((n, belt) => n + belt.items.filter((i) => i.key === key).length, 0);

test('the hub scraps what it did not ask for, without backing the line up', () => {
  const world = seedWorld(new World(3));
  const hub = find(world, KIND.HUB);
  assert.equal(GOALS[world.goal.index].item, 'blue', 'the first goal is Cobalt');
  const amber = connect(world, find(world, KIND.DEPOSIT, 'yellow'), hub);

  const rejected = [];
  const sim = new Sim(world, { onReject: (b, key) => rejected.push(key) });
  run(sim, 30);
  assert.ok(rejected.length >= 8, `Amber kept arriving and was scrapped (${rejected.length})`);
  assert.ok(rejected.every((k) => k === 'yellow'));
  assert.equal(world.goal.got, 0, 'none of it counted');
  assert.ok(amber.items.length <= 3, 'and nothing queued up waiting to be let in');
});

test('finishing a goal hands over what it gives and moves the hub on', () => {
  const world = seedWorld(new World(3));
  const hub = find(world, KIND.HUB);
  const seen = [];
  const sim = new Sim(world, { onGoal: (done, next) => seen.push([done, next]) });
  const first = GOALS[0];
  world.goal.got = first.count - 1;
  const belts = world.stock.belts;

  assert.equal(sim.deliver(hub, first.item), true);
  assert.deepEqual(world.goal, { index: 1, got: 0 });
  assert.deepEqual(seen, [[first, GOALS[1]]]);
  assert.equal(world.stock.belts, belts + first.gives.belts);
  for (const key of first.gives.unlocks) assert.ok(world.unlocked.includes(key), `${key} is unlocked`);
  assert.deepEqual(world.fresh, first.gives.unlocks, 'and marked new until the build list is opened');
});

test('once the last goal is done the hub takes anything', () => {
  const world = seedWorld(new World(3));
  const hub = find(world, KIND.HUB);
  world.goal = { index: GOALS.length, got: 0 };
  const rejected = [];
  const sim = new Sim(world, { onReject: () => rejected.push(1) });
  assert.equal(sim.goal, null);
  for (const key of ['blue', 'slate', 'purple:3']) assert.equal(sim.deliver(hub, key), true);
  assert.equal(sim.delivered, 3);
  assert.equal(rejected.length, 0);
});

// Every goal, played with nothing but what the ladder has unlocked by then. If
// a goal ever asks for something that cannot be built yet, this is where it shows.
test('every goal can be met with what the goals before it unlocked', () => {
  const world = seedWorld(new World(3));
  const hub = find(world, KIND.HUB);
  const ore = (color) => find(world, KIND.DEPOSIT, color);
  const take = (key, dx, dy) => {
    assert.ok(world.unlocked.includes(key), `goal ${world.goal.index + 1} needs a ${key}, unlocked are ${world.unlocked}`);
    const { kind, color } = buildParts(key);
    assert.ok(canPlaceAt(world, hub.x + dx, hub.y + dy), `room for the ${key}`);
    return world.addBuilding(kind, hub.x + dx, hub.y + dy, color ? { color } : {});
  };
  const wire = (...pairs) => {
    for (const [a, b] of pairs) assert.ok(connect(world, a, b), `belt from ${a.kind} to ${b.kind}`);
  };
  const sim = new Sim(world);
  const finish = () => {
    const goal = world.goal.index;
    for (let i = 0; i < 60 * 300 && world.goal.index === goal; i++) sim.tick(1 / 60);
    assert.equal(world.goal.index, goal + 1, `goal ${goal + 1} was not met within five minutes`);
    // Each goal is rebuilt from scratch, the way a player tears up the last line.
    [...world.belts].forEach((belt) => world.removeBelt(belt));
  };

  wire([ore('blue'), hub]);
  finish();
  const mixer = take('mixer', -3, 0);
  wire([ore('blue'), mixer], [ore('yellow'), mixer], [mixer, hub]);
  finish();
  const press = take('press', -2, 4);
  wire([ore('yellow'), press], [press, hub]);
  finish();
  const ruby = take('ore:red', 4, -4);
  wire([ruby, mixer], [ore('yellow'), mixer], [mixer, hub]);
  finish();
  const cobalt = take('ore:blue', -7, 0);
  take('splitter', 2, 4);
  wire([ruby, mixer], [cobalt, mixer], [mixer, press], [press, hub]);
  finish();
  const second = take('mixer', 3, 0);
  wire([ore('blue'), mixer], [ore('yellow'), mixer], [mixer, second], [ruby, second], [second, hub]);
  finish();
  assert.equal(sim.goal, null, 'the ladder is finished');
});

test('one item with no partner chokes a mixer, which stalls but never ends the game', () => {
  const { world, mixer, blue } = fernFloor();
  connect(world, blue, mixer);

  const events = [];
  const sim = new Sim(world, { onJam: () => events.push('jam') });
  run(sim, 120);

  assert.deepEqual(events, ['jam']);
  assert.equal(mixer.buffer.length, TUNE.mixerCap);
  assert.ok(mixer.jam > 0, 'it is still flashing');
  assert.equal(sim.time > 119, true, 'and the floor kept running');
});

test('dumping a stuck machine clears it', () => {
  const { world, mixer, blue } = fernFloor();
  connect(world, blue, mixer);
  const sim = new Sim(world);
  run(sim, 25);

  assert.ok(mixer.jam > 0, 'the alarm is running');
  assert.equal(sim.vent(mixer), true);
  assert.equal(mixer.buffer.length, 0);
  assert.equal(mixer.jam, 0);
  assert.equal(sim.vent(mixer), false, 'nothing left to dump');
});

test('items keep their spacing and ride the belt in order', () => {
  const { world, mixer, blue } = fernFloor();
  const belt = connect(world, blue, mixer);
  const sim = new Sim(world);
  for (let i = 0; i < 60 * 12; i++) {
    sim.tick(1 / 60);
    for (let k = 1; k < belt.items.length; k++) {
      const gap = belt.items[k - 1].d - belt.items[k].d;
      assert.ok(gap >= TUNE.itemGap - 1e-6, `items overlapped (gap ${gap.toFixed(3)})`);
    }
  }
});

test('a splitter feeds its outgoing belts in turn', () => {
  const world = new World(4);
  world.stock.belts = 400;
  const ore = world.addBuilding(KIND.DEPOSIT, 2, 7, { color: 'blue' });
  const split = world.addBuilding(KIND.SPLITTER, 8, 7);
  const left = world.addBuilding(KIND.MIXER, 14, 3);
  const right = world.addBuilding(KIND.MIXER, 14, 11);
  connect(world, ore, split);
  const a = connect(world, split, left);
  const b = connect(world, split, right);
  assert.ok(a && b, 'a splitter both receives and sends');

  const sim = new Sim(world);
  run(sim, 60);
  const served = left.buffer.length + right.buffer.length + a.items.length + b.items.length;
  assert.ok(served >= 4, `expected the splitter to pass items on, saw ${served}`);
  assert.ok(Math.abs(a.items.length + left.buffer.length - (b.items.length + right.buffer.length)) <= 1, 'the two outputs stay level');
});

// ---- placing and moving machines ----

test('a machine needs empty floor with a cell of air around it', () => {
  const { world, mixer, blue } = fernFloor(8);
  assert.equal(canPlaceAt(world, mixer.x, mixer.y), false, 'not on top of a building');
  assert.equal(canPlaceAt(world, mixer.x + 1, mixer.y), false, 'not touching one either');
  assert.equal(canPlaceAt(world, -1, 3), false, 'not off the floor');

  const spot = { x: mixer.x, y: mixer.y - 3 };
  assert.equal(canPlaceAt(world, spot.x, spot.y), true);
  const belt = connect(world, blue, mixer);
  const onBelt = belt.cells[2];
  assert.equal(canPlaceAt(world, onBelt.x, onBelt.y), false, 'not on a running belt');
});

test('every machine is yours to move, but the hub stays put', () => {
  const { world, hub, mixer, blue } = fernFloor(8);
  assert.equal(canManage(mixer), true);
  assert.equal(canManage(blue), true);
  assert.equal(canManage(world.addBuilding(KIND.SPLITTER, 1, 1)), true);
  assert.equal(canManage(world.addBuilding(KIND.PRESS, 1, 12)), true);
  assert.equal(canManage(hub), false, 'the goals live in the hub');
});

test('a machine in hand does not block its own landing spot', () => {
  const { world, mixer, blue } = fernFloor(8);
  assert.equal(canPlaceAt(world, mixer.x, mixer.y), false, 'occupied for anything else');
  assert.equal(canPlaceAt(world, mixer.x, mixer.y, mixer), true, 'but it may be put back');
  assert.equal(canPlaceAt(world, mixer.x, mixer.y - 1, mixer), true, 'and nudged one over');
  assert.equal(canPlaceAt(world, blue.x, blue.y, mixer), false, 'someone else still blocks');
  assert.equal(canPlaceAt(world, blue.x + 1, blue.y, mixer), false, 'as does their elbow room');
});

test("a machine's own belt does not block it either, since that belt is going", () => {
  const { world, mixer, blue } = fernFloor(8);
  const belt = connect(world, blue, mixer);
  const onIts = belt.cells[belt.cells.length - 2]; // the cell its own lane runs through

  assert.equal(canPlaceAt(world, onIts.x, onIts.y), false, 'a running lane is in the way');
  assert.equal(canPlaceAt(world, onIts.x, onIts.y, mixer), true, 'but moving the mixer removes that lane anyway');

  // Somebody else's lane is still a lane.
  const other = connect(world, blue, world.addBuilding(KIND.MIXER, mixer.x - 1, mixer.y + 5));
  const theirs = other.cells[2];
  assert.equal(canPlaceAt(world, theirs.x, theirs.y, mixer), false, 'not onto a lane that stays');
});

test('taking a machine away takes its belts and hands the tiles back', () => {
  const { world, hub, mixer, blue } = fernFloor(8);
  const before = world.stock.belts;
  connect(world, blue, mixer);
  connect(world, mixer, hub);
  assert.equal(world.belts.length, 2);
  assert.ok(world.stock.belts < before);

  world.removeBuilding(mixer);
  assert.equal(world.belts.length, 0, 'its lines went with it');
  assert.equal(world.stock.belts, before, 'and the tiles came back');
  assert.equal(world.buildings.includes(mixer), false);
});

// ---- joining one belt to another ----

const laneWorld = () => {
  const world = new World(2);
  world.stock.belts = 400;
  world.addBuilding(KIND.DEPOSIT, 2, 2, { color: 'blue' });
  world.addBuilding(KIND.DEPOSIT, 2, 10, { color: 'yellow' });
  world.addBuilding(KIND.MIXER, 16, 2);
  world.addBuilding(KIND.HUB, 16, 10);
  world.goal = goalFor('green');
  return world;
};

test('a belt can end on another belt, and its load merges into that lane', () => {
  const world = laneWorld();
  const main = connect(world, find(world, KIND.DEPOSIT, 'blue'), find(world, KIND.MIXER));
  const mid = main.cells[5];
  assert.ok(mergeTargetAt(world, mid.x, mid.y), 'the middle of a lane is joinable');

  const feeder = connect(world, find(world, KIND.DEPOSIT, 'yellow'), mid);
  assert.ok(feeder, 'the belt was laid');
  assert.equal(feeder.to, null, 'it ends on a belt, not a machine');
  assert.deepEqual(feeder.feed, { beltId: main.id, index: 5 });

  connect(world, find(world, KIND.MIXER), find(world, KIND.HUB));
  const sim = new Sim(world);
  run(sim, 60);
  assert.ok(world.goal.got > 0, 'both ores reached the mixer down one shared lane');
});

test('merging never drops an item on top of another', () => {
  const world = laneWorld();
  const main = connect(world, find(world, KIND.DEPOSIT, 'blue'), find(world, KIND.MIXER));
  connect(world, find(world, KIND.DEPOSIT, 'yellow'), main.cells[5]);
  const sim = new Sim(world);
  for (let i = 0; i < 60 * 90; i++) {
    sim.tick(1 / 60);
    for (let k = 1; k < main.items.length; k++) {
      const gap = main.items[k - 1].d - main.items[k].d;
      assert.ok(gap >= TUNE.itemGap - 1e-6, `merged items overlapped (gap ${gap.toFixed(3)})`);
    }
  }
});

test('a lane cannot be joined on a bridge, or twice in the same spot', () => {
  const world = new World(1);
  world.stock.belts = 400;
  world.stock.bridges = 4;
  const a = world.addBuilding(KIND.DEPOSIT, 5, 0, { color: 'blue' });
  const b = world.addBuilding(KIND.MIXER, 5, 13);
  const c = world.addBuilding(KIND.DEPOSIT, 0, 6, { color: 'yellow' });
  const d = world.addBuilding(KIND.MIXER, 13, 6);
  connect(world, a, b);
  const crossing = connect(world, c, d);
  const bridge = [...crossing.bridges][0].split(',').map(Number);
  assert.equal(mergeTargetAt(world, bridge[0], bridge[1]), null, 'a bridge cell is an overpass, not a junction');

  const main = world.belts[0];
  const spot = main.cells[3];
  const e = world.addBuilding(KIND.DEPOSIT, 0, 1, { color: 'red' });
  assert.ok(mergeTargetAt(world, spot.x, spot.y));
  connect(world, e, spot);
  assert.equal(mergeTargetAt(world, spot.x, spot.y), null, 'that spot is taken now');
});

test('pulling up a lane takes its feeders with it', () => {
  const world = laneWorld();
  const main = connect(world, find(world, KIND.DEPOSIT, 'blue'), find(world, KIND.MIXER));
  const feeder = connect(world, find(world, KIND.DEPOSIT, 'yellow'), main.cells[5]);
  assert.equal(world.belts.length, 2);
  world.removeBelt(main);
  assert.equal(world.belts.length, 0, 'the feeder had nowhere left to go');
  assert.equal(world.belts.includes(feeder), false);
});

test('you still cannot branch off a belt without a splitter', () => {
  const world = laneWorld();
  const main = connect(world, find(world, KIND.DEPOSIT, 'blue'), find(world, KIND.MIXER));
  const mid = main.cells[5];
  // There is no building on that cell, so there is nothing to start a drag from.
  assert.equal(world.buildingAt(mid.x, mid.y), null);
  const draft = createDraft(world, find(world, KIND.HUB));
  draftTo(world, draft, mid);
  assert.equal(draft.endFeed, null, 'the hub is still the end of the line');
});

test('a lane that merges in still counts as feeding the machine it reaches', () => {
  const world = laneWorld();
  const mixer = find(world, KIND.MIXER);
  const main = connect(world, find(world, KIND.DEPOSIT, 'blue'), mixer);
  assert.equal(inboundBelts(world, mixer).length, 1);

  connect(world, find(world, KIND.DEPOSIT, 'yellow'), main.cells[5]);
  assert.equal(world.beltsTo(mixer).length, 1, 'only one belt actually ends on the mixer');
  assert.equal(inboundBelts(world, mixer).length, 2, 'but two lines feed it');
});

test('a feeder waits at the kerb instead of standing in the lane', () => {
  const world = laneWorld();
  const main = connect(world, find(world, KIND.DEPOSIT, 'blue'), find(world, KIND.MIXER));
  const feeder = connect(world, find(world, KIND.DEPOSIT, 'yellow'), main.cells[5]);
  const sim = new Sim(world);
  for (let i = 0; i < 60 * 60; i++) {
    sim.tick(1 / 60);
    for (const item of feeder.items) {
      assert.ok(item.d <= feeder.len - TUNE.mergeStop + 1e-6, `a waiting item reached the junction (d ${item.d.toFixed(2)} of ${feeder.len})`);
    }
  }
});

// ---- the opening floor and saving it ----

test('a new floor is the hub and two ores, with only those ores to build and the first goal', () => {
  const world = seedWorld(new World(6));
  assert.deepEqual(world.buildings.map((b) => b.kind + (b.color ? `:${b.color}` : '')).sort(), ['deposit:blue', 'deposit:yellow', 'hub']);
  assert.deepEqual(world.unlocked, START_UNLOCKED);
  assert.deepEqual(world.fresh, []);
  assert.equal(world.stock.belts, TUNE.startBelts);
  assert.deepEqual(world.goal, { index: 0, got: 0 });
  assert.ok(find(world, KIND.DEPOSIT, colorOf(GOALS[0].item)), 'the first goal can be met straight away');
});

test('a saved floor comes back as it was, and keeps running', () => {
  const world = laneWorld();
  const mixer = find(world, KIND.MIXER);
  const hub = find(world, KIND.HUB);
  const main = connect(world, find(world, KIND.DEPOSIT, 'blue'), mixer);
  connect(world, find(world, KIND.DEPOSIT, 'yellow'), main.cells[5]);
  connect(world, mixer, hub);
  const crosser = world.addBuilding(KIND.DEPOSIT, 9, 0, { color: 'red' });
  const crossing = connect(world, crosser, world.addBuilding(KIND.PRESS, 9, 13));
  assert.ok(crossing.bridges.size > 0, 'the save has a bridge to carry');
  world.unlocked.push('press', 'ore:red');
  world.fresh = ['ore:red'];
  world.goal.got = 7;

  const copy = loadWorld(JSON.parse(JSON.stringify(saveWorld(world))));
  assert.deepEqual(saveWorld(copy), saveWorld(world));
  for (const belt of world.belts) {
    for (let i = 1; i < belt.cells.length - 1; i++) {
      const { x, y } = belt.cells[i];
      assert.equal(copy.beltsAt(x, y).length, world.beltsAt(x, y).length, `lane cells at ${x},${y} are taken again`);
    }
  }
  const fresh = copy.addBuilding(KIND.SPLITTER, 1, 6);
  assert.ok(!world.buildings.some((b) => b.id === fresh.id) && !world.belts.some((b) => b.id === fresh.id), 'new ids do not collide');

  const sim = new Sim(copy);
  run(sim, 30);
  assert.ok(sim.delivered > 0, 'the restored line delivers');
});

test('a save this build cannot read is ignored', () => {
  assert.equal(loadWorld(null), null);
  assert.equal(loadWorld({ version: 99 }), null);
});
