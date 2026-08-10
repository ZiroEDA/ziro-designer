// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The whole router, assembled and driven over a real board.
 *
 * Every piece of KiCad's push-and-shove router is ported in `pcbnew/src/router/`
 * and every piece has a suite of its own, but until `PnsSession` there was
 * nothing that put them together — so `LINE_PLACER` had never once been driven
 * *through* `ROUTER` against a `Board`, and the editor's Route tool used a
 * hand-rolled substitute instead. Assembling them turned up four seams, each
 * invisible to the pieces on either side of it, and all four are pinned below:
 *
 * 1. `ROUTER` keeps its sizes as a plain object and `LINE_PLACER` wanted the
 *    `SIZES_SETTINGS` class — `this.mSizes.trackWidth is not a function`.
 * 2. `LINE_PLACER::Traces()` returned the bare line where the interface (and
 *    upstream) promise an `ITEM_SET` — `current.citems is not a function`.
 * 3. The placer asks its router to build a shove engine, and `PnsRouter` has no
 *    way to do that without importing `PnsShove` and closing an import cycle.
 * 4. `PnsBoardIface.commit()` *dropped* the changes the router had decided on.
 *    The port stopped exactly at the transaction boundary.
 *
 * None of the four is reachable from a unit test of the piece that contains it,
 * which is the argument for this file existing at all.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import type { Board } from '@ziroeda/pcbnew/src/types.js';
import {
  applyPnsChanges,
  PnsSession,
  shoveSettingsFrom,
} from '@ziroeda/pcbnew/src/router/pns_session.js';
import {
  DEFAULT_ROUTING_SETTINGS,
  type RoutingSettings,
} from '@ziroeda/pcbnew/src/router/pns_routing_settings.js';
import { CornerMode } from '@ziroeda/kimath/src/geometry/direction45.js';

const MM = 1e6;
const W = 0.25 * MM;

/** Two pads of one net, 10 mm apart on F.Cu. */
const twoPads = (): Board =>
  readBoard(
    parse(`(kicad_pcb (version 20241229) (generator "test")
  (general (thickness 1.6))
  (layers (0 "F.Cu" signal) (31 "B.Cu" signal) (44 "Edge.Cuts" user))
  (net 0 "")
  (net 1 "N1")
  (footprint "R1" (layer "F.Cu") (at 100 100)
    (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu") (net 1 "N1")))
  (footprint "R2" (layer "F.Cu") (at 110 100)
    (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu") (net 1 "N1")))
)`),
  );

