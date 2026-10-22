// Pop-up juice: toasts, floating numbers, bursts and confetti, all in a fixed
// DOM layer above the canvas so the renderer stays a pure redraw.
import { COLORS } from './config.js?v=5';

export const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const layer = () => document.getElementById('fx');
const toastBar = () => document.getElementById('toasts');

function spawn(className, x, y, html = '') {
  const el = document.createElement('div');
  el.className = `fx ${className}`;
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.innerHTML = html;
  layer().append(el);
  return el;
}

function fly(el, frames, options) {
  const anim = el.animate(frames, { fill: 'forwards', easing: 'ease-out', ...options });
  anim.onfinish = () => el.remove();
  return el;
}

// Droplets flung out of a machine or a delivery.
export function burst(x, y, color, count = 9) {
  if (reducedMotion) return;
  const fill = COLORS[color]?.fill ?? '#8c8494';
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + Math.random() * 0.6;
    const dist = 26 + Math.random() * 34;
    const size = 6 + Math.random() * 7;
    const el = spawn('dot', x, y);
    el.style.cssText += `width:${size}px;height:${size}px;background:${i % 4 ? fill : '#fff'}`;
    fly(
      el,
      [
        { transform: 'translate(-50%,-50%) scale(1)', opacity: 1 },
        { transform: `translate(calc(-50% + ${Math.cos(angle) * dist}px),calc(-50% + ${Math.sin(angle) * dist}px)) scale(.2)`, opacity: 0 },
      ],
      { duration: 420 + Math.random() * 220, easing: 'cubic-bezier(.15,.7,.3,1)' }
    );
  }
}

// A ring pushing outward, for a machine that just finished something.
export function ring(x, y, color) {
  if (reducedMotion) return;
  const el = spawn('ring', x, y);
  el.style.borderColor = COLORS[color]?.fill ?? '#8c8494';
  fly(el, [
    { transform: 'translate(-50%,-50%) scale(.3)', opacity: 0.9 },
    { transform: 'translate(-50%,-50%) scale(1.5)', opacity: 0 },
  ], { duration: 560 });
}

// "+1" rising off a depot.
export function floater(x, y, text, color = '#3f4654') {
  const el = spawn('floater', x, y, `<span>${text}</span>`);
  el.style.color = color;
  fly(el, [
    { transform: 'translate(-50%,-50%) scale(.6)', opacity: 0 },
    { transform: 'translate(-50%,-120%) scale(1.15)', opacity: 1, offset: 0.35 },
    { transform: 'translate(-50%,-230%) scale(1)', opacity: 0 },
  ], { duration: 1000 });
}

// A pill sliding in at the top: new building, new recipe unlocked, warnings.
// `icon` is a sprite id like '#i-shop', or true for a plain colour dot.
export function toast(text, { color = '#3f4654', icon = '' } = {}) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.style.setProperty('--tint', color);
  const mark =
    typeof icon === 'string' && icon.startsWith('#')
      ? `<svg class="icon" style="color:${color}"><use href="${icon}"></use></svg>`
      : icon
        ? `<i style="background:${color}"></i>`
        : '';
  el.innerHTML = `${mark}<span>${text}</span>`;
  toastBar().append(el);
  const anim = el.animate(
    [
      { transform: 'translateY(-14px) scale(.9)', opacity: 0 },
      { transform: 'none', opacity: 1, offset: 0.12 },
      { transform: 'none', opacity: 1, offset: 0.82 },
      { transform: 'translateY(-10px) scale(.96)', opacity: 0 },
    ],
    { duration: reducedMotion ? 1600 : 2600, easing: 'cubic-bezier(.2,1.4,.4,1)' }
  );
  anim.onfinish = () => el.remove();
}

export function confetti(count = 64) {
  if (reducedMotion) return;
  const colors = Object.values(COLORS).map((c) => c.fill);
  for (let i = 0; i < count; i++) {
    const size = 7 + Math.random() * 7;
    const el = spawn('confetti', Math.random() * innerWidth, -20);
    el.style.cssText += `width:${size}px;height:${size * 0.6}px;background:${colors[i % colors.length]}`;
    const drift = (Math.random() - 0.5) * 180;
    const spin = (Math.random() - 0.5) * 900;
    fly(
      el,
      [
        { transform: 'translate(-50%,-50%) rotate(0deg)' },
        { transform: `translate(calc(-50% + ${drift}px),${innerHeight + 40}px) rotate(${spin}deg)` },
      ],
      { duration: 2200 + Math.random() * 1400, delay: Math.random() * 500, easing: 'cubic-bezier(.3,.2,.6,1)' }
    );
  }
}

// Screen nudge when a machine burns out.
export function shake(el) {
  if (reducedMotion) return;
  el.animate(
    [{ transform: 'translate(0,0)' }, { transform: 'translate(-7px,3px)' }, { transform: 'translate(6px,-2px)' }, { transform: 'translate(-3px,1px)' }, { transform: 'none' }],
    { duration: 380, easing: 'ease-out' }
  );
}

export function pop(el) {
  if (reducedMotion) return;
  el.animate([{ transform: 'scale(.8)' }, { transform: 'scale(1.12)', offset: 0.6 }, { transform: 'none' }], {
    duration: 380,
    easing: 'cubic-bezier(.2,1.5,.4,1)',
  });
}
