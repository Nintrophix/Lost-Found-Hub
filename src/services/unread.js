'use strict';

const Message = require('../models/Message');

/** Total unread messages across all of a user's conversations (one query). */
function countUnread(userId) {
  return Message.countUnread(userId);
}

module.exports = { countUnread };
