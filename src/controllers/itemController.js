'use strict';

const Item = require('../models/Item');
const User = require('../models/User');
const Claim = require('../models/Claim');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const { MAX_IMAGES } = require('../config/multer');
const { errorMap } = require('../middleware/validate');
const { removeImages, removeUploadedFiles, publicPathFor } = require('../services/files');
const { parseFilters, searchItems, filtersToQuery, toPublicItem } = require('../services/itemSearch');
const { absoluteUrl } = require('../config/site');
const { formatDate, toDateInput, truncate } = require('../utils/format');
const { HttpError, isValidId } = require('../utils/http');

const ITEM_FIELDS = ['type', 'title', 'description', 'category', 'color', 'location', 'dateLostOrFound'];
const TYPE_LABEL = { lost: 'Lost', found: 'Found' };

/* ------------------------------------------------------------------ helpers */

/** Copies validated item fields from a request body, converting the date. */
function itemFieldsFrom(body) {
  const fields = {};
  ITEM_FIELDS.forEach((key) => {
    if (typeof body[key] === 'string') fields[key] = body[key];
  });
  if (fields.dateLostOrFound) fields.dateLostOrFound = new Date(`${fields.dateLostOrFound}T00:00:00.000Z`);
  return fields;
}

function asArray(value) {
  if (Array.isArray(value)) return value.filter((v) => typeof v === 'string');
  return typeof value === 'string' && value ? [value] : [];
}

function formValues(source = {}) {
  const values = {};
  ITEM_FIELDS.forEach((key) => {
    values[key] = typeof source[key] === 'string' ? source[key] : '';
  });
  return values;
}

function valuesFromItem(item) {
  return {
    type: item.type,
    title: item.title,
    description: item.description,
    category: item.category,
    color: item.color || '',
    location: item.location,
    dateLostOrFound: toDateInput(item.dateLostOrFound),
  };
}

function renderForm(res, { mode, item = null, values, errors = {}, status = 200 }) {
  const isEdit = mode === 'edit';
  const breadcrumbs = isEdit
    ? [
        { name: 'Home', url: '/' },
        { name: 'Browse items', url: '/items' },
        { name: item.title, url: `/items/${item._id}` },
        { name: 'Edit' },
      ]
    : [{ name: 'Home', url: '/' }, { name: 'Browse items', url: '/items' }, { name: 'Report an item' }];

  return res.status(status).render(isEdit ? 'pages/items/edit' : 'pages/items/new', {
    title: isEdit ? `Edit ${item.title}` : 'Report a lost or found item',
    description: 'Describe the item, where and when it was lost or found, and add up to four photos.',
    noindex: true,
    breadcrumbs,
    item,
    values,
    errors,
    maxImages: MAX_IMAGES,
    pageScripts: ['/js/upload-preview.js'],
  });
}

/**
 * Removes an item together with everything that only exists because of it:
 * its image files, claims, conversations and their messages.
 */
async function deleteItemCascade(item) {
  const conversationIds = await Conversation.find({ item: item._id }).distinct('_id');
  await Promise.all([
    Message.deleteMany({ conversation: { $in: conversationIds } }),
    Conversation.deleteMany({ item: item._id }),
    Claim.deleteMany({ item: item._id }),
  ]);
  await Item.deleteOne({ _id: item._id });
  await removeImages(item.images);
}

/** Applies validated field changes and image additions/removals to an item. */
function planImageChanges(item, removeRequested, uploadedFiles) {
  const removeList = asArray(removeRequested).filter((p) => item.images.includes(p));
  const kept = item.images.filter((p) => !removeList.includes(p));
  const added = (uploadedFiles || []).map(publicPathFor);
  return { removeList, images: [...kept, ...added], tooMany: kept.length + added.length > MAX_IMAGES };
}

async function loadItemForView(id) {
  if (!isValidId(id)) throw new HttpError(404, 'Item not found.');
  const item = await Item.findById(id).populate('reporter', 'name').lean();
  if (!item) throw new HttpError(404, 'Item not found.');
  return item;
}

/* ------------------------------------------------------------------ pages */

