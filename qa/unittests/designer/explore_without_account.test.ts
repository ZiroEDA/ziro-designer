// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * Signed out, you are in the app (#639): where a visitor with no account may
 * go, what AuthGate draws for them, and sign-up in a new tab.
 * AuthGate itself pulls in the Supabase client, so the rules it applies live
 * in auth/explore.ts and are tested here.
 */
import { describe, expect, it } from 'vitest';
import {
  explorerMayVisit,
  gateView,
  goToAuth,
  closeIfOpenedByApp,
  type GateState,
  type OpenedWindow,
} from '@ziroeda/designer/src/auth/explore.js';

describe('explorerMayVisit', () => {
  it('lets a visitor with no account into home, the demos and the standalone tools', () => {
    expect(explorerMayVisit({ kind: 'home' })).toBe(true);
    expect(explorerMayVisit({ kind: 'demo', id: 'cm5_minima' })).toBe(true);
    expect(explorerMayVisit({ kind: 'demo', id: 'ecc83', view: 'pcb' })).toBe(true);
    expect(explorerMayVisit({ kind: 'tool', tool: 'calculator' })).toBe(true);
  });

  it('keeps a project in an account behind the wall', () => {
    expect(explorerMayVisit({ kind: 'project', uid: 'abc', view: 'pcb' })).toBe(false);
    expect(explorerMayVisit({ kind: 'project', uid: 'abc', view: 'manager' })).toBe(false);
  });

  it('does not treat the wall itself as a place to be let into', () => {
    expect(explorerMayVisit({ kind: 'auth', step: 'signup' })).toBe(false);
  });
});

describe('gateView, signed out', () => {
  const out: GateState = {
    authEnabled: true,
    loading: false,
    hasSession: false,
    keyState: 'absent',
    pendingRecoveryKey: false,
    recovering: false,
    explorable: true,
    signedOutHere: false,
    opening: false,
  };

  it('opening the app drops you straight in: no wall first', () => {
    expect(gateView(out)).toMatchObject({ view: 'app', routeToWall: false });
  });

  it('a project in an account, or the sign-up page itself, is the wall', () => {
    expect(gateView({ ...out, explorable: false })).toMatchObject({
      view: 'wall',
      routeToWall: true,
    });
  });

  it('still a splash while the stored session is being read', () => {
    expect(gateView({ ...out, loading: true }).view).toBe('splash');
  });

  it('with auth off there is no wall anywhere', () => {
    expect(gateView({ ...out, authEnabled: false, explorable: false }).view).toBe('app');
  });
});

describe('goToAuth: the full-page sign-up, in a new tab', () => {
  it('opens /signup in a new tab that keeps its opener, so it can come back', () => {
    const opened: string[][] = [];
    goToAuth('signup', (u, t) => opened.push([u, t]));
    expect(opened).toEqual([['/signup', '_blank']]);
  });

  it('can open on sign-in instead', () => {
    const opened: string[][] = [];
    goToAuth('signin', (u, t) => opened.push([u, t]));
    expect(opened).toEqual([['/signin', '_blank']]);
  });
});

describe('closeIfOpenedByApp: the sign-up tab hands back and closes, as EasyEDA does', () => {
  const tab = (opener: OpenedWindow['opener'], origin = 'https://app.ziroeda.com') => {
    const log: string[] = [];
    const win: OpenedWindow = {
      opener,
      location: { origin },
      close: () => log.push('close'),
    };
    return { win, log };
  };
  const ours = (log: string[], closed = false) => ({
    location: { origin: 'https://app.ziroeda.com' },
    closed,
    focus: () => log.push('focus opener'),
  });

  it('opened by one of our tabs: focuses it and closes', () => {
    const log: string[] = [];
    const { win, log: own } = tab(ours(log));
    expect(closeIfOpenedByApp(win)).toBe(true);
    expect(log).toEqual(['focus opener']);
    expect(own).toEqual(['close']);
  });

  it('opened by the marketing site (another origin): stays open', () => {
    const { win, log } = tab({
      location: { origin: 'https://www.ziroeda.com' },
      closed: false,
      focus: () => {},
    });
    expect(closeIfOpenedByApp(win)).toBe(false);
    expect(log).toEqual([]);
  });

  it('a cross-origin opener whose location cannot even be read: stays open', () => {
    const opener = {
      get location(): { origin: string } {
        throw new Error('SecurityError');
      },
      closed: false,
      focus: () => {},
    };
    const { win, log } = tab(opener);
    expect(closeIfOpenedByApp(win)).toBe(false);
    expect(log).toEqual([]);
  });

  it('no opener (a typed address), or the opener already closed: stays open', () => {
    expect(closeIfOpenedByApp(tab(null).win)).toBe(false);
    const { win, log } = tab(ours([], true));
    expect(closeIfOpenedByApp(win)).toBe(false);
    expect(log).toEqual([]);
  });
});

