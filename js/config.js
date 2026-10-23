// Colours, items, the goal ladder and the handful of numbers that make the
// factory feel right. Kept free of DOM so the rules can be unit tested in Node.

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

// ---- items ----

// An item is a bead of one colour, and a press squeezes two matching ones into
// the next size up: two beads make a pearl, two pearls an orb. Its key is the
// colour alone for a bead and `colour:size` once pressed, so a plain bead is
// still just its colour wherever the code only cares about colour.
export const SIZES = ['bead', 'pearl', 'orb'];

export const itemKey = (color, size = 1) => (size > 1 ? `${color}:${size}` : color);
export const colorOf = (item) => item.split(':')[0];
export const sizeOf = (item) => Number(item.split(':')[1] ?? 1);

export function itemName(item, count = 1) {
  const name = `${COLORS[colorOf(item)].name} ${SIZES[sizeOf(item) - 1]}`;
  return count === 1 ? name : `${name}s`;
}

// Mixing works on any two items of the same size and keeps that size, so a
// Ruby pearl and a Cobalt pearl make a Plum pearl.
export function mixItems(a, b) {
  if (sizeOf(a) !== sizeOf(b)) return null;
  const out = mix(colorOf(a), colorOf(b));
  return out ? itemKey(out, sizeOf(a)) : null;
}

// Pressing takes two identical items and makes one a size up.
export function pressItems(a, b) {
  if (a !== b || sizeOf(a) >= SIZES.length) return null;
  return itemKey(colorOf(a), sizeOf(a) + 1);
}

// First pair in a buffer that `combine` turns into something.
function firstPair(buffer, combine) {
  for (let i = 0; i < buffer.length; i++) {
    for (let j = i + 1; j < buffer.length; j++) {
      const out = combine(buffer[i], buffer[j]);
      if (out) return { i, j, out };
    }
  }
  return null;
}

export const findRecipe = (buffer) => firstPair(buffer, mixItems);
export const findPress = (buffer) => firstPair(buffer, pressItems);

export const TUNE = {
  cols: 20,
  rows: 14,
  cells: 260, // the floor is cut to roughly this many cells, in the shape of the screen
  beltSpeed: 2.3, // cells per second
  itemGap: 0.6, // cells between items on a belt
  mixerCap: 6, // input buffer size before a mixer chokes
  pressCap: 4,
  depositCap: 4,
  splitterCap: 4,
  mixTime: 0.8, // seconds to combine a pair
  pressTime: 1, // seconds to press a pair
  oreInterval: 2.7, // seconds between ore drops
  mergeStop: 0.5, // how far short of a junction a feeder waits its turn
  holdTime: 0.65, // seconds of press before a machine can be moved
  startBelts: 40,
  bridgeTiles: 3, // extra belt tiles a bridge costs, on top of the tile under it
};

// ---- the goal ladder ----

// The hub asks for one item at a time and takes nothing else. Deliver the count
// and the next goal arrives, with whatever finishing this one hands over: new
// buildings to build as many of as you like, and more belt tiles, which are the
// one thing a floor runs short of. `hint` is the one thing the goal teaches.
export const GOALS = [
  {
    item: 'blue',
    count: 10,
    hint: 'Drag a belt from the Cobalt deposit to the hub.',
    gives: { unlocks: ['mixer'], belts: 8 },
  },
  {
    item: 'green',
    count: 20,
    hint: 'A mixer combines two different colours: Cobalt and Amber make Fern.',
    gives: { unlocks: ['press'], belts: 10 },
  },
  {
    item: 'yellow:2',
    count: 12,
    hint: 'A press squeezes two matching beads into one pearl.',
    gives: { unlocks: ['ore:red'], belts: 10 },
  },
  {
    item: 'orange',
    count: 24,
    hint: 'Ruby and Amber make Coral. Build a Ruby deposit to get started.',
    gives: { unlocks: ['splitter'], belts: 12 },
  },
  {
    item: 'purple:2',
    count: 14,
    hint: 'Mix Ruby and Cobalt into Plum, then press it. Or press first and mix the pearls.',
    gives: { unlocks: [], belts: 12 },
  },
  {
    item: 'slate',
    count: 24,
    hint: 'Slate needs all three primaries: mix a mix with the colour it is missing.',
    gives: { unlocks: [], belts: 15 },
  },
];

// What you can build before any goal is done: more of the two starting ores.
export const START_UNLOCKED = ['ore:blue', 'ore:yellow'];

// Everything that can be built, in the order the build list shows it. An
// `ore:<colour>` key is a deposit of that colour.
export const BUILDS = ['ore:blue', 'ore:yellow', 'ore:red', 'mixer', 'press', 'splitter'];

export const MACHINES = {
  mixer: { label: 'Mixer', note: 'Combines two different colours into a third.', icon: '#i-mixer' },
  press: { label: 'Press', note: 'Squeezes two matching items into one a size up.', icon: '#i-press' },
  splitter: { label: 'Splitter', note: 'One belt in, two out, taking turns.', icon: '#i-splitter' },
  ore: { label: 'Ore deposit', note: 'Drops one bead of its colour every few seconds.', icon: '#i-ore' },
};

// A build key split into what it places: `ore:red` is a Ruby deposit.
export function buildParts(key) {
  const [kind, color] = key.split(':');
  return { kind: kind === 'ore' ? 'deposit' : kind, color: color ?? null };
}

export const buildKey = (kind, color) => (kind === 'deposit' ? `ore:${color}` : kind);

export const FACTORY_NAMES = ['Prism Works', 'Indigo Reach', 'Pigment Bay', 'Chroma Falls', 'Tint Harbour', 'Spectra Mill'];
