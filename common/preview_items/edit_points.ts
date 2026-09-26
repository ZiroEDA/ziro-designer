// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `EDIT_POINT`'s screen sizes (`include/tool/edit_points.h:193-202`) — one
 * header upstream, so one module here.
 *
 * They are SCREEN sizes, not world ones: `EDIT_POINTS::ViewDraw` converts each
 * through `aView->ToWorld( … )` (`edit_points.cpp:290-292`) precisely so a
 * handle stays the same size on screen however far you are zoomed. `ToWorld`
 * divides by the VIEW's scale, and the VIEW is sized from
 * `wxWindow::GetClientSize()` (`draw_panel_gal.cpp:459`), which is LOGICAL
 * pixels — so these are logical pixels and a canvas drawing in device space
 * multiplies by the device pixel ratio.
 *
 * That is the opposite of the selection band's pen, which is one DEVICE pixel
 * because it goes through `syncLineWidth`'s clamp rather than through `ToWorld`.
 * The two really do differ, and reasoning from one to the other gets it wrong.
 *
 * The colours are not here: they are derived rather than fixed, and
 * `editPointColors` in `color4d.ts` is that derivation.
 */

/**
 * `static const int POINT_SIZE = 8` — the full width of the square.
 * `ViewDraw` halves it (`edit_points.cpp:290`) and draws corner to corner.
 */
export const EDIT_POINT_SIZE = 8;

/**
 * `BORDER_SIZE` / `HOVER_SIZE`, the idle and hovered border widths.
 *
 * Upstream these are platform-conditional:
 *
 *     #ifdef __WXMAC__
 *         static const int BORDER_SIZE = 3;
 *         static const int HOVER_SIZE  = 6;
 *     #else
 *         static const int BORDER_SIZE = 2;
 *         static const int HOVER_SIZE  = 5;
 *     #endif
 *
 * We take the `#else` arm, because the parity target is the KiCad installed on
 * this machine and that is a GTK build. The schematic canvas had 3 and 6 — the
 * MAC arm — which is the failure mode of reading a header without its guard.
 */
export const EDIT_POINT_BORDER_SIZE = 2;
export const EDIT_POINT_HOVER_SIZE = 5;

/**
 * `gal->SetLineWidth( borderSize / 4 )` for the line joining an EDIT_LINE's
 * two ends (`edit_points.cpp:319`).
 */
export const EDIT_LINE_WIDTH = EDIT_POINT_BORDER_SIZE / 4;
