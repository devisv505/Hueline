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
  jamFuse: 15, // seconds an overflowing machine survives
  ventCost: 5, // score paid to dump a jammed buffer
  startBelts: 58,
  startBridges: 2,
  rewardEvery: 6, // deliveries between upgrade picks
  firstSpawn: 22, // seconds before the second wave of buildings
  spawnDecay: 0.94,
  minSpawn: 11,
  maxBuildings: 20,
};

export const FACTORY_NAMES = ['Prism Works', 'Hue Foundry', 'Pigment Bay', 'Chroma Falls', 'Tint Harbour', 'Spectra Mill'];
