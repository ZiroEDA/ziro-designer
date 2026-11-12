// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * A source file with its translation marks taken off, for the tests that read
 * a frame's source for its structure - a row's label, a menu's order, a
 * caption beside its close box.
 *
 * Marking KiCad's messages turns `label="Line width:"` into
 * `label={_('Line width:')}`, `<legend>Output Size</legend>` into
 * `<legend>{_('Output Size')}</legend>` and `'Open Zip File'` into
 * `_('Open Zip File')`. What those tests assert has not changed, only the
 * spelling, so they read through this. Whether a message IS marked is the
 * translation ratchet's question (untranslated_ratchet.test.ts), asked of
 * every file, not of the few a structure test happens to read.
 */

const MARK = String.raw`(?<![\w$.])(?:_|_HKI|wxGetTranslation)`;
const LIT = String.raw`('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*")`;

/** The text of a JS string literal, quotes and escapes resolved. */
function textOf(aLiteral: string): string {
  return aLiteral.slice(1, -1).replace(/\\(.)/g, (_m, c: string) => (c === 'n' ? '\n' : c));
}

export function unmarked(aSource: string): string {
  return (
    aSource
      // An attribute: `label={_('X')}` -> `label="X"`.
      .replace(
        new RegExp(String.raw`=\{\s*${MARK}\(\s*${LIT}\s*\)\s*\}`, 'g'),
        (_m, lit: string) => `="${textOf(lit)}"`,
      )
      // A JSX child: `>{_('X')}<` -> `>X<`.
      .replace(new RegExp(String.raw`\{\s*${MARK}\(\s*${LIT}\s*\)\s*\}`, 'g'), (_m, lit: string) =>
        textOf(lit),
      )
      // Anywhere else: `_('X')` -> `'X'`, the literal as it was written.
      .replace(new RegExp(String.raw`${MARK}\(\s*${LIT}\s*\)`, 'g'), (_m, lit: string) => lit)
  );
}
