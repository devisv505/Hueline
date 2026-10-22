// Synthesized blips, so the game ships without audio files.
let ctx = null;
let enabled = true;

export function setSoundEnabled(on) {
  enabled = on;
}

// Browsers only start audio from a user gesture; call this from one.
export function unlockAudio() {
  try {
    ctx ??= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
  } catch {
    ctx = null;
  }
}

function tone(freq, duration, { type = 'sine', volume = 0.1, delay = 0, slideTo = null } = {}) {
  if (!enabled || !ctx) return;
  const t = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + duration);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(volume, t + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + duration + 0.02);
}

let lastTick = 0;
export const sfx = {
  grab: () => tone(540, 0.07, { slideTo: 760, volume: 0.06 }),
  // Ticks while the belt grows; throttled so a fast drag does not buzz.
  tick: () => {
    const now = performance.now();
    if (now - lastTick < 55) return;
    lastTick = now;
    tone(880, 0.035, { type: 'triangle', volume: 0.035 });
  },
  lay: () => {
    tone(320, 0.11, { type: 'triangle', volume: 0.13, slideTo: 560 });
    tone(1180, 0.05, { volume: 0.035, delay: 0.05 });
  },
  nope: () => tone(200, 0.17, { type: 'square', volume: 0.035, slideTo: 140 }),
  erase: () => tone(480, 0.1, { slideTo: 240, volume: 0.06 }),
  craft: () => [660, 990].forEach((f, i) => tone(f, 0.1, { type: 'triangle', volume: 0.06, delay: i * 0.05 })),
  deliver: () => [784, 1047].forEach((f, i) => tone(f, 0.14, { type: 'triangle', volume: 0.09, delay: i * 0.06 })),
  arrive: () => [523, 784].forEach((f, i) => tone(f, 0.16, { type: 'sine', volume: 0.07, delay: i * 0.09 })),
  alarm: () => [330, 262].forEach((f, i) => tone(f, 0.2, { type: 'square', volume: 0.04, delay: i * 0.18 })),
  reward: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.26, { type: 'triangle', volume: 0.11, delay: i * 0.1 })),
  fail: () => [392, 311, 233].forEach((f, i) => tone(f, 0.38, { type: 'sawtooth', volume: 0.07, delay: i * 0.16 })),
  click: () => tone(720, 0.05, { type: 'triangle', volume: 0.05 }),
};