exports.index = async (req, res) => {
  const filters = parseFilters(req.query);
  const result = await searchItems(filters);
  const canonicalPath = filters.page > 1 ? `/items?page=${filters.page}` : '/items';

  res.render('pages/items/index', {
    title: filters.page > 1 ? `Lost and found items, page ${filters.page}` : 'Lost and found items',
    description:
      'Search every lost and found report on campus. Filter by lost or found, category, status and date, ' +
      'or search by what the item is and where it was last seen.',
    canonicalPath,
    breadcrumbs: [{ name: 'Home', url: '/' }, { name: 'Browse items' }],
    filters,
    result,
    pageScripts: ['/js/search.js'],
    pageUrl: (page) => {
      const qs = filtersToQuery(filters, { page });
      return `/items${qs ? `?${qs}` : ''}`;
    },
    jsonLd: [
      {
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        name: 'Lost and found items',
        url: absoluteUrl(req, '/items'),
        isPartOf: { '@type': 'WebSite', name: res.locals.siteName, url: absoluteUrl(req, '/') },
      },
    ],
  });
};

exports.show = async (req, res) => {
  const item = await loadItemForView(req.params.id);
  const viewer = res.locals.currentUser;
  const reporterId = String(item.reporter._id);
  const isReporter = Boolean(viewer && viewer.id === reporterId);
  const isAdmin = Boolean(viewer && viewer.role === 'admin');

  const [myPendingClaim, pendingClaimCount] = await Promise.all([
    viewer && !isReporter ? Claim.exists({ item: item._id, claimant: viewer.id, status: 'pending' }) : null,
    isReporter ? Claim.countDocuments({ item: item._id, status: 'pending' }) : 0,
  ]);

  const url = absoluteUrl(req, `/items/${item._id}`);
  const typeLabel = TYPE_LABEL[item.type];
  const description = truncate(
    `${typeLabel}: ${item.title}. ${item.location}, ${formatDate(item.dateLostOrFound)}. ${item.description}`,
    155
  );

  res.render('pages/items/show', {
    title: `${typeLabel}: ${item.title}`,
    description,
    ogImage: item.images[0] ? absoluteUrl(req, item.images[0]) : null,
    breadcrumbs: [
      { name: 'Home', url: '/' },
      { name: 'Browse items', url: '/items' },
      { name: `${typeLabel} items`, url: `/items?type=${item.type}` },
      { name: item.title },
    ],
    item,
    reporterFirstName: User.firstNameOf(item.reporter.name),
    isReporter,
    canManage: isReporter || isAdmin,
    hasPendingClaim: Boolean(myPendingClaim),
    pendingClaimCount,
    pageScripts: item.images.length > 1 ? ['/js/gallery.js'] : [],
    jsonLd: [
      {
        '@context': 'https://schema.org',
        '@type': 'WebPage',
        name: `${typeLabel}: ${item.title}`,
        description,
        url,
        datePublished: new Date(item.createdAt).toISOString(),
        dateModified: new Date(item.updatedAt).toISOString(),
        about: {
          '@type': 'Thing',
          name: item.title,
          description: item.description,
          ...(item.color ? { color: item.color } : {}),
          ...(item.images.length ? { image: item.images.map((p) => absoluteUrl(req, p)) } : {}),
        },
      },
    ],
  });
};

exports.showNew = (req, res) => {
  const type = req.query.type === 'found' || req.query.type === 'lost' ? req.query.type : '';
  // The date is left empty here; upload-preview.js fills in today's date in the visitor's own timezone.
  return renderForm(res, { mode: 'new', values: { ...formValues(), type } });
};

exports.create = async (req, res) => {
  const values = formValues(req.body);
  const errors = errorMap(req.formErrors);
  if (req.uploadError) errors.images = req.uploadError;
  if (Object.keys(errors).length) {
    await removeUploadedFiles(req.files);
    return renderForm(res, { mode: 'new', values, errors, status: req.uploadErrorStatus || 422 });
  }

  let item;
  try {
    item = await Item.create({
      ...itemFieldsFrom(req.body),
      images: (req.files || []).map(publicPathFor),
      reporter: req.session.userId,
    });
  } catch (err) {
    await removeUploadedFiles(req.files);
    throw err;
  }

  req.flash('success', 'Your report is published. Claims and messages about it will appear on your dashboard.');
  return res.redirect(`/items/${item._id}`);
};

