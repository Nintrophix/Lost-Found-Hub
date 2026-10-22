/*
 * Site-wide interface behavior:
 * - Light/dark theme toggle (remembered in localStorage, system preference by default),
 *   revealed as a circle growing from the toggle where View Transitions are supported.
 * - Lifts the first-visit page loader once the page is ready.
 * - Shows a thin progress bar while the next page loads, and a busy spinner on
 *   the button that submitted a form.
 */
(function () {
  'use strict';

  var root = document.documentElement;
  var STORAGE_KEY = 'lf-theme';
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  var prefersDark = window.matchMedia('(prefers-color-scheme: dark)');
  var toggle = document.getElementById('theme-toggle');

  /* ------------------------------------------------------------ theme */

  function currentTheme() {
    var chosen = root.getAttribute('data-theme');
    if (chosen === 'dark' || chosen === 'light') return chosen;
    return prefersDark.matches ? 'dark' : 'light';
  }

  function syncToggle() {
    var theme = currentTheme();
    var label = theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
    if (toggle) {
      toggle.setAttribute('aria-label', label);
      toggle.setAttribute('title', label);
    }
    var metas = document.querySelectorAll('meta[name="theme-color"]');
    for (var i = 0; i < metas.length; i += 1) {
      metas[i].setAttribute('content', theme === 'dark' ? '#0f1317' : '#f3f1ec');
      metas[i].removeAttribute('media');
    }
  }

  function setTheme(theme) {
    root.setAttribute('data-theme', theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch (e) {
      /* Storage blocked: the choice lasts for this page only. */
    }
    syncToggle();
  }

  function switchTheme(x, y) {
    var next = currentTheme() === 'dark' ? 'light' : 'dark';
    if (!document.startViewTransition || reduceMotion.matches) {
      setTheme(next);
      return;
    }
    var radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
    var transition = document.startViewTransition(function () {
      setTheme(next);
    });
    transition.ready.then(function () {
      root.animate(
        { clipPath: ['circle(0px at ' + x + 'px ' + y + 'px)', 'circle(' + radius + 'px at ' + x + 'px ' + y + 'px)'] },
        { duration: 520, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', pseudoElement: '::view-transition-new(root)' }
      );
    }).catch(function () {
      /* The swap already happened; only the animation was skipped. */
    });
  }

  if (toggle) {
    toggle.addEventListener('click', function () {
      var rect = toggle.getBoundingClientRect();
      switchTheme(rect.left + rect.width / 2, rect.top + rect.height / 2);
    });
  }
  if (prefersDark.addEventListener) prefersDark.addEventListener('change', syncToggle);
  syncToggle();

  /* ------------------------------------------------------------ first-visit loader */

  if (root.classList.contains('is-first-load')) {
    // Keep the loader up for at least a beat so it reads as intentional, not a flicker.
    var wait = Math.max(0, 650 - performance.now());
    window.setTimeout(function () {
      root.classList.add('is-loaded');
      window.setTimeout(function () {
        root.classList.remove('is-first-load', 'is-loaded');
      }, 600);
    }, wait);
  }

  /* ------------------------------------------------------------ navigation feedback */

  var progress = document.getElementById('nav-progress');
  var progressTimer = null;

  function startProgress() {
    if (!progress) return;
    window.clearTimeout(progressTimer);
    // Fast navigations finish before the bar appears, so there is no flash.
    progressTimer = window.setTimeout(function () {
      progress.classList.add('is-active');
    }, 180);
  }

  function resetFeedback() {
    window.clearTimeout(progressTimer);
    if (progress) progress.classList.remove('is-active');
    var busy = document.querySelectorAll('.btn.is-busy');
    for (var i = 0; i < busy.length; i += 1) busy[i].classList.remove('is-busy');
  }

  document.addEventListener('click', function (event) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    var link = event.target.closest('a[href]');
    if (!link || link.target || link.hasAttribute('download')) return;
    var url = new URL(link.href, window.location.href);
    if (url.origin !== window.location.origin) return;
    if (url.pathname === window.location.pathname && url.search === window.location.search && url.hash) return;
    if (/\.(xml|txt|webp|png|jpe?g)$/i.test(url.pathname)) return;
    startProgress();
  });

  // Runs after page scripts, so forms they handle with fetch or sockets (defaultPrevented) are skipped.
  document.addEventListener('submit', function (event) {
    if (event.defaultPrevented) return;
    var button = event.submitter;
    if (button && button.classList.contains('btn')) button.classList.add('is-busy');
    startProgress();
  });

  // Coming back with the Back button restores the page from cache: clear any leftover state.
  window.addEventListener('pageshow', resetFeedback);
})();