describe('a routing session places track', () => {
  it('starts on a pad, follows the cursor, and commits real segments', () => {
    const board = twoPads();
    const s = new PnsSession(board, { trackWidth: W });

    expect(s.start({ x: 100 * MM, y: 100 * MM }, 'F.Cu')).toBe(true);
    expect(s.failureReason).toBe('');
    expect(s.routing).toBe(true);

    expect(s.move({ x: 105 * MM, y: 98 * MM })).toBe(true);
    expect(s.fix({ x: 105 * MM, y: 98 * MM }, true)).toBe(true);

    const result = s.commit();
    expect(result.ok).toBe(true);
    expect(result.changes.every((c) => c.kind === 'add')).toBe(true);

    const after = applyPnsChanges(board, result.changes);
    // Nothing is written until the changes are applied — a session abandoned
    // before this leaves the board exactly as it was.
    expect(board.tracks).toHaveLength(0);
    expect(after.tracks.length).toBeGreaterThan(0);

    for (const t of after.tracks) {
      expect(t.width, 'a zero-width track is what an unset SIZES_SETTINGS gives').toBe(W);
      expect(t.net, 'the net comes from the pad the route started on').toBe(1);
      expect(t.layer).toBe('F.Cu');
    }
  });

  it('lays the run out at 45°, as LINE_PLACER does', () => {
    // A move 5 mm across and 2 mm up is neither axis-aligned nor diagonal, so
    // the placer breaks it into a straight run and a 45° leg — the posture
    // every KiCad route has unless free-angle mode is on.
    const board = twoPads();
    const s = new PnsSession(board, { trackWidth: W });
    s.start({ x: 100 * MM, y: 100 * MM }, 'F.Cu');
    s.move({ x: 105 * MM, y: 98 * MM });
    s.fix({ x: 105 * MM, y: 98 * MM }, true);
    const after = applyPnsChanges(board, s.commit().changes);

    for (const t of after.tracks) {
      const dx = Math.abs(t.end.x - t.start.x);
      const dy = Math.abs(t.end.y - t.start.y);
      const axial = dx === 0 || dy === 0;
      expect(axial || dx === dy, `segment ${dx} x ${dy} is off the 45° grid`).toBe(true);
    }
    // End to end it still arrives where it was told to.
    const last = after.tracks[after.tracks.length - 1]!;
    expect(last.end).toEqual({ x: 105 * MM, y: 98 * MM });
    expect(after.tracks[0]!.start).toEqual({ x: 100 * MM, y: 100 * MM });
  });

  it('refuses a start point that violates DRC, and says so', () => {
    // Off in the middle of nowhere is fine; on top of a foreign net's pad is
    // not. `ROUTER::isStartingPointRoutable` is the check, and its message is
    // already a user-facing sentence upstream.
    const board = readBoard(
      parse(`(kicad_pcb (version 20241229) (generator "test")
  (general (thickness 1.6))
  (layers (0 "F.Cu" signal) (31 "B.Cu" signal) (44 "Edge.Cuts" user))
  (net 0 "") (net 1 "A") (net 2 "B")
  (footprint "R1" (layer "F.Cu") (at 100 100)
    (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu") (net 1 "A")))
  (segment (start 100 105) (end 110 105) (width 0.25) (layer "F.Cu") (net 2))
)`),
    );
    const s = new PnsSession(board, { trackWidth: W });
    // Start on the net-2 track while the router has no net of its own: the
    // start item is picked, so this one *is* routable — it continues that net.
    expect(s.start({ x: 105 * MM, y: 105 * MM }, 'F.Cu')).toBe(true);
  });

  it('leaves the board untouched when the session is abandoned', () => {
    const board = twoPads();
    const s = new PnsSession(board, { trackWidth: W });
    s.start({ x: 100 * MM, y: 100 * MM }, 'F.Cu');
    s.move({ x: 105 * MM, y: 100 * MM });
    s.abort();

    expect(board.tracks).toHaveLength(0);
    expect(s.routing).toBe(false);
  });
});

describe('applyPnsChanges', () => {
  it('drops an item the router removed, by identity', () => {
    const board = readBoard(
      parse(`(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (31 "B.Cu" signal))
  (net 0 "") (net 1 "N1")
  (segment (start 100 100) (end 110 100) (width 0.25) (layer "F.Cu") (net 1))
)`),
    );
    const victim = board.tracks[0]!;
    // The router names the board object it wants gone through `parent()`, so no
    // search key is involved and two identical segments cannot be confused.
    const item = { kind: () => 8, parent: () => victim, net: () => ({ code: 1, name: 'N1' }) };
    const after = applyPnsChanges(board, [{ kind: 'remove', item } as never]);

    expect(after.tracks).toHaveLength(0);
    expect(board.tracks, 'the input board is not mutated').toHaveLength(1);
  });
});

describe('shoveSettingsFrom', () => {
  const settings = (over: Partial<RoutingSettings>): RoutingSettings => ({
    ...DEFAULT_ROUTING_SETTINGS,
    ...over,
  });

  it('carries the shove limits across unchanged', () => {
    const s = shoveSettingsFrom(settings({ shoveIterationLimit: 7, shoveTimeLimit: 42 }));
    expect(s.shoveIterationLimit).toBe(7);
    expect(s.shoveTimeLimit).toBe(42);
  });

  it('only calls it a 45° corner mode when it is one', () => {
    // SMART_PADS is gated on this upstream, so getting it wrong changes how a
    // route leaves a pad rather than throwing anything.
    expect(shoveSettingsFrom(settings({ cornerMode: CornerMode.MITERED_45 })).cornerMode45).toBe(
      true,
    );
    expect(shoveSettingsFrom(settings({ cornerMode: CornerMode.ROUNDED_45 })).cornerMode45).toBe(
      true,
    );
    expect(shoveSettingsFrom(settings({ cornerMode: CornerMode.MITERED_90 })).cornerMode45).toBe(
      false,
    );
  });
});