exports.showEdit = (req, res) =>
  renderForm(res, { mode: 'edit', item: req.item, values: valuesFromItem(req.item) });

exports.update = async (req, res) => {
  const item = req.item;
  const values = formValues(req.body);
  const errors = errorMap(req.formErrors);
  if (req.uploadError) errors.images = req.uploadError;

  const plan = planImageChanges(item, req.body.removeImages, req.files);
  if (!errors.images && plan.tooMany) {
    errors.images = `An item can have at most ${MAX_IMAGES} images. Remove some before adding more.`;
  }
  if (Object.keys(errors).length) {
    await removeUploadedFiles(req.files);
    return renderForm(res, { mode: 'edit', item, values, errors, status: req.uploadErrorStatus || 422 });
  }

  Object.assign(item, itemFieldsFrom(req.body));
  item.images = plan.images;
  try {
    await item.save();
  } catch (err) {
    await removeUploadedFiles(req.files);
    throw err;
  }
  await removeImages(plan.removeList);

  req.flash('success', 'Your changes are saved.');
  return res.redirect(`/items/${item._id}`);
};

exports.destroy = async (req, res) => {
  await deleteItemCascade(req.item);
  req.flash('success', `"${req.item.title}" was deleted, along with its photos, claims and conversations.`);
  return res.redirect('/dashboard');
};

exports.resolve = async (req, res) => {
  const item = req.item;
  if (item.status === 'resolved') {
    req.flash('info', 'This item is already marked as returned.');
  } else {
    item.status = 'resolved';
    await item.save();
    await Claim.updateMany({ item: item._id, status: 'pending' }, { status: 'rejected' });
    req.flash('success', 'Marked as returned. Thanks for closing the loop.');
  }
  return res.redirect(`/items/${item._id}`);
};

exports.reopen = async (req, res) => {
  const item = req.item;
  item.status = 'open';
  await item.save();
  req.flash('success', 'The listing is open again and visible as open in search.');
  return res.redirect(`/items/${item._id}`);
};

/* ------------------------------------------------------------------ JSON API */

exports.apiList = async (req, res) => {
  const result = await searchItems(parseFilters(req.query));
  res.json({
    items: result.items.map(toPublicItem),
    page: result.page,
    totalPages: result.totalPages,
    total: result.total,
  });
};

exports.apiShow = async (req, res) => {
  const item = await loadItemForView(req.params.id);
  res.json({ item: toPublicItem(item) });
};

exports.apiCreate = async (req, res) => {
  let item;
  try {
    item = await Item.create({
      ...itemFieldsFrom(req.body),
      images: (req.files || []).map(publicPathFor),
      reporter: req.session.userId,
    });
  } catch (err) {
    await removeUploadedFiles(req.files);
    throw err;
  }
  await item.populate('reporter', 'name');
  res.status(201).location(`/api/items/${item._id}`).json({ item: toPublicItem(item.toObject()) });
};

exports.apiUpdate = async (req, res) => {
  const item = req.item;
  const plan = planImageChanges(item, req.body.removeImages, req.files);
  if (plan.tooMany) {
    await removeUploadedFiles(req.files);
    throw new HttpError(422, `An item can have at most ${MAX_IMAGES} images.`, [
      { field: 'images', message: 'Remove some images before adding more.' },
    ]);
  }

  Object.assign(item, itemFieldsFrom(req.body));
  if (typeof req.body.status === 'string') item.status = req.body.status;
  item.images = plan.images;
  try {
    await item.save();
  } catch (err) {
    await removeUploadedFiles(req.files);
    throw err;
  }
  await removeImages(plan.removeList);
  await item.populate('reporter', 'name');
  res.json({ item: toPublicItem(item.toObject()) });
};

exports.apiDestroy = async (req, res) => {
  await deleteItemCascade(req.item);
  res.status(204).end();
};

exports.deleteItemCascade = deleteItemCascade;
