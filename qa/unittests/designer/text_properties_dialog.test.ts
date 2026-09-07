// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Text Properties dialog, against `dialog_text_properties_base.cpp`.
 *
 * Two separate defects live here, and the first is the one a screenshot shows:
 *
 *  - **The Draw Text tool opened a different dialog.** The board already had a
 *    real `DialogTextProperties` — it is what a double-click on an existing
 *    text opens — but the PLACEMENT path drew a hand-rolled `<div>` with its
 *    own `#2a2c30` background, its own `1px solid #444` border, a
 *    `borderRadius: 4`, a `width: 360` and two bare buttons, holding a textarea
 *    and a static `Layer: F.Cu` line. `DRAWING_TOOL::PlaceText` builds the
 *    PCB_TEXT and opens `DIALOG_TEXT_PROPERTIES` (`drawing_tool.cpp:144`) —
 *    the same dialog, not a smaller second one.
 *  - **That real dialog was not the base file either.** It had three invented
 *    group boxes (Text / Font / Position), a native `<select>` for the layer, a
 *    single-line `<input>` where upstream has a Scintilla control,
 *    Bold/Italic/Mirrored as checkboxes where KiCad has the shared formatting
 *    bar, a free-text Orientation, no Syntax help, and a "Show" checkbox that
 *    upstream HIDES for board text.
 *
 * The heights are measured, not guessed: see `the two heights` below.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(`../../../designer/src/${rel}`, import.meta.url)), 'utf8');

const DIALOG = read('editors/pcb/dialogs/dialog_text_properties.tsx');
const CSS = read('ui/shell.css');
const EDITOR = read('editors/pcb/PcbEditor.tsx');
/**
 * The dialog with every comment stripped.
 *
 * Comments are prose, and this file's are full of the names of the controls it
 * does NOT have — it explains each one. A scan that reads them reports the
 * opposite of the truth, which is what the first draft of this test did.
 */
const code = DIALOG.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/**
 * Everything CSS says about one selector: the bodies of EVERY rule it appears
 * on, concatenated, which is what the browser resolves.
 *
 * Two things make the naive `<selector> {` version wrong here, and both bit.
 * A selector is usually one of several on its rule — `.ze-txt-w-ctl` shares
 * with `.ze-txt-h-ctl` and `.ze-txt-t-ctl`, because the three take the same
 * `Add()` border — and it also appears on MORE than one rule, since the
 * grid-row groups and the column groups cut the table differently. Matching
 * only the first hit returned `grid-row: 7;` for `.ze-tbp-bw-ctl` and missed
 * the height entirely. An empty or partial body passes a `not.toMatch` while
 * checking nothing, so this returns all of it.
 */
