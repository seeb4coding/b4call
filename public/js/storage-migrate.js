// Runs before the app modules (classic script, module scripts are deferred).
// The product was renamed API Studio → B4Send → B4Call; localStorage keys moved
// with it. Existing installs are migrated once, in place, so nobody loses their
// environments, vault, history, or layout preferences.
(function migrateStorageKeys() {
  var DONE = 'b4call-storage-migrated';
  var LEGACY_PREFIXES = ['api-studio-', 'b4send-'];
  try {
    if (localStorage.getItem(DONE) === '1') return;
    var moved = 0;
    for (var i = localStorage.length - 1; i >= 0; i -= 1) {
      var key = localStorage.key(i);
      if (!key) continue;
      for (var p = 0; p < LEGACY_PREFIXES.length; p += 1) {
        var prefix = LEGACY_PREFIXES[p];
        if (key.indexOf(prefix) !== 0) continue;
        var next = 'b4call-' + key.slice(prefix.length);
        if (localStorage.getItem(next) === null) {
          localStorage.setItem(next, localStorage.getItem(key));
          moved += 1;
        }
        localStorage.removeItem(key);
        break;
      }
    }
    localStorage.setItem(DONE, '1');
    if (moved) console.info('[b4call] migrated ' + moved + ' stored setting(s)');
  } catch (err) {
    /* storage unavailable (private mode) — the app still works, just unsaved */
  }
})();

// Apply the saved theme before the first paint. Without this a dark-theme user
// gets a white flash, because the markup defaults to the light theme and the
// real preference only arrives once the module graph has loaded.
// (The light-theme list is duplicated from themes.js — this runs as a classic
// script and cannot import.)
(function applySavedTheme() {
  var LIGHT = { 'b4call-light': 1, light: 1, solarized: 1 };
  try {
    var theme = '';
    var stored = localStorage.getItem('b4call-appearance');
    if (stored) {
      try {
        theme = (JSON.parse(stored) || {}).theme || '';
      } catch (err) {
        /* corrupt preferences — fall back to the legacy key below */
      }
    }
    if (!theme) theme = localStorage.getItem('b4call-theme') || '';
    if (!theme) return; // markup already carries the default

    var isLight = LIGHT[theme] === 1;
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.setAttribute('data-scheme', isLight ? 'light' : 'dark');
    var favicon = document.querySelector('link[rel="icon"]');
    if (favicon) {
      favicon.href = isLight ? '/images/b4call-api_light.png' : '/images/b4call-api.png';
    }
  } catch (err) {
    /* no storage — the default theme in the markup stands */
  }
})();
