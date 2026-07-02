// Checks maintenance mode on every portal page load.
// Admins and login page are exempt.
(function () {
  var p = location.pathname;
  if (p.indexOf('/admin') === 0 || p === '/login' || p === '/maintenance') return;
  if (sessionStorage.getItem('iram_it_auth') === 'true') return;
  fetch('/api/maintenance-check', { cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (d) { if (d && d.maintenance) location.replace('/maintenance'); })
    .catch(function () {});
})();
