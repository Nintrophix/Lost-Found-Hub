/*
 * Live chat room (/chat/:id).
 * Joins the conversation room, sends messages over Socket.io, shows the other
 * person's typing state and read receipts, and loads older history on demand.
 * Without JavaScript the form still posts to the server and works.
 */
(function () {
  'use strict';

  var root = document.getElementById('chat');
  if (!root || !window.lfRealtime) return;

  var socket = window.lfRealtime.socket;
  var conversationId = root.getAttribute('data-conversation-id');
  var me = root.getAttribute('data-me');
  var otherId = root.getAttribute('data-other-id');
  var otherName = root.getAttribute('data-other-name');

  var log = document.getElementById('chat-log');
  var form = document.getElementById('chat-form');
  var input = document.getElementById('chat-input');
  var sendButton = document.getElementById('chat-send');
  var errorBox = document.getElementById('chat-error');
  var typingEl = document.getElementById('typing');
  var emptyEl = document.getElementById('chat-empty');
  var olderWrap = document.getElementById('load-older-wrap');
  var olderButton = document.getElementById('load-older');
  var latestAnchor = document.getElementById('latest');

  var timeFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  var typingTimer = null;
  var isTyping = false;
  var hideTypingTimer = null;

  function showError(text) {
    errorBox.textContent = text || '';
    errorBox.hidden = !text;
  }

  function nearBottom() {
    return log.scrollHeight - log.scrollTop - log.clientHeight < 120;
  }

  function scrollToBottom() {
    log.scrollTop = log.scrollHeight;
  }

  /** Builds the same markup as views/pages/chat/room.ejs, using textContent only. */
  function buildMessage(message) {
    var mine = message.sender.id === me;
    var wrap = document.createElement('div');
    wrap.className = 'msg ' + (mine ? 'msg-mine' : 'msg-theirs');
    wrap.setAttribute('data-id', message.id);

    var body = document.createElement('p');
    body.className = 'msg-body';
    body.textContent = message.body;
    wrap.appendChild(body);

    var meta = document.createElement('p');
    meta.className = 'msg-meta';
    var who = document.createElement('span');
    who.className = 'sr-only';
    who.textContent = (mine ? 'You' : message.sender.firstName) + ', ';
    meta.appendChild(who);
    var time = document.createElement('time');
    time.dateTime = new Date(message.createdAt).toISOString();
    time.textContent = timeFormat.format(new Date(message.createdAt));
    meta.appendChild(time);
    if (mine) {
      var receipt = document.createElement('span');
      receipt.className = 'receipt';
      receipt.setAttribute('data-receipt', '');
      receipt.textContent = message.readBy.indexOf(otherId) !== -1 ? ' · Seen' : ' · Sent';
      meta.appendChild(receipt);
    }
    wrap.appendChild(meta);
    return wrap;
  }

  function hasMessage(id) {
    return Boolean(log.querySelector('[data-id="' + id + '"]'));
  }

  function appendMessage(message) {
    if (hasMessage(message.id)) return;
    var stick = nearBottom() || message.sender.id === me;
    log.insertBefore(buildMessage(message), latestAnchor);
    emptyEl.hidden = true;
    if (stick) scrollToBottom();
  }

  function markRead() {
    if (document.visibilityState !== 'visible') return;
    socket.emit('message:read', { conversationId: conversationId });
  }

  function join() {
    socket.emit('conversation:join', { conversationId: conversationId }, function (res) {
      if (!res || !res.ok) {
        showError((res && res.error) || 'Could not connect to this conversation. Reload the page.');
        return;
      }
      showError('');
      markRead();
    });
  }

  function setTyping(state) {
    if (isTyping === state) return;
    isTyping = state;
    socket.emit('typing', { conversationId: conversationId, isTyping: state });
  }

  // Sending
  form.addEventListener('submit', function (event) {
    event.preventDefault();
    var body = input.value.trim();
    if (!body) return;
    if (!socket.connected) {
      // Fall back to a normal form post when the live connection is down.
      form.submit();
      return;
    }
    sendButton.disabled = true;
    socket.emit('message:send', { conversationId: conversationId, body: body }, function (res) {
      sendButton.disabled = false;
      if (!res || !res.ok) {
        showError((res && res.error) || 'Your message could not be sent.');
        return;
      }
      showError('');
      appendMessage(res.message);
      input.value = '';
      input.focus();
      setTyping(false);
    });
  });

  // Enter sends, Shift+Enter adds a new line.
  input.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event('submit', { cancelable: true }));
    }
  });

  input.addEventListener('input', function () {
    setTyping(input.value.trim().length > 0);
    window.clearTimeout(typingTimer);
    typingTimer = window.setTimeout(function () {
      setTyping(false);
    }, 2500);
  });

  input.addEventListener('blur', function () {
    setTyping(false);
  });

  // Incoming events
  socket.on('message:new', function (data) {
    if (!data || !data.message || data.message.conversationId !== conversationId) return;
    appendMessage(data.message);
    if (data.message.sender.id !== me) {
      typingEl.textContent = '';
      markRead();
    }
  });

  socket.on('typing', function (data) {
    if (!data || data.conversationId !== conversationId || data.userId === me) return;
    typingEl.textContent = data.isTyping ? otherName + ' is typing…' : '';
    window.clearTimeout(hideTypingTimer);
    if (data.isTyping) {
      hideTypingTimer = window.setTimeout(function () {
        typingEl.textContent = '';
      }, 6000);
    }
  });

  socket.on('message:read', function (data) {
    if (!data || data.conversationId !== conversationId || data.userId !== otherId) return;
    var receipts = log.querySelectorAll('.msg-mine [data-receipt]');
    for (var i = 0; i < receipts.length; i += 1) receipts[i].textContent = ' · Seen';
  });

  socket.on('connect', join);
  if (socket.connected) join();

  document.addEventListener('visibilitychange', markRead);

  // Older history
  if (olderButton) {
    olderButton.addEventListener('click', function () {
      var first = log.querySelector('.msg[data-id]');
      if (!first) return;
      olderButton.disabled = true;
      olderButton.textContent = 'Loading…';
      var url = '/api/conversations/' + encodeURIComponent(conversationId) +
        '/messages?before=' + encodeURIComponent(first.getAttribute('data-id'));

      fetch(url, { headers: { Accept: 'application/json' }, credentials: 'same-origin' })
        .then(function (res) {
          if (!res.ok) throw new Error('Request failed');
          return res.json();
        })
        .then(function (page) {
          var previousHeight = log.scrollHeight;
          var anchor = first;
          page.messages.forEach(function (m) {
            if (!hasMessage(m.id)) log.insertBefore(buildMessage(m), anchor);
          });
          log.scrollTop += log.scrollHeight - previousHeight;
          olderWrap.hidden = !page.hasMore;
          showError('');
        })
        .catch(function () {
          showError('Older messages could not be loaded. Try again.');
        })
        .then(function () {
          olderButton.disabled = false;
          olderButton.textContent = 'Load older messages';
        });
    });
  }

  scrollToBottom();
})();
