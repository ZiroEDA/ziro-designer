// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The address bar, as React state.
 *
 * The thin half of `nav/route.ts`: that file has all the decisions in it and no
 * DOM, this one has the DOM and no decisions. It is also where
 * `import.meta.env` is allowed to appear -- reaching for it in `route.ts` is
 * what would make the parser unreachable from `qa`'s typecheck.
 */

import { useCallback, useEffect, useState } from 'react';
import { parseRoute, routeHref, sameRoute, type Route } from './route.js';

/**
 * Where the app is served from -- `/` on the deployed site, a subpath on a
 * build made with `VITE_BASE`. Read once: it cannot change while the page is
 * open, and reading it per navigation would only invite it to disagree with
 * itself.
 */
const BASE: string = import.meta.env.BASE_URL || '/';

const here = (): Route => parseRoute(window.location.href, BASE);

/** The address for a route, from the address the page is currently on. */
export const hrefFor = (route: Route): string =>
  routeHref(route, BASE, typeof window === 'undefined' ? '' : window.location.search);

export interface Nav {
  route: Route;
  /**
   * Go somewhere.
   *
   * `replace` for a change within the same place -- opening a different sheet
   * of the same schematic -- and a push for a change of place, so Back returns
   * to the project manager rather than leaving the app.
   */
  navigate: (to: Route, opts?: { replace?: boolean }) => void;
}

/**
 * Fired by `navigate` so that every `useRoute` on the page re-reads the address.
 *
 * There is more than one: `AuthGate` sits ABOVE `App` and still renders it
 * (blurred) behind the sign-in wall, so both are mounted and both hold route
 * state. `pushState` raises no event of its own, so without this the gate could
 * move the address while App still believed it was elsewhere — and App's
 * canonicalise effect, the next time anything changed, would `replaceState` the
 * address back and undo it. Two owners of one address bar have to hear each
 * other.
 */
const NAV_EVENT = 'ziro:navigate';

export function useRoute(): Nav {
  const [route, setRoute] = useState<Route>(here);

  useEffect(() => {
    // Back and Forward. Without this the address changes and the app does not,
    // which is worse than not having addresses at all.
    const onPop = (): void => setRoute(here());
    window.addEventListener('popstate', onPop);
    window.addEventListener(NAV_EVENT, onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener(NAV_EVENT, onPop);
    };
  }, []);

  // Canonicalise once, on the first render that has a window.
  //
  // This is what migrates a `?p=<uid>` share link -- already sent, and still
  // opening the right project -- to `/p/<uid>`, and it also tidies a hand-typed
  // address into the form the app writes. `replaceState`, so the pre-canonical
  // address is not a Back target that would bounce straight back here.
  useEffect(() => {
    const canonical = hrefFor(route);
    if (canonical !== window.location.pathname + window.location.search) {
      window.history.replaceState(window.history.state, '', canonical);
    }
  }, [route]);

  const navigate = useCallback<Nav['navigate']>((to, opts) => {
    // Against the ADDRESS, not against the last render's route: a navigation
    // can be fired from a handler holding a stale closure, and pushing an entry
    // for the address already shown fills Back with duplicates of one page.
    if (sameRoute(here(), to)) {
      setRoute(to);
      return;
    }
    const href = hrefFor(to);
    if (opts?.replace) window.history.replaceState(window.history.state, '', href);
    else window.history.pushState(window.history.state, '', href);
    setRoute(to);
    // Tell the other useRoute on the page (see NAV_EVENT). Dispatched after the
    // history call so a listener that re-reads the address sees the new one.
    window.dispatchEvent(new Event(NAV_EVENT));
  }, []);

  return { route, navigate };
}
