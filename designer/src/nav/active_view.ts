// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The visible frame, stamped on the page for the frames' global key handlers: the editors stay
 * mounted behind `display: none`, and a keystroke meant for one must not drive another. Each
 * handler reads `document.body.dataset.activeView` and stands down unless it names its own frame.
 */

/**
 * Stamp \a aView as the visible frame. A page without a `<body>` at that moment has nothing to
 * stamp and nothing a key could reach - it threw instead, out of the effect, which took the app
 * down through the error boundary (Sentry 1Z: `Cannot read properties of null (reading
 * 'dataset')`, leaving the Symbol Editor for the Project Manager).
 */
export function stampActiveView(aView: string): void {
  const body = document.body;

  if (body) body.dataset.activeView = aView;
}
