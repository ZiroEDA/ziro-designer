// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Board Setup > Board Stackup > Physical Stackup — `PANEL_SETUP_BOARD_STACKUP`
 * (`pcbnew/board_stackup_manager/panel_board_stackup.cpp`).
 *
 * Which cells a row draws is not one predicate, it is four, and they cover
 * different sets of layer types (`board_stackup.cpp:277-319`):
 *
 *     IsMaterialEditable()  dielectric | soldermask | silkscreen
 *     IsThicknessEditable() dielectric | soldermask | copper
 *     IsColorEditable()     dielectric | soldermask | silkscreen
 *     HasEpsilonRValue()    dielectric | soldermask
 *
 * Copper is in the thickness set and NOT the material set; silkscreen is the
 * other way round. Ours had both of those wrong, which is invisible to any
 * check that only counts columns — so these assert per row, by layer name.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { useState, type JSX } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import {
  PanelPcbStackup,
  defaultPhysicalStackup,
  type PhysicalStackup,
} from '@ziroeda/designer/src/editors/pcb/dialogs/panels/panel_pcb_stackup.js';
import {
  applyBoardFileSetup,
  writeBoardFileSetup,
} from '@ziroeda/designer/src/editors/pcb/board_file_settings.js';
import { defaultBoardSetup } from '@ziroeda/designer/src/editors/pcb/board_settings.js';
import { fitFloor } from '@ziroeda/designer/src/ui/paged_dialog_size.js';

afterEach(cleanup);

function Harness({ initial }: { initial: PhysicalStackup }): JSX.Element {
  const [v, setV] = useState(initial);
  return <PanelPcbStackup value={v} onChange={setV} />;
}

/** The grid cells of the row whose Id cell reads `name`. */
function cellsOf(name: string): HTMLElement[] {
  const cells = [...document.querySelectorAll('.ze-stackup-grid > div')];
  const idIdx = cells.findIndex((c) => c.textContent === name);
  if (idIdx === -1) throw new Error(`no stackup row named ${name}`);
  // The Id cell is the 2nd of the row's cells; a row is one repeat of the grid.
  return cells.slice(idIdx - 1, idIdx - 1 + 10) as HTMLElement[];
}

const has = (name: string, cellIndex: number): boolean =>
  cellsOf(name)[cellIndex]!.querySelector('input, .ze-combo') !== null;

// Cell order inside a row, from renderRow: swatch, id, type, material,
// material-browse, thickness, lock, color, epsilon, loss-tan, …
const MATERIAL = 3;
const THICKNESS = 5;

describe('which cells each row type draws', () => {
  it('gives copper a thickness and no material', () => {
    // `IsThicknessEditable()` includes BS_ITEM_TYPE_COPPER; `IsMaterialEditable()`
    // does not. This drew a Material field reading "Copper".
    render(<Harness initial={defaultPhysicalStackup()} />);
    expect(has('F.Cu', THICKNESS), 'F.Cu thickness').toBe(true);
    expect(has('F.Cu', MATERIAL), 'F.Cu material').toBe(false);
    expect(has('B.Cu', MATERIAL), 'B.Cu material').toBe(false);
  });

  it('gives silkscreen a material and no thickness', () => {
    // The mirror image: silkscreen is in the material set and not the
    // thickness set. A silkscreen thickness also fed the board-thickness sum.
    render(<Harness initial={defaultPhysicalStackup()} />);
    expect(has('F.Silkscreen', MATERIAL), 'F.Silkscreen material').toBe(true);
    expect(has('F.Silkscreen', THICKNESS), 'F.Silkscreen thickness').toBe(false);
    expect(has('B.Silkscreen', THICKNESS), 'B.Silkscreen thickness').toBe(false);
  });

  it('gives solder mask both, and solder paste neither', () => {
    render(<Harness initial={defaultPhysicalStackup()} />);
    expect(has('F.Mask', MATERIAL)).toBe(true);
    expect(has('F.Mask', THICKNESS)).toBe(true);
    expect(has('F.Paste', MATERIAL), 'F.Paste material').toBe(false);
    expect(has('F.Paste', THICKNESS), 'F.Paste thickness').toBe(false);
  });
});

