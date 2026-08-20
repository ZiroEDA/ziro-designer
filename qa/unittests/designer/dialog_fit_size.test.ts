// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A dialog is sized by `Fit()`, not by a number somebody picked.
 *
 * Every wxFormBuilder `_base.cpp` in KiCad ends the same three lines:
 *
 *     this->SetSizer( bMainSizer );
 *     this->Layout();
 *     bMainSizer->Fit( this );
 *
 * and the hand-written `.cpp` on top of it finishes `TransferDataToWindow` with
 * `GetSizer()->SetSizeHints( this )`. `dialog_page_settings_base.cpp:403-405`
 * and `dialog_page_settings.cpp:192` are one instance; the tree repeats it
 * everywhere. The consequence is the thing a user notices: two KiCad dialogs
 * holding the same controls come out the same size, and none of them carries a
 * pixel width at all.
 *
 * Ours carried forty-five. `.ze-modal` declared `width: 860px; height: 580px`
 * — two numbers that appear nowhere in KiCad — and then every single dialog
 * overrode them, 17 in `shell.css` and 28 inline at the call site. They cannot
 * all be right, and two of them prove it: the SAME upstream dialog,
 * `DIALOG_PAGES_SETTINGS`, was 760 px in the schematic's copy and 560 px in the
 * drawing sheet's.
 *
 * This file pins the default and ratchets the pile:
 *
 *  - `.ze-modal` itself must declare no pixel size. That one is absolute; there
 *    is no C++ it could cite, because upstream has no such number.
 *  - the count of dialogs that DO name a size may not grow. A few are real —
 *    `DIALOG_TEMPLATE_SELECTOR` and the hotkey editor genuinely call SetSize,
 *    and their rules carry the citation — so this is a ratchet rather than a
 *    ban. Removing one means lowering the number here in the same commit.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(__dirname, '../../../designer/src');
const SHELL = join(SRC, 'ui/shell.css');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

/** Every `className="ze-modal…"` element that also carries an inline width/height. */
function inlineSized(): string[] {
  const hits: string[] = [];
  for (const file of walk(SRC)) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/className="ze-modal[^"]*"/g)) {
      // the same JSX element only, i.e. up to its closing angle bracket
      const element = text.slice(m.index, m.index + 600).split('>')[0] ?? '';
      if (/\b(width|height)\s*:/.test(element)) {
        hits.push(`${file.slice(SRC.length + 1)}:${text.slice(0, m.index).split('\n').length}`);
      }
    }
  }
  return hits.sort();
}

/** Every `.ze-modal.<variant>` rule in shell.css that names a width or height. */
function cssSized(): string[] {
  const css = readFileSync(SHELL, 'utf8');
  const hits: string[] = [];
  for (const m of css.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    const selector = (m[1] ?? '').trim().split('\n').pop()?.trim() ?? '';
    const first = selector.split(',')[0]?.trim() ?? '';
    // the modal element itself, not something inside it
    // `.ze-modal` or `.ze-modal.<variant>` — the modal element itself. NOT
    // `.ze-modal-header` / `.ze-modal-body`, which are hyphenated siblings
    // inside it and have their own heights for their own reasons.
    if (!/(^|\s)\.ze-modal(\.[\w-]+)*$/.test(first)) continue;
    if (first === '.ze-modal') continue; // the default, checked separately
    if (/(^|[^-])(width|height)\s*:\s*[0-9]/.test(m[2] ?? '')) hits.push(first);
  }
  return hits.sort();
}

describe('the dialog default is Fit(), not a number', () => {
  it('.ze-modal declares no pixel width or height', () => {
    const css = readFileSync(SHELL, 'utf8');
    const rule = css.match(/\n\.ze-modal \{([^}]*)\}/)?.[1] ?? '';
    expect(rule).not.toBe('');
    const pixels = rule
      .split(';')
      .map((l) => l.trim())
      .filter((l) => /^(width|height)\s*:\s*[0-9]/.test(l));
    expect(pixels).toStrictEqual([]);
  });

  it('.ze-modal sizes to its content in both axes, which is what Fit() does', () => {
    const css = readFileSync(SHELL, 'utf8');
    const rule = css.match(/\n\.ze-modal \{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toMatch(/width:\s*max-content/);
    expect(rule).toMatch(/height:\s*max-content/);
  });
});

describe('the pile of hand-picked dialog sizes does not grow', () => {
  /*
   * Counted from the tree, per occurrence rather than per file, so removing one
   * moves this number and a new one cannot hide behind an old one in the same
   * file. Lower it in the same commit that removes a size; the two lists are
   * printed on failure so the diff is obvious.
   */
  it('32 call sites still name their own size', () => {
    expect(inlineSized()).toHaveLength(32);
  });

  it('13 shell.css variants still name their own size', () => {
    // 15 until `.ze-pgs` stopped restating what `.ze-modal` now gets right, and
    // 14 until Open Project became the shared file chooser: `.ze-open-project`
    // named a 920x620 and the window that replaced it is sized by the chooser,
    // not by the dialog. Lowered here rather than on either branch, because
    // neither tree had both changes in it.
    expect(cssSized()).toHaveLength(13);
  });

  it('and every one of them is a dialog, so the scan is really finding them', () => {
    for (const where of [...inlineSized(), ...cssSized()]) {
      expect(where).toMatch(/ze-modal|\.tsx:\d+/);
    }
    expect(inlineSized().length + cssSized().length).toBeGreaterThan(0);
  });
});
