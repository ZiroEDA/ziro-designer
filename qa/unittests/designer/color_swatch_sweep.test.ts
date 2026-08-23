// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Every colour in the app is picked through the one `COLOR_SWATCH`.
 *
 * KiCad has exactly one widget for this (`common/widgets/color_swatch.cpp`): it
 * draws the colour and opens DIALOG_COLOR_PICKER on a click. The colour theme
 * panels, the layer managers, the netclass table and every item dialog build
 * one, which is why its picker looks and behaves the same in all of them.
 *
 * Ours had sixteen `<input type="color">`s instead - the browser's own picker,
 * drawn by the OS as a popup anchored to the control, so on a control near the
 * right edge of the window it opened off-screen with nothing to click. It also
 * cannot carry alpha, which is why six dialogs each had a `fromHex` that wrote
 * alpha 1 unconditionally and quietly made every picked colour opaque.
 *
 * This is a per-occurrence rule, so the check is per-occurrence: a file-level
 * "somebody imports ColorSwatch" would pass with fifteen native inputs left.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { COLOR4D_UNSPECIFIED } from '@ziroeda/common/src/color4d.js';
import {
  color4dToItemColor,
  itemColorToColor4d,
} from '@ziroeda/designer/src/editors/schematic/dialogs/item_color.js';

const SRC = fileURLToPath(new URL('../../../designer/src', import.meta.url));

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

/** Every source line, with comment lines dropped - a citation is not a call. */
function codeLines(file: string): { line: string; n: number }[] {
  const src = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, (m) =>
    m.replace(/[^\n]/g, ' '),
  );
  return src
    .split('\n')
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => !/^\s*(\/\/|\*)/.test(line));
}

describe('no launcher keeps its own colour control', () => {
  it('has no <input type="color"> left anywhere in designer/src', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      for (const { line, n } of codeLines(file)) {
        if (/type=["']color["']/.test(line)) offenders.push(`${file.slice(SRC.length + 1)}:${n}`);
      }
    }
    expect(
      offenders,
      'these hand the colour picker to the browser, which opens it off-screen',
    ).toEqual([]);
  });

  it('routes the picker through ColorSwatch, not through the dialog directly', () => {
    // DialogColorPicker has two legitimate users: the swatch that owns it, and
    // the drawing sheet's properties frame, whose swatch predates ColorSwatch
    // and is the same button by hand. A third would be a third copy of the
    // open-state-and-conversion boilerplate ColorSwatch exists to hold.
    const users = walk(SRC).filter((f) =>
      codeLines(f).some(({ line }) => line.includes('<DialogColorPicker')),
    );
    expect(users.map((f) => f.slice(SRC.length + 1)).sort()).toEqual([
      'editors/drawingsheet/PropertiesFrame.tsx',
      'ui/ColorSwatch.tsx',
    ]);
  });

  it('leaves no copy of the hex round trip the native input forced', () => {
    // Six dialogs carried an identical `fromHex` that hardcoded alpha to 1.
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      for (const { line, n } of codeLines(file)) {
        if (/const fromHex = /.test(line)) offenders.push(`${file.slice(SRC.length + 1)}:${n}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('the swatch opens the picker the way COLOR_SWATCH does', () => {
  const WIDGET = readFileSync(join(SRC, 'ui/ColorSwatch.tsx'), 'utf8');

  it('changes nothing on a cancel', () => {
    // `if( result == wxID_OK )` (color_swatch.cpp:322) - a cancel does not even
    // send the change event, so a caller cannot see it at all.
    expect(WIDGET).toContain('if (picked) onChange(picked);');
  });

  it('passes m_default and m_supportsOpacity through to the dialog', () => {
    // Both change what the dialog IS: UNSPECIFIED relabels Reset to Default as
    // Clear Color, and !supportsOpacity hides the Opacity slider entirely.
    expect(WIDGET).toContain('defaultColor={defaultColor}');
    expect(WIDGET).toContain('allowOpacity={supportsOpacity}');
    expect(WIDGET).toContain('defaultColor = COLOR4D_UNSPECIFIED');
  });

  it('draws the colour over MakeBitmap’s checkerboard, at its own alpha', () => {
    // color_swatch.cpp:78-133. Taking `.ze-swatch.unspecified` unconditionally
    // is what makes a transparent colour the bare checkerboard and a half
    // transparent one a tinted checkerboard, with neither a special case.
    expect(WIDGET).toContain('className={`ze-swatch unspecified');
  });
});

describe('the schematic’s ItemColor round trip', () => {
  it('carries alpha both ways, which the hex round trip could not', () => {
    // The bug the native input forced: `fromHex` wrote `1` for alpha because
    // #rrggbb has no fourth channel, so every pick made the item opaque.
    const half = itemColorToColor4d([255, 128, 0, 0.5]);
    expect(half).toEqual({ r: 1, g: 128 / 255, b: 0, a: 0.5 });
    expect(color4dToItemColor(half)).toEqual([255, 128, 0, 0.5]);
  });

  it('maps an unset colour to UNSPECIFIED and back to unset', () => {
    // Not to the layer colour it resolves to on the canvas: the picker
    // checkerboards UNSPECIFIED and offers Clear Color for it, and an item with
    // no colour of its own is the ABSENT field, not a stored (0, 0, 0, 0).
    expect(itemColorToColor4d(undefined)).toEqual(COLOR4D_UNSPECIFIED);
    expect(color4dToItemColor(COLOR4D_UNSPECIFIED)).toBeUndefined();
  });

  it('rounds channels the way COLOR4D::ToColour does', () => {
    // `static_cast<unsigned char>( c * 255 + 0.5 )` - round half up. A truncate
    // here would drift a colour by one every time a dialog is reopened.
    expect(color4dToItemColor({ r: 0.5, g: 0.5, b: 0.5, a: 1 })).toEqual([128, 128, 128, 1]);
    expect(color4dToItemColor({ r: 1, g: 1, b: 1, a: 1 })).toEqual([255, 255, 255, 1]);
  });

  it('is not a transparent BLACK that happens to be unset', () => {
    // Only the exact UNSPECIFIED quadruple clears. A colour the user chose and
    // then dragged to zero opacity is a colour, and must survive as one.
    expect(color4dToItemColor({ r: 0.5, g: 0, b: 0, a: 0 })).toEqual([128, 0, 0, 0]);
  });
});
