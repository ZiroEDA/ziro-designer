// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The hook a dialog calls to get `wxDialog`'s free Esc-cancels behaviour.
 *
 * One line at the top of a dialog component:
 *
 *     useModalEscape( onClose );
 *
 * See modal_escape.ts for why it is a stack and what Esc is allowed to mean.
 * Split from it so the registry stays testable without React.
 */
import { useEffect, useRef } from 'react';
import { pushModalCancel } from './modal_escape.js';

/**
 * Close this dialog when Esc is pressed and it is the topmost one.
 *
 * `cancel` is read through a ref rather than captured by the effect, because a
 * dialog's close handler is usually an inline arrow and so has a new identity
 * every render. Depending on it would re-register on each one, and each
 * re-registration moves the dialog to the top of the stack - so a repainting
 * background dialog would start swallowing the Esc meant for the one in front
 * of it.
 *
 * `enabled` is for a dialog that renders while closed. Passing `false`
 * unregisters it, so it does not sit on the stack absorbing the key.
 */
export function useModalEscape(cancel: () => void, enabled = true): void {
  const cancelRef = useRef(cancel);
  cancelRef.current = cancel;

  useEffect(() => {
    if (!enabled) return undefined;
    return pushModalCancel(() => cancelRef.current());
  }, [enabled]);
}
