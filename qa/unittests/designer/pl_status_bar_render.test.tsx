// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The pl_editor width table actually reaches the rendered bar.
 *
 * `pl_status_bar.test.ts` asserts the table; this asserts the wiring, which is
 * the half a data test cannot see. `KiStatusBar` reserves each fixed pane's
 * width by rendering its template string invisibly under the value (see
 * `StatusField`), so "did the override arrive?" is answerable by looking for
 * the template in the DOM — and "is that pane fixed at all?" by whether it has
 * one, since a stretching pane renders no template.
 *
 * The bug this pins: `PL_EDITOR_FRAME` writes `coord origin: <corner>` into
 * pane 5 (pl_editor_frame.cpp:805) and sizes that pane for the longest of those
 * sentences (:171), while the shared `EDA_DRAW_FRAME` table sizes pane 5 for
 * the word "Inches" (eda_draw_frame.cpp:817). We rendered the shared table, so
 * a 38-character sentence lived in a six-character pane.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { KiStatusBar } from '@ziroeda/designer/src/ui/KiStatusBar.js';
import { PL_EDITOR_STATUS_TEMPLATES } from '@ziroeda/designer/src/editors/drawingsheet/pl_status_bar.js';

afterEach(cleanup);

const FIELDS = {
  message: "File '/tmp/x.kicad_wks' saved.",
  zoom: 'Z 0.91',
  coords: 'X 309.5  Y 211.5',
  deltas: 'dx 309.5  dy 211.5',
  grid: 'grid 0.5000',
  units: 'coord origin: Left Top paper corner',
  tool: 'mm',
};

/** Every size-reserving template the bar rendered, in pane order. */
function templates(container: HTMLElement): string[] {
  // `Array.from`, not a spread: `lib` here is ES2022 + DOM and its `NodeListOf`
  // carries no `[Symbol.iterator]`, so the spread does not compile.
  return Array.from(container.querySelectorAll('.ze-size-template')).map(
    (n) => n.textContent ?? '',
  );
}

describe('KiStatusBar with the pl_editor table', () => {
  it('reserves pane 5 for the coordinate origin, not for "Inches"', () => {
    const { container } = render(
      <KiStatusBar fields={FIELDS} templates={PL_EDITOR_STATUS_TEMPLATES} />,
    );
    const t = templates(container);
    expect(t.some((s) => s.includes('coord origin: Right Bottom page corner'))).toBe(true);
  });

  it('fixes the units and constraint panes, which normally stretch', () => {
    const { container } = render(
      <KiStatusBar fields={FIELDS} templates={PL_EDITOR_STATUS_TEMPLATES} />,
    );
    const t = templates(container);
    // Seven templates: panes 1-7. Pane 0 is the only proportional one upstream
    // (`-1`, pl_editor_frame.cpp:153).
    expect(t).toHaveLength(7);
    expect(t.some((s) => s.startsWith('Inches'))).toBe(true);
    expect(t.some((s) => s.startsWith('Constrain to H, V, 45'))).toBe(true);
  });

  it('leaves every other frame on the shared table', () => {
    // The override is per-frame, exactly as `SetFieldsCount` is. Without a
    // table the bar must still be the five-fixed-three-stretch shape.
    const { container } = render(<KiStatusBar fields={FIELDS} />);
    const t = templates(container);
    expect(t).toHaveLength(5);
    expect(t).toContain('Inches');
    expect(t.some((s) => s.includes('coord origin'))).toBe(false);
  });

  it('still shows the values, not only the reserved widths', () => {
    const { container } = render(
      <KiStatusBar fields={FIELDS} templates={PL_EDITOR_STATUS_TEMPLATES} />,
    );
    const text = container.textContent ?? '';
    expect(text).toContain('coord origin: Left Top paper corner');
    expect(text).toContain("File '/tmp/x.kicad_wks' saved.");
  });
});
