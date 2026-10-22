'use strict';

const mongoose = require('mongoose');
const config = require('./env');

/**
 * Connects Mongoose to MongoDB and makes sure every model's indexes exist
 * (the text index is required before the first search query runs).
 */
async function connectDB(uri = config.mongoUri) {
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });

  // Load models so their indexes can be built.
  const models = [
    require('../models/User'),
    require('../models/Item'),
    require('../models/Claim'),
    require('../models/Conversation'),
    require('../models/Message'),
  ];
  await Promise.all(models.map((model) => model.init()));

  return mongoose.connection;
}

async function disconnectDB() {
  await mongoose.disconnect();
}

module.exports = { connectDB, disconnectDB };
