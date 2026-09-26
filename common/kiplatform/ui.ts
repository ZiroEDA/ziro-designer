// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `libs/kiplatform/include/kiplatform/ui.h`, the browser port: what the
 * canvas code asks the platform for. A browser cannot warp the pointer, so
 * `WarpPointer` fails the way it does on a Wayland display, and every
 * caller already handles that answer.
 */

import { WXK } from '@ziroeda/core/src/wx_keycodes.js';
import { wxSetKeyState } from '../wx/wx_event.js';

/** `wxWindow` as the platform layer reaches it: the element, its client size and focus. */
export interface KIPLATFORM_WINDOW {
  GetHandle(): HTMLElement | null;
  HasFocus(): boolean;
  SetFocus(): void;
}

/** The last pointer position the platform saw, in screen (page) coordinates. */
let s_mousePosition = { x: 0, y: 0 };

/**
 * Get the mouse position in screen coordinates: the position of the last
 * pointer event the panel forwarded to {@link SetMousePosition}.
 */
export function GetMousePosition(): { x: number; y: number } {
  return { ...s_mousePosition };
}

/** The platform's half: the panel records every pointer event's page position here. */
export function SetMousePosition(aX: number, aY: number): void {
  s_mousePosition = { x: aX, y: aY };
}

/** Record the modifier state carried by a DOM event, for `wxGetKeyState`. */
export function RecordModifierState(aEvent: {
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): void {
  wxSetKeyState(WXK.WXK_CONTROL, aEvent.ctrlKey);
  wxSetKeyState(WXK.WXK_SHIFT, aEvent.shiftKey);
  wxSetKeyState(WXK.WXK_ALT, aEvent.altKey);
  // On GTK WXK_RAW_CONTROL is WXK_CONTROL; the meta key is not a wx modifier there.
}

/**
 * Move the mouse cursor to a specific position relative to the window.
 *
 * @return true if the warp was successful.
 *
 * No browser API moves the pointer; this is the Wayland answer.
 */
export function WarpPointer(_aWindow: KIPLATFORM_WINDOW, _aX: number, _aY: number): boolean {
  return false;
}

/**
 * Configures the IME mode of a given control handle.
 */
export function ImmControl(_aWindow: KIPLATFORM_WINDOW, _aEnable: boolean): void {}

/**
 * Check to see if the given window is the currently active window (e.g. the window
 * in the foreground the user is interacting with).
 *
 * The frame is a document here; it is active when the document has focus.
 */
export function IsWindowActive(_aWindow: unknown): boolean {
  return typeof document !== 'undefined' ? document.hasFocus() : true;
}

/**
 * Sets the mouse pointer for infinite drag, and prepares the window for it.
 *
 * @return true if the platform supports infinite drag (the browser's pointer
 *         lock would; it is not requested here, so the drag is finite).
 */
export function InfiniteDragPrepareWindow(_aWindow: KIPLATFORM_WINDOW): boolean {
  return false;
}

/** Releases the window from infinite drag mode. */
export function InfiniteDragReleaseWindow(): void {}

/** Enables or disables overlay scrolling for a window. */
export function SetOverlayScrolling(_aWindow: KIPLATFORM_WINDOW, _aOverlay: boolean): void {}

/** Cancels any IME composition in progress. */
export function ImeNotifyCancelComposition(_aWindow: KIPLATFORM_WINDOW): void {}
