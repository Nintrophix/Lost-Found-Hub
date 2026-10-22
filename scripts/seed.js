'use strict';

/**
 * Resets the database to a demo state: 3 users, 20 items with images,
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
const mongoose = require('mongoose');
const sharp = require('sharp');

const config = require('../src/config/env');
const { connectDB, disconnectDB } = require('../src/config/db');
const { UPLOAD_DIR } = require('../src/config/multer');
const { PATHS } = require('../src/utils/icons');
const User = require('../src/models/User');
const Item = require('../src/models/Item');
const Claim = require('../src/models/Claim');
const Conversation = require('../src/models/Conversation');
const Message = require('../src/models/Message');

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
  await sharp(Buffer.from(svg)).webp({ quality: 82 }).toFile(path.join(UPLOAD_DIR, filename));
  return `/uploads/${filename}`;
}

function removeOldSeedImages() {
  fs.readdirSync(UPLOAD_DIR)
    .filter((name) => name.startsWith('seed-'))
    .forEach((name) => fs.unlinkSync(path.join(UPLOAD_DIR, name)));
}

async function addMessages(conversation, messages) {
  let last = conversation.lastMessageAt;
  for (const m of messages) {
    const createdAt = new Date(Date.now() - m.minutesAgo * 60 * 1000);
    await Message.create({
      conversation: conversation._id,
      sender: m.from._id,
      body: m.body,
      readBy: m.read ? conversation.participants : [m.from._id],
      createdAt,
    });
    last = createdAt;
  }
  conversation.lastMessageAt = last;
  await conversation.save();
}

async function main() {
  if (config.isProd && !process.argv.includes('--force')) {
    console.error('Refusing to seed in production (this deletes all data). Re-run with --force if you are sure.');
    process.exit(1);
  }

  await connectDB();
  console.log('Clearing existing data...');
  await Promise.all([
    User.deleteMany({}),
    Item.deleteMany({}),
    Claim.deleteMany({}),
    Conversation.deleteMany({}),
    Message.deleteMany({}),
    mongoose.connection.db.collection('sessions').deleteMany({}),
  ]);
  removeOldSeedImages();

  console.log('Creating users...');
  const users = {};
  for (const u of USERS) {
    users[u.key] = await User.create({
      name: u.name,
      email: u.email,
      role: u.role,
      campusId: u.campusId,
      passwordHash: await User.hashPassword(u.password),
    });
  }

  console.log('Creating items and images...');
  const items = {};
  for (const [index, spec] of ITEMS.entries()) {
    // Every item gets one image; every third item also gets a close-up.
    const images = [await renderItemImage(spec, 0)];
    if (index % 3 === 0) images.push(await renderItemImage(spec, 1));
    const posted = daysAgo(spec.posted);
    items[spec.ref] = await Item.create({
      type: spec.type,
      title: spec.title,
      description: spec.description,
      category: spec.category,
      color: spec.color,
      location: spec.location,
      dateLostOrFound: daysAgo(spec.days, { midnight: true }),
      images,
      status: 'open',
      reporter: users[spec.reporter]._id,
      createdAt: posted,
      updatedAt: posted,
    });
  }

  console.log('Creating claims and conversations...');
  const { ava, jordan, sam } = users;

  // 1. Pending claim waiting for Ava's review.
  await Claim.create({
    item: items.charger._id,
    claimant: sam._id,
    message: 'That is my charger. It has a small piece of green electrical tape on the cable about 10 cm from the plug, ' +
      'and I left it in room 104 after the Tuesday 2 pm circuits lab.',
    createdAt: daysAgo(0.5),
  });

  // 2. Approved claim: item is claimed and the hand-off is being arranged in chat.
  await Claim.create({
    item: items.jacket._id,
    claimant: ava._id,
    message: 'The jacket has a hair tie in the left pocket and the inside label has a small tear. I sat in row F for BIO 110.',
    status: 'approved',
    createdAt: daysAgo(2),
  });
  await Claim.create({
    item: items.jacket._id,
    claimant: sam._id,
    message: 'I lost a navy jacket in a lecture hall this week and think it could be this one.',
    status: 'rejected',
    createdAt: daysAgo(2.2),
  });
  await Item.updateOne({ _id: items.jacket._id }, { status: 'claimed' });
  const jacketChat = await Conversation.findOrCreate(items.jacket._id, jordan._id, ava._id);
  await addMessages(jacketChat, [
    { from: jordan, body: 'Hi Ava, your description matches. I work in the Lecture Hall A office.', minutesAgo: 2800, read: true },
    { from: ava, body: 'Thank you so much! When is a good time to pick it up?', minutesAgo: 2790, read: true },
    { from: jordan, body: 'I am in the office from 9 to 4 on weekdays. Room A-012, next to the vending machines.', minutesAgo: 2780, read: true },
    { from: ava, body: 'Perfect, I will come by tomorrow at 10.', minutesAgo: 95, read: false },
  ]);

  // 3. Resolved: claim approved and the keys were handed back.
  await Claim.create({
    item: items.carabinerKeys._id,
    claimant: sam._id,
    message: 'Three keys on a green carabiner: the brass one is for a bike lock and one silver key has a blue rubber cap.',
    status: 'approved',
    createdAt: daysAgo(10),
  });
  await Item.updateOne({ _id: items.carabinerKeys._id }, { status: 'resolved' });
  const keysChat = await Conversation.findOrCreate(items.carabinerKeys._id, jordan._id, sam._id);
  await addMessages(keysChat, [
    { from: jordan, body: 'The blue cap detail checks out. I can meet at the Chemistry Building lobby at noon.', minutesAgo: 14000, read: true },
    { from: sam, body: 'Got them, thanks Jordan!', minutesAgo: 13800, read: true },
  ]);

  // 4. Someone found Ava's lost backpack and wrote to her.
  const backpackChat = await Conversation.findOrCreate(items.backpack._id, sam._id, ava._id);
  await addMessages(backpackChat, [
    {
      from: sam,
      body: 'I think I found your backpack at the Hamilton Hall bus stop. It has a blue pencil case and a calculus notebook. ' +
        'I left it with the Hamilton Hall front desk.',
      minutesAgo: 40,
      read: false,
    },
  ]);

  const counts = await Promise.all([User.countDocuments(), Item.countDocuments(), Claim.countDocuments(), Message.countDocuments()]);
  console.log(`Done: ${counts[0]} users, ${counts[1]} items, ${counts[2]} claims, ${counts[3]} messages.`);
  console.log('\nDemo accounts:');
  USERS.forEach((u) => console.log(`  ${u.role.padEnd(7)} ${u.email.padEnd(20)} ${u.password}`));

  await disconnectDB();
}

main().catch(async (err) => {
  console.error('Seeding failed:', err.message);
  await disconnectDB().catch(() => {});
  process.exit(1);
});
