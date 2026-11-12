// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
//
// The service worker's registration, in place of the one vite-plugin-pwa writes
// (it emits its own only when public/ has none, and still injects the <script>).
//
// Theirs leaves the register() promise unhandled, and registering fails for
// reasons that are the browser's, not ours: a private window or a site setting
// that refuses service workers ("The user denied permission"), a navigation
// that aborts it, a flaky network fetching sw.js. Each became an unhandled
// rejection in the crash reports. A worker that cannot register costs only the
// offline precache - the app runs from the network as it always did - so the
// failure is noted on the console and goes no further.
//
// In a sandboxed iframe without `allow-same-origin`, merely reading `navigator.serviceWorker`
// throws a SecurityError, though `'serviceWorker' in navigator` is true; that is the same case.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const warn = (err) =>
      console.warn('Service worker not registered; running without the offline cache:', err);
    try {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(warn);
    } catch (err) {
      warn(err);
    }
  });
}
