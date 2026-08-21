// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Layers manager, `GERBER_LAYER_WIDGET` over `LAYER_WIDGET`.
 *
 * The two data facts a `.tsx` cannot be asked about are extracted here: the
 * Items page's seven rows (`GERBER_LAYER_WIDGET::ReFillRender`,
 * `gerbview/widgets/gerbview_layer_widget.cpp:117-152`) and the right-click
 * menu (`AddRightClickMenuItems`, `:155-197`).
 */
import { describe, expect, it } from 'vitest';
// From the `.ts` module, not the `.tsx` component: qa's tsconfig compiles `.ts`
// only, and importing through the component fails `pnpm -r typecheck` with
// "--jsx is not set" while vitest still runs green.
import {
  layerContextMenu,
  renderRows,
  type RenderRow,
} from '@ziroeda/designer/src/editors/gerbview/layer_widget.js';
import {
  GERBER_BG_COLOR,
  GERBER_DCODE_COLOR,
  GERBER_DRAWINGSHEET_COLOR,
  GERBER_GRID_COLOR,
  GERBER_NEGATIVE_COLOR,
  GERBER_PAGE_LIMITS_COLOR,
} from '@ziroeda/designer/src/editors/gerbview/gerberColors.js';

const COLORS = {
  dcodes: GERBER_DCODE_COLOR,
  negativeObjects: GERBER_NEGATIVE_COLOR,
  grid: GERBER_GRID_COLOR,
  drawingSheet: GERBER_DRAWINGSHEET_COLOR,
  pageLimits: GERBER_PAGE_LIMITS_COLOR,
  background: GERBER_BG_COLOR,
};

describe('the Items page', () => {
  const rows = renderRows(COLORS);

  /**
   * `LAYER_WIDGET::ROW renderRows[7]` (`gerbview_layer_widget.cpp:120-142`), in
   * order, with `RR()` — the default-constructed spacer — third. Ours had FOUR
   * rows: no Drawing Sheet, no Page Limits, no spacer.
   */
  it('is seven rows, with the spacer third', () => {
    expect(rows).toHaveLength(7);
    expect(rows.map((r) => r.label)).toEqual([
      'DCodes',
      'Negative Objects',
      '',
      'Grid',
      'Drawing Sheet',
      'Page Limits',
      'Background',
    ]);
    expect(rows[2]?.spacer).toBe(true);
    expect(rows.filter((r) => r.spacer)).toHaveLength(1);
  });

  /** Ours wrote "Negative objects" and "Show background"; neither is upstream's. */
  it('spells the labels as upstream does', () => {
    const labels = rows.map((r) => r.label);
    expect(labels).toContain('Negative Objects');
    expect(labels).not.toContain('Negative objects');
    expect(labels).toContain('Background');
    expect(labels).not.toContain('Show background');
  });

  /**
   * Every non-spacer row carries a COLOR_SWATCH — `renderRows[row].color =
   * m_frame->GetVisibleElementColor( id )` for any row whose colour is not
   * UNSPECIFIED (`:144-148`). Ours drew no swatches at all.
   */
  it('gives every real row a colour swatch', () => {
    for (const r of rows.filter((x: RenderRow) => !x.spacer)) expect(r.color).not.toBeNull();
    expect(rows[2]?.color).toBeNull();
  });

  /**
   * `RR( _( "Background" ), LAYER_GERBVIEW_BACKGROUND, BLACK, _( "PCB Background" ), true, false )`
   * — the last argument is `changeable`, and it is the only FALSE one, so the
   * Background row's checkbox is disabled (`layer_widget.cpp:433`).
   */
  it('makes Background the one row that cannot be switched off', () => {
    const notChangeable = rows
      .filter((r: RenderRow) => !r.spacer && !r.changeable)
      .map((r: RenderRow) => r.label);
    expect(notChangeable).toEqual(['Background']);
  });

  /** The tooltip really does say "PCB Background" in GerbView (`:141`). */
  it('keeps upstream’s tooltips, including the odd one', () => {
    expect(rows.find((r) => r.label === 'Background')?.tooltip).toBe('PCB Background');
    expect(rows.find((r) => r.label === 'Grid')?.tooltip).toBe('Show the (x,y) grid dots');
  });

  it('takes its colours from the theme table, not from literals here', () => {
    expect(rows.find((r) => r.label === 'DCodes')?.color).toBe(GERBER_DCODE_COLOR);
    expect(rows.find((r) => r.label === 'Background')?.color).toBe(GERBER_BG_COLOR);
  });
});

describe('the right-click menu', () => {
  const noop = (): void => {};
  const menu = layerContextMenu({
    showAll: noop,
    hideAllButActive: noop,
    hideAll: noop,
    sortByX2: noop,
    sortByFileExtension: noop,
    moveUp: noop,
    moveDown: noop,
    clearLayer: noop,
  });

  /**
   * `AddRightClickMenuItems` (`gerbview_layer_widget.cpp:155-197`), in order,
   * separators included. These commands are the reason there are no per-row
   * buttons: ours had grown 👁 / ▲ / ▼ / ✕ on every row plus two in a header,
   * none of which KiCad draws anywhere.
   */
  it('is upstream’s twelve rows in upstream’s order', () => {
    expect(menu.map((i) => (i.sep ? '---' : i.label))).toEqual([
      'Show All Layers',
      'Hide All Layers But Active',
      'Always Hide All Layers But Active',
      'Hide All Layers',
      '---',
      'Sort Layers if X2 Mode',
      'Sort Layers by File Extension',
      '---',
      'Layers Display Parameters: Offset and Rotation',
      '---',
      'Move Current Layer Up',
      'Move Current Layer Down',
      'Clear Current Layer...',
    ]);
  });

  /**
   * Upstream greys NONE of these; ours greys what is not built yet, in its
   * upstream position rather than dropping it. That leaves two:
   * "Always Hide All Layers But Active" is a mode we do not hold
   * (`m_alwaysShowActiveLayer`, `:52`), and "Layers Display Parameters" opens
   * DIALOG_DRAW_LAYERS_SETTINGS, which we have not built.
   *
   * It used to leave four. The two sorts came off this list when the
   * comparators landed (`gerbview/src/layer_sort.ts`) — re-derived from what is
   * built, not read back off the new output: each of the two removed is
   * separately asserted to run in `gerbview_layer_sort_wiring.test.ts`, and
   * each of the two that stay is unbuilt for a reason named above.
   */
  it('greys exactly the two that are not built', () => {
    expect(menu.filter((i) => i.disabled).map((i) => i.label)).toEqual([
      'Always Hide All Layers But Active',
      'Layers Display Parameters: Offset and Rotation',
    ]);
  });

  it('wires the rest', () => {
    for (const label of [
      'Show All Layers',
      'Hide All Layers But Active',
      'Hide All Layers',
      'Sort Layers if X2 Mode',
      'Sort Layers by File Extension',
      'Move Current Layer Up',
      'Move Current Layer Down',
      'Clear Current Layer...',
    ])
      expect(menu.find((i) => i.label === label)?.action).toBeTypeOf('function');
  });

  /** Upstream's own comment: "menu text is capitalized". */
  it('capitalises its rows, as upstream notes it must', () => {
    for (const item of menu.filter((i) => !i.sep)) {
      const first = item.label?.[0] ?? '';
      expect(first).toBe(first.toUpperCase());
    }
  });
});
