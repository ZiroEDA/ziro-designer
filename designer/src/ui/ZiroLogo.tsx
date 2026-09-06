// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * ZiroEDA's mark, drawn inline so it takes the surrounding colour where it can
 * and needs no network round trip in the app shell.
 *
 * The same artwork is in `designer/public/favicon.svg` for the browser tab —
 * that copy has to be a file, because a `<link rel="icon">` cannot hold a
 * component. The two are the same paths and must be changed together.
 *
 * `size` is the drawn square in CSS px. The default 16 is the menubar's: the
 * bar is `--menu-row` tall (26px, measured from GtkMenuBar) and a 16px mark
 * sits inside its text line without pushing the row taller.
 */
import type { JSX } from 'react';

export function ZiroLogo({ size = 16 }: { size?: number }): JSX.Element {
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      // Decorative: the text beside it already says ZiroEDA, so a second
      // announcement would just repeat itself to a screen reader.
      aria-hidden="true"
      focusable="false"
      style={{ display: 'block', flex: '0 0 auto' }}
    >
      {/* The mark's own ink, not chrome: these colours ARE the logo, the way a
          bitmap KiCad ships is, so they take no theme token and are the same
          values as public/favicon.svg. Each is marked on its own line. */}
      <circle
        cx="50"
        cy="50"
        r="45"
        // [art] the mark's near-black disc.
        fill="#18181b"
        // [art] the ring around it.
        stroke="#ffffff"
        strokeWidth="4"
      />
      <path
        d="M 15 70 A 40 40 0 0 0 50 89"
        // [art] the teal arc of the mark.
        stroke="#14b8a6"
        strokeWidth="5"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M 35 35 H 65 L 35 65 H 65"
        // [art] the Z, in the mark's own white.
        stroke="#ffffff"
        strokeWidth="8"
        strokeLinecap="square"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}
