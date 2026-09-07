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

const DIALOG = read('editors/pcb/dialogs/dialog_reference_image_properties.tsx');
const CSS = read('ui/shell.css');
const EDITOR = read('editors/pcb/PcbEditor.tsx');
const CURSORS = read('editors/pcb/cursors.ts');
/** Comments are prose, and this file's name the controls it does NOT have. */
const code = DIALOG.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

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
    expect(code).toContain('Associated layer:');
  });

  it('puts Height above Width, as rows 3 and 4', () => {
    // `m_HeightLabel` is at `wxGBPosition( 3, 0 )` and `m_WidthLabel` at
    // `( 4, 0 )` (`:54-72`), and the manual lists them "Height, Width, and
    // Scale". This file had Width first.
    expect(rule('.ze-refimg-h-lbl')).toMatch(/grid-row:\s*4;/);
    expect(rule('.ze-refimg-w-lbl')).toMatch(/grid-row:\s*5;/);
  });

  it('leaves Width’s unit stranded on the layer row, where the file puts it', () => {
    // `m_WidthUnit` is added at `wxGBPosition( 2, 2 )` while its label and
    // control are at row 4 (`:61`). It is a wxFormBuilder oddity and it is what
    // KiCad draws, so it is mirrored rather than tidied: `m_width( aParent,
    // m_WidthLabel, m_ModWidth, m_WidthUnit )` binds that control, it does not
    // move it. Tidying it would be a visible divergence.
    expect(rule('.ze-refimg-w-u')).toMatch(/grid-row:\s*3;/);
    expect(rule('.ze-refimg-w-u')).toMatch(/grid-column:\s*3;/);
  });

  it('has the empty row the file sizes, not a collapsed one', () => {
    // Rows 0-4 and 6 are used; row 5 is empty and
    // `SetEmptyCellSize( wxSize( -1,5 ) )` (`:28`) makes it 5 px. A CSS grid
    // gives an empty row no height at all unless the row is stated.
    expect(rule('.ze-refimg-grid')).toMatch(/grid-template-rows:\s*repeat\(5, auto\) 5px auto/);
    expect(rule('.ze-refimg-locked')).toMatch(/grid-row:\s*7;/);
  });

  it('states the 3 and 5 of its gridbag and no border on any cell', () => {
    // `wxGridBagSizer( 3, 5 )`, and not one of its fifteen Add() calls names a
    // border flag — every one is wxALIGN_CENTER_VERTICAL, optionally wxEXPAND —
    // so the 5 they all pass is inert and no cell carries a margin.
    expect(rule('.ze-refimg-grid')).toMatch(/gap:\s*3px 5px/);
    for (const cls of ['.ze-refimg-px-lbl', '.ze-refimg-px-ctl', '.ze-refimg-px-u']) {
      expect(rule(cls), cls).not.toMatch(/margin/);
    }
  });
});

describe('what the dialog must NOT have', () => {
  it('drops the two group boxes it had invented', () => {
    expect(code).not.toContain('<fieldset');
    expect(code).not.toContain('<legend');
  });

  it('uses no native select — the layer combo carries a colour swatch', () => {
    expect(code).not.toContain('<select');
    expect(code).toContain('swatch: layerColor(l)');
  });

  it('takes the shared button row rather than two of its own', () => {
    expect(code).toContain('<StdDialogButtons');
    expect(code).not.toContain('ze-modal-footer');
  });
});

describe('PANEL_IMAGE_EDITOR, which is half the dialog and was absent', () => {
  it('draws the preview at the 300 square its panel asks for', () => {
    // `m_panelDraw->SetMinSize( wxSize( 300,300 ) )`
    // (`panel_image_editor_base.cpp:24`), proportion 1 beside a proportion-0
    // gridbag, so the preview takes the width and the fields take their own.
    const preview = rule('.ze-refimg-preview');
    expect(preview).toMatch(/min-width:\s*300px/);
    expect(preview).toMatch(/min-height:\s*300px/);
    expect(code).toContain('data:image/png;base64,');
  });

  it('shows the PPI as a static text, not a field', () => {
    // `m_stPPI_Value->SetLabel( wxString::Format( "%d", m_workingImage->GetPPI() ) )`
    // (`panel_image_editor.cpp:50`) — set once at construction, so it does not
    // move when the scale does.
    expect(code).toContain('PPI:');
    expect(code).toContain('{pngPPI(image.data)}');
    // Through the shared PNG reader, which is where the pHYs chunk is parsed.
    expect(DIALOG).toContain("from '@ziroeda/common/src/png_meta.js'");
  });

  it('gives Scale no unit label, because its binder is given none', () => {
    // `m_scale( aUnitsProvider, aParent, m_staticTextScale, m_textCtrlScale,
    // nullptr )` (`panel_image_editor.cpp:39`) — a scale factor is unitless,
    // and it is the one field here that is not shown in the frame's units.
    const scaleRow = code.slice(code.indexOf('Scale:'), code.indexOf('PPI:'));
    expect(scaleRow).not.toContain('unitLabel(units)');
  });
});

describe('the four distances follow the frame, as UNIT_BINDERs', () => {
  it('binds them through the unit binder rather than assuming millimetres', () => {
    // `m_posX`, `m_posY`, `m_width`, `m_height`
    // (`dialog_reference_image_properties.cpp:40-43`), each with its label, its
    // control and its unit static text.
    expect(DIALOG).toMatch(/units:\s*StatusUnits/);
    expect(code).toContain('unitLabel(units)');
    expect(code).toContain('stringFromValue(');
    expect(code).toContain('parseUnitValue(');
    expect(code).not.toMatch(/Number\(e\.target\.value\)\s*;[\s\S]{0,80}pcbMmToIU/);
  });
});

describe('the tool, which asks for the file before any click', () => {
  it('primes on activation, as PrimeTool does', () => {
    // `m_toolMgr->PrimeTool( { 0, 0 } )` with `ignorePrimePosition = true`
    // (`drawing_tool.cpp:132-140`). The manual describes the order: "use the
    // button on the right toolbar and browse to the desired reference image
    // file. Click in the canvas to place the image."
    expect(EDITOR).toMatch(/if \(activeTool !== 'placeReferenceImage'\) return;/);
    expect(EDITOR).toContain('chooseImageFile(snapToGrid(cursorRef.current ?? { x: 0, y: 0 }))');
  });

  it('wears MOVING while the image rides the cursor, ARROW before', () => {
    // `if( image ) MOVING else ARROW` (`drawing_tool.cpp:105-112`) — the same
    // two-arm chain the table tool has, so the tool id alone cannot answer it.
    // ARROW is this frame's fallback, which is why `placeReferenceImage` has no
    // entry in the shared table.
    expect(CURSORS).toContain("if (tool === 'placeReferenceImage' && state.imagePlacing)");
    expect(CURSORS).toContain('imagePlacing?: boolean;');
    expect(EDITOR).toContain('{ tableDragging, imagePlacing }');
  });
});
