'use strict';

/**
 * Generates public/img/topography.svg: a seamless tile of topographic contour
 * lines used (as a CSS mask, so it takes the theme's color) for the page background.
 *
 * How: periodic value noise (the lattice wraps, so opposite edges match) is
 * sampled on a grid, contour lines are traced with marching squares at evenly
 * spaced heights, and the segments are joined into polylines.
 *
 * Run with: node scripts/generate-topography.js [seed]
 */
const fs = require('fs');
const path = require('path');

const TILE = 640; // output size in px (also the CSS mask-size)
const GRID = 160; // samples per side
const LEVELS = 15; // contour lines per unit of height
const SEED = Number(process.argv[2]) || 20261022;

/* Small deterministic PRNG (mulberry32) so the tile is reproducible. */
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One octave of value noise on a lattice of `period` cells that wraps around. */
function makeOctave(period, random) {
  const lattice = Array.from({ length: period }, () => Array.from({ length: period }, random));
  const smooth = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  return (u, v) => {
    const x = u * period;
    const y = v * period;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = smooth(x - x0);
    const fy = smooth(y - y0);
    const at = (i, j) => lattice[((j % period) + period) % period][((i % period) + period) % period];
    const top = at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx;
    const bottom = at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx;
    return top * (1 - fy) + bottom * fy;
  };
}

function buildField() {
  const random = prng(SEED);
  const octaves = [
    { fn: makeOctave(3, random), amp: 1 },
    { fn: makeOctave(6, random), amp: 0.45 },
    { fn: makeOctave(12, random), amp: 0.18 },
  ];
  const total = octaves.reduce((s, o) => s + o.amp, 0);
  const field = [];
  for (let j = 0; j <= GRID; j += 1) {
    const row = [];
    for (let i = 0; i <= GRID; i += 1) {
      // Index GRID samples the same point as 0, so the tile edges line up exactly.
      const u = (i % GRID) / GRID;
      const v = (j % GRID) / GRID;
      row.push(octaves.reduce((s, o) => s + o.fn(u, v) * o.amp, 0) / total);
    }
    field.push(row);
  }
  return field;
}

/** Marching squares: returns line segments [[x1, y1], [x2, y2]] for one height. */
function contourSegments(field, level) {
  const segments = [];
  const cell = TILE / GRID;
  const lerp = (a, b) => (level - a) / (b - a);
  for (let j = 0; j < GRID; j += 1) {
    for (let i = 0; i < GRID; i += 1) {
      const tl = field[j][i];
      const tr = field[j][i + 1];
      const br = field[j + 1][i + 1];
      const bl = field[j + 1][i];
      const code = (tl > level ? 8 : 0) | (tr > level ? 4 : 0) | (br > level ? 2 : 0) | (bl > level ? 1 : 0);
      if (code === 0 || code === 15) continue;
      const x = i * cell;
      const y = j * cell;
      const top = [x + lerp(tl, tr) * cell, y];
      const right = [x + cell, y + lerp(tr, br) * cell];
      const bottom = [x + lerp(bl, br) * cell, y + cell];
      const left = [x, y + lerp(tl, bl) * cell];
      const center = (tl + tr + br + bl) / 4;
      switch (code) {
        case 1: case 14: segments.push([left, bottom]); break;
        case 2: case 13: segments.push([bottom, right]); break;
        case 3: case 12: segments.push([left, right]); break;
        case 4: case 11: segments.push([top, right]); break;
        case 6: case 9: segments.push([top, bottom]); break;
        case 7: case 8: segments.push([left, top]); break;
        case 5:
          if (center > level) { segments.push([left, top]); segments.push([bottom, right]); }
          else { segments.push([left, bottom]); segments.push([top, right]); }
          break;
        case 10:
          if (center > level) { segments.push([top, right]); segments.push([left, bottom]); }
          else { segments.push([left, top]); segments.push([bottom, right]); }
          break;
        default:
          break;
      }
    }
  }
  return segments;
}

/** Joins segments that share endpoints into longer polylines. */
function joinSegments(segments) {
  const key = (p) => `${p[0].toFixed(3)},${p[1].toFixed(3)}`;
  const byPoint = new Map();
  segments.forEach((s, index) => {
    [0, 1].forEach((end) => {
      const k = key(s[end]);
      if (!byPoint.has(k)) byPoint.set(k, []);
      byPoint.get(k).push(index);
    });
  });
  const used = new Array(segments.length).fill(false);
  const lines = [];

  const extend = (line, fromEnd) => {
    for (;;) {
      const tip = fromEnd ? line[line.length - 1] : line[0];
      const next = (byPoint.get(key(tip)) || []).find((idx) => !used[idx]);
      if (next === undefined) return;
      used[next] = true;
      const [a, b] = segments[next];
      const other = key(a) === key(tip) ? b : a;
      if (fromEnd) line.push(other);
      else line.unshift(other);
    }
  };

  segments.forEach((s, index) => {
    if (used[index]) return;
    used[index] = true;
    const line = [s[0], s[1]];
    extend(line, true);
    extend(line, false);
    lines.push(line);
  });
  return lines;
}

/** Drops points closer than `min` px to the previous kept point to keep the file small. */
function thin(line, min) {
  const out = [line[0]];
  for (let i = 1; i < line.length - 1; i += 1) {
    const p = out[out.length - 1];
    if (Math.hypot(line[i][0] - p[0], line[i][1] - p[1]) >= min) out.push(line[i]);
  }
  out.push(line[line.length - 1]);
  return out;
}

function main() {
  const field = buildField();
  let min = Infinity;
  let max = -Infinity;
  field.forEach((row) => row.forEach((v) => { min = Math.min(min, v); max = Math.max(max, v); }));

  const paths = [];
  for (let n = 1; n < LEVELS; n += 1) {
    const level = min + ((max - min) * n) / LEVELS;
    joinSegments(contourSegments(field, level)).forEach((line) => {
      const pts = thin(line, 2.2);
      // Skip specks: tiny closed loops read as noise, not terrain.
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      if (pts.length < 2 || Math.max(...xs) - Math.min(...xs) + Math.max(...ys) - Math.min(...ys) < 8) return;
      paths.push('M' + pts.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('L'));
    });
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${TILE}" height="${TILE}" viewBox="0 0 ${TILE} ${TILE}">` +
    `<path fill="none" stroke="#000" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round" d="${paths.join('')}"/>` +
    '</svg>\n';

  const out = path.join(__dirname, '..', 'public', 'img', 'topography.svg');
  fs.writeFileSync(out, svg);
  console.log(`Wrote ${out} (${(svg.length / 1024).toFixed(1)} KB, ${paths.length} contour lines).`);
}

main();
