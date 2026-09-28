// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `FOOTPRINT_PREVIEW_WIDGET` (`include/widgets/footprint_preview_widget.h`,
 * `common/widgets/footprint_preview_widget.cpp`): the footprint pane of the
 * symbol and footprint choosers. It is common because all it does is host a
 * panel and show a status line instead of it when there is nothing to draw;
 * the panel, `FOOTPRINT_PREVIEW_PANEL`, is pcbnew's.
 *
 * Upstream the panel comes from the kiway
 * (`CreateKiWindow( FRAME_FOOTPRINT_PREVIEW )`); here the caller passes it as
 * a `FOOTPRINT_PREVIEW_PANEL_BASE`, the same interface narrowed to what the
 * widget calls.
 */

import { type JSX, type ReactNode, useEffect, useState } from 'react';

/**
 * `FOOTPRINT_PREVIEW_PANEL_BASE` as the widget uses it: `DisplayFootprint`'s
 * library lookup, and `GetWindow()`.
 */
export interface FOOTPRINT_PREVIEW_PANEL_BASE<FP> {
  /** Look a LIB_ID up in the footprint libraries; null is "not found". */
  resolve: (libId: string) => Promise<FP | null>;
  /** The canvas that shows a resolved footprint. */
  render: (footprint: FP) => ReactNode;
}

export interface FootprintPreviewWidgetProps<FP> {
  /** Footprint LIB_ID text to display, '' for none (SetStatusText branch). */
  footprint: string;
  /** Status label, e.g. "No footprint specified" (upstream SetStatusText). */
  statusText: string;
  /** The hosted panel (upstream: from the kiway). */
  panel: FOOTPRINT_PREVIEW_PANEL_BASE<FP>;
  /**
   * Overrides `panel.resolve`: the Assign Footprints window passes a resolver
   * that also serves the project's own `.pretty` libraries (the fp-lib-table's
   * project scope).
   */
  resolve?: (libId: string) => Promise<FP | null>;
}

export function FootprintPreviewWidget<FP>({
  footprint,
  statusText,
  panel,
  resolve,
}: FootprintPreviewWidgetProps<FP>): JSX.Element {
  const lookup = resolve ?? panel.resolve;
  const [fp, setFp] = useState<FP | null>(null);
  // `FOOTPRINT_PREVIEW_WIDGET` has two states, not three: `DisplayFootprint`
  // (common/widgets/footprint_preview_widget.cpp:107-123) either clears the
  // status or sets "Footprint not found." There is no loading state because the
  // read is off an already-resident library, so while ours is in flight the
  // widget keeps showing what it showed before — which is what upstream's panel
  // does too, since it only repaints once the new footprint resolves.
  const [status, setStatus] = useState<'idle' | 'missing'>('idle');

  // DisplayFootprint: fetch the .kicad_mod on selection change.
  useEffect(() => {
    let cancelled = false;
    if (!footprint) {
      setFp(null);
      setStatus('idle');
      return;
    }
    void lookup(footprint).then((loaded) => {
      if (cancelled) return;
      setFp(loaded);
      setStatus(loaded ? 'idle' : 'missing');
    });
    return () => {
      cancelled = true;
    };
  }, [footprint, lookup]);

  return (
    <div className="ze-fp-preview">
      {fp && footprint ? (
        panel.render(fp)
      ) : (
        <div className="ze-muted">
          {!footprint || status !== 'missing' ? statusText : 'Footprint not found.'}
        </div>
      )}
    </div>
  );
}
