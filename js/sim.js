// The factory running itself: ore drops, items ride belts, mixers combine them
// and depots get their orders. Pure logic, driven by `tick(dt)` in seconds.
import { TUNE, findRecipe } from './config.js';
import { KIND, freeSpot, nextArrival } from './world.js';

const capOf = (b) => (b.kind === KIND.MIXER ? TUNE.mixerCap : b.kind === KIND.DEPOT ? TUNE.depotCap : TUNE.depositCap);

export class Sim {
  constructor(world, hooks = {}) {
    this.world = world;
    this.hooks = hooks;
    this.time = 0;
    this.score = 0;
    this.delivered = 0;
    this.spawnIn = TUNE.firstSpawn;
    this.spawnGap = TUNE.firstSpawn;
    this.over = false;
    this.relaxed = false;
    // Stagger the opening floor so it pops in when the run starts.
    this.world.buildings.forEach((b, i) => (b.born = 0.05 + i * 0.09));
  }

  // Belt lookup rebuilt each tick: cheap at this scale and always in step with
  // whatever the player just drew or deleted.
  index() {
    const out = new Map();
    const into = new Map();
    for (const belt of this.world.belts) {
      if (!out.has(belt.from)) out.set(belt.from, []);
      out.get(belt.from).push(belt);
      if (!into.has(belt.to)) into.set(belt.to, []);
      into.get(belt.to).push(belt);
    }
    return { out, into };
  }

  tick(dt) {
    if (this.over) return;
    this.time += dt;
    const { out } = this.index();

    for (const belt of this.world.belts) this.moveBelt(belt, dt);
    for (const b of this.world.buildings) {
      if (b.kind === KIND.DEPOSIT) this.tickDeposit(b, dt, out.get(b.id));
      else if (b.kind === KIND.MIXER) this.tickMixer(b, dt, out.get(b.id));
      else this.tickDepot(b, dt);
    }
    this.tickSpawn(dt);
  }

  // ---- belts ----

  moveBelt(belt, dt) {
    const speed = this.world.speed;
    for (let i = 0; i < belt.items.length; i++) {
      const item = belt.items[i];
      const ceiling = i === 0 ? belt.len : belt.items[i - 1].d - TUNE.itemGap;
      item.d = Math.min(item.d + speed * dt, ceiling);
      item.stuck = item.d >= ceiling - 1e-4 && i > 0;
    }
    const head = belt.items[0];
    if (!head || head.d < belt.len - 1e-4) return;
    const target = this.world.buildings.find((b) => b.id === belt.to);
    if (target && this.deliver(target, head.color)) {
      belt.items.shift();
      belt.color = head.color;
    } else {
      head.stuck = true;
    }
  }

  push(belt, color) {
    const tail = belt.items.at(-1);
    if (tail && tail.d < TUNE.itemGap) return false;
    belt.items.push({ color, d: 0, stuck: false });
    return true;
  }

  // ---- consumers ----

  deliver(b, color) {
    if (b.kind === KIND.DEPOT && color === b.color) {
      this.score++;
      this.delivered++;
      b.pending = Math.max(0, b.pending - 1);
      b.flash = this.time;
      this.hooks.onDeliver?.(b, color, this.delivered);
      return true;
    }
    if (b.buffer.length >= capOf(b)) return false;
    b.buffer.push(color);
    b.flash = this.time;
    return true;
  }

  // ---- buildings ----

  tickDeposit(b, dt, belts) {
    b.cool -= dt;
    if (b.cool <= 0) {
      b.cool += TUNE.oreInterval;
      if (b.buffer.length < capOf(b)) b.buffer.push(b.color);
    }
    this.dispatch(b, belts);
  }

  tickMixer(b, dt, belts) {
    if (b.craft > 0) {
      b.craft -= dt;
      if (b.craft <= 0) {
        b.out = b.pendingOut;
        b.pendingOut = null;
        this.hooks.onCraft?.(b, b.out);
      }
    } else if (!b.out) {
      const recipe = findRecipe(b.buffer);
      if (recipe) {
        // Splice the higher index first so the lower one stays valid.
        b.buffer.splice(recipe.j, 1);
        b.buffer.splice(recipe.i, 1);
        b.pendingOut = recipe.out;
        b.craft = TUNE.mixTime;
      }
    }

    if (b.out && belts?.length) {
      for (let i = 0; i < belts.length; i++) {
        const belt = belts[(b.rr + i) % belts.length];
        if (this.push(belt, b.out)) {
          b.rr = (b.rr + i + 1) % belts.length;
          b.out = null;
          break;
        }
      }
    }

    // A full buffer is only a problem when nothing in it will react: that is
    // one colour flooding in with no partner, and it will never clear itself.
    const choked = b.buffer.length >= capOf(b) && !findRecipe(b.buffer);
    this.fuse(b, choked, dt);
  }

  tickDepot(b, dt) {
    b.cool -= dt;
    if (b.cool <= 0) {
      b.cool += TUNE.demandInterval;
      b.pending = Math.min(TUNE.demandCap, b.pending + 1);
    }
    // Only the wrong colour can pile up here, since orders are consumed on sight.
    this.fuse(b, b.buffer.length >= capOf(b), dt);
  }

  // Shared overflow timer: machines sound an alarm, then burn out.
  fuse(b, choked, dt) {
    const was = b.jam;
    if (choked) b.jam = Math.min(TUNE.jamFuse, b.jam + dt);
    else b.jam = Math.max(0, b.jam - dt * 2.5);
    if (!was && b.jam > 0) this.hooks.onJam?.(b);
    if (was > 0 && b.jam === 0) this.hooks.onCalm?.(b);
    if (b.jam >= TUNE.jamFuse && !this.relaxed) {
      this.over = true;
      this.hooks.onFail?.(b);
    }
  }

  // Dumping a jammed buffer: the escape hatch, paid for in score.
  vent(b) {
    if (!b.buffer.length) return false;
    const dumped = b.buffer.length;
    b.buffer = [];
    b.jam = 0;
    this.score = Math.max(0, this.score - TUNE.ventCost);
    this.hooks.onVent?.(b, dumped);
    return true;
  }

  dispatch(b, belts) {
    if (!belts?.length || !b.buffer.length) return;
    for (let i = 0; i < belts.length; i++) {
      const belt = belts[(b.rr + i) % belts.length];
      if (this.push(belt, b.buffer[0])) {
        b.buffer.shift();
        b.rr = (b.rr + i + 1) % belts.length;
        return;
      }
    }
  }

  // ---- new arrivals ----

  tickSpawn(dt) {
    if (this.world.buildings.length >= this.world.maxBuildings) return;
    this.spawnIn -= dt;
    if (this.spawnIn > 0) return;
    this.spawnGap = Math.max(TUNE.minSpawn, this.spawnGap * TUNE.spawnDecay);
    this.spawnIn = this.spawnGap;
    const spot = freeSpot(this.world, this.world.rng);
    if (!spot) return;
    const plan = nextArrival(this.world, this.world.rng);
    const b = this.world.addBuilding(plan.kind, spot.x, spot.y, plan.color ? { color: plan.color } : {});
    b.born = this.time;
    this.hooks.onSpawn?.(b);
  }
}
