/*
 * Item detail gallery: clicking a thumbnail swaps the main image.
 * Without JavaScript each thumbnail links to the full-size image.
 */
(function () {
  'use strict';

  var gallery = document.querySelector('[data-gallery]');
  if (!gallery) return;

  var main = gallery.querySelector('[data-gallery-main]');
  var thumbs = gallery.querySelectorAll('[data-gallery-thumb]');

  Array.prototype.forEach.call(thumbs, function (thumb) {
    thumb.addEventListener('click', function (event) {
      event.preventDefault();
      main.src = thumb.getAttribute('href');
      main.alt = thumb.getAttribute('data-alt');
      Array.prototype.forEach.call(thumbs, function (t) {
        t.removeAttribute('aria-current');
      });
      thumb.setAttribute('aria-current', 'true');
    });
  });
})();
