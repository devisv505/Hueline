// Colours, recipes and the handful of numbers that make the factory feel right.
// Kept free of DOM so the rules can be unit tested in Node.

// Every colour is a *set of primaries*. Mixing is set union, which is why the
// recipe table below never has to be written out by hand.
export const COLORS = {
  red: { name: 'Ruby', fill: '#ee6a66', deep: '#cf4b47', parts: ['red'] },
  blue: { name: 'Cobalt', fill: '#6ca7e8', deep: '#4b85cb', parts: ['blue'] },
  yellow: { name: 'Amber', fill: '#f3c44d', deep: '#d9a52a', parts: ['yellow'] },
  green: { name: 'Fern', fill: '#7ccf8c', deep: '#55b26b', parts: ['blue', 'yellow'] },
  purple: { name: 'Plum', fill: '#9b7bde', deep: '#7a58c4', parts: ['red', 'blue'] },
  orange: { name: 'Coral', fill: '#f2954e', deep: '#d6742c', parts: ['red', 'yellow'] },
  slate: { name: 'Slate', fill: '#8c8494', deep: '#6d6576', parts: ['red', 'blue', 'yellow'] },
};

export const PRIMARIES = ['red', 'blue', 'yellow'];
const KEYS = Object.keys(COLORS);
const byParts = new Map(KEYS.map((k) => [[...COLORS[k].parts].sort().join('+'), k]));

export function partsOf(color) {
  return COLORS[color].parts;
}

const contains = (a, b) => partsOf(b).every((p) => partsOf(a).includes(p));

// Two colours react only when each one brings something the other lacks, so
// blue + green is a no-op while blue + yellow is green and green + red is slate.
export function mix(a, b) {
  if (!COLORS[a] || !COLORS[b]) return null;
  if (contains(a, b) || contains(b, a)) return null;
  const parts = [...new Set([...partsOf(a), ...partsOf(b)])].sort();
  return byParts.get(parts.join('+')) ?? null;
}

// First pair in the buffer that will actually react.
export function findRecipe(buffer) {
  for (let i = 0; i < buffer.length; i++) {
    for (let j = i + 1; j < buffer.length; j++) {
      const out = mix(buffer[i], buffer[j]);
      if (out) return { i, j, out };
    }
  }
  return null;
}

export const TUNE = {
  cols: 20,
  rows: 14,
  cells: 260, // the floor is cut to roughly this many cells, in the shape of the screen
  beltSpeed: 2.3, // cells per second
  itemGap: 0.6, // cells between items on a belt
  mixerCap: 6, // input buffer size before a mixer overflows
  depotCap: 4,
  depositCap: 4,
  mixTime: 0.8, // seconds to combine a pair
  oreInterval: 2.7, // seconds between ore drops
  demandInterval: 8.5, // seconds between new orders at a depot
  demandCap: 4,
  splitterCap: 4,
  jamFuse: 15, // seconds an overflowing machine survives
  ventCost: 5, // score paid to dump a jammed buffer
  startBelts: 46,
  startBridges: 2,
  startCredits: 6,
  firstSpawn: 32, // seconds before the second wave of buildings
  spawnDecay: 0.97,
  minSpawn: 20,
  sameColorCap: 2, // shops wanting one colour, before the floor needs more variety
  maxBuildings: 20,
};

// Deeper colours take more of the floor to make, so they pay more.
export const CREDITS = { 1: 1, 2: 2, 3: 4 };

export function creditsFor(color) {
  return CREDITS[COLORS[color].parts.length] ?? 1;
}

// The store. `amount` items are stock top-ups; the rest are placed by hand.
export const GOODS = {
  belts: { label: '10 belt tiles', note: 'More line to lay across the floor.', icon: '#i-belt', cost: 4, amount: 10 },
  bridge: { label: 'Bridge', note: 'Carries one belt straight over another.', icon: '#i-bridge', cost: 7, amount: 1 },
  mixer: { label: 'Mixer', note: 'Combines two different colours into a third.', icon: '#i-mixer', cost: 14, place: 'mixer' },
  splitter: { label: 'Splitter', note: 'One belt in, two out, taking turns.', icon: '#i-splitter', cost: 10, place: 'splitter', needs: 'splitter' },
  deposit: { label: 'Ore deposit', note: 'A fresh source of one primary colour.', icon: '#i-ore', cost: 12, place: 'deposit' },
};

// Research. `levels` lets a tech be bought more than once, each time dearer.
export const TECHS = [
  {
    id: 'splitter',
    name: 'Splitters',
    cost: 18,
    icon: '#i-splitter',
    text: 'Unlocks the splitter in the store, so one deposit can feed two machines.',
    apply: (world) => (world.unlocked.splitter = true),
  },
  {
    id: 'express',
    name: 'Express belts',
    cost: 15,
    step: 11,
    levels: 2,
    icon: '#i-belt-fast',
    text: 'Everything on the line moves 20% quicker.',
    apply: (world) => (world.speed *= 1.2),
  },
  {
    id: 'buffers',
    name: 'Wider buffers',
    cost: 22,
    icon: '#i-mixer',
    text: 'Mixers hold eight items instead of six before they overflow.',
    apply: (world) => (world.caps.mixer += 2),
  },
  {
    id: 'reinforced',
    name: 'Reinforced machines',
    cost: 24,
    icon: '#i-shield',
    text: 'An overflowing machine holds on half as long again before it burns out.',
    apply: (world) => (world.jamFuse *= 1.5),
  },
];

export function techCost(tech, level) {
  return tech.cost + (tech.step ?? 0) * level;
}

export const FACTORY_NAMES = ['Prism Works', 'Indigo Reach', 'Pigment Bay', 'Chroma Falls', 'Tint Harbour', 'Spectra Mill'];
