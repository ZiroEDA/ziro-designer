// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * A new version of the app, downloaded and waiting to take over.
 *
 * The service worker serves `index.html` from its precache, and that copy names the old build's
 * hashed files, which are precached too: a tab keeps running the build it was opened on. The new
 * worker installs in the background and then WAITS (vite.config.ts keeps `registerType: 'prompt'`,
 * because swapping the worker under a running editor sends its still-lazy chunks to the network
 * for hashes the new deploy no longer serves). Waiting, it only takes over once every tab of the
 * site is closed - a refresh keeps the tab, so it does not.
 *
 * So the app asks. {@link watchForUpdate} notices the waiting worker; the window offers it
 * (the WX_INFOBAR strip over an editor, or at once on the launcher, where nothing is open), and
 * {@link applyUpdate} tells it to take over - the generated sw.js answers `SKIP_WAITING` with
 * `skipWaiting()` - after which the controller changes and the page reloads onto the new build.
 */

/** How often a tab that never navigates asks for a new sw.js: the browser only checks on navigation. */
export const UPDATE_CHECK_MS = 60 * 60 * 1000;

let waiting: ServiceWorker | null = null;
const listeners = new Set<() => void>();
let watching = false;
let stale = false;
let watchingStale = false;

/** The new version's worker, installed and waiting; null while there is none. */
export function updateWaiting(): ServiceWorker | null {
  return waiting;
}

/**
 * Whether one of this build's lazy chunks failed to load: a deploy since the tab opened has taken
 * its files off the server, so there is a newer version whether or not its worker is waiting yet.
 */
export function buildIsStale(): boolean {
  return stale;
}

/** `useSyncExternalStore`'s subscribe: told when a new version is waiting, or the build is stale. */
export function subscribeUpdate(aListener: () => void): () => void {
  listeners.add(aListener);
  return () => listeners.delete(aListener);
}

/** The waiting worker takes over; the page reloads when it has (see watchForUpdate). */
export function applyUpdate(): boolean {
  if (!waiting) return false;

  waiting.postMessage({ type: 'SKIP_WAITING' });
  return true;
}

/**
 * Reload Now: the waiting worker takes over, and the page reloads when it has; with none waiting
 * yet, \a aReload reloads the page itself.
 */
export function reloadOntoNewBuild(aReload: () => void): void {
  if (!applyUpdate()) aReload();
}

/**
 * Watch \a aWindow for a lazy chunk that will not load - Vite's `vite:preloadError`, which its
 * dynamic-import wrapper sends for the import itself as well as for its preloads.
 *
 * The precache holds only files under its size cap, so the biggest chunks (the 3D viewer's) come
 * from the network, and a deploy since the tab opened has removed them: the host answers the old
 * hash with `index.html`, "not a valid JavaScript MIME type". The build is then stale: the window
 * offers the new version as it offers a waiting one, and \a aContainer is asked for its sw.js now
 * rather than at the hourly check, so the new worker is likely waiting by the time it is taken.
 */
export function watchForStaleBuild(
  aWindow: Pick<EventTarget, 'addEventListener'>,
  aContainer: ServiceWorkerContainer | null,
): void {
  if (watchingStale) return;

  watchingStale = true;

  aWindow.addEventListener('vite:preloadError', () => {
    if (stale) return;

    stale = true;
    for (const listener of listeners) listener();

    aContainer?.ready.then((aRegistration) => aRegistration.update()).catch(() => {});
  });
}

/**
 * Watch \a aContainer for a new version: one waiting already, one that finishes installing later,
 * and an hourly check for one. \a aReload runs when a new worker takes control of the page - an
 * update this tab applied or another tab did, either way the old build's lazy chunks are gone -
 * and not on a first install, which has no worker to replace.
 */
export function watchForUpdate(
  aContainer: ServiceWorkerContainer,
  aReload: () => void,
  aSchedule: (aCheck: () => void) => void = (aCheck) => setInterval(aCheck, UPDATE_CHECK_MS),
): void {
  if (watching) return;

  watching = true;

  const hadController = !!aContainer.controller;
  let reloading = false;

  aContainer.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;

    reloading = true;
    aReload();
  });

  const offer = (aWorker: ServiceWorker): void => {
    // A first install is not an update: there is no old build to replace.
    if (!aContainer.controller) return;

    waiting = aWorker;
    for (const listener of listeners) listener();
  };

  aContainer.ready
    .then((aRegistration) => {
      if (aRegistration.waiting) offer(aRegistration.waiting);

      aRegistration.addEventListener('updatefound', () => {
        const worker = aRegistration.installing;

        if (!worker) return;

        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed') offer(worker);
        });
      });

      aSchedule(() => {
        aRegistration.update().catch(() => {});
      });
    })
    .catch(() => {});
}

/** For the tests: forget the watches, the waiting worker and the stale build. */
export function resetUpdateWatchForTests(): void {
  watching = false;
  waiting = null;
  stale = false;
  watchingStale = false;
  listeners.clear();
}
