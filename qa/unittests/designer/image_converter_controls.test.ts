// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Which Image Converter controls are live before any image is loaded, and what
 * they do there.
 *
 * `BITMAP2CMP_PANEL`'s constructor disables exactly two things:
 *
 *     m_buttonExportFile->Enable( false );          // bitmap2cmp_panel.cpp:65
 *     m_buttonExportClipboard->Enable( false );     //                     :66
 *
 * Nothing else. The three notebook tabs, both Output Size fields, the unit
 * choice and the threshold slider are all live from the first frame, which is
 * why a freshly opened bitmap2component window shows a bright `0.0 0.0`, a
 * usable `mm` combo and a slider sitting at its saved value. We greyed the lot
 * (findings B1 / IC-1), and that is also the whole reason our tab labels read
 * dimmer than KiCad's: they were painting at `--ctl-fg-disabled`.
 *
 * There is no DOM test environment in this repo, so the enable/disable half
 * reads the source — but it reads it structurally: `jsxTag()` pulls out the one
 * JSX opening tag that owns a marker attribute and the assertions are made
 * against that tag alone, so `disabled={!loaded}` reappearing on any single
 * control fails one named test rather than hiding in a substring match over the
 * whole file. What each live control *does* with no bitmap is tested for real,
 * through the pure functions the handlers are built out of.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  convertOutputSize,
  formatOutputSize,
} from '@ziroeda/designer/src/editors/image/imageSize.js';
import {
  acceptDrop,
  askBeforeReplace,
  REPLACE_LOADED_FILE_CAPTION,
  REPLACE_LOADED_FILE_DEFAULT,
  REPLACE_LOADED_FILE_ICON,
  REPLACE_LOADED_FILE_MESSAGE,
} from '@ziroeda/designer/src/editors/image/dropFile.js';
import { NO_LABEL, YES_LABEL, yesNoButtons } from '@ziroeda/designer/src/ui/message_dialog.js';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const TSX = read('../../../designer/src/editors/image/ImageConverter.tsx');
const CSS = read('../../../designer/src/editors/image/imageConverter.css');
/** The stylesheet with its comments removed, so they cannot read as rules. */
const CSS_CODE = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * The single JSX opening tag containing `marker`, e.g. `jsxTag('type="range"')`
 * for the slider. Scans back to the `<` that opens the tag and forward to the
 * `>` that closes it, ignoring any `>` nested inside a `{…}` expression (an
 * arrow function's `=>` is exactly that case).
 */
function jsxTag(marker: string): string {
  const at = TSX.indexOf(marker);
  expect(at, `ImageConverter.tsx has no ${marker}`).toBeGreaterThanOrEqual(0);
  expect(TSX.indexOf(marker, at + 1), `${marker} is not unique`).toBe(-1);
  const open = TSX.lastIndexOf('<', at);
  let depth = 0;
  for (let i = open; i < TSX.length; i++) {
    const c = TSX[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '>' && depth === 0) return TSX.slice(open, i + 1);
  }
  throw new Error(`unterminated JSX tag around ${marker}`);
}

/** The controls of the panel, by a marker attribute unique to each. */
const NOTEBOOK_TABS = 'role="tab"';
const SIZE_X = 'value={outX}';
const SIZE_Y = 'value={outY}';
const UNIT_CHOICE = 'value={unit}';
const THRESHOLD_SLIDER = 'type="range"';
// The Layer choice is now the shared `Combo` (ui/Combo.tsx) rather than a
// native <select>, so its value is stringified. The marker moved with it; the
// behaviour this pins - disabled off the FORMAT, never off the image - did not.
const LAYER_CHOICE = 'value={String(layerIdx)}';
const EXPORT_FILE = 'onClick={exportToFile}';
const EXPORT_CLIPBOARD = 'exportToClipboard()}';

describe('Image Converter: only the two export buttons start disabled', () => {
  // One test per control, so a regression names the control it broke.
  for (const [what, marker] of [
    ['the notebook tabs', NOTEBOOK_TABS],
    ['the Size X field', SIZE_X],
    ['the Size Y field', SIZE_Y],
    ['the unit choice', UNIT_CHOICE],
    ['the threshold slider', THRESHOLD_SLIDER],
  ] as const) {
    it(`leaves ${what} live with no image`, () => {
      expect(jsxTag(marker)).not.toContain('disabled');
    });
  }

  it('disables Export to File until an image is loaded', () => {
    // bitmap2cmp_panel.cpp:65, and :261 re-enables it in OpenProjectFiles.
    expect(jsxTag(EXPORT_FILE)).toContain('disabled={!loaded}');
  });

  it('disables Export to Clipboard until an image is loaded', () => {
    // bitmap2cmp_panel.cpp:66, re-enabled at :262.
    expect(jsxTag(EXPORT_CLIPBOARD)).toContain('disabled={!loaded}');
  });

  it('disables the Layer choice off the format, not off the image', () => {
    // m_layerCtrl->Enable( m_rbFootprint->GetValue() ) (bitmap2cmp_panel.cpp:572)
    // - it is live with no image, as long as Footprint is the chosen format.
    const tag = jsxTag(LAYER_CHOICE);
    expect(tag).toContain('disabled={!footprint}');
    expect(tag).not.toContain('loaded');
  });

  it('greys the Layer LABEL with the combo, as m_layerLabel->Enable does', () => {
    // bitmap2cmp_panel.cpp:571 and :102 both Enable() the label alongside the
    // control (finding B3 / IC-4).
    expect(CSS_CODE).toMatch(
      /\.imgc-layerrow\.disabled \.lbl \{[^}]*color: var\(--ctl-fg-disabled\)/,
    );
    expect(TSX).toContain("`imgc-layerrow${footprint ? '' : ' disabled'}`");
  });

  it('has no disabled styling left for controls that can no longer be disabled', () => {
    // Dead :disabled rules are how the dim tab labels would come back without
    // anyone editing the TSX.
    expect(CSS_CODE).not.toContain('.imgc-tab:disabled');
    expect(CSS_CODE).not.toMatch(/range"\]:disabled/);
  });
});

describe('Image Converter: what a live control does with no bitmap', () => {
  it('re-formats both Size fields on a unit change even with no image', () => {
    // OnSizeUnitChange (bitmap2cmp_panel.cpp:373-381) is unconditional: it
    // SetUnit()s both IMAGE_SIZEs and ChangeValue()s both fields whatever is
    // loaded. With no image m_originalSizePixels is 0, so IMAGE_SIZE::SetUnit
    // (bitmap2cmp_frame.cpp:92-138) falls to its `else size_mm = 0` branches and
    // the size stays 0 - but the field still re-formats to the new unit's
    // precision. Our changeUnit must therefore not be guarded on `loaded`.
    expect(formatOutputSize(convertOutputSize(0, 0, 'mm', 'mm'), 'mm')).toBe('0.0');
    expect(formatOutputSize(convertOutputSize(0, 0, 'mm', 'inch'), 'inch')).toBe('0.00');
    expect(formatOutputSize(convertOutputSize(0, 0, 'mm', 'dpi'), 'dpi')).toBe('0');
    expect(formatOutputSize(convertOutputSize(0, 0, 'dpi', 'mm'), 'mm')).toBe('0.0');
    // and the guard really is gone from the handler
    expect(TSX).toMatch(/const changeUnit[\s\S]{0,900}?loaded\?\.w \?\? 0/);
    expect(TSX).not.toMatch(/const changeUnit = \(next: SizeUnit\): void => \{\s*if \(loaded\)/);
  });

  it('starts both fields at the "0.0" KiCad shows, not blank', () => {
    // m_outputSizeX.SetOutputSize( 0, … ) then ChangeValue( formatOutputSize(…) )
    // (bitmap2cmp_panel.cpp:59-63).
    expect(formatOutputSize(0, 'mm')).toBe('0.0');
    expect(TSX).toContain('useState(() => formatOutputSize(0,');
  });

  it('keeps the aspect ratio at LoadSettings’ 1.0 before any load', () => {
    // m_aspectRatio = 1.0 (bitmap2cmp_panel.cpp:89), so the locked size fields
    // have a ratio to work with while the panel is still empty.
    expect(TSX).toContain('const aspect = loaded ? loaded.w / loaded.h : 1;');
  });

  it('leaves the notebook without a page-change handler, as KiCad does', () => {
    // bitmap2cmp_panel_base.cpp:215-231 connects paint, buttons, fields and
    // radios and never the notebook, so a tab click only selects a page.
    expect(jsxTag(NOTEBOOK_TABS)).toContain('onClick={() => setTab(t.id)}');
  });
});

describe('Image Converter: DROP_FILE’s "Replace Loaded File?" question', () => {
  it('uses the shared message dialog, not window.confirm', () => {
    // Finding B5. DROP_FILE::OnDropFiles (bitmap2cmp_panel.cpp:589-591) shows a
    // KICAD_MESSAGE_DIALOG; include/confirm.h:45-53 makes that one shared
    // wxMessageDialog, so ours is one shared component in ui/.
    expect(TSX).toContain('<MessageDialogYesNo');
    expect(TSX).not.toContain("window.confirm('There is already a file loaded");
  });

  it('carries KiCad’s caption and message character for character', () => {
    expect(REPLACE_LOADED_FILE_CAPTION).toBe('Replace Loaded File?');
    expect(REPLACE_LOADED_FILE_MESSAGE).toBe(
      'There is already a file loaded. Do you want to replace it?',
    );
  });

  it('is wxICON_QUESTION | wxYES_DEFAULT', () => {
    expect(REPLACE_LOADED_FILE_ICON).toBe('question');
    expect(REPLACE_LOADED_FILE_DEFAULT).toBe('yes');
  });

  it('asks only when an image is already loaded', () => {
    // `GetOutputSizeX().GetOriginalSizePixels() != 0` (bitmap2cmp_panel.cpp:587)
    // - the first drop onto an empty panel is never questioned.
    expect(askBeforeReplace(0)).toBe(false);
    expect(askBeforeReplace(1920)).toBe(true);
  });

  it('refuses the drop on wxID_NO and takes it on wxID_YES', () => {
    // `if( replace == wxID_NO ) return false;` (bitmap2cmp_panel.cpp:594-595).
    expect(acceptDrop('no')).toBe(false);
    expect(acceptDrop('yes')).toBe(true);
  });

  it('lays the buttons out GTK’s way: negative first, default focused', () => {
    // A wxMessageDialog uses the platform's button order; on GTK the
    // affirmative is last, and wxYES_DEFAULT focuses it.
    expect(yesNoButtons('yes').map((b) => b.label)).toEqual([NO_LABEL, YES_LABEL]);
    expect(yesNoButtons('yes').map((b) => b.isDefault)).toEqual([false, true]);
    expect(yesNoButtons('no').map((b) => b.isDefault)).toEqual([true, false]);
  });
});
