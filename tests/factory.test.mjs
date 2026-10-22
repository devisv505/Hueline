import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mix, findRecipe, TUNE, GOODS, TECHS, techCost, creditsFor } from '../js/config.js';
import { World, KIND, seedWorld, createDraft, draftTo, commitDraft, draftCost, makeableColors, canPlaceAt, mergeTargetAt, inboundBelts } from '../js/world.js';
import { Sim } from '../js/sim.js';

const connect = (world, from, to) => {
  const draft = createDraft(world, from);
  draftTo(world, draft, to);
  return commitDraft(world, draft);
};

const find = (world, kind, color) => world.buildings.find((b) => b.kind === kind && (!color || b.color === color));

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

test('a drawn belt runs from building to building and costs its inner cells', () => {
  const world = seedWorld(new World(11));
  const mixer = find(world, KIND.MIXER);
  const blue = find(world, KIND.DEPOSIT, 'blue');
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

test('ore deposits only send and belts never double up', () => {
  const world = seedWorld(new World(2));
  const blue = find(world, KIND.DEPOSIT, 'blue');
  const yellow = find(world, KIND.DEPOSIT, 'yellow');
  const mixer = find(world, KIND.MIXER);

  const toOre = createDraft(world, mixer);
  draftTo(world, toOre, blue);
  assert.equal(toOre.end, null, 'a deposit cannot receive');
  assert.equal(toOre.blocked, 'kind');

  connect(world, blue, mixer);
  const again = createDraft(world, blue);
  draftTo(world, again, mixer);
  assert.equal(again.end, null, 'the same pair cannot be wired twice');
  assert.equal(again.blocked, 'duplicate');
  assert.ok(yellow);
});

test('belts cannot cross without a bridge, and a bridge is spent when they do', () => {
  const world = new World(1);
  world.cols = 11;
  world.rows = 11;
  const src = world.addBuilding(KIND.DEPOSIT, 5, 0, { color: 'blue' });
  const dst = world.addBuilding(KIND.MIXER, 5, 10);
  const src2 = world.addBuilding(KIND.DEPOSIT, 0, 5, { color: 'yellow' });
  const dst2 = world.addBuilding(KIND.MIXER, 10, 5);

  connect(world, src, dst); // straight down the middle
  world.stock.bridges = 0;
  const blocked = createDraft(world, src2);
  draftTo(world, blocked, dst2);
  assert.equal(blocked.end, null);
  assert.equal(blocked.blocked, 'no-bridges');
  assert.ok(blocked.cells.length <= 5, 'the path stops at the belt it cannot cross');

  world.stock.bridges = 1;
  const crossing = createDraft(world, src2);
  draftTo(world, crossing, dst2);
  assert.equal(crossing.end, dst2);
  assert.equal(crossing.bridges.length, 1);
  assert.deepEqual(crossing.bridges[0], { x: 5, y: 5 });

  commitDraft(world, crossing);
  assert.equal(world.stock.bridges, 0, 'the bridge is paid for');
});

test('however the floor is wired, belts only ever meet on a bridge', () => {
  const world = new World(77);
  world.stock.belts = 4000;
  world.stock.bridges = 400;
  const kinds = [KIND.DEPOSIT, KIND.MIXER, KIND.DEPOT];
  for (let i = 0; i < 12; i++) {
    const spot = { x: 1 + world.rng.int(world.cols - 2), y: 1 + world.rng.int(world.rows - 2) };
    if (world.buildingAt(spot.x, spot.y)) continue;
    const kind = kinds[i % 3];
    world.addBuilding(kind, spot.x, spot.y, kind === KIND.MIXER ? {} : { color: 'blue' });
  }

  for (let i = 0; i < 120; i++) {
    const from = world.buildings[world.rng.int(world.buildings.length)];
    const to = world.buildings[world.rng.int(world.buildings.length)];
    if (from === to || (from.kind !== KIND.DEPOSIT && from.kind !== KIND.MIXER)) continue;
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

test('removing a belt hands the tiles and bridges back', () => {
  const world = seedWorld(new World(9));
  const before = { ...world.stock };
  const belt = connect(world, find(world, KIND.DEPOSIT, 'blue'), find(world, KIND.MIXER));
  assert.ok(world.stock.belts < before.belts);
  world.removeBelt(belt);
  assert.deepEqual(world.stock, before);
  assert.equal(world.beltsAt(belt.cells[1].x, belt.cells[1].y).length, 0);
});

test('two ores reach a mixer, come out mixed and are delivered', () => {
  const world = seedWorld(new World(3));
  const mixer = find(world, KIND.MIXER);
  connect(world, find(world, KIND.DEPOSIT, 'blue'), mixer);
  connect(world, find(world, KIND.DEPOSIT, 'yellow'), mixer);
  connect(world, mixer, find(world, KIND.DEPOT));

  const made = [];
  const sim = new Sim(world, { onCraft: (b, color) => made.push(color) });
  for (let i = 0; i < 60 * 30; i++) sim.tick(1 / 60);

  assert.ok(made.length > 0, 'the mixer produced something');
  assert.ok(made.every((c) => c === 'green'), `blue + yellow is green, got ${[...new Set(made)]}`);
  assert.ok(sim.score > 0, 'the shop was served');
  assert.equal(sim.over, false);
});

test('one colour with no partner overflows the mixer and stops the line', () => {
  const world = seedWorld(new World(3));
  const mixer = find(world, KIND.MIXER);
  connect(world, find(world, KIND.DEPOSIT, 'blue'), mixer);

  const events = [];
  const sim = new Sim(world, { onJam: () => events.push('jam'), onFail: () => events.push('fail') });
  for (let i = 0; i < 60 * 120 && !sim.over; i++) sim.tick(1 / 60);

  assert.deepEqual(events, ['jam', 'fail']);
  assert.equal(mixer.buffer.length, TUNE.mixerCap);
  assert.ok(sim.over);
});

test('venting a jammed mixer clears it for a price', () => {
  const world = seedWorld(new World(3));
  const mixer = find(world, KIND.MIXER);
  connect(world, find(world, KIND.DEPOSIT, 'blue'), mixer);
  const sim = new Sim(world);
  sim.score = 10;
  for (let i = 0; i < 60 * 25; i++) sim.tick(1 / 60);

  assert.ok(mixer.jam > 0, 'the alarm is running');
  assert.equal(sim.vent(mixer), true);
  assert.equal(mixer.buffer.length, 0);
  assert.equal(mixer.jam, 0);
  assert.equal(sim.score, 10 - TUNE.ventCost);
  assert.equal(sim.vent(mixer), false, 'nothing left to dump');
});

test('relaxed mode keeps an overflowing machine from ending the run', () => {
  const world = seedWorld(new World(3));
  connect(world, find(world, KIND.DEPOSIT, 'blue'), find(world, KIND.MIXER));
  const sim = new Sim(world);
  sim.relaxed = true;
  for (let i = 0; i < 60 * 120; i++) sim.tick(1 / 60);
  assert.equal(sim.over, false);
});

test('new arrivals only ask for colours the floor can actually make', () => {
  const world = seedWorld(new World(21));
  const sim = new Sim(world);
  for (let i = 0; i < 60 * 400; i++) sim.tick(1 / 60);

  assert.ok(world.buildings.length > 4, 'the factory grew');
  const makeable = makeableColors(world);
  for (const depot of world.buildings.filter((b) => b.kind === KIND.DEPOT)) {
    assert.ok(makeable.includes(depot.color), `nothing can produce ${depot.color}`);
  }
  for (const b of world.buildings) {
    assert.equal(world.buildingAt(b.x, b.y), b, 'every building is on its own cell');
  }
});

test('items keep their spacing and ride the belt in order', () => {
  const world = seedWorld(new World(3));
  const mixer = find(world, KIND.MIXER);
  const belt = connect(world, find(world, KIND.DEPOSIT, 'blue'), mixer);
  const sim = new Sim(world);
  for (let i = 0; i < 60 * 12; i++) {
    sim.tick(1 / 60);
    for (let k = 1; k < belt.items.length; k++) {
      const gap = belt.items[k - 1].d - belt.items[k].d;
      assert.ok(gap >= TUNE.itemGap - 1e-6, `items overlapped (gap ${gap.toFixed(3)})`);
    }
  }
});

test('a delivery pays by how deep the colour is', () => {
  assert.equal(creditsFor('blue'), 1);
  assert.equal(creditsFor('green'), 2);
  assert.equal(creditsFor('slate'), 4);

  const world = seedWorld(new World(3));
  const mixer = find(world, KIND.MIXER);
  connect(world, find(world, KIND.DEPOSIT, 'blue'), mixer);
  connect(world, find(world, KIND.DEPOSIT, 'yellow'), mixer);
  connect(world, mixer, find(world, KIND.DEPOT));
  const sim = new Sim(world);
  const purse = world.stock.credits;
  for (let i = 0; i < 60 * 30; i++) sim.tick(1 / 60);
  assert.ok(sim.score > 0);
  assert.equal(world.stock.credits, purse + sim.score * 2, 'every Fern paid two');
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
  for (let i = 0; i < 60 * 60; i++) sim.tick(1 / 60);
  const served = left.buffer.length + right.buffer.length + a.items.length + b.items.length;
  assert.ok(served >= 4, `expected the splitter to pass items on, saw ${served}`);
  assert.ok(Math.abs(a.items.length + left.buffer.length - (b.items.length + right.buffer.length)) <= 1, 'the two outputs stay level');
});

test('ore deposits still only send, and shops only receive', () => {
  const world = new World(5);
  const ore = world.addBuilding(KIND.DEPOSIT, 2, 2, { color: 'red' });
  const shop = world.addBuilding(KIND.DEPOT, 10, 2, { color: 'red' });
  const split = world.addBuilding(KIND.SPLITTER, 6, 6);
  const toOre = createDraft(world, split);
  draftTo(world, toOre, ore);
  assert.equal(toOre.end, null);
  assert.equal(toOre.blocked, 'kind');
  const fromShop = createDraft(world, shop);
  draftTo(world, fromShop, split);
  assert.equal(fromShop.end, null, 'a shop is the end of the line');
});

test('a bought machine needs empty floor with a cell of air around it', () => {
  const world = seedWorld(new World(8));
  const mixer = find(world, KIND.MIXER);
  assert.equal(canPlaceAt(world, mixer.x, mixer.y), false, 'not on top of a building');
  assert.equal(canPlaceAt(world, mixer.x + 1, mixer.y), false, 'not touching one either');
  assert.equal(canPlaceAt(world, -1, 3), false, 'not off the floor');

  const spot = { x: mixer.x, y: mixer.y + 3 };
  assert.equal(canPlaceAt(world, spot.x, spot.y), true);
  const belt = connect(world, find(world, KIND.DEPOSIT, 'blue'), mixer);
  const onBelt = belt.cells[2];
  assert.equal(canPlaceAt(world, onBelt.x, onBelt.y), false, 'not on a running belt');
});

test('research is priced per level and actually changes the floor', () => {
  const world = seedWorld(new World(2));
  const express = TECHS.find((t) => t.id === 'express');
  assert.equal(techCost(express, 0), express.cost);
  assert.equal(techCost(express, 1), express.cost + express.step);

  const speed = world.speed;
  express.apply(world);
  assert.ok(world.speed > speed, 'express belts move the line faster');

  const cap = world.caps.mixer;
  TECHS.find((t) => t.id === 'buffers').apply(world);
  assert.equal(world.caps.mixer, cap + 2);

  const fuse = world.jamFuse;
  TECHS.find((t) => t.id === 'reinforced').apply(world);
  assert.ok(world.jamFuse > fuse);

  assert.equal(world.unlocked.splitter, false);
  TECHS.find((t) => t.id === 'splitter').apply(world);
  assert.equal(world.unlocked.splitter, true);
  assert.equal(GOODS.splitter.needs, 'splitter', 'the store keeps the splitter behind that tech');
});

test('wider buffers really do delay an overflow', () => {
  const run = (wide) => {
    const world = seedWorld(new World(3));
    if (wide) TECHS.find((t) => t.id === 'buffers').apply(world);
    connect(world, find(world, KIND.DEPOSIT, 'blue'), find(world, KIND.MIXER));
    const sim = new Sim(world);
    for (let i = 0; i < 60 * 200 && !sim.over; i++) sim.tick(1 / 60);
    return sim.time;
  };
  assert.ok(run(true) > run(false), 'eight slots last longer than six');
});

test('only shops arrive on their own now', () => {
  const world = seedWorld(new World(14));
  const sim = new Sim(world);
  const before = world.buildings.length;
  for (let i = 0; i < 60 * 400; i++) sim.tick(1 / 60);
  assert.ok(world.buildings.length > before, 'the town grew');
  const arrived = world.buildings.slice(before);
  assert.ok(arrived.every((b) => b.kind === KIND.DEPOT), 'machines are bought, not gifted');
});

// ---- joining one belt to another ----

const laneWorld = () => {
  const world = new World(2);
  world.stock.belts = 400;
  world.addBuilding(KIND.DEPOSIT, 2, 2, { color: 'blue' });
  world.addBuilding(KIND.DEPOSIT, 2, 10, { color: 'yellow' });
  world.addBuilding(KIND.MIXER, 16, 2);
  world.addBuilding(KIND.DEPOT, 16, 10, { color: 'green' });
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

  connect(world, find(world, KIND.MIXER), find(world, KIND.DEPOT));
  const sim = new Sim(world);
  for (let i = 0; i < 60 * 60; i++) sim.tick(1 / 60);
  assert.ok(sim.score > 0, 'both ores reached the mixer down one shared lane');
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
  const shop = find(world, KIND.DEPOT);
  const draft = createDraft(world, shop);
  draftTo(world, draft, mid);
  assert.equal(draft.endFeed, null, 'a shop is still the end of the line');
});

// ---- how demand arrives ----

test('shops stop piling onto one colour', () => {
  for (const seed of [3, 11, 21, 37, 44]) {
    const world = seedWorld(new World(seed));
    const sim = new Sim(world);
    for (let i = 0; i < 60 * 600; i++) sim.tick(1 / 60);
    const counts = {};
    for (const shop of world.buildings.filter((b) => b.kind === KIND.DEPOT)) {
      counts[shop.color] = (counts[shop.color] ?? 0) + 1;
    }
    const worst = Math.max(...Object.values(counts));
    assert.ok(worst <= TUNE.sameColorCap, `seed ${seed}: ${worst} shops wanted the same colour`);
    assert.ok(Object.keys(counts).length > 1, `seed ${seed}: only one colour was ever asked for`);
  }
});

test('arrivals hold off once every makeable colour is served', () => {
  const world = seedWorld(new World(5));
  const sim = new Sim(world);
  for (let i = 0; i < 60 * 900; i++) sim.tick(1 / 60);
  const shops = world.buildings.filter((b) => b.kind === KIND.DEPOT);
  // Blue and yellow ore make blue, yellow and green; two shops each is the lot.
  assert.equal(shops.length, 6, 'the floor fills up and then waits for a new ore colour');
  assert.ok(sim.stalled, 'and it knows it is waiting');
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
