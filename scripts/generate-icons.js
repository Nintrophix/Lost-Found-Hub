'use strict';

/**
 * Generates the favicon set in public/ from one SVG source:
 *   public/img/favicon.svg, public/favicon.ico (16, 32, 48 px), public/img/apple-touch-icon.png (180 px)
 * Run with: node scripts/generate-icons.js   (needs the sharp dev dependency)
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { PATHS } = require('../src/utils/icons');

const PUBLIC = path.join(__dirname, '..', 'public');
const BRAND = '#1d4e89';

function iconSvg({ padding = 4, radius = 7, strokeWidth = 2 } = {}) {
  const scale = (32 - padding * 2) / 24;
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
    `<rect width="32" height="32" rx="${radius}" fill="${BRAND}"/>` +
    `<g transform="translate(${padding} ${padding}) scale(${scale})" fill="none" stroke="#ffffff" ` +
    `stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">${PATHS.tag}</g>` +
    '</svg>\n'
  );
}

/** Packs PNG images into a single .ico file (PNG-compressed entries are valid ICO). */
function buildIco(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);

  const entries = [];
  let offset = 6 + pngs.length * 16;
  pngs.forEach(({ size, data }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(entry);
  });
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

async function main() {
  fs.mkdirSync(path.join(PUBLIC, 'img'), { recursive: true });

  const svg = iconSvg();
  fs.writeFileSync(path.join(PUBLIC, 'img', 'favicon.svg'), svg);

  const pngs = await Promise.all(
    [16, 32, 48].map(async (size) => ({
      size,
      data: await sharp(Buffer.from(svg), { density: 600 }).resize(size, size).png().toBuffer(),
    }))
  );
  fs.writeFileSync(path.join(PUBLIC, 'favicon.ico'), buildIco(pngs));

  // Apple touch icons are shown without transparency, so use a square background.
  const touch = iconSvg({ padding: 6, radius: 0, strokeWidth: 1.6 });
  await sharp(Buffer.from(touch), { density: 600 }).resize(180, 180).png().toFile(path.join(PUBLIC, 'img', 'apple-touch-icon.png'));

  console.log('Icons written to public/favicon.ico and public/img/.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
