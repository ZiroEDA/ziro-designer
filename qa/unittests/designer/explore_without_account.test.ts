// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * Signed out, you are in the app (#639): where a visitor with no account may
 * go, what AuthGate draws for them, and the trip to the sign-up page and back.
 * AuthGate itself pulls in the Supabase client, so the rules it applies live
 * in auth/explore.ts and are tested here.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  explorerMayVisit,
  gateView,
  goToAuth,
  takeDestination,
  type GateState,
} from '@ziroeda/designer/src/auth/explore.js';
import type { Route } from '@ziroeda/designer/src/nav/route.js';

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
  };

  it('opening the app drops you straight in: no wall first', () => {
    expect(gateView(out)).toEqual({ view: 'app', routeToWall: false });
  });

  it('a project in an account, or the sign-up page itself, is the wall', () => {
    expect(gateView({ ...out, explorable: false })).toEqual({ view: 'wall', routeToWall: true });
  });

  it('still a splash while the stored session is being read', () => {
    expect(gateView({ ...out, loading: true }).view).toBe('splash');
  });

  it('with auth off there is no wall anywhere', () => {
    expect(gateView({ ...out, authEnabled: false, explorable: false }).view).toBe('app');
  });
});

describe('goToAuth: the full-page sign-up, and back', () => {
  beforeEach(() => sessionStorage.clear());

  it('pushes the sign-up page and remembers where the visitor was', () => {
    const went: Route[] = [];
    const demo: Route = { kind: 'demo', id: 'cm5_minima', view: 'pcb' };
    goToAuth((r) => went.push(r), demo);
    expect(went).toEqual([{ kind: 'auth', step: 'signup' }]);
    // Signing up then lands back on the demo they were playing with.
    expect(takeDestination()).toEqual(demo);
  });

  it('can open on sign-in instead', () => {
    const went: Route[] = [];
    goToAuth((r) => went.push(r), { kind: 'home' }, 'signin');
    expect(went).toEqual([{ kind: 'auth', step: 'signin' }]);
  });
});
