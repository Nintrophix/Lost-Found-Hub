/*
 * Shared Socket.io connection for logged-in pages.
 * Keeps the header unread badge current and shows a short notice when a
 * message or claim update arrives for a conversation you are not viewing.
 */
(function () {
  'use strict';

  if (typeof window.io !== 'function') return;

  var socket = window.io({ transports: ['websocket', 'polling'] });
  window.lfRealtime = { socket: socket };

  var badge = document.getElementById('unread-badge');
  var badgeLabel = document.getElementById('unread-badge-label');
  var toastRegion = document.getElementById('toast-region');

  function setUnread(total) {
    if (!badge || typeof total !== 'number' || total < 0) return;
    // A small bump draws the eye only when the count goes up.
    if (total > Number(badge.textContent || 0)) {
      badge.classList.remove('is-bumped');
      void badge.offsetWidth;
      badge.classList.add('is-bumped');
    }
    badge.textContent = String(total);
    badge.hidden = total === 0;
    if (badgeLabel) badgeLabel.textContent = total ? ', ' + total + ' unread' : '';
    var menuCount = document.getElementById('unread-menu');
    if (menuCount) {
      menuCount.textContent = total + ' unread';
      menuCount.hidden = total === 0;
    }
  }

  function viewingConversation(conversationId) {
    var chat = document.getElementById('chat');
    return Boolean(chat && conversationId && chat.getAttribute('data-conversation-id') === conversationId);
  }

  function showToast(text, href) {
    if (!toastRegion || !text) return;
    var toast = document.createElement('div');
    toast.className = 'toast';

    var message = document.createElement('p');
    message.textContent = text;
    toast.appendChild(message);

    var link = document.createElement('a');
    link.href = href;
    link.textContent = href.indexOf('/chat/') === 0 ? 'Open chat' : 'View';
    toast.appendChild(link);

    toastRegion.appendChild(toast);
    window.setTimeout(function () {
      toast.remove();
    }, 8000);
  }

  socket.on('notification', function (data) {
    if (!data) return;
    setUnread(data.unreadTotal);
    if (viewingConversation(data.conversationId) && document.visibilityState === 'visible') return;
    showToast(data.preview, data.conversationId ? '/chat/' + data.conversationId : '/dashboard');
  });

  socket.on('unread:count', function (data) {
    if (data) setUnread(data.total);
  });
})();
