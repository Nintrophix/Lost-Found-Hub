'use strict';

const Item = require('../models/Item');
const Claim = require('../models/Claim');
const config = require('../config/env');
const site = require('../config/site');
const { listConversations } = require('./chatController');
const { toDateInput } = require('../utils/format');

/** Escapes text for XML output. */
function xml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

exports.home = async (req, res) => {
  const [recent, counts] = await Promise.all([Item.recentOpen(8), Item.homeCounts()]);

  res.render('pages/home', {
    title: null,
    description: site.SITE_DESCRIPTION,
    recent,
    counts,
    jsonLd: [
      {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: site.SITE_NAME,
        url: site.absoluteUrl(req, '/'),
        description: site.SITE_DESCRIPTION,
        potentialAction: {
          '@type': 'SearchAction',
          target: { '@type': 'EntryPoint', urlTemplate: `${site.absoluteUrl(req, '/items')}?q={search_term_string}` },
          'query-input': 'required name=search_term_string',
        },
      },
    ],
  });
};

exports.privacy = (req, res) => {
  res.render('pages/privacy', {
    title: 'Privacy policy',
    description:
      'What Campus Lost & Found Hub collects, why, who can see it, how long it is kept and how to have it removed.',
    breadcrumbs: [{ name: 'Home', url: '/' }, { name: 'Privacy policy' }],
    contactEmail: config.contactEmail,
    lastUpdated: 'November 6, 2026',
    jsonLd: [
      {
        '@context': 'https://schema.org',
        '@type': 'WebPage',
        name: 'Privacy policy',
        url: site.absoluteUrl(req, '/privacy'),
        dateModified: '2026-11-06',
      },
    ],
  });
};

exports.dashboard = async (req, res) => {
  const userId = req.session.userId;
  const [myItems, myClaims, claimsOnMine, conversations] = await Promise.all([
    Item.listByReporter(userId),
    Claim.listByClaimant(userId, 20),
    Claim.listOnItemsOf(userId, { pendingOnly: true, oldestFirst: true }),
    listConversations(userId, 5),
  ]);

  res.render('pages/dashboard', {
    title: 'Your dashboard',
    description: 'Your reported items, your claims, claims waiting for your review and your conversations.',
    noindex: true,
    breadcrumbs: [{ name: 'Home', url: '/' }, { name: 'Dashboard' }],
    myItems,
    myClaims,
    claimsOnMine,
    conversations,
  });
};

exports.sitemap = async (req, res) => {
  const items = (await Item.sitemapEntries(45000)).map((row) => ({ _id: row.id, updatedAt: row.updated_at }));
  const latest = items[0] ? toDateInput(items[0].updatedAt) : toDateInput(new Date());
  const urls = [
    { loc: '/', lastmod: latest, changefreq: 'daily', priority: '1.0' },
    { loc: '/items', lastmod: latest, changefreq: 'hourly', priority: '0.9' },
    { loc: '/privacy', lastmod: '2026-11-06', changefreq: 'yearly', priority: '0.3' },
    ...items.map((i) => ({ loc: `/items/${i._id}`, lastmod: toDateInput(i.updatedAt), changefreq: 'weekly', priority: '0.6' })),
  ];

  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map(
      (u) =>
        `  <url><loc>${xml(site.absoluteUrl(req, u.loc))}</loc><lastmod>${u.lastmod}</lastmod>` +
        `<changefreq>${u.changefreq}</changefreq><priority>${u.priority}</priority></url>`
    ),
    '</urlset>',
    '',
  ].join('\n');

  res.type('application/xml').set('Cache-Control', 'public, max-age=3600').send(body);
};

exports.robots = (req, res) => {
  const body = [
    'User-agent: *',
    'Allow: /',
    'Disallow: /dashboard',
    'Disallow: /chat',
    'Disallow: /claims',
    'Disallow: /login',
    'Disallow: /register',
    'Disallow: /items/new',
    'Disallow: /api/',
    '',
    `Sitemap: ${site.absoluteUrl(req, '/sitemap.xml')}`,
    '',
  ].join('\n');
  res.type('text/plain').set('Cache-Control', 'public, max-age=86400').send(body);
};

exports.llms = (req, res) => {
  const u = (p) => site.absoluteUrl(req, p);
  const body = [
    `# ${site.SITE_NAME}`,
    '',
    `> ${site.SITE_DESCRIPTION}`,
    '',
    'Listings are either "lost" (someone is looking for the item) or "found" (someone is holding it).',
    'Each listing has a category, color, campus location, the date it was lost or found, up to four photos,',
    'and a status: open, claimed (an owner was approved and the hand-off is being arranged) or resolved (returned).',
    'Only the reporter\'s first name is public. Claims and chats require an account and are private.',
    '',
    '## Pages',
    '',
    `- [Home](${u('/')}): newest open listings and current open lost and found counts`,
    `- [Browse items](${u('/items')}): every listing, filterable by type, category, status and date`,
    `- [Lost items](${u('/items?type=lost')}): items people are looking for`,
    `- [Found items](${u('/items?type=found')}): items waiting for their owners`,
    `- [Report an item](${u('/items/new')}): form to report a lost or found item (login required)`,
    `- [Privacy policy](${u('/privacy')}): what data is collected and how it is used`,
    '',
    '## API',
    '',
    `- [Search items](${u('/api/items')}): GET JSON. Query parameters: q (full-text), type (lost|found), ` +
      'category (electronics|ids-cards|keys|bags|clothing|books|jewelry|other), status (open|claimed|resolved), ' +
      'from and to (YYYY-MM-DD), page, limit (max 48). Returns { items, page, totalPages, total }.',
    `- Item detail: GET ${u('/api/items/{id}')} returns { item }.`,
    '',
    '## Optional',
    '',
    `- [Sitemap](${u('/sitemap.xml')}): all public URLs`,
    '',
  ].join('\n');
  res.type('text/plain').set('Cache-Control', 'public, max-age=86400').send(body);
};
