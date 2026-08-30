// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `FOOTPRINT_CHOOSER_FRAME` (pcbnew/footprint_chooser_frame.cpp) — what the
 * Footprint field's browse button opens, from the Properties panel and from
 * Symbol Properties alike.
 *
 * Its counterpart is `SYMBOL_CHOOSER_FRAME`, and the two are deliberately not
 * one file: they host different panels. What they share is `LIB_TREE`, which is
 * where KiCad shares it and the only place we do.
 *
 * The frame owns three things the panel does not:
 *
 *  - the TITLE, `"Footprint Chooser"` plus `" (%d items loaded)"` (:198);
 *  - the two FILTER CHECKBOXES, which it puts in the panel's filters slot -
 *    `m_chooserPanel->GetFiltersSizer()->Add( m_filterByFPFilters, 0,
 *    wxEXPAND|wxBOTTOM, 4 )` (:590). They live here because only the frame
 *    knows the symbol's fp_filters and pin count, which arrive by KIWAY mail
 *    from the schematic; a filter with nothing to filter on is HIDDEN rather
 *    than shown unticked (`else { if( m_filterByFPFilters ) …->Hide(); }`);
 *  - the bottom panel: "Show 3D viewer in own window" (:178) and a
 *    wxStdDialogButtonSizer.
 *
 * Ticking either checkbox calls `m_chooserPanel->Regenerate()` (:580), which
 * rebuilds the tree against the new filter - not a client-side hide.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';
import { PanelFootprintChooser } from '../widgets/panel_footprint_chooser.js';
import type { FootprintTreeFilter } from '../widgets/fp_tree_model_adapter.js';
import { loadFootprintIndex, type FpIndexEntry } from '../../../widgets/footprint_list.js';
import { useModalEscape } from '../../../ui/useModalEscape.js';

export interface FootprintChooserFrameProps {
  /**
   * `ShowModal( wxString* aFootprint, … )`: the caller's current text,
   * preselected when it names a footprint.
   */
  preselect?: string;
  /**
   * The symbol's `ki_fp_filters`, which upstream receives as
   * MAIL_SYMBOL_NETLIST. Empty or absent means the "Apply footprint filters"
   * checkbox is never built.
   */
  fpFilters?: readonly string[];
  /**
   * The symbol's pin count, from the same netlist. Absent means the "Filter by
   * pin count" checkbox is never built.
   */
  pinCount?: number;
  /** OK with a valid selection: the chosen `LIB_ID::Format()`. */
  onOk: (libId: string) => void;
  /** Cancel, Escape, or OK with nothing chosen — `DismissModal( false )`. */
  onCancel: () => void;
}

export function FootprintChooserFrame({
  preselect,
  fpFilters,
  pinCount,
  onOk,
  onCancel,
}: FootprintChooserFrameProps): JSX.Element {
  useModalEscape(onCancel);

  const [index, setIndex] = useState<readonly FpIndexEntry[]>([]);
  const [itemCount, setItemCount] = useState(0);
  const [selected, setSelected] = useState<string | null>(preselect ?? null);

  // `cfg->m_FootprintChooser.use_fp_filters` / `.filter_on_pin_count` seed
  // these upstream and are written back in the destructor (:302-306). Ours
  // start ticked, which is what a fresh profile does, and the settings round
  // trip is left for when the frame has somewhere to persist it.
  const [useFpFilters, setUseFpFilters] = useState(true);
  const [filterByPins, setFilterByPins] = useState(true);

  useEffect(() => {
    let live = true;
    void loadFootprintIndex().then((i) => {
      if (live) setIndex(i);
    });
    return () => {
      live = false;
    };
  }, []);

  const hasFpFilters = (fpFilters?.length ?? 0) > 0;
  const hasPinCount = pinCount !== undefined;

  const filter = useMemo<FootprintTreeFilter>(
    () => ({
      ...(hasFpFilters && useFpFilters ? { fpFilters } : {}),
      ...(hasPinCount && filterByPins ? { pinCount } : {}),
    }),
    [hasFpFilters, useFpFilters, fpFilters, hasPinCount, filterByPins, pinCount],
  );

  const accept = useCallback(() => {
    // `if( !fpid.empty() ) … else DismissModal( false )` — OK with nothing
    // chosen closes without changing the caller's field.
    if (selected) onOk(selected);
    else onCancel();
  }, [selected, onOk, onCancel]);

  /**
   * What goes in `GetFiltersSizer()`. Each is built only when there is
   * something for it to filter on, which is upstream's `if( !m_fpFilters
   * .empty() )` / `Hide()` pair rather than a disabled checkbox.
   */
  const filters =
    hasFpFilters || hasPinCount ? (
      <>
        {hasFpFilters && (
          <label className="ze-check">
            <input
              type="checkbox"
              checked={useFpFilters}
              onChange={(e) => setUseFpFilters(e.target.checked)}
            />
            {/* `msg.Printf( _( "Apply footprint filters (%s)" ), strings[1] )`
                — the patterns are IN the label, space separated. */}
            <span>{`Apply footprint filters (${(fpFilters ?? []).join(' ')})`}</span>
          </label>
        )}
        {hasPinCount && (
          <label className="ze-check">
            <input
              type="checkbox"
              checked={filterByPins}
              onChange={(e) => setFilterByPins(e.target.checked)}
            />
            <span>{`Filter by pin count (${pinCount})`}</span>
          </label>
        )}
      </>
    ) : undefined;

  return (
    <div className="ze-modal-backdrop" onMouseDown={onCancel}>
      <div className="ze-modal ze-fpchooser-frame" onMouseDown={(e) => e.stopPropagation()}>
        {/* `SetTitle( GetTitle() + " (%d items loaded)" )` (:198). */}
        <div className="ze-modal-header">
          {`Footprint Chooser (${itemCount} items loaded)`}
          <span className="x" onClick={onCancel}>
            ✕
          </span>
        </div>
        <div className="ze-modal-body">
          <PanelFootprintChooser
            index={index}
            filter={filter}
            filters={filters}
            preselect={preselect}
            onSelect={setSelected}
            onChoose={(id) => onOk(id)}
            onItemCountChanged={setItemCount}
          />
        </div>
        <div className="ze-cp-buttons ze-fpchooser-foot">
          {/* m_show3DViewer (:178). Disabled: the 3D viewer is a child frame
              this app opens from the board editor, and there is nothing to
              show it from here yet. Present because the row's shape is
              upstream's and hiding it would put the buttons in the wrong place. */}
          <label className="ze-check" title="Needs the 3D viewer">
            <input type="checkbox" disabled />
            <span>Show 3D viewer in own window</span>
          </label>
          <div className="ze-modal-footer">
            <button type="button" className="ze-btn" onClick={onCancel}>
              Cancel
            </button>
            <button type="button" className="ze-btn primary" onClick={accept}>
              OK
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
