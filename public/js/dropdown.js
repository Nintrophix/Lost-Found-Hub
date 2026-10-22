/*
 * Accessible dropdown menus for the header, following the shadcn/Radix
 * dropdown-menu pattern (trigger, content, label, group, separator, items,
 * submenu, radio group) without a framework.
 *
 * Markup (see views/partials/header.ejs):
 *   [data-dropdown]
 *     [data-dropdown-trigger]           link or button; a link still navigates without JS
 *     .dd-content[role=menu]            data-align="start|end"
 *       [role=menuitem|menuitemradio]
 *       [data-dropdown-sub]
 *         [data-sub-trigger]
 *         .dd-content[data-sub-content]
 *
 * Keyboard: Enter, Space or ArrowDown opens on the first item, ArrowUp on the
 * last; arrows, Home and End move; letters jump by first character; ArrowRight
 * opens a submenu and ArrowLeft closes it; Escape closes and returns focus;
 * Tab or a click outside closes everything.
 */
(function () {
  'use strict';

  var CLOSE_ANIMATION_MS = 140;
  var SUB_OPEN_DELAY_MS = 90;
  var GAP = 6;
  var current = null; // { root, trigger, content }
  var subTimer = null;

  /* ------------------------------------------------------------ helpers */

  function itemsOf(menu) {
    return Array.prototype.filter.call(
      menu.querySelectorAll('[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]'),
      function (el) {
        return el.closest('[role="menu"]') === menu && el.getAttribute('aria-disabled') !== 'true' && !el.disabled;
      }
    );
  }

  function focusItem(menu, index) {
    var list = itemsOf(menu);
    if (!list.length) return;
    var i = (index + list.length) % list.length;
    list[i].focus({ preventScroll: true });
  }

  function indexOfFocused(menu) {
    return itemsOf(menu).indexOf(document.activeElement);
  }

  /* Places a top-level menu under its trigger, flipping horizontally to stay on screen. */
  function positionRoot(content) {
    content.style.left = '';
    content.style.right = '';
    content.setAttribute('data-side', 'bottom');
    if (content.getAttribute('data-align') === 'end') content.style.right = '0';
    else content.style.left = '0';

    var rect = content.getBoundingClientRect();
    var vw = document.documentElement.clientWidth;
    if (rect.right > vw - 8) {
      content.style.left = 'auto';
      content.style.right = '0';
      rect = content.getBoundingClientRect();
    }
    if (rect.left < 8) {
      content.style.right = 'auto';
      content.style.left = (8 - content.parentElement.getBoundingClientRect().left) + 'px';
    }
  }

  /* Places a submenu beside its trigger, on the left when the right side has no room. */
  function positionSub(content) {
    content.style.left = 'calc(100% + ' + (GAP - 2) + 'px)';
    content.style.right = 'auto';
    content.setAttribute('data-side', 'right');
    var rect = content.getBoundingClientRect();
    if (rect.right > document.documentElement.clientWidth - 8) {
      content.style.left = 'auto';
      content.style.right = 'calc(100% + ' + (GAP - 2) + 'px)';
      content.setAttribute('data-side', 'left');
    }
  }

  function show(content) {
    window.clearTimeout(content._closeTimer);
    content.hidden = false;
    content.setAttribute('data-state', 'open');
  }

  function hide(content) {
    if (content.hidden) return;
    content.setAttribute('data-state', 'closed');
    window.clearTimeout(content._closeTimer);
    content._closeTimer = window.setTimeout(function () {
      if (content.getAttribute('data-state') === 'closed') content.hidden = true;
    }, CLOSE_ANIMATION_MS);
  }

  /* ------------------------------------------------------------ submenus */

  function openSub(sub, focusFirst) {
    var trigger = sub.querySelector('[data-sub-trigger]');
    var content = sub.querySelector('[data-sub-content]');
    if (trigger.getAttribute('aria-expanded') !== 'true') {
      trigger.setAttribute('aria-expanded', 'true');
      show(content);
      positionSub(content);
    }
    if (focusFirst) focusItem(content, 0);
  }

  function closeSub(sub, refocusTrigger) {
    var trigger = sub.querySelector('[data-sub-trigger]');
    var content = sub.querySelector('[data-sub-content]');
    if (trigger.getAttribute('aria-expanded') !== 'true') return;
    trigger.setAttribute('aria-expanded', 'false');
    hide(content);
    if (refocusTrigger) trigger.focus({ preventScroll: true });
  }

  function closeSubsIn(content, except) {
    Array.prototype.forEach.call(content.querySelectorAll('[data-dropdown-sub]'), function (sub) {
      if (sub !== except) closeSub(sub, false);
    });
  }

  /* ------------------------------------------------------------ root menus */

  function open(root, focus) {
    var trigger = root.querySelector('[data-dropdown-trigger]');
    var content = root.querySelector(':scope > .dd-content');
    if (current && current.root !== root) close(false);
    current = { root: root, trigger: trigger, content: content };
    trigger.setAttribute('aria-expanded', 'true');
    root.classList.add('is-open');
    show(content);
    positionRoot(content);
    if (focus === 'first') focusItem(content, 0);
    else if (focus === 'last') focusItem(content, -1);
    else content.focus({ preventScroll: true });
  }

  function close(returnFocus) {
    if (!current) return;
    var state = current;
    current = null;
    closeSubsIn(state.content);
    state.trigger.setAttribute('aria-expanded', 'false');
    state.root.classList.remove('is-open');
    hide(state.content);
    if (returnFocus) state.trigger.focus({ preventScroll: true });
  }

  /* ------------------------------------------------------------ typeahead */

  var typed = '';
  var typedTimer = null;

  function typeahead(menu, key) {
    window.clearTimeout(typedTimer);
    typed += key.toLowerCase();
    typedTimer = window.setTimeout(function () { typed = ''; }, 600);
    var list = itemsOf(menu);
    var start = indexOfFocused(menu);
    for (var n = 1; n <= list.length; n += 1) {
      var item = list[(start + n) % list.length];
      if (item.textContent.trim().toLowerCase().indexOf(typed) === 0) {
        item.focus({ preventScroll: true });
        return;
      }
    }
  }

  /* ------------------------------------------------------------ wiring */

  function onTriggerKeydown(event, root) {
    var key = event.key;
    if (key === 'Enter' || key === ' ' || key === 'ArrowDown') {
      event.preventDefault();
      open(root, 'first');
    } else if (key === 'ArrowUp') {
      event.preventDefault();
      open(root, 'last');
    }
  }

  function onMenuKeydown(event) {
    var menu = event.target.closest('[role="menu"]');
    if (!menu || !current) return;
    var key = event.key;
    var item = event.target.closest('[role^="menuitem"]');
    var sub = menu.closest('[data-dropdown-sub]');
    var isSubMenu = menu.hasAttribute('data-sub-content');

    switch (key) {
      case 'ArrowDown':
        event.preventDefault();
        focusItem(menu, indexOfFocused(menu) + 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        focusItem(menu, indexOfFocused(menu) === -1 ? -1 : indexOfFocused(menu) - 1);
        break;
      case 'Home':
        event.preventDefault();
        focusItem(menu, 0);
        break;
      case 'End':
        event.preventDefault();
        focusItem(menu, -1);
        break;
      case 'ArrowRight':
        if (item && item.hasAttribute('data-sub-trigger')) {
          event.preventDefault();
          openSub(item.closest('[data-dropdown-sub]'), true);
        }
        break;
      case 'ArrowLeft':
        if (isSubMenu && sub) {
          event.preventDefault();
          closeSub(sub, true);
        }
        break;
      case 'Enter':
      case ' ':
        if (item && item.hasAttribute('data-sub-trigger')) {
          event.preventDefault();
          openSub(item.closest('[data-dropdown-sub]'), true);
        } else if (item && key === ' ' && item.tagName === 'A') {
          event.preventDefault();
          item.click();
        }
        break;
      case 'Escape':
        event.preventDefault();
        if (isSubMenu && sub) closeSub(sub, true);
        else close(true);
        break;
      case 'Tab':
        close(false);
        break;
      default:
        if (key.length === 1 && /\S/.test(key) && !event.ctrlKey && !event.metaKey && !event.altKey) {
          typeahead(menu, key);
        }
    }
  }

  function init(root) {
    var trigger = root.querySelector('[data-dropdown-trigger]');
    var content = root.querySelector(':scope > .dd-content');
    if (!trigger || !content) return;
    content.setAttribute('tabindex', '-1');
    // An enhanced link now behaves as a menu button.
    if (trigger.tagName === 'A') trigger.setAttribute('role', 'button');

    trigger.addEventListener('click', function (event) {
      event.preventDefault();
      if (current && current.root === root) close(false);
      else open(root, null);
    });
    trigger.addEventListener('keydown', function (event) {
      onTriggerKeydown(event, root);
    });
    content.addEventListener('keydown', onMenuKeydown);

    // Hover highlights an item (like Radix) and opens submenus after a short pause.
    content.addEventListener('pointermove', function (event) {
      if (event.pointerType !== 'mouse') return;
      var item = event.target.closest('[role^="menuitem"]');
      if (!item || document.activeElement === item) return;
      item.focus({ preventScroll: true });
      var menu = item.closest('[role="menu"]');
      var sub = item.hasAttribute('data-sub-trigger') ? item.closest('[data-dropdown-sub]') : null;
      window.clearTimeout(subTimer);
      if (sub) {
        subTimer = window.setTimeout(function () { openSub(sub, false); }, SUB_OPEN_DELAY_MS);
      } else if (!menu.hasAttribute('data-sub-content')) {
        closeSubsIn(content);
      }
    });

    Array.prototype.forEach.call(content.querySelectorAll('[data-sub-trigger]'), function (subTrigger) {
      subTrigger.addEventListener('click', function (event) {
        event.preventDefault();
        openSub(subTrigger.closest('[data-dropdown-sub]'), event.detail === 0);
      });
    });

    // Choosing a regular item closes the menu (links then navigate as usual).
    content.addEventListener('click', function (event) {
      var item = event.target.closest('[role^="menuitem"]');
      if (item && !item.hasAttribute('data-sub-trigger')) close(false);
    });
  }

  Array.prototype.forEach.call(document.querySelectorAll('[data-dropdown]'), init);

  document.addEventListener('pointerdown', function (event) {
    if (current && !current.root.contains(event.target)) close(false);
  });
  window.addEventListener('resize', function () {
    close(false);
  });

  window.lfDropdown = { close: close };
})();
