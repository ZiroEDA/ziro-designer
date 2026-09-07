// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The other half of "a paged dialog is one size", and the half a DOM test
 * cannot reach: happy-dom lays out nothing, so `min-width` on a scroll
 * container is invisible to `paged_dialog_resize.test.tsx`. It is asserted
 * here as the declaration it is, in a node environment that can read the file.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const CSS = readFileSync(
  fileURLToPath(new URL('../../../designer/src/ui/shell.css', import.meta.url)),
  'utf8',
);

describe('the page area lets itself be narrower than its content', () => {
  /**
   * The other half of the rule, and the half a DOM test cannot reach: happy-dom
   * lays out nothing, so `min-width` on a scroll container is invisible to
   * every case above. It is asserted as the declaration it is.
   *
   * `min-width: min-content` on the page area means the panel REFUSES to be
   * narrower than its content, so a wide page pushes the width out through
   * `.ze-modal`'s `max-content` and the dialog grows — which is exactly the
   * resizing the stated size above exists to stop. The two are one mechanism;
   * a stated size with a `min-content` page area still grows.
   *
   * Per panel, not per file: there are exactly two page areas in the app and
   * both must say it.
   */
  const declarationsOf = (selector: string): string => {
    const at = CSS.indexOf(`${selector} {`);
    expect(at, `${selector} is not in shell.css`).toBeGreaterThan(-1);
    return CSS.slice(at, CSS.indexOf('\n}', at)).replace(/\/\*[\s\S]*?\*\//g, '');
  };

  for (const panel of ['.ze-paged-panel', '.ze-prefs-panel']) {
    it(`${panel} is min-width: 0`, () => {
      const decls = declarationsOf(panel);
      expect(decls).toMatch(/min-width:\s*0\s*;/);
      expect(decls).not.toMatch(/min-width:\s*min-content/);
    });
  }

  it('and both scroll, so the content that does not fit is still reachable', () => {
    // A panel that may be narrower than its content but does not scroll clips
    // it instead, which is worse than a dialog that grows.
    for (const panel of ['.ze-paged-panel', '.ze-prefs-panel']) {
      expect(declarationsOf(panel), panel).toMatch(/overflow(-y)?:\s*auto\s*;/);
    }
  });
});
