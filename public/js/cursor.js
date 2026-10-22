/*
 * Fluid magnetic cursor.
 * A small dot tracks the pointer exactly; a ring follows it with spring lag and
 * stretches along the direction of travel. Over buttons and navigation links the
 * ring wraps the element and the element leans toward the pointer.
 *
 * Runs only with a mouse or trackpad (hover + fine pointer) and when the visitor
 * has not asked for reduced motion. The system cursor is never hidden, and the
 * animation loop stops whenever everything has come to rest.
 */
(function () {
  'use strict';

  var finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (!finePointer.matches || reduceMotion.matches) return;

  var MAGNETIC = '.btn, .nav-link, .theme-toggle, .page-link, .brand, [data-magnetic]';
  var TEXT_INPUT = 'input:not([type="radio"]):not([type="checkbox"]):not([type="submit"]):not([type="button"]), textarea, select, [contenteditable="true"]';
  var RING = 34; // resting ring diameter in px
  var PULL = 0.28; // how far a magnetic element leans toward the pointer (share of the offset)
  var MAX_LEAN = 8; // px

  var dot = document.createElement('div');
  var blob = document.createElement('div');
  dot.className = 'cursor-dot is-hidden';
  blob.className = 'cursor-blob is-hidden';
  dot.setAttribute('aria-hidden', 'true');
  blob.setAttribute('aria-hidden', 'true');
  document.body.appendChild(blob);
  document.body.appendChild(dot);

  var mouse = { x: -100, y: -100 };
  var ring = { x: -100, y: -100, w: RING, h: RING, r: RING / 2, vx: 0, vy: 0 };
  var magnet = null; // element the ring is wrapped around
  var leaning = new Map(); // element -> { x, y } current lean
  var pressed = false;
  var frame = null;

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function radiusOf(el) {
    var r = parseFloat(window.getComputedStyle(el).borderTopLeftRadius) || 6;
    return r + 4;
  }

  function step() {
    frame = null;
    var target = { x: mouse.x, y: mouse.y, w: RING, h: RING, r: RING / 2 };

    if (magnet && magnet.isConnected) {
      var rect = magnet.getBoundingClientRect();
      var cx = rect.left + rect.width / 2;
      var cy = rect.top + rect.height / 2;
      // The ring hugs the element but still drifts a little with the pointer.
      var drift = function (d) { return Math.max(-6, Math.min(6, d * 0.12)); };
      target = {
        x: cx + drift(mouse.x - cx),
        y: cy + drift(mouse.y - cy),
        w: rect.width + 10,
        h: rect.height + 10,
        r: radiusOf(magnet),
      };
      var lx = Math.max(-MAX_LEAN, Math.min(MAX_LEAN, (mouse.x - cx) * PULL));
      var ly = Math.max(-MAX_LEAN, Math.min(MAX_LEAN, (mouse.y - cy) * PULL));
      var lean = leaning.get(magnet) || { cx: 0, cy: 0 };
      lean.x = lx;
      lean.y = ly;
      leaning.set(magnet, lean);
    } else {
      magnet = null;
    }

    // Spring toward the target: this lag is what makes the ring feel fluid.
    var prevX = ring.x;
    var prevY = ring.y;
    ring.x = lerp(ring.x, target.x, magnet ? 0.22 : 0.18);
    ring.y = lerp(ring.y, target.y, magnet ? 0.22 : 0.18);
    ring.w = lerp(ring.w, target.w, 0.2);
    ring.h = lerp(ring.h, target.h, 0.2);
    ring.r = lerp(ring.r, target.r, 0.2);
    ring.vx = ring.x - prevX;
    ring.vy = ring.y - prevY;

    var speed = Math.min(Math.hypot(ring.vx, ring.vy), 40);
    var angle = Math.atan2(ring.vy, ring.vx) * (180 / Math.PI);
    // Stretch along the direction of travel only while free; a wrapped ring stays square to the element.
    var stretch = magnet ? 0 : speed / 40;
    var sx = (1 + stretch * 0.45) * (pressed ? 0.85 : 1);
    var sy = (1 - stretch * 0.25) * (pressed ? 0.85 : 1);

    blob.style.width = ring.w.toFixed(1) + 'px';
    blob.style.height = ring.h.toFixed(1) + 'px';
    blob.style.borderRadius = ring.r.toFixed(1) + 'px';
    blob.style.transform =
      'translate(' + (ring.x - ring.w / 2).toFixed(1) + 'px,' + (ring.y - ring.h / 2).toFixed(1) + 'px)' +
      (magnet ? '' : ' rotate(' + angle.toFixed(1) + 'deg)') +
      ' scale(' + sx.toFixed(3) + ',' + sy.toFixed(3) + ')';
    dot.style.transform = 'translate(' + (mouse.x - 3) + 'px,' + (mouse.y - 3) + 'px)';

    // Ease leaning elements toward their lean (or back to rest after the pointer leaves).
    var moving = Math.abs(ring.x - target.x) > 0.1 || Math.abs(ring.y - target.y) > 0.1 ||
      Math.abs(ring.w - target.w) > 0.1 || Math.abs(ring.h - target.h) > 0.1;
    leaning.forEach(function (lean, el) {
      var goalX = el === magnet ? lean.x : 0;
      var goalY = el === magnet ? lean.y : 0;
      lean.cx = lerp(lean.cx || 0, goalX, 0.2);
      lean.cy = lerp(lean.cy || 0, goalY, 0.2);
      el.style.translate = lean.cx.toFixed(2) + 'px ' + lean.cy.toFixed(2) + 'px';
      if (el !== magnet && Math.abs(lean.cx) < 0.05 && Math.abs(lean.cy) < 0.05) {
        el.style.translate = '';
        leaning.delete(el);
      } else {
        moving = true;
      }
    });

    if (moving) frame = window.requestAnimationFrame(step);
  }

  function kick() {
    if (!frame) frame = window.requestAnimationFrame(step);
  }

  document.addEventListener('pointermove', function (event) {
    if (event.pointerType !== 'mouse') return;
    if (blob.classList.contains('is-hidden') && !event.target.closest(TEXT_INPUT)) {
      // First move after entering: start the ring where the pointer is, not where it was.
      ring.x = event.clientX;
      ring.y = event.clientY;
      blob.classList.remove('is-hidden');
      dot.classList.remove('is-hidden');
    }
    mouse.x = event.clientX;
    mouse.y = event.clientY;
    kick();
  }, { passive: true });

  document.addEventListener('pointerover', function (event) {
    if (event.pointerType !== 'mouse') return;
    var overText = event.target.closest(TEXT_INPUT);
    blob.classList.toggle('is-hidden', Boolean(overText));
    dot.classList.toggle('is-hidden', Boolean(overText));
    var el = event.target.closest(MAGNETIC);
    // Menu items get their own highlight, so they do not attract the ring.
    if (el && (el.closest('.dd-content') || el.disabled)) el = null;
    magnet = el;
    blob.classList.toggle('is-magnet', Boolean(el));
    if (el && !leaning.has(el)) leaning.set(el, { x: 0, y: 0, cx: 0, cy: 0 });
    kick();
  });

  document.addEventListener('pointerdown', function () {
    pressed = true;
    kick();
  });
  document.addEventListener('pointerup', function () {
    pressed = false;
    kick();
  });

  document.documentElement.addEventListener('mouseleave', function () {
    blob.classList.add('is-hidden');
    dot.classList.add('is-hidden');
    magnet = null;
    blob.classList.remove('is-magnet');
    kick();
  });

  // If the visitor turns on reduced motion mid-visit, remove the effect entirely.
  if (reduceMotion.addEventListener) {
    reduceMotion.addEventListener('change', function () {
      if (!reduceMotion.matches) return;
      leaning.forEach(function (lean, el) { el.style.translate = ''; });
      blob.remove();
      dot.remove();
    });
  }
})();
