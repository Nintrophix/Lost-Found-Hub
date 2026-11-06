'use strict';

/**
 * Resets the Postgres (Supabase) database to a demo state: 3 users, 20 items with images,
 * claims in every state and a few conversations.
 *
 *   npm run seed            (refuses to run when NODE_ENV=production)
 *   npm run seed -- --force (runs anyway; this deletes all existing data)
 *
 * Listing images are generated illustrations (a category icon on the item's
 * color), so the demo does not ship stock or AI-generated photos.
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const config = require('../src/config/env');
const { connectDB, disconnectDB, query, one, transaction } = require('../src/config/db');
const { removeImages } = require('../src/services/storage');
// Demo images are committed with the code (public/img/seed) so they also exist on hosts like Render.
const SEED_DIR = path.join(__dirname, '..', 'public', 'img', 'seed');
const { PATHS } = require('../src/utils/icons');
const User = require('../src/models/User');

const DAY = 24 * 60 * 60 * 1000;

const USERS = [
  { key: 'ava', name: 'Ava Martinez', email: 'ava@example.edu', password: 'AvaDemo#2026', role: 'student', campusId: 'S2041187' },
  { key: 'jordan', name: 'Jordan Lee', email: 'jordan@example.edu', password: 'JordanDemo#2026', role: 'staff' },
  { key: 'sam', name: 'Sam Patel', email: 'sam@example.edu', password: 'SamDemo#2026', role: 'admin' },
];

// Hex values used to draw each listing image.
const COLORS = {
  navy: '#1f3a5f',
  'light blue': '#7fb3e0',
  black: '#1f2328',
  white: '#f3f4f6',
  red: '#b42318',
  green: '#2f7d4f',
  gray: '#6b7280',
  maroon: '#7a1f2b',
  silver: '#c0c4c9',
  gold: '#c9a227',
  brown: '#7a5230',
  yellow: '#e2b714',
  purple: '#5b3a8c',
  tan: '#c8a97e',
};

// icon: optional object icon for the demo image (defaults to the category icon).
// reporter: user key, days: how long ago it was lost/found, posted: days ago it was posted.
const ITEMS = [
  {
    ref: 'navyBottle', icon: 'bottle', reporter: 'jordan', type: 'found', category: 'other', color: 'navy', days: 2, posted: 2,
    title: 'Navy blue insulated water bottle',
    location: 'Main Library, 2nd floor study carrels',
    description: 'Navy blue 32 oz insulated steel water bottle with a dent near the base and a mountain sticker on the side. ' +
      'Left at a carrel by the north windows around 6 pm. Handed to the library circulation desk.',
  },
  {
    ref: 'lightBottle', icon: 'bottle', reporter: 'ava', type: 'lost', category: 'other', color: 'light blue', days: 4, posted: 4,
    title: 'Light blue plastic water bottle',
    location: 'Science Library, basement quiet room',
    description: 'Light blue BPA-free plastic water bottle with a flip straw lid and my initials A.M. written on the bottom in marker. ' +
      'I think I left it on the long table in the quiet room.',
  },
  {
    ref: 'charger', icon: 'plug', reporter: 'ava', type: 'found', category: 'electronics', color: 'black', days: 1, posted: 1,
    title: 'Black USB-C laptop charger',
    location: 'Engineering Building, room 104',
    description: 'Black 65 W USB-C laptop charger with a braided cable, still plugged into the wall socket under the window after the afternoon lab.',
  },
  {
    ref: 'earbuds', icon: 'earbuds', reporter: 'sam', type: 'lost', category: 'electronics', color: 'white', days: 3, posted: 3,
    title: 'White wireless earbuds case',
    location: 'Student Union food court',
    description: 'White wireless earbuds charging case with a small crack on the hinge. Both earbuds were inside. ' +
      'Probably fell out of my jacket pocket near the noodle counter at lunch.',
  },
  {
    ref: 'studentId', reporter: 'jordan', type: 'found', category: 'ids-cards', color: 'white', days: 1, posted: 1,
    title: 'Student ID card, last name starts with N',
    location: 'Recreation Center front desk',
    description: 'Student ID card found on the floor by the turnstiles. Kept at the Recreation Center front desk. ' +
      'Tell us your full name and student number to collect it.',
  },
  {
    ref: 'carKey', reporter: 'ava', type: 'lost', category: 'keys', color: 'red', days: 6, posted: 6,
    title: 'Car key with red key fob',
    location: 'Parking Garage B, level 3',
    description: 'Car key on a red plastic fob with a small silver house key and a library card tag on the same ring. ' +
      'Lost between my car on level 3 and the stairwell.',
  },
  {
    ref: 'carabinerKeys', reporter: 'jordan', type: 'found', category: 'keys', color: 'green', days: 12, posted: 12,
    title: 'Three keys on a green carabiner',
    location: 'Chemistry Building lobby',
    description: 'Three keys (one brass, two silver) clipped to a green climbing carabiner. Found on the bench next to the vending machines.',
  },
  {
    ref: 'backpack', reporter: 'ava', type: 'lost', category: 'bags', color: 'gray', days: 2, posted: 2,
    title: 'Gray backpack with laptop sleeve',
    location: 'Bus stop outside Hamilton Hall',
    description: 'Gray backpack with a padded laptop sleeve (no laptop inside), a blue pencil case, a calculus notebook and a reusable lunch box. ' +
      'Left it on the bench while getting on the 8:15 bus.',
  },
  {
    ref: 'tote', reporter: 'sam', type: 'found', category: 'bags', color: 'black', days: 5, posted: 5,
    title: 'Black canvas tote bag with sketchbooks',
    location: 'Art Building, Studio 3',
    description: 'Black canvas tote containing two sketchbooks and a tin of charcoal pencils. No name inside the bag.',
  },
  {
    ref: 'hoodie', reporter: 'sam', type: 'lost', category: 'clothing', color: 'maroon', days: 8, posted: 7,
    title: 'Maroon university hoodie, size M',
    location: 'Gym locker room',
    description: 'Maroon university hoodie, size medium, with a bleach spot on the left cuff. Left on the bench near lockers 40 to 60.',
  },
  {
    ref: 'jacket', reporter: 'jordan', type: 'found', category: 'clothing', color: 'navy', days: 3, posted: 3,
    title: 'Navy rain jacket',
    location: 'Lecture Hall A, row F',
    description: 'Navy lightweight rain jacket with a hood, left on a seat in row F after the morning lecture.',
  },
  {
    ref: 'textbook', reporter: 'ava', type: 'lost', category: 'books', color: 'yellow', days: 9, posted: 9,
    title: 'Organic chemistry textbook, 4th edition',
    location: 'Science Library, group study room 2',
    description: 'Organic chemistry textbook, 4th edition, with yellow sticky tabs on chapters 5 to 9 and a highlighted index.',
  },
  {
    ref: 'notebook', icon: 'notebook', reporter: 'jordan', type: 'found', category: 'books', color: 'purple', days: 4, posted: 4,
    title: 'Spiral notebook with ECON 201 notes',
    location: 'Business School cafe',
    description: 'Purple spiral notebook full of ECON 201 lecture notes and a graded problem set tucked in the back cover.',
  },
  {
    ref: 'ring', reporter: 'sam', type: 'lost', category: 'jewelry', color: 'silver', days: 10, posted: 10,
    title: 'Silver ring with an engraved date',
    location: 'Humanities Building, 2nd floor restroom',
    description: 'Plain silver band with a date engraved on the inside. I took it off to wash my hands and forgot it by the sink. Sentimental value.',
  },
  {
    ref: 'earring', reporter: 'ava', type: 'found', category: 'jewelry', color: 'gold', days: 6, posted: 6,
    title: 'Gold hoop earring',
    location: 'Dining Hall East, near the salad bar',
    description: 'Single small gold hoop earring found on the floor near the salad bar. Kept with the dining hall manager.',
  },
  {
    ref: 'umbrella', icon: 'umbrella', reporter: 'sam', type: 'lost', category: 'other', color: 'black', days: 5, posted: 5,
    title: 'Black umbrella with a wooden handle',
    location: 'Main Library entrance',
    description: 'Large black umbrella with a curved wooden handle. Left in the umbrella stand at the entrance during the afternoon rain.',
  },
  {
    ref: 'calculator', icon: 'calculator', reporter: 'jordan', type: 'found', category: 'electronics', color: 'black', days: 2, posted: 2,
    title: 'Graphing calculator',
    location: 'Math Building, room 210',
    description: 'Black graphing calculator in a slide cover. There is a name scratched on the back, which the owner should be able to tell us.',
  },
  {
    ref: 'glasses', icon: 'glasses', reporter: 'ava', type: 'lost', category: 'other', color: 'brown', days: 1, posted: 1,
    title: 'Prescription glasses in a brown case',
    location: 'Student Union, 3rd floor lounge',
    description: 'Tortoiseshell prescription glasses in a brown hard case with a cleaning cloth inside.',
  },
  {
    ref: 'keyCard', reporter: 'sam', type: 'found', category: 'ids-cards', color: 'tan', days: 3, posted: 3,
    title: 'Residence hall key card, Maple Hall',
    location: 'Maple Hall laundry room',
    description: 'Maple Hall residence key card on a tan lanyard, left on top of dryer 4.',
  },
  {
    ref: 'bikeLock', icon: 'lock', reporter: 'jordan', type: 'found', category: 'other', color: 'red', days: 7, posted: 7,
    title: 'Red bike lock with key',
    location: 'Bike racks beside the Main Library',
    description: 'Red U-lock with its key still in the lock, left open on the bike rack nearest the library steps.',
  },
];

function daysAgo(days, { midnight = false } = {}) {
  const d = new Date(Date.now() - days * DAY);
  if (midnight) d.setUTCHours(0, 0, 0, 0);
  return d;
}

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function mixWithWhite(hex, amount) {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return '#' + channels.map((c) => Math.round(c + (255 - c) * amount).toString(16).padStart(2, '0')).join('');
}

/** Draws a listing image: the category icon in the item's color on a matching background. */
async function renderItemImage(item, variant) {
  const color = COLORS[item.color] || '#6b7280';
  const light = luminance(color) > 0.62;
  const background = light ? '#3b4250' : mixWithWhite(color, variant === 0 ? 0.86 : 0.74);
  const panel = light ? '#4a5262' : mixWithWhite(color, variant === 0 ? 0.93 : 0.84);
  const scale = variant === 0 ? 13 : 17;
  const size = 24 * scale;
  const x = (800 - size) / 2;
  const y = (600 - size) / 2;

  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">' +
    `<rect width="800" height="600" fill="${background}"/>` +
    `<circle cx="400" cy="300" r="${variant === 0 ? 210 : 250}" fill="${panel}"/>` +
    `<g transform="translate(${x} ${y}) scale(${scale})" fill="none" stroke="${color}" stroke-width="1.4" ` +
    `stroke-linecap="round" stroke-linejoin="round">${PATHS[item.icon || item.category]}</g>` +
    '</svg>';

  const filename = `seed-${item.ref}-${variant + 1}.webp`;
  await sharp(Buffer.from(svg)).webp({ quality: 82 }).toFile(path.join(SEED_DIR, filename));
  return `/img/seed/${filename}`;
}

