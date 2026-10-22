// Drawing belts with a finger or a mouse: press a producer, drag, release on a
// machine. The path grows cell by cell under the cursor and can be walked back.
import { canStartFrom, canManage, createDraft, draftTo, commitDraft, draftCost } from './world.js?v=3';
import { sfx } from './audio.js?v=3';

const TAP = 7; // px of travel still counted as a tap
const HOLD = 650; // ms of stillness before a machine can be picked up

const REASONS = {
  edge: 'The belt cannot leave the floor',
  self: 'A belt has to end somewhere else',
  kind: 'Ore deposits only send, they never receive',
  duplicate: 'These two are already connected',
  loop: 'A belt cannot run back over itself',
  overlap: 'Belts cannot share a lane',
  occupied: 'Join a belt mid-lane, not on a bridge or where one already merges',
  corner: 'No room to bridge over a corner',
  busy: 'Too many belts in that square',
  'bridge-turn': 'A belt has to stay straight across a bridge',
  'no-bridges': 'Out of bridges — belts cannot cross without one',
  'no-belts': 'Out of belt tiles',
};

export class Controls {
  constructor(canvas, world, renderer, hooks = {}) {
    this.canvas = canvas;
    this.world = world;
    this.renderer = renderer;
    this.hooks = hooks;
    this.draft = null;
    this.hover = null;
    this.placing = null; // a machine bought from the store, waiting to be dropped
    this.cell = null; // cell under the pointer, for the placement ghost
    this.holdOn = null; // machine being pressed, once the ring starts filling
    this.holdAt = 0;
    this.holdTimer = 0;
    this.swallowUp = false; // the release that ends a pick-up is not a drop
    this.locked = false;
    this.pointer = null;
    this.start = null;
    this.moved = 0;
    this.lastLen = 0;
    this.lastWhy = null;

    canvas.addEventListener('pointerdown', (e) => this.down(e));
    canvas.addEventListener('pointermove', (e) => this.move(e));
    canvas.addEventListener('pointerup', (e) => this.up(e));
    canvas.addEventListener('pointercancel', () => this.cancel());
    canvas.addEventListener('pointerleave', () => {
      if (!this.draft) this.setHover(null);
      if (this.pointer === null) this.cell = null;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  setWorld(world) {
    this.world = world;
    this.placing = null;
    this.cell = null;
    this.finish();
    this.setHover(null);
  }

  // Arm or disarm placement; the cursor says which mode the board is in.
  setPlacing(placing) {
    this.placing = placing;
    this.setHover(null);
    this.canvas.style.cursor = placing ? 'copy' : 'default';
  }

  cellOf(e) {
    return this.renderer.toCell(e.clientX, e.clientY);
  }

  beltUnder(cell) {
    return this.world.beltsAt(cell.x, cell.y)[0]?.belt ?? null;
  }

  setHover(target) {
    if (this.hover === target) return;
    this.hover = target;
    this.canvas.style.cursor = target ? 'pointer' : 'default';
  }

  down(e) {
    if (this.locked || this.pointer !== null) return;
    const cell = this.cellOf(e);
    if (!this.world.inside(cell.x, cell.y)) return;
    this.cell = cell;
    // While placing a machine, the board is a target, not a drawing surface.
    if (this.placing) {
      this.canvas.setPointerCapture(e.pointerId);
      this.pointer = e.pointerId;
      this.start = { x: e.clientX, y: e.clientY, cell };
      this.moved = 0;
      return;
    }
    this.canvas.setPointerCapture(e.pointerId);
    this.pointer = e.pointerId;
    this.start = { x: e.clientX, y: e.clientY, cell };
    this.moved = 0;

    const building = this.world.buildingAt(cell.x, cell.y);
    this.tapTarget = building ?? this.beltUnder(cell);
    // Holding still on your own machine picks it up; dragging draws a belt, so
    // the two only part ways once the pointer moves or the ring fills.
    if (building && canManage(building)) {
      this.holdOn = building;
      this.holdAt = performance.now();
      this.holdTimer = setTimeout(() => this.finishHold(), HOLD);
    }
    if (building && canStartFrom(building)) {
      this.draft = createDraft(this.world, building);
      this.lastLen = 1;
      sfx.grab();
      this.hooks.onDraft?.(this.draft);
    }
  }

  move(e) {
    const where = this.cellOf(e);
    if (this.world.inside(where.x, where.y)) this.cell = where;
    if (this.pointer === null) {
      if (!this.placing) this.setHover(this.world.buildingAt(where.x, where.y) ?? this.beltUnder(where));
      return;
    }
    if (e.pointerId !== this.pointer) return;
    this.moved = Math.max(this.moved, Math.hypot(e.clientX - this.start.x, e.clientY - this.start.y));
    if (this.moved > TAP) this.cancelHold();
    if (!this.draft) return;

    const cell = this.cellOf(e);
    if (!this.world.inside(cell.x, cell.y)) return;
    draftTo(this.world, this.draft, cell);

    if (this.draft.cells.length !== this.lastLen) {
      if (this.draft.cells.length > this.lastLen) sfx.tick();
      this.lastLen = this.draft.cells.length;
      this.lastWhy = null;
      this.hooks.onDraft?.(this.draft);
    } else if (this.draft.blocked && this.draft.blocked !== this.lastWhy) {
      this.lastWhy = this.draft.blocked;
      this.hooks.onBlocked?.(REASONS[this.draft.blocked] ?? 'That way is blocked');
    }
  }

  up(e) {
    if (e.pointerId !== this.pointer) return;
    // Letting go of the press that lifted a machine must not immediately put it
    // back down, or the bar's Remove button could never be reached.
    if (this.swallowUp) {
      this.swallowUp = false;
      this.finish();
      return;
    }
    if (this.placing) {
      const cell = this.cellOf(e);
      this.finish();
      if (this.world.inside(cell.x, cell.y)) this.hooks.onPlace?.(cell);
      return;
    }
    const draft = this.draft;
    const target = this.tapTarget;
    const tapped = this.moved <= TAP;
    this.finish(); // clears draft and tapTarget, so read them first
    // A finger leaves no cursor behind, so drop the hover ring with it.
    if (e.pointerType !== 'mouse') this.setHover(null);

    if (draft && (draft.end || draft.endFeed)) {
      const cost = draftCost(draft);
      const belt = commitDraft(this.world, draft);
      if (belt) {
        belt.born = performance.now() / 1000;
        sfx.lay();
        this.hooks.onBuild?.(belt, cost);
        return;
      }
    }
    if (draft && draft.cells.length > 1) {
      sfx.nope();
      this.hooks.onCancel?.(draft);
      return;
    }
    if (tapped && target) this.hooks.onTap?.(target);
  }

  cancel() {
    this.finish();
  }

  // 0 to 1 while a machine is being pressed, for the ring the renderer draws.
  holdProgress() {
    if (!this.holdOn) return 0;
    return Math.min(1, (performance.now() - this.holdAt) / HOLD);
  }

  cancelHold() {
    clearTimeout(this.holdTimer);
    this.holdOn = null;
    this.holdTimer = 0;
  }

  finishHold() {
    const building = this.holdOn;
    this.cancelHold();
    if (!building) return;
    this.draft = null; // the press was a pick-up, not the start of a belt
    this.tapTarget = null;
    this.swallowUp = true;
    this.hooks.onDraft?.(null);
    this.hooks.onHold?.(building);
  }

  finish() {
    this.cancelHold();
    if (this.pointer !== null && this.canvas.hasPointerCapture?.(this.pointer)) {
      this.canvas.releasePointerCapture(this.pointer);
    }
    this.pointer = null;
    this.draft = null;
    this.tapTarget = null;
    this.lastWhy = null;
    this.hooks.onDraft?.(null);
  }
}
