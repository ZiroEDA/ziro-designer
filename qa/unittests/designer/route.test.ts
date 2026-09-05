// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The address bar, as data.
 *
 * The app had no addresses: every page was the bare domain, so a refresh could
 * not put you back, two tabs could not hold two projects, Back left the app,
 * and nothing could be linked to — which is why sharing had to invent `?p=` and
 * then carry it across a sign-in by hand.
 *
 * This is the half with the decisions in it, and it is pure so that it can be
 * tested at all: no DOM, and no `import.meta.env`, which is what makes a module
 * unreachable from this package.
 */
import { describe, expect, it } from 'vitest';
import {
  fileForFrame,
  HOME,
  parseRoute,
  routeHref,
  sameRoute,
  type Route,
} from '@ziroeda/designer/src/nav/route.js';

const UID = '11111111-2222-3333-4444-555555555555';
const AT = 'https://designer.ziroeda.com';

describe('reading an address', () => {
  it('names the project and the frame', () => {
    expect(parseRoute(`${AT}/`)).toEqual({ kind: 'home' });
    expect(parseRoute(`${AT}/p/${UID}`)).toEqual({
      kind: 'project',
      uid: UID,
      view: 'manager',
    });
    expect(parseRoute(`${AT}/p/${UID}/pcb`)).toEqual({
      kind: 'project',
      uid: UID,
      view: 'pcb',
    });
    expect(parseRoute(`${AT}/p/${UID}/schematic?f=Amp.kicad_sch`)).toEqual({
      kind: 'project',
      uid: UID,
      view: 'schematic',
      file: 'Amp.kicad_sch',
    });
    expect(parseRoute(`${AT}/demo/ecc83`)).toEqual({ kind: 'demo', id: 'ecc83' });
    expect(parseRoute(`${AT}/calculator`)).toEqual({ kind: 'tool', tool: 'calculator' });
    expect(parseRoute(`${AT}/drawing-sheet`)).toEqual({ kind: 'tool', tool: 'drawing-sheet' });
  });

  it('falls back to home for anything it does not recognise', () => {
    // An address is user input: it arrives from bookmarks, chat messages and
    // typos, and the app still has to start. A wrong path lands on the home
    // screen, never on a blank page.
    expect(parseRoute(`${AT}/nonsense`)).toEqual(HOME);
    expect(parseRoute(`${AT}/p`)).toEqual(HOME);
    expect(parseRoute(`${AT}/p/not-a-uid`)).toEqual(HOME);
    expect(parseRoute(`${AT}/p/${UID}/nosuchframe`)).toEqual(HOME);
    expect(parseRoute(`${AT}/demo/../../etc/passwd`)).toEqual(HOME);
    expect(parseRoute('not a url at all')).toEqual(HOME);
  });

  it('still opens a `?p=` link, because those are already sent', () => {
    // The share link this replaces. It has to keep working; `routeHref` never
    // writes one back.
    expect(parseRoute(`${AT}/?p=${UID}`)).toEqual({
      kind: 'project',
      uid: UID,
      view: 'manager',
    });
    expect(parseRoute(`${AT}/?p=rubbish`)).toEqual(HOME);
  });

  it('reads the same under a base path', () => {
    // The build can be served from a subpath (`VITE_BASE`), and a route that
    // only parsed at the root would break every link on such a deploy.
    expect(parseRoute(`${AT}/pcb-app/p/${UID}/pcb`, '/pcb-app/')).toEqual({
      kind: 'project',
      uid: UID,
      view: 'pcb',
    });
    expect(parseRoute(`${AT}/pcb-app/`, '/pcb-app/')).toEqual(HOME);
  });
});

describe('writing an address', () => {
  const ROUTES: Route[] = [
    { kind: 'home' },
    { kind: 'project', uid: UID, view: 'manager' },
    { kind: 'project', uid: UID, view: 'schematic' },
    { kind: 'project', uid: UID, view: 'pcb' },
    { kind: 'project', uid: UID, view: 'symbols' },
    { kind: 'project', uid: UID, view: 'footprints' },
    { kind: 'project', uid: UID, view: 'schematic', file: 'sheets/Power.kicad_sch' },
    { kind: 'demo', id: 'ecc83' },
    { kind: 'tool', tool: 'calculator' },
    { kind: 'tool', tool: 'image-converter' },
    { kind: 'tool', tool: 'gerber' },
    { kind: 'tool', tool: 'drawing-sheet' },
  ];

  it('round-trips every shape', () => {
    // The property that matters: what the app writes, the app can read. A shape
    // that only survives one direction is a link that opens the wrong thing.
    for (const r of ROUTES) {
      expect(parseRoute(`${AT}${routeHref(r)}`)).toEqual(r);
    }
  });

  it('round-trips under a base path too', () => {
    for (const r of ROUTES) {
      const href = routeHref(r, '/pcb-app/');
      expect(href.startsWith('/pcb-app/')).toBe(true);
      expect(parseRoute(`${AT}${href}`, '/pcb-app/')).toEqual(r);
    }
  });

  it('escapes a file name rather than breaking the address', () => {
    const r: Route = { kind: 'project', uid: UID, view: 'schematic', file: 'a b/c&d.kicad_sch' };
    const href = routeHref(r);
    expect(href).not.toContain(' ');
    expect(parseRoute(`${AT}${href}`)).toEqual(r);
  });
});

