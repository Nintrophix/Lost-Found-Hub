'use strict';

const bcrypt = require('bcrypt');
const User = require('../models/User');
const { errorMap } = require('../middleware/validate');
const { safeReturnPath } = require('../utils/http');
const { userRoom } = require('../services/messaging');

// Compared against when an email is unknown, so failed logins take the same time.
let dummyHashPromise;
function dummyHash() {
  if (!dummyHashPromise) dummyHashPromise = User.hashPassword('timing-equalizer-not-a-password');
  return dummyHashPromise;
}

const authCrumbs = (name) => [{ name: 'Home', url: '/' }, { name }];

function regenerateSession(req) {
  return new Promise((resolve, reject) => req.session.regenerate((err) => (err ? reject(err) : resolve())));
}

function saveSession(req) {
  return new Promise((resolve, reject) => req.session.save((err) => (err ? reject(err) : resolve())));
}

/** Starts a fresh session for the user (prevents session fixation). */
async function logIn(req, user) {
  const returnTo = safeReturnPath(req.session.returnTo);
  await regenerateSession(req);
  req.session.userId = String(user._id);
  return returnTo;
}

function renderRegister(res, { values = {}, errors = {}, status = 200 } = {}) {
  return res.status(status).render('pages/auth/register', {
    title: 'Create an account',
    description: 'Create a free account to report lost or found items, claim belongings and message finders.',
    noindex: true,
    breadcrumbs: authCrumbs('Create an account'),
    values,
    errors,
  });
}

function renderLogin(res, { values = {}, errors = {}, status = 200 } = {}) {
  return res.status(status).render('pages/auth/login', {
    title: 'Log in',
    description: 'Log in to report items, follow your claims and read your messages.',
    noindex: true,
    breadcrumbs: authCrumbs('Log in'),
    values,
    errors,
  });
}

exports.showRegister = (req, res) => {
  if (res.locals.currentUser) return res.redirect('/dashboard');
  return renderRegister(res);
};

exports.register = async (req, res) => {
  const values = {
    name: req.body.name,
    email: req.body.email,
    role: req.body.role,
    campusId: req.body.campusId,
  };
  if (req.formErrors) return renderRegister(res, { values, errors: errorMap(req.formErrors), status: 422 });

  if (await User.exists({ email: values.email })) {
    return renderRegister(res, {
      values,
      errors: { email: 'An account with this email already exists. Try logging in instead.' },
      status: 422,
    });
  }

  const user = await User.create({
    name: values.name,
    email: values.email,
    role: values.role === 'staff' ? 'staff' : 'student',
    campusId: values.campusId || undefined,
    passwordHash: await User.hashPassword(req.body.password),
  });

  const returnTo = await logIn(req, user);
  req.flash('success', `Welcome, ${User.firstNameOf(user.name)}. Your account is ready.`);
  await saveSession(req);
  return res.redirect(returnTo || '/dashboard');
};

exports.showLogin = (req, res) => {
  if (res.locals.currentUser) return res.redirect('/dashboard');
  return renderLogin(res);
};

exports.login = async (req, res) => {
  const values = { email: req.body.email };
  if (req.formErrors) return renderLogin(res, { values, errors: errorMap(req.formErrors), status: 422 });

  const user = await User.findOne({ email: values.email }).select('+passwordHash');
  let ok = false;
  if (user) {
    ok = await user.verifyPassword(req.body.password);
  } else {
    await bcrypt.compare(req.body.password, await dummyHash());
  }

  if (!ok) {
    return renderLogin(res, {
      values,
      errors: { form: 'The email or password is incorrect.' },
      status: 401,
    });
  }

  const returnTo = await logIn(req, user);
  req.flash('success', `Welcome back, ${User.firstNameOf(user.name)}.`);
  await saveSession(req);
  return res.redirect(returnTo || '/dashboard');
};

exports.logout = async (req, res) => {
  const userId = req.session.userId;
  await regenerateSession(req);
  req.flash('success', 'You have been logged out.');
  await saveSession(req);

  // Close any live chat connections that belonged to the old session.
  const io = req.app.get('io');
  if (io && userId) io.in(userRoom(userId)).disconnectSockets(true);

  return res.redirect('/');
};
