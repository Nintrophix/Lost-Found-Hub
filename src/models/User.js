'use strict';

const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const ROLES = ['student', 'staff', 'admin'];
const BCRYPT_ROUNDS = 12;

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 80 },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
    },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES, default: 'student' },
    campusId: { type: String, trim: true, maxlength: 40 },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// Only the first name is ever shown publicly.
userSchema.virtual('firstName').get(function firstName() {
  return (this.name || '').trim().split(/\s+/)[0] || 'Member';
});

userSchema.methods.verifyPassword = function verifyPassword(password) {
  return bcrypt.compare(password, this.passwordHash);
};

userSchema.statics.hashPassword = function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
};

userSchema.statics.firstNameOf = function firstNameOf(name) {
  return (name || '').trim().split(/\s+/)[0] || 'Member';
};

const User = mongoose.model('User', userSchema);
User.ROLES = ROLES;

module.exports = User;
