// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `hiddenItems` and `onlyItems`: drawing a subset of a sheet (#449).
 *
 * This is what KiCad's renderer can do and ours could not. `VIEW` caches each
 * item's geometry separately, so re-drawing one item leaves every other item's
 * cached vertices alone (`VIEW::updateItemGeometry`, common/view/view.cpp), and
 * `SCH_MOVE_TOOL` puts the items being dragged into a preview group
 * (`m_view->AddToPreview` / `ClearPreview`) painted over an otherwise static
 * background.
 *
 * Both need the painter to be able to leave items out. Without it, a drag has
 * to repaint the whole sheet on every pointer move, which is why a symbol
 * trails the cursor by the length of a full repaint.
 *
 * The load-bearing test is the first one. This adds a condition to twenty-odd
 * draw sites in the file that decides what a schematic looks like, so the
 * property that matters most is that with no filter set, **nothing whatsoever
 * changed**.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from '@ziroeda/sexpr';
import { readSchematic, refId } from '@ziroeda/eeschema';
import { DEFAULT_RENDER_OPTS } from '@ziroeda/designer/src/editors/schematic/render/renderer.js';
import { recordSchematicScene } from '@ziroeda/designer/src/render/gl/schematic_gl.js';
import { Scene } from '@ziroeda/designer/src/render/gl/scene.js';
import type { Theme } from '@ziroeda/designer/src/editors/schematic/theme.js';

const SCALE = 0.00002;
const SRC = readFileSync(
  join(import.meta.dirname, '../../data/complex_hierarchy.kicad_sch'),
  'utf8',
);

const theme = new Proxy(
  {},
  { get: (_t, k) => (k === 'background' ? '#f0f0f0' : '#008484') },
) as unknown as Theme;

const doc = (): ReturnType<typeof readSchematic> => readSchematic(parse(SRC));

/**
 * The recorded geometry is the observable here: it is what the GL backend
 * uploads, and it is a faithful record of every draw call the renderer made.
 */
function record(opts: {
  hiddenItems?: ReadonlySet<string>;
  onlyItems?: ReadonlySet<string>;
  selection?: ReadonlySet<string>;
}): Scene {
  const scene = new Scene();
  recordSchematicScene(
    scene,
    {
      doc: doc(),
      theme,
      opts: {
        ...DEFAULT_RENDER_OPTS,
        ...(opts.hiddenItems ? { hiddenItems: opts.hiddenItems } : {}),
        ...(opts.onlyItems ? { onlyItems: opts.onlyItems } : {}),
      },
      selection: opts.selection,
      highlight: undefined,
    },
    SCALE,
  );
  return scene;
}

const bytes = (s: Scene): string => s.segments.view().join(',');

/** Every symbol on the sheet, by the id the renderer keys them under. */
const symbolIds = (): string[] => doc().symbols.map((s, i) => refId('symbol', s.uuid, i));

describe('with no filter set', () => {
  it('draws exactly what it drew before', () => {
    // The whole point. A guard was added to twenty-odd draw sites in the file
    // that decides what a schematic looks like; if any of them is wrong for
    // the unfiltered case, every user sees it and no other test would say so.
    const plain = record({});
    const emptySets = record({ hiddenItems: new Set(), onlyItems: new Set() });
    expect(emptySets.segmentCount).toBe(plain.segmentCount);
    expect(bytes(emptySets)).toBe(bytes(plain));
  });
});

describe('hiddenItems', () => {
  it('removes the hidden items and leaves the rest untouched', () => {
    const ids = symbolIds();
    expect(ids.length).toBeGreaterThan(2);
    const hidden = new Set(ids.slice(0, 2));

    const plain = record({});
    const without = record({ hiddenItems: hidden });
    expect(without.segmentCount).toBeLessThan(plain.segmentCount);

    // And what remains is a prefix-free subset, not a redrawn sheet: hiding two
    // symbols must not move anything else. Checked by hiding them one at a
    // time and confirming the removals are independent.
    const one = record({ hiddenItems: new Set([ids[0]!]) });
    const other = record({ hiddenItems: new Set([ids[1]!]) });
    const removedByFirst = plain.segmentCount - one.segmentCount;
    const removedBySecond = plain.segmentCount - other.segmentCount;
    expect(plain.segmentCount - without.segmentCount).toBe(removedByFirst + removedBySecond);
  });

  it('hiding every symbol still leaves the sheet furniture', () => {
    const all = record({ hiddenItems: new Set(symbolIds()) });
    // Wires, the page frame and the title block are not symbols.
    expect(all.segmentCount).toBeGreaterThan(0);
  });
});

describe('onlyItems', () => {
  it('draws just those items, at a cost set by how many there are', () => {
    // This is the preview pass: on a drag it runs on every pointer move, so
    // what it must not do is scale with the size of the sheet.
    const ids = symbolIds();
    const plain = record({});
    const preview = record({ onlyItems: new Set([ids[0]!]) });

    expect(preview.segmentCount).toBeGreaterThan(0);
    expect(preview.segmentCount).toBeLessThan(plain.segmentCount / 10);
  });

  it('complements hiddenItems exactly, so a split draws the sheet once over', () => {
    // The invariant a drag depends on: background plus preview is the whole
    // sheet, with nothing drawn twice and nothing missing.
    const moving = new Set(symbolIds().slice(0, 2));
    const plain = record({});
    const background = record({ hiddenItems: moving });
    const preview = record({ onlyItems: moving });
    expect(background.segmentCount + preview.segmentCount).toBe(plain.segmentCount);
  });

  it('wins over hiddenItems when both name the same item', () => {
    // An explicit rule rather than an accident, since the two are set together.
    const id = symbolIds()[0]!;
    const both = record({ onlyItems: new Set([id]), hiddenItems: new Set([id]) });
    expect(both.segmentCount).toBeGreaterThan(0);
  });
});

describe('the selection shadow honours the filter too', () => {
  it('so a dragged symbol does not leave its halo behind', () => {
    // The halo is drawn in its own pass. Filtering only the main pass would
    // leave a glow sitting at the old position for the length of the drag.
    const moving = new Set([symbolIds()[0]!]);
    // Selecting an item that is hidden must add nothing at all. Comparing a
    // selected background against an unselected one isolates the shadow pass:
    // any halo it still drew would show up here as extra geometry, where
    // comparing against the unfiltered sheet would pass on the main pass's
    // filtering alone and say nothing about the shadow.
    const hiddenAndSelected = record({ selection: moving, hiddenItems: moving });
    const hiddenNotSelected = record({ hiddenItems: moving });
    expect(hiddenAndSelected.segmentCount).toBe(hiddenNotSelected.segmentCount);

    // And the halo is real when the item is not hidden, so the equality above
    // is not passing because nothing draws a halo in the first place.
    const visibleAndSelected = record({ selection: moving });
    expect(visibleAndSelected.segmentCount).toBeGreaterThan(record({}).segmentCount);
  });
});
