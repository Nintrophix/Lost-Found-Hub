/*
 * Image previews for the report and edit forms.
 * Shows thumbnails of the chosen files and warns early about files that are
 * too large, the wrong type, or too many. The server repeats every check.
 */
(function () {
  'use strict';

  // Default "When" to today's date in the visitor's timezone on a blank report form.
  var dateField = document.getElementById('dateLostOrFound');
  if (dateField && !dateField.value) {
    var today = new Date();
    var pad = function (n) { return String(n).padStart(2, '0'); };
    dateField.value = today.getFullYear() + '-' + pad(today.getMonth() + 1) + '-' + pad(today.getDate());
  }

  var input = document.getElementById('images');
  var preview = document.getElementById('images-preview');
  var errorBox = document.getElementById('images-client-error');
  if (!input || !preview) return;

  var ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
  var ALLOWED_EXT = /\.(jpe?g|png|webp)$/i;
  var maxTotal = Number(input.getAttribute('data-max-total')) || 4;
  var maxMb = Number(input.getAttribute('data-max-mb')) || 5;
  var objectUrls = [];

  /** Existing photos that are not ticked for removal (edit form only). */
  function keptExisting() {
    var boxes = document.querySelectorAll('input[name="removeImages"]');
    var kept = 0;
    for (var i = 0; i < boxes.length; i += 1) if (!boxes[i].checked) kept += 1;
    return kept;
  }

  function clearPreviews() {
    objectUrls.forEach(function (url) {
      URL.revokeObjectURL(url);
    });
    objectUrls = [];
    preview.textContent = '';
  }

  function showError(message) {
    errorBox.textContent = message || '';
    errorBox.hidden = !message;
    if (message) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  }

  function check() {
    clearPreviews();
    var files = Array.prototype.slice.call(input.files || []);
    var problems = [];
    var allowed = maxTotal - keptExisting();

    if (files.length > allowed) {
      problems.push(allowed <= 0
        ? 'This item already has ' + maxTotal + ' photos. Tick one to remove before adding more.'
        : 'You can add ' + allowed + ' more ' + (allowed === 1 ? 'photo' : 'photos') + '. You chose ' + files.length + '.');
    }

    files.forEach(function (file, index) {
      if (ALLOWED_TYPES.indexOf(file.type) === -1 || !ALLOWED_EXT.test(file.name)) {
        problems.push('"' + file.name + '" is not a JPEG, PNG or WebP image.');
        return;
      }
      if (file.size > maxMb * 1024 * 1024) {
        problems.push('"' + file.name + '" is ' + (file.size / 1024 / 1024).toFixed(1) + ' MB. The limit is ' + maxMb + ' MB.');
        return;
      }
      var url = URL.createObjectURL(file);
      objectUrls.push(url);
      var figure = document.createElement('figure');
      var img = document.createElement('img');
      img.src = url;
      img.alt = 'Preview of selected photo ' + (index + 1) + ': ' + file.name;
      var caption = document.createElement('figcaption');
      caption.textContent = file.name;
      figure.appendChild(img);
      figure.appendChild(caption);
      preview.appendChild(figure);
    });

    showError(problems.join(' '));
    return problems.length === 0;
  }

  input.addEventListener('change', check);
  document.addEventListener('change', function (event) {
    if (event.target && event.target.name === 'removeImages' && input.files && input.files.length) check();
  });

  var form = input.form;
  if (form) {
    form.addEventListener('submit', function (event) {
      if (input.files && input.files.length && !check()) {
        event.preventDefault();
        input.focus();
      }
    });
  }
})();
