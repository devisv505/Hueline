// The factory running itself: ore drops, items ride belts, mixers combine them
// and depots get their orders. Pure logic, driven by `tick(dt)` in seconds.
import { TUNE, findRecipe, creditsFor } from './config.js?v=5';
import { KIND, freeSpot, nextArrival } from './world.js?v=5';

export class Sim {
  constructor(world, hooks = {}) {
    this.world = world;
    this.capOf = (b) => world.caps[b.kind];
    this.hooks = hooks;
    this.time = 0;
    this.score = 0;
    this.delivered = 0;
    this.spawnIn = TUNE.firstSpawn;
    this.spawnGap = TUNE.firstSpawn;
    this.over = false;
    this.relaxed = false;
    this.stalled = false;
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
      else if (b.kind === KIND.SPLITTER) this.dispatch(b, out.get(b.id));
      else this.tickDepot(b, dt);
    }
    this.tickSpawn(dt);
  }

  // ---- belts ----

  moveBelt(belt, dt) {
    const speed = this.world.speed;
    // A belt joining another stops short of it, so its queue waits at the kerb
    // rather than standing on top of the traffic it is trying to join.
    const end = belt.feed ? Math.max(0, belt.len - TUNE.mergeStop) : belt.len;
    for (let i = 0; i < belt.items.length; i++) {
      const item = belt.items[i];
      const ceiling = i === 0 ? end : belt.items[i - 1].d - TUNE.itemGap;
      item.d = Math.min(item.d + speed * dt, Math.max(item.d, ceiling));
      item.stuck = item.d >= ceiling - 1e-4 && i > 0;
    }
    const head = belt.items[0];
    if (!head || head.d < end - 1e-4) return;
    const landed = belt.feed ? this.merge(belt.feed, head.color) : this.handOff(belt.to, head.color);
    if (landed) {
      belt.items.shift();
      belt.color = head.color;
    } else {
      head.stuck = true;
    }
  }

  handOff(buildingId, color) {
    const target = this.world.buildings.find((b) => b.id === buildingId);
    return Boolean(target) && this.deliver(target, color);
  }

  // Slip an item into another belt's lane, if the traffic there has left a gap.
  merge(feed, color) {
    const target = this.world.beltById(feed.beltId);
    if (!target) return false;
    const d = Math.min(feed.index, target.len);
    let at = target.items.length; // items run head first, so d descends
    for (let i = 0; i < target.items.length; i++) {
      if (target.items[i].d < d) {
        at = i;
        break;
      }
    }
    const ahead = target.items[at - 1];
    const behind = target.items[at];
    if (ahead && ahead.d - d < TUNE.itemGap) return false;
    if (behind && d - behind.d < TUNE.itemGap) return false;
    target.items.splice(at, 0, { color, d, stuck: false });
    return true;
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
      const paid = creditsFor(color);
      this.score++;
      this.delivered++;
      this.world.stock.credits += paid;
      b.pending = Math.max(0, b.pending - 1);
      b.flash = this.time;
      this.hooks.onDeliver?.(b, color, this.delivered, paid);
      return true;
    }
    if (b.buffer.length >= this.capOf(b)) return false;
    b.buffer.push(color);
    b.flash = this.time;
    return true;
  }

  // ---- buildings ----

  tickDeposit(b, dt, belts) {
    b.cool -= dt;
    if (b.cool <= 0) {
      b.cool += TUNE.oreInterval;
      if (b.buffer.length < this.capOf(b)) b.buffer.push(b.color);
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
    const choked = b.buffer.length >= this.capOf(b) && !findRecipe(b.buffer);
    this.fuse(b, choked, dt);
  }

  tickDepot(b, dt) {
    b.cool -= dt;
    if (b.cool <= 0) {
      b.cool += TUNE.demandInterval;
      b.pending = Math.min(TUNE.demandCap, b.pending + 1);
    }
    // Only the wrong colour can pile up here, since orders are consumed on sight.
    this.fuse(b, b.buffer.length >= this.capOf(b), dt);
  }

  // Shared overflow timer: machines sound an alarm, then burn out.
  fuse(b, choked, dt) {
    const was = b.jam;
    const fuse = this.world.jamFuse;
    if (choked) b.jam = Math.min(fuse, b.jam + dt);
    else b.jam = Math.max(0, b.jam - dt * 2.5);
    if (!was && b.jam > 0) this.hooks.onJam?.(b);
    if (was > 0 && b.jam === 0) this.hooks.onCalm?.(b);
    if (b.jam >= fuse && !this.relaxed) {
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
    if (!plan) {
      // Every colour the floor can make already has its shops. Say so once;
      // the way out is a new ore deposit from the store.
      if (!this.stalled) {
        this.stalled = true;
        this.hooks.onStalled?.();
      }
      return;
    }
    this.stalled = false;
    const b = this.world.addBuilding(plan.kind, spot.x, spot.y, plan.color ? { color: plan.color } : {});
    b.born = this.time;
    this.hooks.onSpawn?.(b);
  }
}
