// Small UI helpers for HawkZero buttons
(function () {
  // Show spinner on submit buttons marked data-loading
  document.querySelectorAll('form').forEach(function (form) {
    form.addEventListener('submit', function () {
      var btn = form.querySelector('[data-loading]');
      if (!btn) return;
      btn.classList.add('is-loading');
      btn.setAttribute('disabled', 'disabled');
      var s = document.createElement('span');
      s.className = 'hz-btn__spin';
      btn.appendChild(s);
    });
  });

  // Refresh buttons
  document.querySelectorAll('[data-action="refresh"]').forEach(function (btn) {
    btn.addEventListener('click', function () { location.reload(); });
  });
})();
