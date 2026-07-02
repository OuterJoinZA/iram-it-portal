// Polls /api/version every 20 seconds. When the deploy version changes,
// shows a toast and refreshes the page so visitors always have the latest build.
(function () {
  var p = location.pathname;
  if (p.indexOf('/admin') === 0 || p === '/login' || p === '/maintenance') return;

  var INTERVAL   = 20000;
  var knownVer   = null;
  var toastShown = false;

  // Seed the known version immediately on page load
  fetch('/api/version', { cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (d) { knownVer = d.version || null; })
    .catch(function () {});

  // Poll for changes
  setInterval(function () {
    fetch('/api/version', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!knownVer || toastShown) return;
        if (d.version && d.version !== knownVer) {
          toastShown = true;
          if (d.maintenance && sessionStorage.getItem('iram_it_auth') !== 'true') {
            showBanner('🚧 The portal is entering maintenance. Redirecting…', '#e07828');
            setTimeout(function () { location.replace('/maintenance'); }, 2500);
          } else {
            showBanner('✨ Portal updated — refreshing in 10 seconds…', '#4e9938');
            setTimeout(function () { location.reload(); }, 10000);
          }
        }
      })
      .catch(function () {});
  }, INTERVAL);

  function showBanner(msg, bg) {
    var el = document.createElement('div');
    el.style.cssText = [
      'position:fixed', 'bottom:76px', 'left:50%', 'transform:translateX(-50%) translateY(40px)',
      'background:' + bg, 'color:#fff', 'padding:13px 26px', 'border-radius:12px',
      'font-family:Segoe UI,Arial,sans-serif', 'font-size:14px', 'font-weight:600',
      'z-index:99998', 'box-shadow:0 6px 24px rgba(0,0,0,0.28)', 'white-space:nowrap',
      'transition:transform .4s cubic-bezier(.2,1,.3,1),opacity .4s', 'opacity:0'
    ].join(';');
    el.textContent = msg;
    document.body.appendChild(el);
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        el.style.transform = 'translateX(-50%) translateY(0)';
        el.style.opacity   = '1';
      });
    });
  }
})();
