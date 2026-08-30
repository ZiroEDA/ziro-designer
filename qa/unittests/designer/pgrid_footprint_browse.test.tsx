// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Footprint field's cell editor is not the plain text control.
 *
 * `SCH_PROPERTIES_PANEL::createPGProperty` (sch_properties_panel.cpp:478-482)
 * swaps it for exactly two field names, and for the Footprint field that is
 * `PG_FPID_EDITOR`: `CreateControls` builds a `wxPGMultiButton` carrying
 * `BITMAPS::small_library` and then generates the text control at whatever
 * width the buttons leave (pg_editors.cpp:541-553). Clicking it opens
 * FRAME_FOOTPRINT_CHOOSER.
 *
 * Two things follow that this pins:
 *
 *  - the button belongs to the EDITOR, so it exists only while the cell is
 *    activated — it is not painted on the resting row;
 *  - it is a NAME test, not a heuristic: every other field keeps the plain
 *    text control, Reference and Value included.
 *
 * The button is disabled: FRAME_FOOTPRINT_CHOOSER does not exist in this app,
 * and the identical button in Symbol Properties is disabled for the same
 * reason. Its shape and position are upstream's so that wiring it is the only
 * step left.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { PropertiesPanel } from '@ziroeda/designer/src/widgets/properties_panel.js';
import type { PropertyGridRow } from '@ziroeda/designer/src/widgets/properties_panel.js';

afterEach(cleanup);

type Cmd = { readonly what: string };

const ROWS: PropertyGridRow<Cmd>[] = [
  { group: 'Fields', name: 'Reference', kind: 'string', value: 'J1', set: () => ({ what: 'r' }) },
  {
    group: 'Fields',
    name: 'Footprint',
    kind: 'string',
    value: 'TerminalBlock:TB_01x02',
    browse: 'footprint',
    set: () => ({ what: 'f' }),
  },
];

const panel = () =>
  render(
    <PropertiesPanel<Cmd>
      selectionCount={1}
      friendlyName="Symbol"
      rows={ROWS}
      fmt={(iu) => `${iu}`}
      parse={() => null}
      onCommand={() => {}}
    />,
  );

/** Activate a cell the way the grid does — a click on the value cell. */
const activate = (c: HTMLElement, name: string): void => {
  const row = [...c.querySelectorAll('.ze-pgrid-row')].find((r) =>
    r.querySelector('.ze-pgrid-name')?.textContent?.includes(name),
  )!;
  fireEvent.click(row.querySelector('.ze-pgrid-value')!);
};

describe('the Footprint cell carries the library button', () => {
  it('shows no button at rest, because the editor is what builds it', () => {
    const { container } = panel();
    expect(container.querySelector('.ze-grid-cellbtn')).toBeNull();
  });

  it('shows one once the cell is activated', () => {
    const { container } = panel();
    activate(container, 'Footprint');
    const btn = container.querySelector('.ze-grid-cellbtn');
    expect(btn).not.toBeNull();
    expect(btn!.getAttribute('aria-label')).toBe('Browse for footprint');
  });

  it('leaves the entry beside it, not replaced by it', () => {
    const { container } = panel();
    activate(container, 'Footprint');
    const wrap = container.querySelector('.ze-grid-editwrap')!;
    expect(wrap.querySelector('input.ze-pgrid-editor')).not.toBeNull();
    expect(wrap.querySelector('.ze-grid-cellbtn')).not.toBeNull();
  });

  it('gives no button to any other field', () => {
    // A name test, not a heuristic on "looks like a path".
    const { container } = panel();
    activate(container, 'Reference');
    expect(container.querySelector('.ze-grid-cellbtn')).toBeNull();
    expect(container.querySelector('input.ze-pgrid-editor')).not.toBeNull();
  });

  it('is disabled, and says why', () => {
    const { container } = panel();
    activate(container, 'Footprint');
    const btn = container.querySelector('.ze-grid-cellbtn') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.title).toContain('Footprint Chooser');
  });
});