const rule = (selector: string): string => {
  const esc = selector.replace(/[.*+?^$()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?:^|,)\\s*${esc}\\s*(?:,[^{}]*)?\\{([^}]*)\\}`, 'gm');
  return [...CSS.matchAll(re)].map((m) => m[1]).join('\n');
};

describe('the controls the base file declares', () => {
  it('has the multi-line control, the syntax link and Locked', () => {
    expect(code).toContain('<textarea');
    expect(code).toContain('Syntax help');
    // `m_syntaxHelp` is a wxHyperlinkCtrl, so it wears the shared class.
    expect(code).toContain('ze-hyperlink');
    expect(code).toContain('Locked');
  });

  it('has the Font row, now that a board text can carry a face', () => {
    // `m_fontLabel` / `m_fontCtrl` at `( 2, 0 )` and `( 2, 1 )`. This was the
    // one control the dialog deliberately went without, because `PcbTextItem`
    // had no `face` for it to edit — see `qa/unittests/pcbnew/font_face.test.ts`.
    expect(code).toContain('Font:');
    expect(code).toContain('<FontChoice');
    expect(code).toContain('face={v.face}');
  });

  it('has Layer, Knockout, the three sizes, both positions and Orientation', () => {
    for (const label of [
      'Layer:',
      'Knockout',
      'Width:',
      'Height:',
      'Thickness:',
      'Position X:',
      'Position Y:',
      'Orientation:',
    ]) {
      expect(code, label).toContain(label);
    }
  });

  it('seeds Orientation with rot_list, to one decimal', () => {
    // `double rot_list[] = { 0.0, 90.0, -90.0, 180.0 }` shown `"%.1f"`
    // (`dialog_text_properties.cpp:220-223`). It was a free-text degrees field.
    expect(DIALOG).toMatch(/const ORIENTATIONS = \[0, 90, -90, 180\]/);
    expect(code).toContain('toFixed(1)');
  });
});

describe('what the dialog must NOT have', () => {
  it('drops the three group boxes it had invented', () => {
    // `bMainSizer` is vertical with no group boxes at all.
    expect(code).not.toContain('<fieldset');
    expect(code).not.toContain('<legend');
  });

  it('drops Show and Keep upright, which upstream hides for a board text', () => {
    // `dialog_text_properties.cpp:161-165` — for anything that is not footprint
    // text it hides `m_SingleLineSizer`, `m_Visible` and `m_KeepUpright`.
    expect(code).not.toContain('Keep upright');
    expect(code).not.toMatch(/>\s*Show\s*</);
    expect(code).not.toContain('Reference designator');
  });

  it('uses no native select — the layer combo carries a colour swatch', () => {
    // `m_LayerSelectionCtrl` is a PCB_LAYER_BOX_SELECTOR.
    expect(code).not.toContain('<select');
    expect(code).toContain('swatch: layerColor(l)');
  });
});

describe('the shared pieces it reuses', () => {
  it('takes the formatting bar rather than restating it as checkboxes', () => {
    expect(code).toContain('<TextFormatBar');
    // pcbnew's bars end with m_mirrored where eeschema's end with the h/v pair.
    expect(code).toContain('mirrored={v.mirrored}');
  });

  it('takes the shared button row, so the order is the platform’s', () => {
    expect(code).toContain('<StdDialogButtons');
    expect(code).not.toContain('ze-modal-footer');
  });

  it('binds every distance through UNIT_BINDER rather than assuming millimetres', () => {
    expect(DIALOG).toMatch(/units:\s*StatusUnits/);
    expect(code).toContain('unitLabel(units)');
    expect(code).toContain('stringFromValue(');
    expect(code).toContain('parseUnitValue(');
    expect(code).toContain('pcbIUScale');
    expect(code).not.toMatch(/Number\(e\.target\.value\)/);
  });
});

describe('the layout is the stylesheet’s, and it is the base file’s gridbag', () => {
  it('is seven columns with BOTH control columns growable', () => {
    // `gbSizer1 = new wxGridBagSizer( 2, 3 )` with `AddGrowableCol( 1 )` AND
    // `AddGrowableCol( 5 )` (`:264-265`) — two growable columns, which is what
    // keeps the halves even, and `SetEmptyCellSize( wxSize( 20,-1 ) )` is the
    // 20 px separator at column 3.
    const grid = rule('.ze-txt-grid');
    expect(grid).toMatch(
      /max-content 1fr max-content\s*\n?\s*20px\s*\n?\s*max-content 1fr max-content/,
    );
    expect(grid).toMatch(/gap:\s*2px 3px/);
  });

  it('places every cell where the base file puts it', () => {
    // A cell that states no row and no column is one the browser is placing,
    // not wxFormBuilder.
    for (const [cls, row, col] of [
      ['ze-txt-locked', 1, '1 / span 3'],
      ['ze-txt-layer-lbl', 2, '1'],
      ['ze-txt-layer', 2, '2 / span 2'],
      ['ze-txt-knockout', 2, '5 / span 3'],
      ['ze-txt-font-lbl', 3, '1'],
      ['ze-txt-font', 3, '2 / span 2'],
      ['ze-txt-bar', 3, '5 / span 3'],
      ['ze-txt-orient', 6, '6'],
    ] as const) {
      const body = rule(`.${cls}`);
      expect(body, cls).toMatch(new RegExp(`grid-row:\\s*${row};`));
      expect(body, cls).toMatch(new RegExp(`grid-column:\\s*${col.replace('/', '\\/')};`));
    }
  });
});

describe('the two heights, both measured with the widget wx builds', () => {
  /*
   * `qa/probes/stc_bestsize_probe.cpp` constructs the two controls exactly as
   * the generated file does and asks them:
   *
   *     wxStyledTextCtrl GetBestSize = 200 x 100
   *     wxTextCtrl       GetBestSize =  98 x 34
   *
   * Neither number was guessed and neither is in the C++: this dialog states no
   * `SetMinSize` at all, unlike the text box's `wxSize( -1,150 )`, so both come
   * from the toolkit. They are the whole of the height divergence a
   * side-by-side capture showed — the text block was a browser textarea's own
   * two rows, and the rows below sat at their padding height.
   */
  it('gives the text control the 100px a wxStyledTextCtrl asks for', () => {
    expect(rule('.ze-txt-text')).toMatch(/min-height:\s*100px/);
  });

  it('stands every entry at --ctl-height, which the shared entry rule leaves alone', () => {
    // That rule sets an entry's colour, border and horizontal padding and says
    // so: "an entry's height is set per control (--ctl-height where it is a
    // full-size field), not by this rule". A dialog that does not say it gets
    // 26 px, and a row pitch of 28 against a real dialog's 36.
    for (const cls of ['.ze-txt-w-ctl', '.ze-txt-px-ctl']) {
      expect(rule(cls), cls).toMatch(/height:\s*var\(--ctl-height\)/);
    }
    // The text box dialog's fields are the same wxTextCtrl and had the same gap.
    for (const cls of ['.ze-tbp-w-ctl', '.ze-tbp-bw-ctl']) {
      expect(rule(cls), cls).toMatch(/height:\s*var\(--ctl-height\)/);
    }
  });
});

describe('the Draw Text tool opens this dialog, and opens it on activation', () => {
  it('shows DialogTextProperties for a placement, not a second smaller one', () => {
    expect(EDITOR).toContain('initial={newTextValues(textDialog)}');
    // `textDraft` was the state the hand-rolled div held its one field in, and
    // nothing else ever read it: its absence is the div's absence.
    //
    // Not a scan for the colours it carried. `#2a2c30` and `1px solid #444` are
    // still in this file three more times — the canvas context menu and the
    // zone dialog are hand-rolled too — and a test that failed on those would
    // be reporting somebody else's drift as this one's.
    expect(EDITOR).not.toContain('textDraft');
  });

  it('primes the tool the moment it is picked, as PrimeTool does', () => {
    // `m_toolMgr->PrimeTool( { 0, 0 } )` with `ignorePrimePosition = true`
    // (`drawing_tool.cpp:1049-1058`): a synthetic click that runs the tool's own
    // click arm, which is what opens the dialog. The position is discarded, so
    // the text takes the cursor's.
    expect(EDITOR).toMatch(/if \(activeTool !== 'placeText'\) return;/);
    expect(EDITOR).toContain('setTextDialog(snapToGrid(cursorRef.current ?? { x: 0, y: 0 }))');
  });

  it('starts the new text from the active layer’s Board Setup row', () => {
    // `textAttrs.m_Size = bds.GetTextSize( layer )` and friends
    // (`drawing_tool.cpp:124-131`) — the layer class's row, not EDA_TEXT's
    // defaults, and mirrored from the outset on a back layer.
    expect(EDITOR).toContain('const row = layerClassRow(activeLayer);');
    expect(EDITOR).toContain('mirrored: isBackLayer(activeLayer)');
    expect(EDITOR).toMatch(/hJustify: 'left'/);
    expect(EDITOR).toMatch(/vJustify: 'bottom'/);
  });
});

