/*
 * Live filtering for /items.
 * Calls GET /api/items as filters change (debounced 300 ms), re-renders the
 * grid and pagination, and keeps the URL in sync so results stay shareable.
 * Without JavaScript the same form submits normally and the server renders results.
 */
(function () {
  'use strict';

  var form = document.getElementById('filters');
  if (!form || !window.fetch) return;

  var results = document.getElementById('results');
  var grid = document.getElementById('results-grid');
  var empty = document.getElementById('results-empty');
  var summary = document.getElementById('results-summary');
  var errorBox = document.getElementById('results-error');
  var pager = document.getElementById('results-pagination');
  var clearLink = document.getElementById('clear-filters');

  var PAGE_SIZE = 12;
  var FIELDS = ['q', 'type', 'category', 'status', 'from', 'to'];
  var iconTemplates = document.getElementById('icon-templates');
  var debounceTimer = null;
  var controller = null;

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  /** Clones a server-rendered SVG icon from the <template> on the page. */
  function icon(name) {
    if (!iconTemplates) return null;
    var source = iconTemplates.content.querySelector('[data-icon="' + name + '"] svg');
    return source ? source.cloneNode(true) : null;
  }

  function metaLine(iconName, text) {
    var p = el('p', 'meta');
    var svg = icon(iconName);
    if (svg) p.appendChild(svg);
    p.appendChild(el('span', '', text));
    return p;
  }

  /** Builds the same markup as views/partials/itemCard.ejs using textContent for all data. */
  function buildCard(item) {
    var li = document.createElement('li');
    var article = el('article', 'item-card');
    article.setAttribute('data-type', item.type);

    var thumb = el('div', 'item-thumb');
    if (item.images.length) {
      var img = document.createElement('img');
      img.src = item.images[0];
      img.alt = item.title;
      img.loading = 'lazy';
      img.width = 400;
      img.height = 300;
      thumb.appendChild(img);
    } else {
      var emptyThumb = el('div', 'thumb-empty');
      var categoryIcon = icon(item.category);
      if (categoryIcon) emptyThumb.appendChild(categoryIcon);
      emptyThumb.appendChild(el('span', '', 'No photo yet'));
      thumb.appendChild(emptyThumb);
    }
    article.appendChild(thumb);

    var body = el('div', 'item-body');
    var badges = el('div', 'badges');
    var typeLabel = item.type === 'lost' ? 'Lost' : 'Found';
    badges.appendChild(el('span', 'badge badge-' + item.type, typeLabel));
    if (item.status !== 'open') badges.appendChild(el('span', 'badge badge-' + item.status, item.statusLabel));
    body.appendChild(badges);

    var heading = el('h2', 'item-title');
    var link = el('a', 'item-card-link', item.title);
    link.href = item.url;
    heading.appendChild(link);
    body.appendChild(heading);

    body.appendChild(metaLine('pin', item.location));
    body.appendChild(metaLine('calendar', typeLabel + ' ' + item.dateLabel));
    body.appendChild(metaLine('tag', item.categoryLabel));

    article.appendChild(body);
    li.appendChild(article);
    return li;
  }

  function currentParams(page) {
    var data = new FormData(form);
    var params = new URLSearchParams();
    FIELDS.forEach(function (key) {
      var value = String(data.get(key) || '').trim();
      if (value) params.set(key, value);
    });
    if (page && page > 1) params.set('page', String(page));
    return params;
  }

  function pageHref(params, page) {
    var copy = new URLSearchParams(params);
    copy.delete('page');
    if (page > 1) copy.set('page', String(page));
    var qs = copy.toString();
    return '/items' + (qs ? '?' + qs : '');
  }

  /** Mirrors views/partials/pagination.ejs. */
  function renderPagination(params, page, totalPages) {
    pager.textContent = '';
    if (totalPages <= 1) return;

    var nav = el('nav', 'pagination mt-8');
    nav.setAttribute('aria-label', 'Pagination');
    var ul = document.createElement('ul');

    function addLink(n, label, rel, current) {
      var li = document.createElement('li');
      var a = el('a', 'page-link');
      a.href = pageHref(params, n);
      a.setAttribute('data-page', String(n));
      if (rel) a.rel = rel;
      if (current) a.setAttribute('aria-current', 'page');
      if (label) {
        a.textContent = label;
      } else {
        a.appendChild(el('span', 'sr-only', 'Page '));
        a.appendChild(document.createTextNode(String(n)));
      }
      li.appendChild(a);
      ul.appendChild(li);
    }

    if (page > 1) addLink(page - 1, 'Previous', 'prev');
    var last = 0;
    for (var n = 1; n <= totalPages; n += 1) {
      if (n === 1 || n === totalPages || Math.abs(n - page) <= 1) {
        addLink(n, null, null, n === page);
        last = n;
      } else if (last !== -1) {
        var gap = document.createElement('li');
        var span = el('span', 'page-gap', '…');
        span.setAttribute('aria-hidden', 'true');
        gap.appendChild(span);
        ul.appendChild(gap);
        last = -1;
      }
    }
    if (page < totalPages) addLink(page + 1, 'Next', 'next');

    nav.appendChild(ul);
    pager.appendChild(nav);
  }

  function render(data, params) {
    grid.textContent = '';
    // Restart the short entrance animation for the new set of cards.
    grid.classList.remove('results-grid-enter');
    void grid.offsetWidth;
    grid.classList.add('results-grid-enter');
    data.items.forEach(function (item) {
      grid.appendChild(buildCard(item));
    });
    grid.hidden = data.items.length === 0;
    empty.hidden = data.items.length !== 0;

    if (data.total) {
      var start = (data.page - 1) * PAGE_SIZE + 1;
      var end = Math.min(data.page * PAGE_SIZE, data.total);
      summary.textContent = 'Showing ' + start + ' to ' + end + ' of ' + data.total + (data.total === 1 ? ' item' : ' items');
    } else {
      summary.textContent = 'No items match these filters';
    }
    renderPagination(params, data.page, data.totalPages);
  }

  function setLoading(loading) {
    results.setAttribute('aria-busy', loading ? 'true' : 'false');
  }

  function run(page, scroll) {
    var params = currentParams(page);
    var apiParams = new URLSearchParams(params);
    apiParams.set('limit', String(PAGE_SIZE));

    if (controller) controller.abort();
    controller = new AbortController();
    setLoading(true);

    fetch('/api/items?' + apiParams.toString(), {
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
      signal: controller.signal,
    })
      .then(function (res) {
        return res.json().then(function (body) {
          if (!res.ok) throw new Error((body && body.error && body.error.message) || 'Search failed.');
          return body;
        });
      })
      .then(function (data) {
        errorBox.hidden = true;
        render(data, params);
        window.history.replaceState(null, '', pageHref(params, data.page));
        if (scroll) results.scrollIntoView({ block: 'start' });
      })
      .catch(function (err) {
        if (err.name === 'AbortError') return;
        errorBox.textContent = err.message || 'Search failed. Please try again.';
        errorBox.hidden = false;
      })
      .then(function () {
        setLoading(false);
      });
  }

  function schedule() {
    window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(function () {
      run(1, false);
    }, 300);
  }

  form.addEventListener('input', schedule);
  form.addEventListener('change', schedule);
  form.addEventListener('submit', function (event) {
    event.preventDefault();
    window.clearTimeout(debounceTimer);
    run(1, false);
  });

  if (clearLink) {
    clearLink.addEventListener('click', function (event) {
      event.preventDefault();
      form.reset();
      FIELDS.forEach(function (key) {
        if (form.elements[key]) form.elements[key].value = '';
      });
      run(1, false);
    });
  }

  pager.addEventListener('click', function (event) {
    var link = event.target.closest('a[data-page]');
    if (!link) return;
    event.preventDefault();
    run(Number(link.getAttribute('data-page')), true);
  });
})();
