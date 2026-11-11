// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Reference Image Properties, against
 * `pcbnew/dialogs/dialog_reference_image_properties_base.cpp` and the
 * `PANEL_IMAGE_EDITOR` it embeds.
 *
 * Same three defects the other two board text dialogs had, and one more of its
 * own: two invented group boxes (Position and Size) where `bMainSizer` has
 * none, a native `<select>` where upstream has a PCB_LAYER_BOX_SELECTOR, a
 * literal "mm" beside four `UNIT_BINDER`s, hand-made buttons instead of the
 * shared row — and no image preview at all, when half the dialog upstream IS
 * the preview.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(`../../../designer/src/${rel}`, import.meta.url)), 'utf8');

const BASE = read('../../pcbnew/dialogs/dialog_reference_image_properties_base.tsx');
const DIALOG = read('../../pcbnew/dialogs/dialog_reference_image_properties.tsx');
const CSS = read('../../common/widgets/shell.css');
/** Comments are prose, and these files' name the controls they do NOT have. */
const strip = (t: string): string =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const base = strip(BASE);
const code = strip(DIALOG);
// PANEL_IMAGE_EDITOR is common/dialogs' since 09-26, shared with the schematic.
const PANEL = read('../../common/dialogs/panel_image_editor.tsx');
const panelCode = strip(PANEL);

/** Everything CSS says about one selector — see text_properties_dialog.test.ts. */
const rule = (selector: string): string => {
  const esc = selector.replace(/[.*+?^$()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?:^|,)\\s*${esc}\\s*(?:,[^{}]*)?\\{([^}]*)\\}`, 'gm');
  return [...CSS.matchAll(re)].map((m) => m[1]).join('\n');
};

describe('the fields the base file declares, in its order', () => {
  it('names the layer row the way upstream does', () => {
    // `_("Associated layer:")` (`:74`), not "Layer:". The manual uses the same
    // words: "Associated layer controls the layer that the reference image is
    // considered to be on".
    expect(base).toContain("label={_('Associated layer:')}");
  });

  it('puts Height above Width, as rows 3 and 4', () => {
    // `m_HeightLabel` is at `wxGBPosition( 3, 0 )` and `m_WidthLabel` at
    // `( 4, 0 )` (`:54-72`), and the manual lists them "Height, Width, and Scale".
    expect(base).toContain("field(3, p.m_height, 'Height')");
    expect(base).toContain("field(4, p.m_width, 'Width')");
  });

  it('leaves Width’s unit stranded on the layer row, where the file puts it', () => {
    // `m_WidthUnit` is added at `wxGBPosition( 2, 2 )` while its label and
    // control are at row 4 (`:61`). It is a wxFormBuilder oddity and it is what
    // KiCad draws, so it is mirrored rather than tidied.
    expect(base).toContain('unit(2, p.m_width)');
    expect(base).toContain('pos={[2, 1]}');
  });

  it('has the empty row the file sizes, and its gaps', () => {
    // `wxGridBagSizer( 3, 5 )` and `SetEmptyCellSize( wxSize( -1,5 ) )` (`:28`):
    // row 5 is empty and 5 px; Locked is on row 6.
    expect(base).toMatch(/vgap=\{3\}\s+hgap=\{5\}/);
    expect(base).toContain('emptyCellSize={[-1, 5]}');
    expect(base).toContain('pos={[6, 0]} span={[1, 3]}');
  });

  it('states no border on any cell of the gridbag', () => {
    // Not one of its fifteen Add() calls names a border flag: every one is
    // wxALIGN_CENTER_VERTICAL, optionally wxEXPAND, so the 5 they pass is inert.
    const grid = base.slice(base.indexOf('<GridBagSizer'), base.indexOf('</GridBagSizer>'));
    const fn = base.slice(base.indexOf('const field'), base.indexOf('return ('));
    for (const part of [grid, fn]) {
      for (const flag of part.matchAll(/flag=\{([^}]*)\}/g))
        expect(flag[1]!.replace(/CV|wxALIGN_CENTER_VERTICAL|wxEXPAND|\|/g, '').trim()).toBe('');
    }
  });
});

describe('what the dialog must NOT have', () => {
  it('drops the two group boxes it had invented', () => {
    expect(base).not.toContain('StaticBox');
    expect(base).not.toContain('<fieldset');
  });

  it('uses no native select: the layer box is the PCB_LAYER_BOX_SELECTOR, with swatches', () => {
    expect(base).not.toContain('<select');
    expect(code).toContain('new PCB_LAYER_BOX_SELECTOR()');
    expect(code).toContain('swatch: r.swatch ? toCssColor(r.swatch) : undefined');
  });

  it('takes the shared button row rather than two of its own', () => {
    expect(base).toContain('<StdDialogButtonSizer');
    expect(base).not.toContain('ze-modal-footer');
  });

  it('carries no CSS of its own', () => {
    expect(BASE + DIALOG).not.toContain('className=');
    expect(CSS).not.toContain('.ze-refimg');
  });
});

describe('PANEL_IMAGE_EDITOR, which is half the dialog and was absent', () => {
  it('draws the preview at the 300 square its panel asks for', () => {
    // `m_panelDraw->SetMinSize( wxSize( 300,300 ) )`
    // (`panel_image_editor_base.cpp:24`), proportion 1 beside a proportion-0
    // gridbag, so the preview takes the width and the fields take their own.
    const preview = rule('.ze-imgedit-preview');
    expect(preview).toMatch(/min-width:\s*300px/);
    expect(preview).toMatch(/min-height:\s*300px/);
    expect(panelCode).toContain('data:image/png;base64,');
    // And the board dialog embeds the shared panel rather than a copy.
    expect(code).toContain('<PANEL_IMAGE_EDITOR');
  });

  it('shows the PPI as a static text, not a field', () => {
    // `m_stPPI_Value->SetLabel( wxString::Format( "%d", m_workingImage->GetPPI() ) )`
    // (`panel_image_editor.cpp:50`) — set once at construction, so it does not
    // move when the scale does.
    expect(panelCode).toContain('PPI:');
    expect(panelCode).toContain('<span className="ze-imgedit-ppi">{ppi}</span>');
    // m_workingImage->GetPPI(), the working copy's.
    expect(code).toContain('ppi={dialog.m_workingImage.GetPPI()}');
  });

  it('gives Scale no unit label, because its binder is given none', () => {
    // `m_scale( aUnitsProvider, aParent, m_staticTextScale, m_textCtrlScale,
    // nullptr )` (`panel_image_editor.cpp:39`) — a scale factor is unitless,
    // and it is the one field here that is not shown in the frame's units.
    const scaleRow = panelCode.slice(panelCode.indexOf('Scale:'), panelCode.indexOf('PPI:'));
    expect(scaleRow).not.toContain('unitLabel(units)');
  });
});

describe('the four distances follow the frame, as UNIT_BINDERs', () => {
  it('binds them through the unit binder rather than assuming millimetres', () => {
    // `m_posX`, `m_posY`, `m_width`, `m_height`
    // (`dialog_reference_image_properties.cpp:40-43`), each with its label, its
    // control and its unit static text.
    for (const m of ['m_posX', 'm_posY', 'm_width', 'm_height'])
      expect(code).toMatch(new RegExp(`this\\.${m} = new UNIT_BINDER\\(`));
    expect(code).toContain('units: unitLabel(aBinder.GetUnits())');
  });
});
