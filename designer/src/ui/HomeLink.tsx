// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The mark and the name at the left of every menubar.
 *
 * One component rather than nine copies of the same markup: every launcher had
 * its own `<div className="ze-home-link">⌂ ZiroEDA</div>`, which is exactly the
 * shape that drifts — and had already drifted from the project manager, which
 * carried no branding at all.
 *
 * With `onClick` it is the way back to the project manager, as the `⌂` was.
 * Without one — in the manager itself — it is a label: no hover, no pointer,
 * because there is nowhere to go from home.
 */
import type { JSX } from 'react';
import { ZiroLogo } from './ZiroLogo.js';

export function HomeLink({ onClick }: { onClick?: () => void }): JSX.Element {
  return (
    <div
      className={onClick ? 'ze-home-link' : 'ze-home-link ze-home-link-static'}
      onClick={onClick}
      title={onClick ? 'Back to project manager' : undefined}
    >
      <ZiroLogo />
      <span>ZiroEDA</span>
    </div>
  );
}
