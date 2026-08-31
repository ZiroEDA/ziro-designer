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

const panel = (onBrowse?: (current: string, commit: (picked: string) => void) => void) =>
  render(
    <PropertiesPanel<Cmd>
      selectionCount={1}
      friendlyName="Symbol"
      rows={ROWS}
      fmt={(iu) => `${iu}`}
      parse={() => null}
      onCommand={() => {}}
      onBrowse={onBrowse}
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

  /**
   * The bug this exists for, and it shipped once: clicking the button did
   * nothing at all.
   *
   * A mousedown on a button moves focus to it, which blurs the entry beside
   * it, whose `onBlur` is the cell's commit, whose first statement is
   * `setEditing( false )`. The editor unmounted and took the button with it, so
   * the click that follows the mousedown had nothing to land on. Firing
   * `click` in a test never sees this, because a synthetic click is not
   * preceded by a real mousedown - which is exactly how it got through.
   *
   * So the assertion is on the mechanism: the handler must prevent the default,
   * which is what keeps focus in the entry. `fireEvent` returns false when a
   * handler called `preventDefault`.
   */
  it('does not steal focus from the entry, or it unmounts before the click', () => {
    const { container } = panel(() => {});
    activate(container, 'Footprint');
    const btn = container.querySelector('.ze-grid-cellbtn') as HTMLButtonElement;
    expect(fireEvent.mouseDown(btn)).toBe(false);
    // ...and the editor is still there for the click to reach.
    expect(container.querySelector('input.ze-pgrid-editor')).not.toBeNull();
  });

  it('still swallows the mousedown, so the cell does not re-enter the editor', () => {
    // Both halves matter: preventDefault keeps focus, stopPropagation keeps the
    // cell from treating it as a click on itself.
    const { container } = panel(() => {});
    activate(container, 'Footprint');
    const cell = container.querySelector('.ze-pgrid-value')!;
    let sawIt = false;
    cell.addEventListener('mousedown', () => {
      sawIt = true;
    });
    fireEvent.mouseDown(container.querySelector('.ze-grid-cellbtn')!);
    expect(sawIt).toBe(false);
  });

  it('is disabled only where the host cannot open the frame', () => {
    // The editor is the frame's opener; a grid with nowhere to open one says so
    // rather than offering a button that does nothing.
    const { container } = panel();
    activate(container, 'Footprint');
    const btn = container.querySelector('.ze-grid-cellbtn') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.title).toContain('Footprint Chooser');
  });

  it('is live when the host supplies one, and opens it on the cell text', () => {
    const opened: string[] = [];
    const { container } = panel((current) => opened.push(current));
    activate(container, 'Footprint');
    const btn = container.querySelector('.ze-grid-cellbtn') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    // `wxString fpid = aProperty->GetValue().GetString()` — the frame opens on
    // what the cell currently holds, not on an empty string.
    expect(opened).toEqual(['TerminalBlock:TB_01x02']);
  });

  it('commits the picked fpid through the cell', () => {
    // `aGrid->ChangePropertyValue( aProperty, fpid )` — the picked value goes
    // back through the property, so it is one commit and not two.
    const commits: string[] = [];
    const rows: PropertyGridRow<Cmd>[] = [
      {
        group: 'Fields',
        name: 'Footprint',
        kind: 'string',
        value: 'Old:One',
        browse: 'footprint',
        set: (v) => {
          commits.push(String(v));
          return { what: 'f' };
        },
      },
    ];
    const { container } = render(
      <PropertiesPanel<Cmd>
        selectionCount={1}
        friendlyName="Symbol"
        rows={rows}
        fmt={(iu) => `${iu}`}
        parse={() => null}
        onCommand={() => {}}
        onBrowse={(_current, commit) => commit('New:Two')}
      />,
    );
    activate(container, 'Footprint');
    fireEvent.click(container.querySelector('.ze-grid-cellbtn')!);
    expect(commits).toEqual(['New:Two']);
  });
});