describe('what survives a navigation', () => {
  it('carries a parameter the router does not own', () => {
    // `?perf=1` is read by SchematicCanvas and GerberCanvas. Losing it on the
    // first navigation would break the perf overlay in a way that looks like
    // the overlay's fault.
    const href = routeHref({ kind: 'project', uid: UID, view: 'pcb' }, '/', '?perf=1&demo=amp');
    const params = new URL(`${AT}${href}`).searchParams;
    expect(params.get('perf')).toBe('1');
    expect(params.get('demo')).toBe('amp');
  });

  it('does not carry an invitation token forward', () => {
    // `cloud/invites.ts` strips `join` from the address on purpose: until it is
    // redeemed it is the credential. Carrying it would put a secret back into
    // every URL the app writes afterwards.
    const href = routeHref({ kind: 'project', uid: UID, view: 'pcb' }, '/', '?join=abc&perf=1');
    const params = new URL(`${AT}${href}`).searchParams;
    expect(params.has('join')).toBe(false);
    expect(params.get('perf')).toBe('1');
  });

  it('does not re-emit the `?p=` it replaced', () => {
    // Otherwise every address would carry both forms of the same fact, and the
    // legacy one would outlive the migration it exists for.
    const href = routeHref({ kind: 'project', uid: UID, view: 'pcb' }, '/', `?p=${UID}`);
    expect(href).toBe(`/p/${UID}/pcb`);
  });

  it('drops a stale `f` when the frame has no file', () => {
    // Switching from a sheet to the PCB editor must not leave the sheet's name
    // in the address, or Back and a reload would disagree about what is open.
    const href = routeHref({ kind: 'project', uid: UID, view: 'pcb' }, '/', '?f=Amp.kicad_sch');
    expect(href).toBe(`/p/${UID}/pcb`);
  });
});

describe('telling two routes apart', () => {
  it('is used to decide whether an address is worth a history entry', () => {
    // React re-renders far more often than the address changes. Pushing the
    // address you are already on fills Back with duplicates of one page.
    const a: Route = { kind: 'project', uid: UID, view: 'schematic', file: 'A.kicad_sch' };
    expect(sameRoute(a, { ...a })).toBe(true);
    expect(sameRoute(a, { ...a, view: 'pcb' })).toBe(false);
    expect(sameRoute(a, { ...a, file: 'B.kicad_sch' })).toBe(false);
    expect(sameRoute(a, { ...a, uid: '99999999-2222-3333-4444-555555555555' })).toBe(false);
    expect(sameRoute(HOME, HOME)).toBe(true);
    expect(sameRoute(HOME, a)).toBe(false);
    expect(sameRoute({ kind: 'tool', tool: 'gerber' }, { kind: 'tool', tool: 'calculator' })).toBe(
      false,
    );
  });

  it('treats a missing file and an empty one as the same place', () => {
    const withNone: Route = { kind: 'project', uid: UID, view: 'schematic' };
    const withEmpty: Route = { kind: 'project', uid: UID, view: 'schematic', file: '' };
    expect(sameRoute(withNone, withEmpty)).toBe(true);
  });
});

describe('which file the address names', () => {
  // Three frames open a file and each holds its own: eeschema's sheet, and the
  // library each of the two editors was launched on (KiCad's MAIL_LIB_EDIT and
  // MAIL_FP_EDIT). `?f=` is one parameter, so the frame decides which of the
  // three it means.
  const OPEN = {
    schematic: 'sheets/Power.kicad_sch',
    symbols: 'lib/Amp.kicad_sym',
    footprints: 'lib/Amp.pretty/R_0805.kicad_mod',
  };

  it('gives each frame its own', () => {
    expect(fileForFrame('schematic', OPEN)).toBe('sheets/Power.kicad_sch');
    expect(fileForFrame('symbols', OPEN)).toBe('lib/Amp.kicad_sym');
    expect(fileForFrame('footprints', OPEN)).toBe('lib/Amp.pretty/R_0805.kicad_mod');
  });

  it('gives the board and the manager none, whatever else is open', () => {
    // The bug this exists for: one shared `startFile` was written to the
    // address whatever was on screen, so walking from a sheet to the board
    // produced `/p/<uid>/pcb?f=Amp.kicad_sch` — a file pcbnew does not open,
    // and a link that reopens somewhere other than where it was copied from. A
    // project has one board, and the manager is the project itself.
    expect(fileForFrame('pcb', OPEN)).toBeUndefined();
    expect(fileForFrame('manager', OPEN)).toBeUndefined();
  });

  it('treats nothing open as no parameter at all', () => {
    // Not the empty string: `routeHref` writes `f` for any truthy value, and
    // `?f=` naming nothing would come back from `parseRoute` as no file — an
    // address that does not round-trip.
    expect(fileForFrame('schematic', {})).toBeUndefined();
    expect(fileForFrame('schematic', { schematic: null })).toBeUndefined();
    expect(fileForFrame('symbols', { symbols: '' })).toBeUndefined();
  });

  it('survives the round trip, for every frame that has one', () => {
    for (const view of ['schematic', 'symbols', 'footprints'] as const) {
      const file = fileForFrame(view, OPEN);
      const r: Route = { kind: 'project', uid: UID, view, ...(file ? { file } : {}) };
      expect(parseRoute(`${AT}${routeHref(r)}`)).toEqual(r);
    }
  });
});
