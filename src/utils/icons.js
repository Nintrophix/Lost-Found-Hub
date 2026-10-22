'use strict';

/**
 * Inline SVG line icons (24x24, stroke based). Drawn for this project.
 * Used in templates through the icon() helper and by the seed script to
 * render listing images for the demo data.
 */
const PATHS = {
  // Interface
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  pin: '<path d="M12 21s-7-6.2-7-11.2a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.8" r="2.5"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  chat: '<path d="M4 5h16v11H10l-5 4v-4H4z"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  upload: '<path d="M12 15V4M7.5 8.5L12 4l4.5 4.5M4.5 15v4.5h15V15"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5c1.2-3.6 4-5.5 7.5-5.5s6.3 1.9 7.5 5.5"/>',
  tag: '<path d="M3.5 12.6V4.5a1 1 0 0 1 1-1h8.1l8 8a1 1 0 0 1 0 1.4l-7.2 7.2a1 1 0 0 1-1.4 0z"/><circle cx="8.5" cy="8.5" r="1.5"/>',
  arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  arrowLeft: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  shield: '<path d="M12 3l7.5 3v5.5c0 4.6-3.1 8.3-7.5 9.5-4.4-1.2-7.5-4.9-7.5-9.5V6z"/><path d="M8.8 12.2l2.2 2.2 4.2-4.4"/>',
  // Categories
  electronics: '<rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M10.5 18.5h3"/>',
  'ids-cards':
    '<rect x="2.5" y="5" width="19" height="14" rx="2"/><circle cx="8.5" cy="11" r="2"/>' +
    '<path d="M5.5 16c.6-1.3 1.7-2 3-2s2.4.7 3 2M14.5 10h4M14.5 13.5h3"/>',
  keys: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="M10.7 12.3L20 3M16 7l2.5 2.5M18.5 4.5L21 7"/>',
  bags:
    '<path d="M5.5 9.5a6.5 6.5 0 0 1 13 0V19a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2z"/>' +
    '<path d="M9 3.5h6M9 21v-5h6v5M5.5 12.5h13"/>',
  clothing: '<path d="M8.5 3L3 6.2l2.2 4.3 2.8-1.2V21h8V9.3l2.8 1.2L21 6.2 15.5 3a3.5 3.5 0 0 1-7 0z"/>',
  books:
    '<path d="M4.5 5A1.5 1.5 0 0 1 6 3.5h13.5v14H6A1.5 1.5 0 0 0 4.5 19z"/>' +
    '<path d="M4.5 19A1.5 1.5 0 0 0 6 20.5h13.5M9 7.5h6.5"/>',
  jewelry: '<circle cx="12" cy="14.5" r="6"/><path d="M9.5 5.5L12 8.5l2.5-3-1.2-2h-2.6z"/>',
  other: '<path d="M21 7.5l-9-4.5-9 4.5 9 4.5z"/><path d="M3 7.5v9l9 4.5 9-4.5v-9M12 12v9"/>',
  // Specific objects (used for demo listing images)
  bottle: '<path d="M10 2.5h4v3l1.5 2.5v12a1.5 1.5 0 0 1-1.5 1.5h-4A1.5 1.5 0 0 1 8.5 20V8L10 5.5z"/><path d="M8.5 11h7M8.5 16h7"/>',
  glasses:
    '<circle cx="6.5" cy="14" r="3.5"/><circle cx="17.5" cy="14" r="3.5"/>' +
    '<path d="M10 14c.7-.8 1.3-1.2 2-1.2s1.3.4 2 1.2M3 14l1-6.5h2.5M21 14l-1-6.5h-2.5"/>',
  umbrella: '<path d="M3 12a9 9 0 0 1 18 0z"/><path d="M12 12v7a2 2 0 0 1-4 0"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7.5a4 4 0 0 1 8 0V11M12 15v2"/>',
  calculator:
    '<rect x="5" y="2.5" width="14" height="19" rx="2"/><rect x="8" y="5.5" width="8" height="4" rx=".5"/>' +
    '<path d="M8.5 13h.01M12 13h.01M15.5 13h.01M8.5 16.5h.01M12 16.5h.01M15.5 16.5h.01"/>',
  earbuds: '<rect x="5" y="7" width="14" height="12" rx="5"/><path d="M5 11.5h14M12 14v1.5"/>',
  plug: '<path d="M9 2.5v5M15 2.5v5M7 7.5h10v3a5 5 0 0 1-10 0z"/><path d="M12 15.5v6"/>',
  notebook: '<rect x="6" y="3" width="13" height="18" rx="1.5"/><path d="M4 7h3M4 11h3M4 15h3M10 8h6M10 11.5h6"/>',
};

function svg(name, { cls = 'icon', size = 20, strokeWidth = 1.75, color = 'currentColor' } = {}) {
  const body = PATHS[name] || PATHS.other;
  return (
    `<svg class="${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" ` +
    `stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" ` +
    `aria-hidden="true" focusable="false">${body}</svg>`
  );
}

module.exports = { PATHS, svg };
