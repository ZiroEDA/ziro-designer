// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * PROPERTIES_PANEL, the docked Properties pane — the shared widget.
 *
 * Upstream this is `common/widgets/properties_panel.cpp`, and eeschema and
 * pcbnew subclass it purely to supply data. Ours was a private copy inside the
 * schematic editor, which is how it drifted into a FORM — bold labels, every
 * value boxed in an input or a select — where KiCad is a wxPropertyGrid.
 *
 * Two halves, and they fail for different reasons on purpose:
 *
 *  - the RENDERED half asks the real component for structure: that there is a
 *    caption carrying the item TYPE, that groups are collapsible categories,
 *    that rows come out in the order handed over, that a read-only row carries
 *    no control, and that a value cell is text until it is activated. A source
 *    scan cannot tell a moved element from a renamed one.
 *  - the DECLARED half pins the widget stylesheet's TEXT, because happy-dom
 *    computes no `var()` and paints nothing. It is a check on spelling: that
 *    the row pitch is the 25 the probe measured, that every colour comes from
 *    a shared token rather than a hex literal, and that nothing draws a box
 *    round a value cell.
 *
 * Every number in the stylesheet came from `qa/probes/propgrid_probe.cpp`,
 * which builds this panel with wxWidgets and asks it.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render } from '@testing-library/react';
import {
  PropertiesPanel,
  propertiesPanelCaption,
  UNSPECIFIED_GROUP_CAPTION,
} from '@ziroeda/designer/src/widgets/properties_panel.js';
import type { PropertyGridRow } from '@ziroeda/designer/src/widgets/properties_panel.js';

afterEach(cleanup);

type Cmd = { readonly what: string };

/** The rows a selected SCH_SYMBOL produces, trimmed to one per shape. */
const ROWS: PropertyGridRow<Cmd>[] = [
  { group: '', name: 'Pin numbers', kind: 'bool', value: true, set: () => ({ what: 'pn' }) },
  { group: '', name: 'Position X', kind: 'coord', value: 1000, set: () => ({ what: 'x' }) },
  {
    group: '',
    name: 'Orientation',
    kind: 'choice',
    choices: ['0', '90', '180', '270'],
    value: '180',
    set: () => ({ what: 'o' }),
  },
  { group: 'Fields', name: 'Reference', kind: 'string', value: 'J1', set: () => ({ what: 'r' }) },
  { group: 'Fields', name: 'Library Link', kind: 'string', value: 'Connector:Screw' },
  // SCH_SYMBOL's third group, and it is here so the group ORDER is testable:
  // the display order is '', Fields, Attributes, while alphabetical order is
  // '', Attributes, Fields. With only two groups the two agree and no
  // assertion about ordering can fail.
  {
    group: 'Attributes',
    name: 'Do not Populate',
    kind: 'bool',
    value: false,
    set: () => ({ what: 'dnp' }),
  },
];

const panel = (rows = ROWS, count = 1, name: string | undefined = 'Symbol') =>
  render(
    <PropertiesPanel<Cmd>
      selectionCount={count}
      friendlyName={name}
      rows={rows}
      fmt={(iu) => `${iu / 1000} mils`}
      parse={(t) => (Number.isFinite(Number(t)) ? Number(t) * 1000 : null)}
      onCommand={() => {}}
    />,
  );

const texts = (root: HTMLElement, sel: string): string[] =>
  Array.from(root.querySelectorAll(sel)).map((e) => e.textContent ?? '');