describe('the Type cell', () => {
  it('is a Core/PrePreg choice on a dielectric row and text elsewhere', () => {
    // `panel_board_stackup.cpp:828-840` — a wxChoice for a dielectric's main
    // row, a wxStaticText for every other layer. All of them were text, so the
    // one editable Type cell on the page could not be changed.
    render(<Harness initial={defaultPhysicalStackup()} />);
    const diel = cellsOf('Dielectric 1')[2]!;
    expect(diel.querySelector('.ze-combo')).not.toBeNull();
    expect(diel.querySelector('.ze-combo-shown')?.textContent).toBe('Core');

    expect(cellsOf('F.Cu')[2]!.querySelector('.ze-combo')).toBeNull();
    expect(cellsOf('F.Cu')[2]!.textContent).toBe('Copper');
  });

  it('labels the second entry PrePreg, which is not the stored value', () => {
    // `m_core_prepreg_choice` is "Core" / "PrePreg" (`:121-122`) while
    // SetTypeName stores KEY_CORE / KEY_PREPREG.
    const s = defaultPhysicalStackup();
    s.layers = s.layers.map((l) => (l.type === 'Core' ? { ...l, type: 'Prepreg' } : l));
    render(<Harness initial={s} />);
    expect(cellsOf('Dielectric 1')[2]!.querySelector('.ze-combo-shown')?.textContent).toBe(
      'PrePreg',
    );
  });
});

describe('board thickness from stackup', () => {
  const readField = (): string =>
    (screen.getByLabelText('Board thickness from stackup') as HTMLInputElement).value;

  it('carries its unit in the field and trims trailing zeros', () => {
    // `StringFromValue( thickness, true )` (`:590-594`) — "1.6 mm", not
    // "1.620" beside a separate mm label.
    render(<Harness initial={defaultPhysicalStackup()} />);
    expect(readField()).toMatch(/^[\d.]+ mm$/);
    expect(readField()).not.toMatch(/0 mm$/);
  });

  it('sums only the thickness-editable rows', () => {
    // `GetBoardThickness()` adds a row only when `IsThicknessEditable()`
    // (`board_stackup.cpp:498-515`), so a stale thickness on a silkscreen or
    // paste row must not reach it.
    const s = defaultPhysicalStackup();
    const before = s.layers.reduce(
      (a, l) => a + (l.type === 'Copper' || l.type === 'Core' ? l.thicknessMM : 0),
      0,
    );
    s.layers = s.layers.map((l) =>
      l.type.includes('Silk Screen') || l.type.includes('Solder Paste')
        ? { ...l, thicknessMM: 5 }
        : l,
    );
    render(<Harness initial={s} />);
    // Five 5mm phantom layers would be unmissable; the mask rows still count.
    const shown = Number.parseFloat(readField());
    expect(shown).toBeLessThan(before + 1);
  });
});

describe('the option and thickness bars are single wx rows', () => {
  it('puts two growable spacers in the top bar', () => {
    // `bTopSizer` adds `40, 0, 1, wxEXPAND` before AND after the checkbox
    // (`panel_board_stackup_base.cpp:37`, `:46`); only one was here.
    render(<Harness initial={defaultPhysicalStackup()} />);
    const bar = document.querySelector('.ze-stackup-bar')!;
    expect(bar.querySelectorAll(':scope > .ze-stackup-spacer')).toHaveLength(2);
  });

  it('puts the bottom bar spacer between Adjust and Export', () => {
    // `bBottomSizer`: value, fixed 10px, Adjust, growable spacer, Export
    // (`:139-148`) — which is what holds Export hard right on its own.
    render(<Harness initial={defaultPhysicalStackup()} />);
    const bars = document.querySelectorAll('.ze-stackup-bar');
    const bottom = bars[bars.length - 1]!;
    const kids = [...bottom.children];
    const adjust = kids.findIndex((k) => k.textContent === 'Adjust Dielectric Thickness');
    const spacer = kids.findIndex((k) => k.classList.contains('ze-stackup-spacer'));
    const exportBtn = kids.findIndex((k) => k.textContent === 'Export to Clipboard');
    expect(adjust).toBeGreaterThan(-1);
    expect(spacer).toBeGreaterThan(adjust);
    expect(exportBtn).toBeGreaterThan(spacer);
    // and the fixed 10px gap sits before Adjust, not after.
    expect(kids.findIndex((k) => k.classList.contains('ze-stackup-gap10'))).toBeLessThan(adjust);
  });
});