function removeOldSeedImages() {
  fs.mkdirSync(SEED_DIR, { recursive: true });
  fs.readdirSync(SEED_DIR)
    .filter((name) => name.startsWith('seed-'))
    .forEach((name) => fs.unlinkSync(path.join(SEED_DIR, name)));
}

/** Inserts a conversation's messages in order and moves the thread's last activity to the newest one. */
async function addMessages(tx, conversation, messages) {
  let last = null;
  for (const m of messages) {
    const createdAt = new Date(Date.now() - m.minutesAgo * 60 * 1000);
    await tx.query(
      'insert into messages (conversation_id, sender_id, body, read_at, created_at) values ($1, $2, $3, $4, $5)',
      [conversation.id, m.from.id, m.body, m.read ? createdAt : null, createdAt]
    );
    last = createdAt;
  }
  if (last) await tx.query('update conversations set last_message_at = $2 where id = $1', [conversation.id, last]);
}

async function openConversation(tx, itemId, userA, userB) {
  const [a, b] = [userA.id, userB.id].sort();
  return tx.one('insert into conversations (item_id, user_a, user_b) values ($1, $2, $3) returning id', [itemId, a, b]);
}

async function insertClaim(tx, { item, claimant, message, status = 'pending', createdAt = new Date() }) {
  await tx.query('insert into claims (item_id, claimant_id, message, status, created_at) values ($1, $2, $3, $4, $5)', [
    item.id,
    claimant.id,
    message,
    status,
    createdAt,
  ]);
}

