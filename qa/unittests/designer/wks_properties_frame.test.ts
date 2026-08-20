// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PROPERTIES_FRAME` (pagelayout_editor/dialogs/properties_frame.cpp) — which
 * of its fields are range-checked, and what every row is called.
 *
 * The audit found no validation at all on our side: any finite number was
 * applied, an emptied field became 0, and the sheet's default text size could
 * be set to 0 — which upstream refuses, because a 0 default has nothing left
 * to fall back to.
 *
 * `properties_frame.cpp` checks exactly five fields and leaves the rest alone
 * on purpose (the four page margins, both positions, the text constraints and
 * the repeat steps take whatever is typed). Getting that list right in both
 * directions is the point of this file: a range added where upstream has none
 * is as wrong as a range missing where it has one.
 *
 * WHAT THIS FILE CANNOT DO: there is no DOM test environment in this repo, so
 * it cannot type into a field and watch the box appear. It reads the panel's
 * declarations; the behaviour behind them is tested over the pure functions in
 * `unit_binder.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const PANEL = read('../../../designer/src/editors/drawingsheet/PropertiesFrame.tsx');

/** Every `<UnitField …/>` in the panel, keyed by the model value it edits. */
const FIELDS: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  for (const tag of PANEL.split('<UnitField').slice(1)) {
    const body = tag.slice(0, tag.indexOf('/>'));
    const value = /value=\{([^}]*)\}/.exec(body)?.[1];
    if (value) out[value] = body;
  }
  return out;
})();

/** The `range={…}` a field declares, or `''` when it declares none. */
const rangeOf = (value: string): string => {
  const body = FIELDS[value];
  expect(body, `no UnitField edits ${value}`).toBeDefined();
  return /range=\{(\w+)\}/.exec(body as string)?.[1] ?? '';
};

describe('validateMM call sites', () => {
  it('checks an item’s pen width against 0..10 mm', () => {
    // properties_frame.cpp:529 — validateMM( m_lineWidth, 0.0, 10.0 ). One
    // binder over DS_DATA_ITEM::m_LineWidth serves line, rect, text and
    // polygon, so there is one field here too.
    expect(rangeOf('pen.lineWidth')).toBe('LINE_WIDTH_RANGE');
  });

  it('checks an item’s text size against 0..100 mm', () => {
    // :611 and :614 — 0.0 to DLG_MAX_TEXTSIZE. Zero is legal and means
    // "use the sheet default".
    expect(rangeOf('t.fontW')).toBe('ITEM_TEXT_SIZE_RANGE');
    expect(rangeOf('t.fontH')).toBe('ITEM_TEXT_SIZE_RANGE');
  });

  it('checks the sheet’s default line width against 0..10 mm', () => {
    // :204 — validateMM( m_defaultLineWidth, 0.0, 10.0 ).
    expect(rangeOf('setup.lineWidth')).toBe('LINE_WIDTH_RANGE');
  });

  it('checks the sheet’s default text size against 0.01..100 mm', () => {
    // :207 and :210 — DLG_MIN_TEXTSIZE, not 0. This is the one that stops an
    // emptied field zeroing the default.
    expect(rangeOf('setup.textW')).toBe('DEFAULT_TEXT_SIZE_RANGE');
    expect(rangeOf('setup.textH')).toBe('DEFAULT_TEXT_SIZE_RANGE');
  });

  it('checks the sheet’s default text thickness against 0..5 mm', () => {
    // :213 — validateMM( m_defaultTextThickness, 0.0, 5.0 ).
    expect(rangeOf('setup.textLineWidth')).toBe('DEFAULT_TEXT_THICKNESS_RANGE');
  });

  it('spells the five ranges the way properties_frame.cpp does', () => {
    expect(PANEL).toContain('const DLG_MIN_TEXTSIZE = 0.01;');
    expect(PANEL).toContain('const DLG_MAX_TEXTSIZE = 100.0;');
    expect(PANEL).toContain('const LINE_WIDTH_RANGE: UnitRange = { min: 0.0, max: 10.0 };');
    expect(PANEL).toContain(
      'const ITEM_TEXT_SIZE_RANGE: UnitRange = { min: 0.0, max: DLG_MAX_TEXTSIZE };',
    );
    expect(PANEL).toContain(
      'const DEFAULT_TEXT_SIZE_RANGE: UnitRange = { min: DLG_MIN_TEXTSIZE, max: DLG_MAX_TEXTSIZE };',
    );
    expect(PANEL).toContain(
      'const DEFAULT_TEXT_THICKNESS_RANGE: UnitRange = { min: 0.0, max: 5.0 };',
    );
  });
});

describe('the fields upstream deliberately does NOT check', () => {
  it('leaves the four page margins unvalidated', () => {
    // CopyPrmsFromPanelToGeneral (:216-219) assigns all four with no
    // validateMM call. A range here would refuse layouts KiCad accepts.
    for (const m of [
      'setup.leftMargin',
      'setup.rightMargin',
      'setup.topMargin',
      'setup.bottomMargin',
    ])
      expect(rangeOf(m)).toBe('');
  });

  it('leaves positions, constraints and repeat steps unvalidated', () => {
    // :535-556 assign m_textPos*/m_textEnd*/m_textStep* straight through, and
    // :617-618 the two m_constraint* binders.
    for (const v of ['point.x', 'point.y', 't.maxlen', 't.maxheight', 'item.incrx', 'item.incry'])
      expect(rangeOf(v)).toBe('');
  });

  it('checks five fields and no more', () => {
    const withRange = Object.keys(FIELDS).filter((v) => rangeOf(v) !== '');
    expect(withRange.sort()).toEqual(
      [
        'pen.lineWidth',
        'setup.lineWidth',
        'setup.textH',
        'setup.textLineWidth',
        'setup.textW',
        't.fontH',
        't.fontW',
      ].sort(),
    );
  });
});

describe('a failed check is reported, not swallowed', () => {
  it('shows DisplayErrorMessage’s box', () => {
    // UNIT_BINDER::delayedFocusHandler calls DisplayErrorMessage, which is one
    // shared KICAD_MESSAGE_DIALOG (common/confirm.cpp) — so ours is the shared
    // ui/ dialog, not a box hand-rolled in this panel.
    expect(PANEL).toContain("import { MessageDialogError } from '../../ui/dialog_message.js'");
    expect(PANEL).toContain(
      '{error && <MessageDialogError message={error} onClose={() => setError(null)} />}',
    );
  });

  it('gives every validated field somewhere to report to', () => {
    for (const [value, body] of Object.entries(FIELDS)) {
      if (/range=\{/.test(body)) expect(body, value).toContain('onError={onError}');
    }
  });
});

describe('the row labels are the ones properties_frame_base.cpp declares', () => {
  const labels = [...PANEL.matchAll(/<Row\s+label="([^"]*)"/g)].map((m) => m[1] as string);

  it('calls an item’s pen width "Line width:", whatever the item is', () => {
    // properties_frame_base.cpp:354. One row, one label, for line, rect, text
    // and polygon; upstream Show()s it for everything but a bitmap.
    expect(labels.filter((l) => l === 'Line width:')).toHaveLength(1);
    expect(PANEL).toContain('{!bitmap && pen && (');
  });

  it('keeps "Line thickness:" and "Text thickness:" for the SHEET defaults only', () => {
    // :497 and :511 — both live in General Options > Default Values, over
    // m_DefaultLineWidth and m_DefaultTextThickness. Neither belongs to an
    // item, and the per-item "Text thickness:" row was invented here.
    const general = PANEL.slice(PANEL.indexOf('function GeneralOptions'));
    const item = PANEL.slice(
      PANEL.indexOf('function ItemProperties'),
      PANEL.indexOf('function GeneralOptions'),
    );
    expect(general).toContain('label="Line thickness:"');
    expect(general).toContain('label="Text thickness:"');
    // (checked as declarations, not as prose: the panel's own comment
    // explains the move and names both labels.)
    expect(item).not.toContain('label="Line thickness:"');
    expect(item).not.toContain('label="Text thickness:"');
  });

  it('gives the page-option choice no label at all', () => {
    // :37-42 puts it in bSizerButt with the item type and the Syntax Help
    // link, and never creates a static text for it.
    expect(labels).not.toContain('Show:');
    expect(PANEL).not.toContain('label="Show:"');
  });

  it('puts no unit after Rotation', () => {
    // m_textCtrlRotation (:369) has no m_*Units sibling; the value is
    // UNSCALED. We used to print "deg" beside it.
    expect(labels).toContain('Rotation:');
    expect(PANEL).not.toMatch(/>\s*deg\s*</);
  });

  it('offers a bitmap only Bitmap DPI, with no Scale row', () => {
    // :372 is the last row of gbSizer1. There is no scale control upstream:
    // DS_DATA_ITEM_BITMAP derives the scale from the PPI.
    expect(labels).toContain('Bitmap DPI:');
    expect(labels).not.toContain('Scale:');
  });

  it('offers Default Font and KiCad Font as two separate entries', () => {
    // FONT_CHOICE (common/widgets/font_choice.cpp:254-256) appends them in
    // that order, and they mean different things: "Default Font" leaves
    // m_Font null, "KiCad Font" names the stroke font. They are two rows of
    // the shared Combo's option list, not one merged entry.
    const faces = PANEL.slice(PANEL.indexOf('const FACE_CHOICES'));
    expect(faces.slice(0, faces.indexOf('];'))).toContain(
      "{ value: '', label: 'Default Font' },\n  { value: KICAD_FONT_NAME, label: KICAD_FONT_NAME },",
    );
    // The three CSS generics we invented are gone.
    expect(PANEL).not.toContain('Sans-serif');
    expect(PANEL).not.toContain("label: 'Serif'");
    expect(PANEL).not.toContain('Monospace');
  });

  it('draws all three choices with the shared wxChoice, never a native select', () => {
    // .ze-select and .ze-combo are both (0,1,0), so a call site keeping the
    // old class would win or lose on file order alone - which is the accident
    // that produced the original drop-down bug. The corner choice, the
    // page-option choice and the Font choice are all Combo.
    expect(PANEL).not.toContain('ze-select');
    expect(PANEL).not.toContain('<select');
    expect(PANEL.match(/<Combo/g) ?? []).toHaveLength(3);
  });
});

describe('"KiCad Font" is the stroke font, not an outline family', () => {
  const RENDER = read('../../../designer/src/editors/drawingsheet/wksRender.ts');

  it('names it once, in the font module that owns it', () => {
    // include/font/kicad_font_name.h, which stroke_font.cpp:189 assigns to the
    // stroke font's own m_fontName.
    const FONT = read('../../../common/src/font/stroke_font.ts');
    expect(FONT).toContain("export const KICAD_FONT_NAME = 'KiCad Font';");
  });

  it('strokes it rather than sending it to a CSS family', () => {
    // FONT::GetFont( KICAD_FONT_NAME ) returns the stroke font, so a face of
    // that name must not take the outline path — which would look for a CSS
    // family called "KiCad Font" and fall back to sans-serif.
    expect(RENDER).toContain('if (t.face && t.face !== KICAD_FONT_NAME) {');
  });
});

/**
 * DSP-19 / DSP-20 — per-type visibility and label text in the properties frame.
 *
 * Source assertions again: the panel is a `.tsx`, so this reads its
 * declarations. What each one is checking against is named on the line.
 */
describe('DSP-19 — Syntax Help is a text-item control', () => {
  it('is rendered only when the selected item is a text', () => {
    // properties_frame.cpp:358 —
    //   m_syntaxHelpLink->Show( aItem->GetType() == DS_DATA_ITEM::DS_TEXT )
    // Ours drew the link for a Line, which has no ${…} syntax to be helped
    // with. `t` is the panel's "this item is a WksText" binding.
    const at = PANEL.indexOf('className="ze-ds-syntaxhelp"');
    expect(at, 'no Syntax Help link').toBeGreaterThan(-1);
    // The nearest opening guard above the link is the text-item one.
    const guard = PANEL.lastIndexOf('{t && (', at);
    expect(guard, 'the link is not inside a text-only guard').toBeGreaterThan(-1);
    expect(PANEL.slice(guard, at)).not.toContain(')}');
  });
});

describe('DSP-20 — the label text KiCad prints', () => {
  it('shows the item type name alone, with no "Type:" prefix', () => {
    // m_staticTextType->SetLabel( aItem->GetClassName() ) — :241.
    expect(PANEL).toContain('<span className="ze-ds-type">{WKS_ITEM_TYPE_LABEL[item.type]}</span>');
    expect(PANEL).not.toContain('Type: {');
  });

  it('takes the class-name table from common rather than keeping a copy', () => {
    // A third copy of it had drifted to `polygon: 'Poly'`, where
    // DS_DATA_ITEM::GetClassName (ds_data_item.cpp:374) says "Imported Shape".
    expect(PANEL).toContain('WKS_ITEM_TYPE_LABEL');
    expect(PANEL).not.toContain('const TYPE_LABEL');
  });

  it('leaves the first-page choice unlabelled', () => {
    // bSizerButt (properties_frame_base.cpp:38-42) adds m_choicePageOpt with no
    // wxStaticText beside it; the three entries say what it is. Ours labelled
    // it "Show:".
    expect(PANEL).not.toContain('Show:');
  });

  it('offers the three page options KiCad words', () => {
    for (const s of ['Show on all pages', 'First page only', 'Subsequent pages only'])
      expect(PANEL).toContain(s);
  });

  it('calls the item pen "Line width:" and the sheet default "Line thickness:"', () => {
    // properties_frame_base.cpp:354 vs :497 — two different controls.
    expect(PANEL).toContain('label="Line width:"');
    expect(PANEL).toContain('label="Line thickness:"');
  });

  it('gives Rotation no unit suffix', () => {
    // m_textCtrlRotation has no m_*Units static beside it (:365-369).
    const at = PANEL.indexOf('label="Rotation:"');
    expect(at).toBeGreaterThan(-1);
    expect(PANEL.slice(at, at + 400)).not.toContain('deg');
  });

  it('spells the size hint "Set to 0 to use default values"', () => {
    // m_staticTextSizeInfo (:226). "Set to 0 to disable this constraint" is the
    // TOOLTIP of the two Maximum fields (:185, :198) and belongs only there.
    expect(PANEL).toContain('Set to 0 to use default values</div>');
    expect(PANEL).not.toContain('Set to 0 to disable a constraint');
    expect(PANEL).toContain('hint="Set to 0 to disable this constraint"');
  });

  it('offers Default Font and KiCad Font as two separate entries', () => {
    // m_fontCtrlChoices (:155). They are not the same value: the first writes
    // no (face …) at all, the second writes (face "KiCad Font").
    expect(PANEL).toContain("{ value: '', label: 'Default Font' }");
    expect(PANEL).not.toContain('Default Font (KiCad Font)');
  });
});

describe('DSP-21 — the panel takes its metrics from the theme', () => {
  it('has no hardcoded font size left in its markup', () => {
    // Every text size in this panel is --ui-font-size (or, for the one info
    // label, --ui-font-size-info) in shell.css. `fontSize: 12` on the item
    // table is the Design Inspector's, not this file's.
    expect(PANEL).not.toMatch(/fontSize:\s*\d/);
  });

  it('leaves no numeric font size in this launcher’s CSS block', () => {
    // The standing rule (per-launcher tokenisation): a measured chrome metric
    // goes in the :root token layer, and the editor's own CSS consumes it by
    // name. Adding a ninth hardcoded font size is the defect this pins.
    const CSS = read('../../../designer/src/ui/shell.css');
    const start = CSS.indexOf('---- Drawing Sheet Editor properties panel');
    const end = CSS.indexOf("---- UNIT_BINDER's unit static text", start);
    expect(start, 'the drawing sheet CSS block moved').toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);

    // Declarations only: a `font-size:` at the head of a line. The prose in
    // this block names the token and quotes the measurements it replaced.
    const declarations = CSS.slice(start, end)
      .split('\n')
      .filter((line) => /^\s*font-size:/.test(line));
    expect(declarations.length, 'no font-size declarations found').toBeGreaterThan(0);
    for (const line of declarations) expect(line).toMatch(/var\(--ui-font-size/);
  });

  it('marks the selected tab in the desktop accent, not in a blue of our own', () => {
    // [px] sampled off ziro-dsp/shots/k_tab.png: rgb(238, 84, 31), which is
    // --chrome-active (#e95420). This block carries no hex colour of its own.
    const CSS = read('../../../designer/src/ui/shell.css');
    const start = CSS.indexOf('---- Drawing Sheet Editor properties panel');
    const end = CSS.indexOf("---- UNIT_BINDER's unit static text", start);
    const block = CSS.slice(start, end);
    expect(block).toContain('border-bottom-color: var(--chrome-active);');
    expect(block).toContain('border-bottom: var(--tab-underline) solid transparent;');
    for (const line of block
      .split('\n')
      .filter((l) => /^\s*(background|color|border-.*color):/.test(l)))
      expect(line, 'a hex colour in this launcher’s CSS').not.toMatch(/#[0-9a-f]{3,8}/i);
  });

  it('lets a distance field fill its column instead of pinning 62 px', () => {
    // Every wxTextCtrl in properties_frame_base.cpp is added wxEXPAND into a
    // sizer with a growable value column (AddGrowableCol( 1 )).
    const FIELD = read('../../../designer/src/ui/UnitField.tsx');
    expect(FIELD).not.toContain('width = 62');
    expect(FIELD).toContain("flex: '1 1 auto'");
  });
});

describe('DSP-23 — the pane has its AUI caption', () => {
  it('draws a "Properties" caption strip above the notebook', () => {
    // pl_editor_frame.cpp:199-203 adds the pane with
    // `.Caption( _( "Properties" ) )`, and GTK paints a caption strip for it.
    // Ours had none, alone among our editors.
    const at = PANEL.indexOf('<div className="ze-panel-header">Properties</div>');
    expect(at, 'no pane caption').toBeGreaterThan(-1);
    // Above the notebook tabs, not below them.
    expect(at).toBeLessThan(PANEL.indexOf('className="ze-ds-tabs"'));
  });

  it('uses the shared caption, not a private one', () => {
    // .ze-panel-header is WX_AUI_DOCK_ART's caption measured off a real pane;
    // the PCB, schematic and symbol editors all already draw theirs with it.
    const SHELL = read('../../../designer/src/ui/shell.css');
    expect(SHELL).toContain('.ze-panel-header {');
    expect(PANEL).not.toMatch(/ze-ds-(pane)?caption/);
  });
});