describe('the board thickness written to the file', () => {
  const BOARD = `(kicad_pcb (version 20241229) (generator "test")
  (general (thickness 1.6))
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (25 "Edge.Cuts" user))
  (setup)
)`;

  const thicknessIn = (text: string): number =>
    Number(/\(thickness ([\d.]+)/.exec(text)?.[1] ?? Number.NaN);

  it('includes a dielectric’s sublayers, not just its main layer', () => {
    // `GetBoardThickness()` adds the row, then loops
    // `for( idx = 1; idx < GetSublayersCount(); idx++ ) thickness += GetThickness( idx )`
    // (`board_stackup.cpp:502-512`). A writer that summed only main layers
    // under-reported every board with an added dielectric sublayer.
    const s = defaultBoardSetup();
    applyBoardFileSetup(BOARD, s);

    const plain = thicknessIn(writeBoardFileSetup(BOARD, s)!);

    s.physicalStackup.layers = s.physicalStackup.layers.map((l) =>
      l.type === 'Core' || l.type === 'Prepreg'
        ? { ...l, sublayers: [{ material: 'PTFE', thicknessMM: 0.25 }] }
        : l,
    );
    const withSub = thicknessIn(writeBoardFileSetup(BOARD, s)!);

    expect(withSub).toBeCloseTo(plain + 0.25, 6);
  });

  it('leaves a silkscreen thickness out of it', () => {
    const s = defaultBoardSetup();
    applyBoardFileSetup(BOARD, s);
    const before = thicknessIn(writeBoardFileSetup(BOARD, s)!);

    s.physicalStackup.layers = s.physicalStackup.layers.map((l) =>
      l.type.includes('Silk Screen') ? { ...l, thicknessMM: 1 } : l,
    );
    expect(thicknessIn(writeBoardFileSetup(BOARD, s)!)).toBeCloseTo(before, 6);
  });
});

describe('the Layer column swatch', () => {
  const swatchOf = (name: string): HTMLElement =>
    cellsOf(name)[0]!.querySelector('.ze-stackup-swatch') as HTMLElement;

  it('draws one for EVERY row, including copper and paste', () => {
    // `lazyBuildRowUI` inserts the wxStaticBitmap unconditionally
    // (`panel_board_stackup.cpp:807-810`). This drew one only where
    // `IsColorEditable()` was true, so copper and paste rows came out blank —
    // and those are precisely the types with a fixed colour of their own.
    render(<Harness initial={defaultPhysicalStackup()} />);
    for (const row of ['F.Silkscreen', 'F.Paste', 'F.Mask', 'F.Cu', 'Dielectric 1', 'B.Cu'])
      expect(swatchOf(row), row).not.toBeNull();
  });

  it('uses getColorIconItem’s three fixed colours, not the Color cell', () => {
    // [data] `copperColor( 220, 180, 30 )`, `dielectricColor( 75, 120, 75 )`,
    // `pasteColor( 200, 200, 200 )` (`:69-71`).
    render(<Harness initial={defaultPhysicalStackup()} />);
    expect(swatchOf('F.Cu').style.background).toBe('rgb(220, 180, 30)');
    expect(swatchOf('B.Cu').style.background).toBe('rgb(220, 180, 30)');
    expect(swatchOf('Dielectric 1').style.background).toBe('rgb(75, 120, 75)');
    expect(swatchOf('F.Paste').style.background).toBe('rgb(200, 200, 200)');
  });

  it('follows the Color cell only for mask and silkscreen', () => {
    // `case BS_ITEM_TYPE_SOLDERMASK/SILKSCREEN: color = GetSelectedColor( aRow )`.
    const s = defaultPhysicalStackup();
    s.layers = s.layers.map((l) =>
      l.name === 'F.Mask' ? { ...l, color: 'Red' } : l.name === 'F.Cu' ? { ...l, color: 'Red' } : l,
    );
    render(<Harness initial={s} />);
    expect(swatchOf('F.Mask').style.background).toBe('rgb(128, 0, 0)');
    // Copper ignores its Color cell entirely.
    expect(swatchOf('F.Cu').style.background).toBe('rgb(220, 180, 30)');
  });
});

describe('fitFloor — Fit() then IncTo(minSize)', () => {
  it('grows the dialog by the width the content did not get', () => {
    // Board Setup states 980; the stackup page's top row needs ~1070, and wx
    // answers that by growing the window, not by clipping it.
    expect(fitFloor({ width: 980, height: 600 }, 1070, 980, { w: 0, h: 0 })).toEqual({
      w: 1070,
      h: 600,
    });
  });

  it('does not shrink below a floor it has already reached', () => {
    // `IncTo` is a componentwise max.
    expect(fitFloor({ width: 800, height: 500 }, 800, 800, { w: 1070, h: 600 })).toEqual({
      w: 1070,
      h: 600,
    });
  });

  it('ignores a deliberate scroller, which reports no shortfall of its own', () => {
    // The stackup grid lives in a wxScrolledWindow with wxHSCROLL; its overflow
    // is internal and the dialog element's scrollWidth equals its clientWidth.
    expect(fitFloor({ width: 980, height: 600 }, 980, 980, { w: 0, h: 0 })).toEqual({
      w: 980,
      h: 600,
    });
  });

  it('never treats a negative difference as a shrink', () => {
    expect(fitFloor({ width: 980, height: 600 }, 900, 980, { w: 0, h: 0 }).w).toBe(980);
  });
});

describe('only the grid scrolls, not the page', () => {
  // `bMainSizer` holds bTopSizer, the scrolled window, and bBottomSizer as
  // siblings: the two bars are NOT inside the thing that scrolls
  // (`panel_board_stackup_base.cpp:19-56`, `:126-152`). A scroller wrapped
  // around the whole page takes them with it, which is what put "Copper
  // layers:" and "Board thickness from" off the left edge.
  const css = readFileSync(join(__dirname, '../../../designer/src/ui/shell.css'), 'utf8');
  const ruleFor = (selector: string): string => {
    const at = css.indexOf(`\n${selector} {`);
    if (at === -1) throw new Error(`no rule for ${selector}`);
    return css.slice(at, css.indexOf('}', at));
  };

  it('does not let a page be squeezed below its unscrolled chrome', () => {
    // `min-width: 0` here is what made the shortfall unmeasurable: the box
    // shrank and scrolled instead of pushing the dialog wider.
    const rule = ruleFor('.ze-paged-panel');
    expect(rule).toContain('min-width: min-content');
    expect(rule).not.toMatch(/min-width:\s*0/);
  });

  it('keeps the grid as the one deliberate scroller, claiming no width', () => {
    // `m_scGridWin` is created `wxHSCROLL|wxVSCROLL`, so it scrolls in both
    // axes and imposes no width on the page — that is why a real Board Setup
    // is ~1070 wide and not the ~1280 the twelve columns need.
    const rule = ruleFor('.ze-stackup-scroll');
    expect(rule).toMatch(/overflow:\s*auto/);
    // `min-width: 0` is NOT sufficient and was the wrong fix on its own: it is
    // a LOWER bound, so `.ze-paged-panel`'s min-content walk still reached the
    // grid's 1050 px of columns. `contain: inline-size` is what makes this
    // box's intrinsic width independent of its contents — a wxScrolledWindow's
    // best size, not its virtual size.
    expect(rule).toMatch(/contain:\s*inline-size/);
  });

  it('does not let the grid columns set the dialog width', () => {
    // The regression this pins, in numbers: GRID_COLS sums to 1006 px and the
    // eleven 4 px gaps add 44, so a grid that reached the dialog would demand
    // ~1050 px of page on its own — the ~300 px of extra dialog that showed up.
    const panel = readFileSync(
      join(__dirname, '../../../designer/src/editors/pcb/dialogs/panels/panel_pcb_stackup.tsx'),
      'utf8',
    );
    const cols = /const GRID_COLS = '([^']+)'/.exec(panel)?.[1] ?? '';
    const total = cols
      .split(/\s+/)
      .map((c) => Number.parseInt(c, 10))
      .reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(1000);
    // …so the scroller must be the thing that absorbs it.
    expect(ruleFor('.ze-stackup-scroll')).toMatch(/contain:\s*inline-size/);
  });

  it('never wraps either bar', () => {
    // A wxBoxSizer( wxHORIZONTAL ) has no second line.
    expect(ruleFor('.ze-stackup-bar')).toContain('flex-wrap: nowrap');
  });
});
