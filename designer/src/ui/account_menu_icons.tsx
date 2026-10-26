// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The glyphs in the account menu's icon column (ui/AccountButton.tsx), one per row.
 *
 * [data] Excalidraw's own (packages/excalidraw/components/icons.tsx, MIT) wherever it has one,
 * because the menu is modelled on its main menu: `GithubIcon`, `DiscordIcon`, `loginIcon`,
 * `LockedIcon`, `TrashIcon`. Sign out is the Tabler `logout` that Excalidraw's `loginIcon` is the
 * other half of (Tabler Icons, MIT). Drawn in `currentColor`, so a row's ink - the critical colour
 * on Delete account - is the glyph's too.
 */
import type { JSX, ReactNode } from 'react';

/** Excalidraw's `modifiedTablerIconProps` (20-unit box) and `tablerIconProps` (24, width 2). */
function glyph(aBox: 20 | 24, aChildren: ReactNode): JSX.Element {
  return (
    <svg
      viewBox={`0 0 ${aBox} ${aBox}`}
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={aBox === 24 ? 2 : undefined}
      aria-hidden="true"
    >
      {aChildren}
    </svg>
  );
}

export const githubGlyph = glyph(
  20,
  <path
    strokeWidth="1.25"
    d="M7.5 15.833c-3.583 1.167-3.583-2.083-5-2.5m10 4.167v-2.917c0-.833.083-1.166-.417-1.666 2.334-.25 4.584-1.167 4.584-5a3.833 3.833 0 0 0-1.084-2.667 3.5 3.5 0 0 0-.083-2.667s-.917-.25-2.917 1.084a10.25 10.25 0 0 0-5.166 0C5.417 2.333 4.5 2.583 4.5 2.583a3.5 3.5 0 0 0-.083 2.667 3.833 3.833 0 0 0-1.084 2.667c0 3.833 2.25 4.75 4.584 5-.5.5-.5 1-.417 1.666V17.5"
  />,
);

export const discordGlyph = glyph(
  20,
  <g strokeWidth="1.25">
    <path d="M7.5 10.833a.833.833 0 1 0 0-1.666.833.833 0 0 0 0 1.666ZM12.5 10.833a.833.833 0 1 0 0-1.666.833.833 0 0 0 0 1.666ZM6.25 6.25c2.917-.833 4.583-.833 7.5 0M5.833 13.75c2.917.833 5.417.833 8.334 0" />
    <path d="M12.917 14.167c0 .833 1.25 2.5 1.666 2.5 1.25 0 2.361-1.39 2.917-2.5.556-1.39.417-4.861-1.25-9.584-1.214-.846-2.5-1.116-3.75-1.25l-.833 2.084M7.083 14.167c0 .833-1.13 2.5-1.526 2.5-1.191 0-2.249-1.39-2.778-2.5-.529-1.39-.397-4.861 1.19-9.584 1.157-.846 2.318-1.116 3.531-1.25l.833 2.084" />
  </g>,
);

export const signInGlyph = glyph(
  24,
  <g strokeWidth={1.5}>
    <path d="M15 8v-2a2 2 0 0 0 -2 -2h-7a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h7a2 2 0 0 0 2 -2v-2" />
    <path d="M21 12h-13l3 -3" />
    <path d="M11 15l-3 -3" />
  </g>,
);

export const signOutGlyph = glyph(
  24,
  <g strokeWidth={1.5}>
    <path d="M14 8v-2a2 2 0 0 0 -2 -2h-7a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h7a2 2 0 0 0 2 -2v-2" />
    <path d="M9 12h12l-3 -3" />
    <path d="M18 15l3 -3" />
  </g>,
);

export const recoveryKeyGlyph = glyph(
  20,
  <g strokeWidth="1.25">
    <path d="M13.542 8.542H6.458a2.5 2.5 0 0 0-2.5 2.5v3.75a2.5 2.5 0 0 0 2.5 2.5h7.084a2.5 2.5 0 0 0 2.5-2.5v-3.75a2.5 2.5 0 0 0-2.5-2.5Z" />
    <path d="M10 13.958a1.042 1.042 0 1 0 0-2.083 1.042 1.042 0 0 0 0 2.083Z" />
    <path d="M6.667 8.333V5.417C6.667 3.806 8.159 2.5 10 2.5c1.841 0 3.333 1.306 3.333 2.917v2.916" />
  </g>,
);

export const deleteAccountGlyph = glyph(
  20,
  <path
    strokeWidth="1.25"
    d="M3.333 5.833h13.334M8.333 9.167v5M11.667 9.167v5M4.167 5.833l.833 10c0 .92.746 1.667 1.667 1.667h6.666c.92 0 1.667-.746 1.667-1.667l.833-10M7.5 5.833v-2.5c0-.46.373-.833.833-.833h3.334c.46 0 .833.373.833.833v2.5"
  />,
);