describe('Syntax Help, which the link used to not open', () => {
  const HELP = readFileSync(
    fileURLToPath(new URL('../../../pcbnew/src/pcb_text_help.ts', import.meta.url)),
    'utf8',
  );

  it('binds the hyperlink to it, in both text dialogs', () => {
    // `m_syntaxHelp->Bind( wxEVT_HYPERLINK, &DIALOG_…::onSyntaxHelp, this )`,
    // and `onSyntaxHelp` is `PCB_TEXT::ShowSyntaxHelp( this )`. The link was
    // rendered and bound to nothing in both.
    const BOX = read('editors/pcb/dialogs/dialog_textbox_properties.tsx');
    for (const src of [code, BOX]) {
      expect(src).toContain('onClick={() => setSyntaxHelp(true)}');
      expect(src).toContain('<HtmlMessageBox');
      expect(src).toContain('html={PCB_TEXT_SYNTAX_HELP}');
    }
  });

  it('carries KiCad’s own help table rather than one written here', () => {
    // `pcb_text_help_md.h` is generated by CMake from `pcb_text_help.md` and
    // checked in, so it is a table KiCad hardcodes — data, mirrored.
    expect(HELP).toContain('^{superscript}');
    expect(HELP).toContain('${refdes:field}');
    expect(HELP).toContain('&lt;UNRESOLVED: token&gt;');
  });

  it('is the shared HTML_MESSAGE_BOX at the size the C++ states', () => {
    // `SetDialogSizeInDU( 320, 320 )` (`pcb_text.cpp:725-728`), which
    // [px] converts to 720 x 840 here (`qa/probes/stc_bestsize_probe.cpp`).
    // Dialog units are a font measurement, so the two axes differ.
    const box = rule('.ze-modal.ze-htmlmsg.ze-syntaxhelp');
    expect(box).toMatch(/width:\s*720px/);
    expect(box).toMatch(/height:\s*840px/);
  });
});
