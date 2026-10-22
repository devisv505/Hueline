// Everything you see on the factory floor, drawn to one canvas in cell units.
import { COLORS, TUNE } from './config.js';
import { KIND } from './world.js';
import { makeRng } from './rng.js';

const INK = '#3f4654';
const PAPER = '#ffffff';
const LINE = 'rgba(63,70,84,.07)';
const LINE_BOLD = 'rgba(63,70,84,.12)';
const ROAD = '#ffffff';
const ROAD_EDGE = 'rgba(63,70,84,.10)';
const ALARM = '#ec5a5a';
const BUILDING = 1.34; // cells across

const ease = (k) => 1 - Math.pow(1 - k, 3);
const backOut = (k) => 1 + 2.4 * Math.pow(k - 1, 3) + 1.4 * Math.pow(k - 1, 2);

export class Renderer {
  constructor(canvas, world) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.world = world;
    this.view = { cell: 32, ox: 0, oy: 0, dpr: 1 };
    this.scenery = buildScenery(world);
    this.resize();
  }

  // Rebuilt between runs so the scenery is reshuffled with the new floor.
  setWorld(world) {
    this.world = world;
    this.scenery = buildScenery(world);
    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(3, devicePixelRatio || 1);
    this.canvas.width = Math.round(rect.width * dpr);
    this.canvas.height = Math.round(rect.height * dpr);
    const cell = Math.min(rect.width / this.world.cols, rect.height / this.world.rows);
    this.view = {
      cell,
      dpr,
      ox: (rect.width - cell * this.world.cols) / 2,
      oy: (rect.height - cell * this.world.rows) / 2,
      rect,
    };
  }

  // Client coordinates -> grid cell (floored, so it is the cell under the finger).
  toCell(clientX, clientY) {
    const { cell, ox, oy } = this.view;
    const r = this.canvas.getBoundingClientRect();
    return { x: Math.floor((clientX - r.left - ox) / cell), y: Math.floor((clientY - r.top - oy) / cell) };
  }

  // Grid units -> client coordinates, for DOM effects floating over the canvas.
  toClient(cx, cy) {
    const { cell, ox, oy } = this.view;
    const r = this.canvas.getBoundingClientRect();
    return { x: r.left + ox + cx * cell, y: r.top + oy + cy * cell };
  }

  shadow(color, blur, dy = 0) {
    const d = this.view.dpr;
    this.ctx.shadowColor = color;
    this.ctx.shadowBlur = blur * d;
    this.ctx.shadowOffsetY = dy * d;
  }

  noShadow() {
    this.ctx.shadowColor = 'transparent';
    this.ctx.shadowBlur = 0;
    this.ctx.shadowOffsetY = 0;
  }

  draw(sim, ui, t) {
    const { ctx } = this;
    const { cell, ox, oy, dpr } = this.view;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(cell, cell);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    this.drawScenery();
    this.drawGrid();
    for (const belt of this.world.belts) this.beltShadow(belt);
    for (const belt of this.world.belts) this.beltBody(belt, t);
    for (const belt of this.world.belts) this.beltBridges(belt);
    if (ui.draft) this.drawDraft(ui.draft, t);
    for (const belt of this.world.belts) this.drawItems(belt);
    for (const b of this.world.buildings) this.drawBuilding(b, sim, t, ui);

    ctx.restore();
    this.noShadow();
  }

  // ---- background ----

  drawScenery() {
    const { ctx } = this;
    for (const shape of this.scenery) {
      ctx.fillStyle = shape.color;
      ctx.beginPath();
      const pts = shape.pts;
      ctx.moveTo((pts[0].x + pts.at(-1).x) / 2, (pts[0].y + pts.at(-1).y) / 2);
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        ctx.quadraticCurveTo(a.x, a.y, (a.x + b.x) / 2, (a.y + b.y) / 2);
      }
      ctx.closePath();
      ctx.fill();
    }
  }

  drawGrid() {
    const { ctx } = this;
    const { cols, rows } = this.world;
    ctx.lineWidth = 1 / this.view.cell;
    for (let x = 0; x <= cols; x++) {
      ctx.strokeStyle = x % 5 === 0 ? LINE_BOLD : LINE;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, rows);
      ctx.stroke();
    }
    for (let y = 0; y <= rows; y++) {
      ctx.strokeStyle = y % 5 === 0 ? LINE_BOLD : LINE;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(cols, y);
      ctx.stroke();
    }
  }

  // ---- belts ----

  tracePath(pts, skipLast = 0) {
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length - skipLast; i++) ctx.lineTo(pts[i].x, pts[i].y);
  }

  beltShadow(belt) {
    const { ctx } = this;
    this.tracePath(belt.pts);
    this.shadow('rgba(63,70,84,.22)', 7, 3);
    ctx.strokeStyle = ROAD;
    ctx.lineWidth = 0.54;
    ctx.stroke();
    this.noShadow();
  }

  beltBody(belt, t) {
    const { ctx } = this;
    this.tracePath(belt.pts);
    ctx.strokeStyle = ROAD_EDGE;
    ctx.lineWidth = 0.56;
    ctx.stroke();
    this.tracePath(belt.pts);
    ctx.strokeStyle = ROAD;
    ctx.lineWidth = 0.5;
    ctx.stroke();

    // Dashes crawling towards the destination: the belt's direction, at a glance.
    this.tracePath(belt.pts);
    ctx.setLineDash([0.22, 0.3]);
    ctx.lineDashOffset = -t * this.world.speed * 0.5;
    ctx.strokeStyle = 'rgba(63,70,84,.17)';
    ctx.lineWidth = 0.07;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Where one belt hops another, lift it onto a little overpass.
  beltBridges(belt) {
    const { ctx } = this;
    for (let i = 1; i < belt.cells.length - 1; i++) {
      const c = belt.cells[i];
      if (!belt.bridges.has(`${c.x},${c.y}`)) continue;
      const a = belt.pts[i - 1];
      const b = belt.pts[i + 1];
      const dx = Math.sign(b.x - a.x);
      const dy = Math.sign(b.y - a.y);
      const cx = c.x + 0.5;
      const cy = c.y + 0.5;
      const span = 0.56;

      // Lift the deck clear of the belt underneath.
      ctx.beginPath();
      ctx.moveTo(cx - dx * span, cy - dy * span);
      ctx.lineTo(cx + dx * span, cy + dy * span);
      this.shadow('rgba(63,70,84,.35)', 7, 4);
      ctx.strokeStyle = ROAD;
      ctx.lineWidth = 0.46;
      ctx.stroke();
      this.noShadow();

      // Side rails, the way the reference art marks a crossing.
      const nx = dy ? 0.29 : 0;
      const ny = dx ? 0.29 : 0;
      ctx.strokeStyle = 'rgba(63,70,84,.6)';
      ctx.lineWidth = 0.055;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(cx - dx * span + nx * side, cy - dy * span + ny * side);
        ctx.lineTo(cx + dx * span + nx * side, cy + dy * span + ny * side);
        ctx.stroke();
      }
    }
  }

  drawItems(belt) {
    const { ctx } = this;
    for (const item of belt.items) {
      const p = this.world.pointAt(belt, item.d);
      const c = COLORS[item.color];
      this.shadow('rgba(63,70,84,.28)', 4, 2);
      ctx.fillStyle = c.fill;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 0.165, 0, Math.PI * 2);
      ctx.fill();
      this.noShadow();
      ctx.fillStyle = 'rgba(255,255,255,.45)';
      ctx.beginPath();
      ctx.arc(p.x - 0.05, p.y - 0.055, 0.055, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ---- the belt being drawn right now ----

  drawDraft(draft, t) {
    const { ctx } = this;
    if (draft.cells.length > 1) {
      const pts = draft.cells.map((c) => ({ x: c.x + 0.5, y: c.y + 0.5 }));
      this.tracePath(pts);
      this.shadow('rgba(63,70,84,.18)', 6, 3);
      ctx.strokeStyle = 'rgba(255,255,255,.96)';
      ctx.lineWidth = 0.5;
      ctx.stroke();
      this.noShadow();

      this.tracePath(pts);
      ctx.setLineDash([0.3, 0.26]);
      ctx.lineDashOffset = -t * 2;
      ctx.strokeStyle = draft.end ? 'rgba(96,189,129,.95)' : 'rgba(63,70,84,.35)';
      ctx.lineWidth = 0.1;
      ctx.stroke();
      ctx.setLineDash([]);

      for (const c of draft.bridges) {
        ctx.strokeStyle = 'rgba(63,70,84,.55)';
        ctx.lineWidth = 0.055;
        ctx.setLineDash([0.12, 0.1]);
        ctx.strokeRect(c.x + 0.18, c.y + 0.18, 0.64, 0.64);
        ctx.setLineDash([]);
      }
    }

    const tip = draft.cells.at(-1);
    const pulse = 0.3 + Math.sin(t * 9) * 0.04;
    ctx.fillStyle = draft.end ? 'rgba(96,189,129,.9)' : draft.blocked ? 'rgba(236,90,90,.85)' : 'rgba(63,70,84,.5)';
    ctx.beginPath();
    ctx.arc(tip.x + 0.5, tip.y + 0.5, pulse, 0, Math.PI * 2);
    ctx.fill();
  }

  // ---- buildings ----

  drawBuilding(b, sim, t, ui) {
    const { ctx } = this;
    const age = sim.time - b.born;
    const grow = b.born > 0 && age < 0.55 ? backOut(Math.max(0.02, age / 0.55)) : 1;
    const flash = b.flash ? Math.max(0, 1 - (sim.time - b.flash) * 5) : 0;
    const size = BUILDING * grow * (1 + flash * 0.07);
    const cx = b.x + 0.5;
    const cy = b.y + 0.5;
    const half = size / 2;

    ctx.save();
    ctx.translate(cx, cy);
    if (b.jam > 0) {
      // Rattle harder the closer the machine is to burning out.
      const k = b.jam / TUNE.jamFuse;
      ctx.translate(Math.sin(t * 34) * 0.035 * k, 0);
    }

    this.shadow('rgba(63,70,84,.3)', 9, 4);
    if (b.kind === KIND.DEPOSIT) this.drawDeposit(b, half);
    else if (b.kind === KIND.MIXER) this.drawMixer(b, half, t);
    else this.drawDepot(b, half);
    this.noShadow();

    if (ui.hover === b) {
      ctx.strokeStyle = 'rgba(63,70,84,.3)';
      ctx.lineWidth = 0.05;
      ctx.setLineDash([0.14, 0.12]);
      roundRect(ctx, -half - 0.16, -half - 0.16, size + 0.32, size + 0.32, 0.3);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();

    if (b.kind === KIND.MIXER) this.drawChips(b, cx, cy + half + 0.26, TUNE.mixerCap);
    if (b.kind === KIND.DEPOT) {
      this.drawOrders(b, cx, cy - half - 0.3);
      if (b.buffer.length) this.drawChips(b, cx, cy + half + 0.26, TUNE.depotCap);
    }
    if (b.kind === KIND.DEPOSIT && b.buffer.length) this.drawChips(b, cx, cy + half + 0.26, TUNE.depositCap);
    if (b.jam > 0) this.drawAlarm(b, cx, cy, half, t);
  }

  drawDeposit(b, half) {
    const { ctx } = this;
    const c = COLORS[b.color];
    ctx.fillStyle = c.fill;
    roundRect(ctx, -half, -half, half * 2, half * 2, half * 0.38);
    ctx.fill();
    this.noShadow();
    ctx.fillStyle = 'rgba(255,255,255,.3)';
    roundRect(ctx, -half * 0.62, -half * 0.62, half * 1.24, half * 1.24, half * 0.26);
    ctx.fill();
    // Three chunks of ore, so a deposit reads differently from a depot.
    ctx.fillStyle = c.deep;
    for (const [dx, dy, r] of [
      [-0.19, 0.1, 0.12],
      [0.17, 0.14, 0.1],
      [0, -0.15, 0.13],
    ]) {
      ctx.beginPath();
      ctx.arc(dx, dy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawMixer(b, half, t) {
    const { ctx } = this;
    ctx.fillStyle = '#f7f8fa';
    roundRect(ctx, -half, -half, half * 2, half * 2, half * 0.34);
    ctx.fill();
    this.noShadow();
    ctx.strokeStyle = 'rgba(63,70,84,.18)';
    ctx.lineWidth = 0.055;
    roundRect(ctx, -half + 0.05, -half + 0.05, half * 2 - 0.1, half * 2 - 0.1, half * 0.3);
    ctx.stroke();

    const spin = b.craft > 0 ? t * 5 : t * 0.7;
    ctx.save();
    ctx.rotate(spin);
    ctx.strokeStyle = b.out ? COLORS[b.out].fill : 'rgba(63,70,84,.45)';
    ctx.lineWidth = 0.08;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.arc(0, 0, half * 0.46, (i * Math.PI * 2) / 3 + 0.25, (i * Math.PI * 2) / 3 + 1.6);
      ctx.stroke();
    }
    ctx.restore();

    ctx.fillStyle = b.out ? COLORS[b.out].fill : '#dfe3ea';
    ctx.beginPath();
    ctx.arc(0, 0, half * 0.2, 0, Math.PI * 2);
    ctx.fill();

    if (b.craft > 0) {
      const k = 1 - b.craft / TUNE.mixTime;
      ctx.strokeStyle = COLORS[b.pendingOut]?.fill ?? INK;
      ctx.lineWidth = 0.09;
      ctx.beginPath();
      ctx.arc(0, 0, half * 0.76, -Math.PI / 2, -Math.PI / 2 + k * Math.PI * 2);
      ctx.stroke();
    }
  }

  drawDepot(b, half) {
    const { ctx } = this;
    const c = COLORS[b.color];
    ctx.fillStyle = '#ffffff';
    roundRect(ctx, -half, -half, half * 2, half * 2, half * 0.36);
    ctx.fill();
    this.noShadow();
    // A coloured awning says which order this shop is waiting on.
    ctx.save();
    ctx.beginPath();
    roundRect(ctx, -half, -half, half * 2, half * 2, half * 0.36);
    ctx.clip();
    ctx.fillStyle = c.fill;
    ctx.fillRect(-half, -half, half * 2, half * 0.72);
    ctx.restore();
    ctx.fillStyle = c.deep;
    ctx.beginPath();
    ctx.arc(0, half * 0.28, half * 0.3, 0, Math.PI * 2);
    ctx.fill();
  }

  drawChips(b, cx, cy, cap) {
    const { ctx } = this;
    const w = 0.17;
    const gap = 0.05;
    const total = cap * w + (cap - 1) * gap;
    for (let i = 0; i < cap; i++) {
      const x = cx - total / 2 + i * (w + gap);
      const color = b.buffer[i];
      ctx.fillStyle = color ? COLORS[color].fill : 'rgba(63,70,84,.1)';
      roundRect(ctx, x, cy - w / 2, w, w, 0.05);
      ctx.fill();
    }
  }

  drawOrders(b, cx, cy) {
    const { ctx } = this;
    const c = COLORS[b.color];
    const r = 0.13;
    const gap = 0.36;
    const total = (TUNE.demandCap - 1) * gap;
    for (let i = 0; i < TUNE.demandCap; i++) {
      const x = cx - total / 2 + i * gap;
      if (i < b.pending) {
        this.shadow('rgba(63,70,84,.22)', 3, 2);
        ctx.fillStyle = c.fill;
        ctx.beginPath();
        ctx.arc(x, cy, r, 0, Math.PI * 2);
        ctx.fill();
        this.noShadow();
      } else {
        ctx.strokeStyle = 'rgba(63,70,84,.16)';
        ctx.lineWidth = 0.04;
        ctx.beginPath();
        ctx.arc(x, cy, r * 0.8, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  drawAlarm(b, cx, cy, half, t) {
    const { ctx } = this;
    const k = b.jam / TUNE.jamFuse;
    const r = half + 0.3 + Math.sin(t * 7) * 0.05;
    ctx.strokeStyle = `rgba(236,90,90,${0.3 + k * 0.5})`;
    ctx.lineWidth = 0.07;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = ALARM;
    ctx.lineWidth = 0.13;
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + k * Math.PI * 2);
    ctx.stroke();

    // Tap-to-vent badge.
    ctx.fillStyle = ALARM;
    this.shadow('rgba(236,90,90,.5)', 6, 2);
    ctx.beginPath();
    ctx.arc(cx + half + 0.1, cy - half - 0.1, 0.26, 0, Math.PI * 2);
    ctx.fill();
    this.noShadow();
    ctx.fillStyle = '#fff';
    ctx.font = '700 0.36px Nunito, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('!', cx + half + 0.1, cy - half - 0.07);
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

// Pastel districts and a river, generated once per run from the world seed.
// Sizes key off the shorter side so the floor reads the same tall or wide.
function buildScenery(world) {
  const rng = makeRng(1337 ^ (world.cols * 31 + world.rows));
  const base = Math.min(world.cols, world.rows);
  const wide = world.cols >= world.rows;
  const shapes = [];
  const blob = (cx, cy, radius, color) => {
    const pts = [];
    const n = 10;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const r = radius * rng.range(0.7, 1.25);
      pts.push({ x: cx + Math.cos(a) * r * (wide ? 1.25 : 1), y: cy + Math.sin(a) * r * (wide ? 1 : 1.25) });
    }
    shapes.push({ pts, color });
  };

  // A wandering band of water down one side.
  const river = [];
  const steps = 7;
  for (let i = 0; i <= steps; i++) {
    river.push({ x: world.cols * 0.76 + Math.sin(i * 0.9) * base * 0.12, y: (i / steps) * world.rows });
  }
  const right = river.map((p) => ({ x: p.x + rng.range(1.9, 2.8), y: p.y })).reverse();
  shapes.push({ pts: [...river, ...right], color: 'rgba(156,222,219,.42)' });

  blob(world.cols * 0.26, world.rows * 0.28, base * 0.3, 'rgba(249,205,216,.42)');
  blob(world.cols * 0.3, world.rows * 0.8, base * 0.22, 'rgba(249,205,216,.3)');
  blob(world.cols * 0.86, world.rows * 0.14, base * 0.19, 'rgba(253,232,205,.45)');
  return shapes;
}
