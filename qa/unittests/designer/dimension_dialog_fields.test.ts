// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Which controls the dimension properties dialog shows, by kind.
 * Counterpart: the `switch( m_dimension->Type() )` in
 * `DIALOG_DIMENSION_PROPERTIES`' constructor, which hides whole sizers, plus
 * `m_extensionOvershoot.Show(false)` for anything that is not a
 * `PCB_DIM_ALIGNED`.
 *
 * These rules are not cosmetic. Every hidden control corresponds to a field the
 * engine refuses to write for that kind, so a control shown where the engine
 * ignores it is a box the user can type into that silently does nothing — and
 * one hidden where the engine *does* write is a property they can never reach.
 * The last describe below ties each flag to the engine to keep the two honest.
 */
import { describe, expect, it } from 'vitest';
import {
  applyDimensionValues,
  collectDimensionValues,
} from '@ziroeda/pcbnew/src/dimension_properties.js';
import { startDimension } from '@ziroeda/pcbnew';
import type { DimensionKind } from '@ziroeda/pcbnew/src/types.js';
import { dimensionDialogFields } from '@ziroeda/designer/src/editors/pcb/dimension_tools.js';

const ALL: DimensionKind[] = ['aligned', 'orthogonal', 'center', 'radial', 'leader'];

describe('an aligned or orthogonal dimension', () => {
  it('shows everything except the leader text frame', () => {
    for (const k of ['aligned', 'orthogonal'] as const) {
      const f = dimensionDialogFields(k);
      expect(f.format, k).toBe(true);
      expect(f.text, k).toBe(true);
      expect(f.textPositionMode, k).toBe(true);
      expect(f.arrowLength, k).toBe(true);
      expect(f.extensionOffset, k).toBe(true);
      expect(f.extensionOvershoot, k).toBe(true);
      expect(f.arrowDirection, k).toBe(true);
      expect(f.textFrame, k).toBe(false);
    }
  });
});

describe('a centre dimension', () => {
  const f = dimensionDialogFields('center');

  it('hides the format and text groups, because it measures nothing', () => {
    expect(f.format).toBe(false);
    expect(f.text).toBe(false);
  });

  it('hides the arrow length and extension offset, because it draws only a cross', () => {
    expect(f.arrowLength).toBe(false);
    expect(f.extensionOffset).toBe(false);
  });

  it('leaves nothing but the layer, lock and line thickness', () => {
    expect(f.extensionOvershoot).toBe(false);
    expect(f.arrowDirection).toBe(false);
    expect(f.textFrame).toBe(false);
  });
});

describe('a leader', () => {
  const f = dimensionDialogFields('leader');

  it('hides the format group, showing typed text rather than a measurement', () => {
    expect(f.format).toBe(false);
  });

  it('keeps its text but loses the position-mode choice', () => {
    expect(f.text).toBe(true);
    expect(f.textPositionMode).toBe(false);
  });

  it('is the only kind with a text frame', () => {
    expect(f.textFrame).toBe(true);
    for (const k of ALL.filter((x) => x !== 'leader'))
      expect(dimensionDialogFields(k).textFrame, k).toBe(false);
  });

  it('has no extension overshoot, the cast that gates it failing for a leader', () => {
    expect(f.extensionOvershoot).toBe(false);
  });
});

describe('a radial dimension', () => {
  const f = dimensionDialogFields('radial');

  it('measures, so it keeps the format and text groups', () => {
    expect(f.format).toBe(true);
    expect(f.text).toBe(true);
  });

  it('has no extension overshoot or arrow direction, being no kind of aligned', () => {
    // Both are gated on PCB_DIM_ALIGNED upstream. Arrow direction is the one
    // deliberate divergence: upstream leaves the control visible even though
    // the serializer never writes it for a radial, so it is hidden here rather
    // than offered as a box that does nothing.
    expect(f.extensionOvershoot).toBe(false);
    expect(f.arrowDirection).toBe(false);
  });
});

describe('the flags agree with what the engine will actually write', () => {
  /** Apply a change to a fresh dimension of this kind and see if it took. */
  const applyTo = (kind: DimensionKind, over: Record<string, unknown>) => {
    const d = startDimension(kind, { x: 0, y: 0 }).dimension;
    const board = {
      version: 20241229,
      layers: [],
      nets: new Map<number, string>(),
      footprints: [],
      tracks: [],
      arcs: [],
      vias: [],
      zones: [],
      shapes: [],
      texts: [],
      dimensions: [{ ...d, end: { x: 1_000_000, y: 0 } }],
      groups: [],
      source: { kind: 'list' as const, items: [] },
    };
    const v = { ...collectDimensionValues(board.dimensions[0]!), ...over };
    return applyDimensionValues(board, 0, v).dimensions[0]!;
  };

  it('shows extension overshoot exactly where the engine keeps it', () => {
    for (const k of ALL) {
      const kept =
        applyTo(k, { extensionOvershoot: 5_000_000 }).style.extensionHeight === 5_000_000;
      expect(kept, k).toBe(dimensionDialogFields(k).extensionOvershoot);
    }
  });

  it('shows the text frame exactly where the engine keeps it', () => {
    for (const k of ALL) {
      const kept = applyTo(k, { textFrame: 2 }).style.textFrame === 2;
      expect(kept, k).toBe(dimensionDialogFields(k).textFrame);
    }
  });

  it('shows the format group exactly where the item has one', () => {
    for (const k of ALL) {
      const has = applyTo(k, { prefix: 'X ' }).format !== undefined;
      // A leader has a format in the model (it holds the override text) but no
      // format *group* in the dialog, so this is the one place the two differ
      // on purpose.
      if (k === 'leader') continue;
      expect(has, k).toBe(dimensionDialogFields(k).format);
    }
  });
});
