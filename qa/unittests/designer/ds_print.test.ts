// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DSP-30 (the half that is not browser-impossible) — Print used to fail
 * silently.
 *
 * KiCad's Ctrl+P goes straight to the GTK system print dialog and prints
 * vectors. A browser cannot open that dialog, and the raster-to-`window.print`
 * route is the honest substitute. But `window.open` returns null when the popup
 * is blocked, and `if (!w) return;` turned that into a command that does
 * nothing and says nothing.
 *
 * WHAT THIS FILE CANNOT DO: there is no DOM test environment in this repo, so
 * this reads the handler rather than blocking a popup.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const EDITOR = readFileSync(
  fileURLToPath(
    new URL('../../../designer/src/editors/drawingsheet/DrawingSheetEditor.tsx', import.meta.url),
  ),
  'utf8',
);

const PRINT = (() => {
  const at = EDITOR.indexOf('const printSheet');
  expect(at, 'no printSheet').toBeGreaterThan(-1);
  return EDITOR.slice(at, EDITOR.indexOf('w.document.close();', at));
})();

describe('Print with popups blocked', () => {
  it('does not return silently', () => {
    expect(PRINT).toContain("window.open('', '_blank'");
    expect(PRINT).not.toMatch(/if \(!w\) return;/);
  });

  it('raises DisplayErrorMessage’s dialog and names the cause', () => {
    expect(PRINT).toContain('setPrintError(');
    expect(PRINT).toContain('pop-up');
    expect(EDITOR).toContain('<MessageDialogError message={printError}');
  });

  it('uses the shared message dialog rather than a private one', () => {
    // common/confirm.cpp's DisplayErrorMessage is one dialog for every frame;
    // ui/dialog_message.tsx is that one component here.
    expect(EDITOR).toContain("from '../../ui/dialog_message.js'");
  });
});
