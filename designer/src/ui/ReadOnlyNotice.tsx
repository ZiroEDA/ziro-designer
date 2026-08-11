// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The strip across the top of the canvas saying this document is not being
 * saved, and offering the one action that changes that.
 *
 * Where KiCad puts the same message: eeschema shows "Schematic is read only."
 * in its WX_INFOBAR above the drawing area, not as a floating card over it. It
 * shares `.ze-infobar` with the tool messages for that reason, and takes its own
 * row rather than covering the board.
 */
import type { JSX } from 'react';

export function ReadOnlyNotice({
  message,
  actionLabel,
  onAction,
}: {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}): JSX.Element {
  return (
    <div className="ze-infobar ze-readonly-infobar" role="status">
      <span>{message}</span>
      {actionLabel && onAction && (
        <button type="button" onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </div>
  );
}