async function main() {
  if (config.isProd && !process.argv.includes('--force')) {
    console.error('Refusing to seed in production (this deletes all data). Re-run with --force if you are sure.');
    process.exit(1);
  }

  await connectDB();

  // Photos people uploaded are deleted along with their listings.
  const uploaded = (await query('select images from items')).flatMap((row) => row.images);

  removeOldSeedImages();
  console.log('Drawing demo images...');
  const images = {};
  for (const [index, spec] of ITEMS.entries()) {
    // Every item gets one image; every third item also gets a close-up.
    images[spec.ref] = [await renderItemImage(spec, 0)];
    if (index % 3 === 0) images[spec.ref].push(await renderItemImage(spec, 1));
  }

  const hashes = await Promise.all(USERS.map((u) => User.hashPassword(u.password)));

  // Everything below runs in one transaction: the demo data appears all at once or not at all.
  await transaction(async (tx) => {
    console.log('Clearing existing data...');
    await tx.query('truncate messages, conversations, claims, items, users, user_sessions restart identity cascade');

    console.log('Creating users...');
    const users = {};
    for (const [i, u] of USERS.entries()) {
      users[u.key] = await tx.one(
        'insert into users (name, email, role, campus_id, password_hash) values ($1, $2, $3, $4, $5) returning id',
        [u.name, u.email, u.role, u.campusId || null, hashes[i]]
      );
    }

    console.log('Creating items...');
    const items = {};
    for (const spec of ITEMS) {
      const posted = daysAgo(spec.posted);
      items[spec.ref] = await tx.one(
        `insert into items (type, title, description, category, color, location, date_lost_or_found, images, status,
                            reporter_id, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, 'open', $9, $10, $10) returning id`,
        [
          spec.type,
          spec.title,
          spec.description,
          spec.category,
          spec.color,
          spec.location,
          daysAgo(spec.days, { midnight: true }).toISOString().slice(0, 10),
          images[spec.ref],
          users[spec.reporter].id,
          posted,
        ]
      );
    }

    console.log('Creating claims and conversations...');
    const { ava, jordan, sam } = users;

    // 1. Pending claim waiting for Ava's review.
    await insertClaim(tx, {
      item: items.charger,
      claimant: sam,
      message: 'That is my charger. It has a small piece of green electrical tape on the cable about 10 cm from the plug, ' +
        'and I left it in room 104 after the Tuesday 2 pm circuits lab.',
      createdAt: daysAgo(0.5),
    });

    // 2. Approved claim: item is claimed and the hand-off is being arranged in chat.
    await insertClaim(tx, {
      item: items.jacket,
      claimant: ava,
      message: 'The jacket has a hair tie in the left pocket and the inside label has a small tear. I sat in row F for BIO 110.',
      status: 'approved',
      createdAt: daysAgo(2),
    });
    await insertClaim(tx, {
      item: items.jacket,
      claimant: sam,
      message: 'I lost a navy jacket in a lecture hall this week and think it could be this one.',
      status: 'rejected',
      createdAt: daysAgo(2.2),
    });
    await tx.query("update items set status = 'claimed' where id = $1", [items.jacket.id]);
    const jacketChat = await openConversation(tx, items.jacket.id, jordan, ava);
    await addMessages(tx, jacketChat, [
      { from: jordan, body: 'Hi Ava, your description matches. I work in the Lecture Hall A office.', minutesAgo: 2800, read: true },
      { from: ava, body: 'Thank you so much! When is a good time to pick it up?', minutesAgo: 2790, read: true },
      { from: jordan, body: 'I am in the office from 9 to 4 on weekdays. Room A-012, next to the vending machines.', minutesAgo: 2780, read: true },
      { from: ava, body: 'Perfect, I will come by tomorrow at 10.', minutesAgo: 95, read: false },
    ]);

    // 3. Resolved: claim approved and the keys were handed back.
    await insertClaim(tx, {
      item: items.carabinerKeys,
      claimant: sam,
      message: 'Three keys on a green carabiner: the brass one is for a bike lock and one silver key has a blue rubber cap.',
      status: 'approved',
      createdAt: daysAgo(10),
    });
    await tx.query("update items set status = 'resolved' where id = $1", [items.carabinerKeys.id]);
    const keysChat = await openConversation(tx, items.carabinerKeys.id, jordan, sam);
    await addMessages(tx, keysChat, [
      { from: jordan, body: 'The blue cap detail checks out. I can meet at the Chemistry Building lobby at noon.', minutesAgo: 14000, read: true },
      { from: sam, body: 'Got them, thanks Jordan!', minutesAgo: 13800, read: true },
    ]);

    // 4. Someone found Ava's lost backpack and wrote to her.
    const backpackChat = await openConversation(tx, items.backpack.id, sam, ava);
    await addMessages(tx, backpackChat, [
      {
        from: sam,
        body: 'I think I found your backpack at the Hamilton Hall bus stop. It has a blue pencil case and a calculus notebook. ' +
          'I left it with the Hamilton Hall front desk.',
        minutesAgo: 40,
        read: false,
      },
    ]);
  });

  await removeImages(uploaded);

  const counts = await one(
    `select (select count(*) from users)::int as users, (select count(*) from items)::int as items,
            (select count(*) from claims)::int as claims, (select count(*) from messages)::int as messages`
  );
  console.log(`Done: ${counts.users} users, ${counts.items} items, ${counts.claims} claims, ${counts.messages} messages.`);
  console.log('\nDemo accounts:');
  USERS.forEach((u) => console.log(`  ${u.role.padEnd(7)} ${u.email.padEnd(20)} ${u.password}`));

  await disconnectDB();
}

main().catch(async (err) => {
  console.error('Seeding failed:', err.message);
  await disconnectDB().catch(() => {});
  process.exit(1);
});
