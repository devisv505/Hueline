// The factory running itself: ore drops, items ride belts, mixers and presses
// combine them, and the hub takes whatever its goal asks for. Pure logic,
// driven by `tick(dt)` in seconds.
import { TUNE, GOALS, findRecipe, findPress } from './config.js?v=6';
import { KIND } from './world.js?v=6';

// The machines that turn a pair from their buffer into something new.
const CRAFTERS = {
  [KIND.MIXER]: { find: findRecipe, time: TUNE.mixTime },
  [KIND.PRESS]: { find: findPress, time: TUNE.pressTime },
};

export class Sim {
  constructor(world, hooks = {}) {
    this.world = world;
    this.capOf = (b) => world.caps[b.kind];
    this.hooks = hooks;
    this.time = 0;
    this.delivered = 0; // items the hub has taken since the floor was opened
    // Stagger the floor so it pops in when the game starts.
    this.world.buildings.forEach((b, i) => (b.born = 0.05 + i * 0.09));
  }

  // The goal the hub is on, or null once the ladder is finished.
  get goal() {
    return GOALS[this.world.goal.index] ?? null;
  }

  // Belts leaving each building, rebuilt each tick: cheap at this scale and
  // always in step with whatever the player just drew or deleted.
  outgoing() {
    const out = new Map();
    for (const belt of this.world.belts) {
      if (!out.has(belt.from)) out.set(belt.from, []);
      out.get(belt.from).push(belt);
    }
    return out;
  }

  tick(dt) {
    this.time += dt;
    const out = this.outgoing();

    for (const belt of this.world.belts) this.moveBelt(belt, dt);
    for (const b of this.world.buildings) {
      if (b.kind === KIND.DEPOSIT) this.tickDeposit(b, dt, out.get(b.id));
      else if (CRAFTERS[b.kind]) this.tickCrafter(b, dt, out.get(b.id));
      else if (b.kind === KIND.SPLITTER) this.dispatch(b, out.get(b.id));
    }
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
    const landed = belt.feed ? this.merge(belt.feed, head.key) : this.handOff(belt.to, head.key);
    if (landed) belt.items.shift();
    else head.stuck = true;
  }

  handOff(buildingId, key) {
    const target = this.world.buildings.find((b) => b.id === buildingId);
    return Boolean(target) && this.deliver(target, key);
  }

  // Slip an item into another belt's lane, if the traffic there has left a gap.
  merge(feed, key) {
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
    target.items.splice(at, 0, { key, d, stuck: false });
    return true;
  }

  push(belt, key) {
    const tail = belt.items.at(-1);
    if (tail && tail.d < TUNE.itemGap) return false;
    belt.items.push({ key, d: 0, stuck: false });
    return true;
  }

  // ---- receiving ----

  deliver(b, key) {
    if (b.kind === KIND.HUB) return this.toHub(b, key);
    if (b.buffer.length >= this.capOf(b)) return false;
    b.buffer.push(key);
    b.flash = this.time;
    return true;
  }

  // Only the item the goal asks for counts. Anything else is scrapped at the
  // door rather than left to wait, or one leftover from the last goal could
  // block a line that is otherwise wired right. Once the last goal is done,
  // everything counts.
  toHub(b, key) {
    const goal = this.goal;
    if (goal && key !== goal.item) {
      this.hooks.onReject?.(b, key);
      return true;
    }
    this.delivered++;
    b.flash = this.time;
    if (goal) this.world.goal.got++;
    this.hooks.onDeliver?.(b, key);
    if (goal && this.world.goal.got >= goal.count) this.finishGoal(goal);
    return true;
  }

  // Hand over what the goal gives and move the hub on to the next one.
  finishGoal(goal) {
    const { world } = this;
    world.stock.belts += goal.gives.belts;
    for (const key of goal.gives.unlocks) {
      if (world.unlocked.includes(key)) continue;
      world.unlocked.push(key);
      world.fresh.push(key);
    }
    world.goal = { index: world.goal.index + 1, got: 0 };
    this.hooks.onGoal?.(goal, this.goal);
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

  // Mixers and presses: take the first pair in the buffer that makes something,
  // work on it for a moment, then send the result on.
  tickCrafter(b, dt, belts) {
    const crafter = CRAFTERS[b.kind];
    if (b.craft > 0) {
      b.craft -= dt;
      if (b.craft <= 0) {
        b.out = b.pendingOut;
        b.pendingOut = null;
        this.hooks.onCraft?.(b, b.out);
      }
    } else if (!b.out) {
      const recipe = crafter.find(b.buffer);
      if (recipe) {
        // Splice the higher index first so the lower one stays valid.
        b.buffer.splice(recipe.j, 1);
        b.buffer.splice(recipe.i, 1);
        b.pendingOut = recipe.out;
        b.craft = crafter.time;
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

    // A full buffer is only a problem when nothing in it will combine: that is
    // one kind flooding in with no partner, and it will never clear itself.
    this.choke(b, b.buffer.length >= this.capOf(b) && !crafter.find(b.buffer), dt);
  }

  // A choked machine stalls and flashes until its buffer is dumped. It never
  // ends the game; the line behind it just stops until you sort it out.
  choke(b, choked, dt) {
    const was = b.jam > 0;
    b.jam = choked ? Math.min(1, b.jam + dt) : Math.max(0, b.jam - dt * 2.5);
    if (!was && b.jam > 0) this.hooks.onJam?.(b);
    if (was && b.jam === 0) this.hooks.onCalm?.(b);
  }

  // Dumping a choked buffer: the way out when a route goes wrong.
  vent(b) {
    if (!b.buffer.length) return false;
    const dumped = b.buffer.length;
    b.buffer = [];
    b.jam = 0;
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
}
