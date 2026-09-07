// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Text Box Properties dialog, against `dialog_textbox_properties_base.cpp`.
 *
 * wxFormBuilder generates that file, so every control below is a declaration in
 * a checked-in file rather than a judgement call. Four things this pins, all of
 * which were wrong:
 *
 *  - **No group boxes.** `bMainSizer` is vertical: the multi-line control, a
 *    "Syntax help" link, `Locked`, then one `wxGridBagSizer`. This dialog had
 *    invented Text / Font / Alignment / Border fieldsets and put a four-line
 *    text area in the corner of the first one.
 *  - **The formatting bar is the shared one.** KiCad assembles the same
 *    `FONT_CHOICE` + `BITMAP_BUTTON` row into every dialog that edits text;
 *    ours had spelled it out as two checkboxes and two dropdowns.
 *  - **Knockout and the four margins are not in this dialog.** They are
 *    `PCB_TEXTBOX`'s property-manager entries (`pcb_textbox.cpp:871,893-900`),
 *    so they belong to the Properties panel. They were invented controls.
 *  - **Orientation is a combo**, `m_OrientCtrl` being a `wxComboBox`, not a
 *    free-text angle field.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(`../../../designer/src/${rel}`, import.meta.url)), 'utf8');

const DIALOG = read('editors/pcb/dialogs/dialog_textbox_properties.tsx');
const CSS = read('ui/shell.css');
/** The file's own header names the invented controls to explain them. */
const code = DIALOG.slice(DIALOG.indexOf('*/') + 2);

describe('the controls the base file declares', () => {
  it('has the multi-line text control and the syntax help link', () => {
    expect(code).toContain('<textarea');
    expect(code).toContain('Syntax help');
    // `m_syntaxHelp` is a wxHyperlinkCtrl, so it wears the shared class.
    expect(code).toContain('ze-hyperlink');
  });

  it('has Locked, Layer, Orientation, the three sizes and the three border rows', () => {
    for (const label of [
      'Locked',
      'Layer:',
      'Orientation:',
      'Text width:',
      'Text height:',
      'Thickness:',
      'Border',
      'Border width:',
      'Border style:',
    ])
      expect(code).toContain(label);
  });

  it('makes Orientation a combo, not a free-text angle', () => {
    // `m_OrientCtrl` is a wxComboBox seeded with the four right angles.
    expect(code).toContain('ORIENTATIONS');
    expect(DIALOG).toMatch(/const ORIENTATIONS = \['0', '90', '180', '270'\]/);
  });
});

describe('what the dialog must NOT have', () => {
  it('drops the four group boxes it had invented', () => {
    expect(code).not.toContain('<fieldset');
    expect(code).not.toContain('<legend');
  });

  it('drops Knockout, which is a property-manager entry', () => {
    expect(code).not.toContain('Knockout');
    expect(code).not.toContain('knockout');
  });

  it('drops the four margins, which are property-manager entries too', () => {
    for (const m of ['marginLeft', 'marginTop', 'marginRight', 'marginBottom'])
      expect(code).not.toContain(m);
  });

  it('uses no native select — every combo here is a wx control', () => {
    expect(code).not.toContain('<select');
  });
});

describe('the shared pieces it reuses', () => {
  it('takes the formatting bar rather than restating it', () => {
    expect(code).toContain('<TextFormatBar');
    // The bar's own buttons must not be re-implemented here — the dialog hands
    // it state and takes callbacks, and builds no button of its own. (It still
    // mentions `onBold`, which is how it hands that state over.)
    expect(code).not.toContain('<IconButton');
    expect(code).not.toContain('text_bold');
    expect(code).not.toContain('text_italic');
    // …and the alignment axes are the bar's buttons, not two dropdowns.
    expect(code).not.toContain('Horizontal:');
    expect(code).not.toContain('Vertical:');
  });

  it('ends the bar with mirrored, which is what pcbnew bars do', () => {
    // `m_mirrored` is the last BITMAP_BUTTON on pcbnew's bars; eeschema spends
    // that slot on the horizontal/vertical pair instead.
    expect(code).toContain('onMirrored');
    const bar = read('ui/TextFormatBar.tsx');
    expect(bar).toContain('text_mirrored');
    expect(bar).toContain('onMirrored');
  });

  it('takes the layer combo with its colour swatch, and the shared buttons', () => {
    expect(code).toContain('swatch: layerColor(l)');
    expect(code).toContain('<StdDialogButtons');
    expect(code).not.toContain('ze-modal-footer');
  });

  it('says "Create" while placing, as the OK label', () => {
    // `DIALOG_TEXTBOX_PROPERTIES` is opened from the draw tool before the box
    // exists; cancelling there discards it rather than reverting.
    expect(code).toContain("okLabel: 'Create'");
  });
});

describe('the layout is the stylesheet’s', () => {
  it('gives the text control the top of the dialog, not a corner', () => {
    const rule = /\.ze-tbp-text\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? '';
    expect(rule).toMatch(/min-height:\s*150px/);
    expect(rule).toMatch(/width:\s*100%/);
  });

  it('sizes each gridbag label column by its widest label', () => {
    // A wxGridBagSizer column is the width of its widest member; a stated
    // width is the invention `.ze-pref-row .lbl`'s 150px was.
    const rule = /\.ze-tbp-grid\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? '';
    expect(rule).toMatch(/grid-template-columns:\s*max-content max-content max-content/);
  });
});

describe('the width is KiCad’s, and it is not stated as a dialog width', () => {
  it('states no width for the dialog itself', () => {
    // `dialog_textbox_properties_base.cpp:18` is
    // `SetSizeHints( wxSize( -1,-1 ), wxDefaultSize )` — no size at all. The
    // dialog is as wide as `bMainSizer->Fit( this )` makes it, which is
    // `.ze-modal`'s `width: max-content`. A `width: NNNpx` here would defeat it.
    const rule = /\.ze-textboxprops-dialog\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? '';
    expect(rule).not.toMatch(/(?<!max-)(?<!min-)width:\s*\d+px/);
  });

  it('carries the two control minimums that give it that width instead', () => {
    // m_LayerSelectionCtrl->SetMinSize( wxSize( 175,-1 ) );   (:79)
    // m_borderStyleCombo->SetMinSize( wxSize( 240,-1 ) );     (:233)
    // These are the only two width minimums in the whole base file, and they
    // are what propagates through the gridbag to size the dialog.
    expect(/\.ze-tbp-layer\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? '').toMatch(/min-width:\s*175px/);
    expect(/\.ze-tbp-borderstyle\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? '').toMatch(/min-width:\s*240px/);
    // …and the dialog must actually hand them to those two combos.
    expect(code).toContain('className="ze-tbp-layer"');
    expect(code).toContain('className="ze-tbp-borderstyle"');
  });
});

describe('the tool that opens it wears the right cursor', () => {
  it('is the pencil, like every other graphic-drawing tool', () => {
    // `DRAWING_TOOL::drawShape`'s setCursor is one unconditional line, and the
    // text box is `DrawRectangle`'s `isTextBox` arm, so it goes through it.
    const cursors = read('ui/tool_cursors.ts');
    for (const tool of [
      'drawTextBox',
      'drawLine',
      'drawRectangle',
      'drawCircle',
      'drawArc',
      'drawPolygon',
      'drawZone',
      'drawRuleArea',
    ])
      expect(cursors).toMatch(new RegExp(`${tool}:\\s*'PENCIL'`));
  });
});