describe('the caption is the item type, above the grid', () => {
  it('renders one caption element carrying GetFriendlyName()', () => {
    const { container } = panel();
    const caps = container.querySelectorAll('.ze-pgrid-caption');
    expect(caps).toHaveLength(1);
    expect(caps[0]!.textContent).toBe('Symbol');
  });

  it('places the caption before the grid, not inside it', () => {
    const { container } = panel();
    const cap = container.querySelector('.ze-pgrid-caption')!;
    const grid = container.querySelector('.ze-pgrid')!;
    expect(grid.contains(cap)).toBe(false);
    expect(cap.compareDocumentPosition(grid) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('says "No objects selected" and shows no rows when nothing is selected', () => {
    const { container } = panel(ROWS, 0, undefined);
    expect(container.querySelector('.ze-pgrid-caption')!.textContent).toBe('No objects selected');
    expect(container.querySelectorAll('.ze-pgrid-row')).toHaveLength(0);
  });

  it('counts a multi-selection', () => {
    expect(propertiesPanelCaption(3, 'Symbol')).toBe('3 objects selected');
    expect(propertiesPanelCaption(0)).toBe('No objects selected');
    expect(propertiesPanelCaption(1, 'Wire')).toBe('Wire');
  });
});

describe('groups are collapsible wxPropertyCategory rows', () => {
  it('captions the unnamed group "Basic Properties" and names the rest as given', () => {
    const { container } = panel();
    expect(texts(container, '.ze-pgrid-cat-label')).toEqual([
      UNSPECIFIED_GROUP_CAPTION,
      'Fields',
      'Attributes',
    ]);
  });

  it('puts each row under its own group', () => {
    const { container } = panel();
    const order = Array.from(container.querySelectorAll('.ze-pgrid-cat-label, .ze-pgrid-name')).map(
      (e) => e.textContent,
    );
    expect(order).toEqual([
      'Basic Properties',
      'Pin numbers',
      'Position X',
      'Orientation',
      'Fields',
      'Reference',
      'Library Link',
      'Attributes',
      'Do not Populate',
    ]);
  });

  it('gives every category a twisty', () => {
    const { container } = panel();
    expect(container.querySelectorAll('.ze-pgrid-cat .ze-pgrid-twisty')).toHaveLength(3);
    expect(container.querySelectorAll('.ze-pgrid-twisty.open')).toHaveLength(3);
  });

  it('collapses only the category that was clicked', () => {
    const { container } = panel();
    const cats = container.querySelectorAll('.ze-pgrid-cat');
    fireEvent.click(cats[0]!);
    expect(texts(container, '.ze-pgrid-name')).toEqual([
      'Reference',
      'Library Link',
      'Do not Populate',
    ]);
    // Every category is still listed; only the one clicked lost its rows.
    expect(container.querySelectorAll('.ze-pgrid-cat')).toHaveLength(3);
    fireEvent.click(container.querySelectorAll('.ze-pgrid-cat')[0]!);
    expect(texts(container, '.ze-pgrid-name')).toEqual([
      'Pin numbers',
      'Position X',
      'Orientation',
      'Reference',
      'Library Link',
      'Do not Populate',
    ]);
  });
});

describe('a value cell is a grid cell, not a permanently-rendered control', () => {
  it('draws a writeable text row as text with no control', () => {
    const { container } = panel();
    const cell = Array.from(container.querySelectorAll('.ze-pgrid-row')).find(
      (r) => r.querySelector('.ze-pgrid-name')!.textContent === 'Reference',
    )!;
    expect(cell.querySelector('.ze-pgrid-value')!.textContent).toBe('J1');
    expect(cell.querySelectorAll('input, select, textarea')).toHaveLength(0);
  });

  it('draws a choice row as its label, not as a dropdown', () => {
    const { container } = panel();
    const cell = Array.from(container.querySelectorAll('.ze-pgrid-row')).find(
      (r) => r.querySelector('.ze-pgrid-name')!.textContent === 'Orientation',
    )!;
    expect(cell.querySelector('.ze-pgrid-value')!.textContent).toBe('180');
    expect(cell.querySelectorAll('select')).toHaveLength(0);
  });

  it('has no control anywhere in the grid except the bool row', () => {
    const { container } = panel();
    const controls = Array.from(container.querySelectorAll('.ze-pgrid input, .ze-pgrid select'));
    expect(controls.map((c) => (c as HTMLInputElement).type)).toEqual(['checkbox', 'checkbox']);
  });

  it('builds a text editor only once the cell is activated', () => {
    const { container } = panel();
    const cell = Array.from(container.querySelectorAll('.ze-pgrid-row')).find(
      (r) => r.querySelector('.ze-pgrid-name')!.textContent === 'Reference',
    )!;
    fireEvent.click(cell.querySelector('.ze-pgrid-text')!);
    const editor = cell.querySelector('input.ze-pgrid-editor') as HTMLInputElement;
    expect(editor).not.toBeNull();
    expect(editor.value).toBe('J1');
  });

  it('builds the combo only once a choice cell is activated', () => {
    const { container } = panel();
    const cell = Array.from(container.querySelectorAll('.ze-pgrid-row')).find(
      (r) => r.querySelector('.ze-pgrid-name')!.textContent === 'Orientation',
    )!;
    fireEvent.click(cell.querySelector('.ze-pgrid-text')!);
    const editor = cell.querySelector('select.ze-pgrid-editor') as HTMLSelectElement;
    expect(editor).not.toBeNull();
    expect(Array.from(editor.options).map((o) => o.value)).toEqual(['0', '90', '180', '270']);
  });

  it('keeps the checkbox a bool row draws at rest — PG_CHECKBOX_EDITOR::DrawValue', () => {
    const { container } = panel();
    const cell = Array.from(container.querySelectorAll('.ze-pgrid-row')).find(
      (r) => r.querySelector('.ze-pgrid-name')!.textContent === 'Pin numbers',
    )!;
    const box = cell.querySelector('input.ze-pgrid-check') as HTMLInputElement;
    expect(box).not.toBeNull();
    expect(box.checked).toBe(true);
    expect(box.disabled).toBe(false);
  });

  it('renders a distance through the frame’s unit conversion', () => {
    const { container } = panel();
    const cell = Array.from(container.querySelectorAll('.ze-pgrid-row')).find(
      (r) => r.querySelector('.ze-pgrid-name')!.textContent === 'Position X',
    )!;
    expect(cell.querySelector('.ze-pgrid-value')!.textContent).toBe('1 mils');
  });
});

describe('read-only rows', () => {
  it('marks the row so its VALUE greys, and does not activate on click', () => {
    const { container } = panel();
    const rows = Array.from(container.querySelectorAll('.ze-pgrid-row'));
    const ro = rows.find((r) => r.querySelector('.ze-pgrid-name')!.textContent === 'Library Link')!;
    const rw = rows.find((r) => r.querySelector('.ze-pgrid-name')!.textContent === 'Reference')!;
    expect(ro.hasAttribute('data-readonly')).toBe(true);
    expect(rw.hasAttribute('data-readonly')).toBe(false);
    fireEvent.click(ro.querySelector('.ze-pgrid-text')!);
    expect(ro.querySelectorAll('input, select')).toHaveLength(0);
  });

  it('disables a read-only checkbox rather than dropping it', () => {
    const { container } = panel([
      { group: '', name: 'Mirror X', kind: 'bool', value: false },
      ...ROWS,
    ]);
    const box = container.querySelector('input.ze-pgrid-check') as HTMLInputElement;
    expect(box.disabled).toBe(true);
  });
});

describe('the stylesheet states what wxPropertyGrid decides, and nothing else', () => {
  const css = readFileSync(
    resolve(process.cwd(), '../designer/src/widgets/properties_panel.css'),
    'utf8',
  );
  /** The rules, with the comments (which quote KiCad and carry hex samples) cut out. */
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');

  it('lives beside its widget rather than in ui/shell.css', () => {
    const shell = readFileSync(resolve(process.cwd(), '../designer/src/ui/shell.css'), 'utf8');
    expect(shell).not.toContain('.ze-pgrid');
  });

  it('pins the measured row pitch: GetRowHeight() is 25', () => {
    expect(rules).toContain('--pgrid-row-height: 25px;');
  });

  it('pins the measured margin gutter: GetMarginWidth() is 15', () => {
    expect(rules).toContain('--pgrid-margin-width: 15px;');
  });

  it('pins wxPG_XBEFORETEXT, which the __WXGTK__ block sets to 5', () => {
    expect(rules).toContain('--pgrid-text-inset: 5px;');
  });

  it('pins CenterSplitter(): the name/value split is at half the width', () => {
    expect(rules).toContain('--pgrid-splitter: 50%;');
  });

  it('takes every colour from a shared token — no hex, no rgb() literal', () => {
    expect(rules).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(rules).not.toMatch(/\brgba?\(/);
  });

  it('greys the value of a read-only row, and only the value', () => {
    // PG_CELL_RENDERER::Render swaps the foreground for `aColumn > 0` only.
    expect(rules).toContain(
      '.ze-pgrid-row[data-readonly] .ze-pgrid-value {\n  color: var(--ctl-fg-disabled);\n}',
    );
    expect(rules).not.toContain('[data-readonly] .ze-pgrid-name');
  });

  it('draws no box round a value cell: the splitter is its only edge', () => {
    const cell = rules.slice(rules.indexOf('.ze-pgrid-value {'));
    const body = cell.slice(0, cell.indexOf('}'));
    expect(body).toContain('border-left: 1px solid var(--content-bg);');
    expect(body).not.toMatch(/^\s*border(-radius|-top|-right|-bottom)?:/m);
    expect(body).not.toContain('background');
  });

  it('states no font, so the panel keeps the shell’s wxSYS_DEFAULT_GUI_FONT', () => {
    // KIUI::GetDockedPaneFont is getGUIFont( win, 0 ) off macOS, which is what
    // --ui-font-size already carries; restating it is the specificity trap.
    expect(rules).not.toContain('font-size:');
    expect(rules).not.toContain('font-family:');
    // The one `font:` there is belongs to the cell editor, and it says
    // `inherit` — the control must take the grid's font, not the UA's.
    expect(rules.match(/\bfont:\s*[^;]+;/g)).toEqual(['font: inherit;']);
  });
});

/*
 * The two fields pcbnew's subclass needed, exercised through rows of the shape
 * pcbnew's `pcbPropertiesFor` actually emits. `ROWS` above is eeschema-shaped,
 * so both editors' row shapes go through this one widget here — which is the
 * point: "right in one, wrong in the other" is what a shared widget invites.
 */
const PCB_ROWS: PropertyGridRow<Cmd>[] = [
  // PCB_PROPERTIES_PANEL::createPGProperty makes every PCB_LAYER_ID property a
  // PGPROPERTY_COLORENUM, so a Layer row carries a colour AND a choice list.
  {
    group: '',
    name: 'Layer',
    kind: 'choice',
    choices: ['F.Cu', 'B.Cu'],
    value: 'F.Cu',
    swatch: '#c83434',
    set: () => ({ what: 'layer' }),
  },
  // PGPROPERTY_DISTANCE over std::optional<int>: no override set.
  {
    group: 'Overrides',
    name: 'Clearance Override',
    kind: 'dist',
    value: null,
    optional: true,
    set: () => ({ what: 'clr' }),
  },
  {
    group: 'Overrides',
    name: 'Thermal Relief Gap',
    kind: 'dist',
    value: 500,
    optional: true,
    set: () => ({ what: 'gap' }),
  },
];

const rowNamed = (container: HTMLElement, name: string): HTMLElement =>
  Array.from(container.querySelectorAll('.ze-pgrid-row')).find(
    (r) => r.querySelector('.ze-pgrid-name')!.textContent === name,
  ) as HTMLElement;

describe('a layer row carries PGPROPERTY_COLORENUM’s colour image', () => {
  it('paints the swatch in the VALUE cell, ahead of the text', () => {
    const { container } = panel(PCB_ROWS, 1, 'Track');
    const value = rowNamed(container, 'Layer').querySelector('.ze-pgrid-value')!;
    const swatch = value.querySelector('.ze-pgrid-swatch') as HTMLElement;
    expect(swatch).not.toBeNull();
    expect(swatch.style.background).toBe('#c83434');
    // OnCustomPaint draws the image, then GetImageOffset shifts the text past
    // it — so the swatch precedes the value text inside the same cell.
    const text = value.querySelector('.ze-pgrid-text')!;
    expect(swatch.compareDocumentPosition(text) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('draws no swatch on a row that has no colour', () => {
    const { container } = panel(PCB_ROWS, 1, 'Track');
    expect(rowNamed(container, 'Clearance Override').querySelector('.ze-pgrid-swatch')).toBeNull();
    // …and none anywhere in an eeschema row set, which has no layer property.
    expect(panel().container.querySelectorAll('.ze-pgrid-swatch')).toHaveLength(0);
  });

  it('keeps the cell an editable enum: the swatch is paint, not a button', () => {
    // PGPROPERTY_COLORENUM is a wxEnumProperty. Its image is drawn by
    // OnCustomPaint and is not a COLOR_SWATCH, which would be a control.
    const { container } = panel(PCB_ROWS, 1, 'Track');
    const cell = rowNamed(container, 'Layer');
    expect(cell.querySelectorAll('button')).toHaveLength(0);
    fireEvent.click(cell.querySelector('.ze-pgrid-text')!);
    const editor = cell.querySelector('select.ze-pgrid-editor') as HTMLSelectElement;
    expect(Array.from(editor.options).map((o) => o.value)).toEqual(['F.Cu', 'B.Cu']);
  });
});

describe('an optional distance is blank when it has no value', () => {
  it('renders an unset override as the empty string, not as 0', () => {
    // PGPROPERTY_DISTANCE::DistanceToString returns wxEmptyString for an empty
    // std::optional<int>. `fmt` must not be reached at all: this panel's fmt
    // would print "0 mils".
    const { container } = panel(PCB_ROWS, 1, 'Pad');
    expect(
      rowNamed(container, 'Clearance Override').querySelector('.ze-pgrid-value')!.textContent,
    ).toBe('');
    expect(
      rowNamed(container, 'Thermal Relief Gap').querySelector('.ze-pgrid-value')!.textContent,
    ).toBe('0.5 mils');
  });

  it('commits the empty string when the cell is cleared', () => {
    // PG_UNIT_EDITOR::GetValueFromControl writes `std::optional<int>()` back
    // when the binder is null, rather than parsing "" as zero.
    const seen: (string | number | boolean)[] = [];
    const rows: PropertyGridRow<Cmd>[] = PCB_ROWS.map((r) =>
      r.name === 'Thermal Relief Gap'
        ? {
            ...r,
            set: (v) => {
              seen.push(v);
              return { what: 'gap' };
            },
          }
        : r,
    );
    const { container } = panel(rows, 1, 'Pad');
    const cell = rowNamed(container, 'Thermal Relief Gap');
    fireEvent.click(cell.querySelector('.ze-pgrid-text')!);
    const editor = cell.querySelector('input.ze-pgrid-editor') as HTMLInputElement;
    fireEvent.change(editor, { target: { value: '  ' } });
    fireEvent.keyDown(editor, { key: 'Enter' });
    expect(seen).toEqual(['']);
  });

  it('still parses a NON-optional distance cell, so an emptied one is refused', () => {
    // `Position X` is a plain PGPROPERTY_COORD: clearing it goes through
    // `parse`, which this panel's parse rejects, and the cell snaps back.
    const seen: (string | number | boolean)[] = [];
    const rows = ROWS.map((r) =>
      r.name === 'Position X'
        ? {
            ...r,
            set: (v: string | number | boolean) => {
              seen.push(v);
              return { what: 'x' };
            },
          }
        : r,
    );
    const { container } = panel(rows, 1, 'Symbol');
    const cell = rowNamed(container, 'Position X');
    fireEvent.click(cell.querySelector('.ze-pgrid-text')!);
    const editor = cell.querySelector('input.ze-pgrid-editor') as HTMLInputElement;
    fireEvent.change(editor, { target: { value: 'nonsense' } });
    fireEvent.keyDown(editor, { key: 'Enter' });
    expect(seen).toEqual([]);
    expect(cell.querySelector('.ze-pgrid-value')!.textContent).toBe('1 mils');
  });
});

describe('the editing rules every launcher relies on', () => {
  it('commits on Enter and on blur, and abandons on Escape', () => {
    const seen: (string | number | boolean)[] = [];
    const rows = ROWS.map((r) =>
      r.name === 'Reference'
        ? {
            ...r,
            set: (v: string | number | boolean) => {
              seen.push(v);
              return { what: 'r' };
            },
          }
        : r,
    );
    const open = (container: HTMLElement): HTMLInputElement => {
      const cell = rowNamed(container, 'Reference');
      fireEvent.click(cell.querySelector('.ze-pgrid-text')!);
      return cell.querySelector('input.ze-pgrid-editor') as HTMLInputElement;
    };

    const a = panel(rows, 1, 'Symbol').container;
    const e1 = open(a);
    fireEvent.change(e1, { target: { value: 'R9' } });
    fireEvent.keyDown(e1, { key: 'Enter' });
    expect(seen).toEqual(['R9']);

    const b = panel(rows, 1, 'Symbol').container;
    const e2 = open(b);
    fireEvent.change(e2, { target: { value: 'R8' } });
    fireEvent.blur(e2);
    expect(seen).toEqual(['R9', 'R8']);

    // Escape closes the editor, commits nothing, and puts the CELL back to the
    // value it had — an editor that only stopped editing would leave "R7"
    // in its draft and show it again on the next click.
    const c = panel(rows, 1, 'Symbol').container;
    const cell = rowNamed(c, 'Reference');
    const e3 = open(c);
    fireEvent.change(e3, { target: { value: 'R7' } });
    fireEvent.keyDown(e3, { key: 'Escape' });
    expect(seen).toEqual(['R9', 'R8']);
    expect(cell.querySelector('.ze-pgrid-value')!.textContent).toBe('J1');
    fireEvent.click(cell.querySelector('.ze-pgrid-text')!);
    expect((cell.querySelector('input.ze-pgrid-editor') as HTMLInputElement).value).toBe('J1');
  });

  it('swallows keys inside a cell editor, so the canvas hotkeys do not fire', () => {
    // The canvas binds bare letters (R rotates, Delete deletes). Typing a net
    // name into a grid cell must not reach it.
    for (const rows of [ROWS, PCB_ROWS]) {
      const { container } = panel(rows, 1, 'Item');
      const cell = rowNamed(container, rows === ROWS ? 'Reference' : 'Layer');
      fireEvent.click(cell.querySelector('.ze-pgrid-text')!);
      const editor = cell.querySelector('.ze-pgrid-editor') as HTMLElement;
      let reachedCanvas = false;
      const spy = (): void => {
        reachedCanvas = true;
      };
      // React 18 delegates to the render container, so the listener has to sit
      // OUTSIDE it — that is where the canvas's own document-level hotkey
      // handler sits too.
      document.addEventListener('keydown', spy);
      editor.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'r', bubbles: true, cancelable: true }),
      );
      document.removeEventListener('keydown', spy);
      expect(reachedCanvas, rows === ROWS ? 'eeschema row' : 'pcbnew row').toBe(false);
      cleanup();
    }
  });
});

describe('the private pcbnew copy of this widget is gone', () => {
  const shell = readFileSync(resolve(process.cwd(), '../designer/src/ui/shell.css'), 'utf8');

  it('leaves no .ze-pg* rules behind in ui/shell.css', () => {
    // PcbEditor.tsx drew its own grid with `PgCat`/`PgRow`/`PgEdit` styled by
    // `.ze-pg*`; the eeschema panel before it left `.ze-propgrid*`. Both are
    // dead, and dead CSS is what the next copy gets built out of.
    expect(shell).not.toMatch(/^\.ze-pg[\s.:{,]/m);
    expect(shell).not.toContain('.ze-pg-');
    expect(shell).not.toContain('.ze-propgrid');
  });

  it('leaves no Pg* components in PcbEditor.tsx', () => {
    const pcb = readFileSync(
      resolve(process.cwd(), '../designer/src/editors/pcb/PcbEditor.tsx'),
      'utf8',
    );
    for (const sym of ['PgCat', 'PgRow', 'PgRO', 'PgCheck', 'PgLayer', 'PgEdit', 'PgChoice'])
      expect(pcb, sym).not.toContain(sym);
    expect(pcb).not.toContain('PcbSelectionInfo');
    expect(pcb).toContain('<PcbPropertiesPanel');
  });
});