describe('gateView: the tab that opened sign-up keeps its app while the other tab finishes', () => {
  const base: GateState = {
    authEnabled: true,
    loading: false,
    hasSession: false,
    keyState: 'absent',
    pendingRecoveryKey: false,
    recovering: false,
    explorable: true,
    signedOutHere: false,
    opening: false,
  };
  const walk = (steps: Partial<GateState>[]) => {
    let signedOutHere = false;
    return steps.map((st) => {
      const v = gateView({ ...base, ...st, signedOutHere });
      signedOutHere = v.signedOutHere;
      return v;
    });
  };

  it('a sign-up in the new tab: this tab is the app throughout, demo and all', () => {
    // What this tab sees: signed out on a demo; the session arrives before the
    // new tab has stored the keys (none); the new tab announces its key, this
    // one re-settles (loading, then locked until the answer), then unlocked.
    const views = walk([
      { explorable: true },
      { hasSession: true, keyState: 'loading' },
      { hasSession: true, keyState: 'none' },
      { hasSession: true, keyState: 'loading' },
      { hasSession: true, keyState: 'locked' },
      { hasSession: true, keyState: 'unlocked' },
    ]);
    expect(views.map((v) => v.view)).toEqual(['app', 'app', 'app', 'app', 'app', 'app']);
    expect(views.some((v) => v.routeToWall)).toBe(false);
    // And never signed out while waiting for the other tab.
    expect(views.some((v) => v.signOutHere)).toBe(false);
    // All the way through: an ordinary signed-in tab from here on.
    expect(views[5]!.signedOutHere).toBe(false);
  });

  it('once through, a later lock is handled as for anyone: this tab signs itself out', () => {
    const views = walk([
      {},
      { hasSession: true, keyState: 'unlocked' },
      { hasSession: true, keyState: 'locked' },
    ]);
    expect(views[2]!.signOutHere).toBe(true);
  });

  it('the moment before the stored session loads does not count as signed out: a keyless returning tab is signed out, not kept', () => {
    const views = walk([
      { loading: true },
      { hasSession: true, keyState: 'loading' },
      { hasSession: true, keyState: 'locked' },
    ]);
    expect(views.map((v) => v.view)).toEqual(['splash', 'splash', 'splash']);
    expect(views[2]!.signOutHere).toBe(true);
  });

  it('the keep-the-app grace is only for places a visitor may be anyway', () => {
    const views = walk([{}, { hasSession: true, keyState: 'locked', explorable: false }]);
    expect(views[1]!.view).not.toBe('app');
    expect(views[1]!.signOutHere).toBe(true);
  });

  it('while this tab is signing in (seconds of Argon2id), the form stays: no splash, no sign-out', () => {
    // The session lands before the keys are made; it used to show the bare
    // splash for the whole wait, and with no unlock step a keyless lookup
    // would have signed the half-finished sign-in out.
    for (const keyState of ['absent', 'loading', 'none', 'locked'] as const) {
      const v = gateView({ ...base, hasSession: true, keyState, opening: true, explorable: false });
      expect(v).toMatchObject({ view: 'wall', routeToWall: false, signOutHere: false });
    }
  });

  it('the new tab itself, which never had the app signed out, shows its recovery key', () => {
    const views = walk([
      { explorable: false },
      { hasSession: true, keyState: 'unlocked', pendingRecoveryKey: true, explorable: false },
    ]);
    expect(views[1]!.view).toBe('wall');
  });
});
