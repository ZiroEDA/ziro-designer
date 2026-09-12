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
import { footprintHistory } from '../widgets/footprint_history.js';
import { FootprintPreview3D, useFootprintHolderBoard } from '../widgets/footprint_preview_3d.js';
import { Viewer3DFrame } from '../Viewer3DFrame.js';
import { loadFootprintIndex, type FpIndexEntry } from '../../../widgets/footprint_list.js';
import { useModalEscape } from '../../../ui/useModalEscape.js';
import { bitmapUrl } from '../../../ui/toolbarIcons.js';

/**
 * `inline static bool m_showDescription = true; m_showFpMode = true;
 * m_show3DMode = false;` (footprint_chooser_frame.h:136-138) — one value per
 * process, so a chooser opens the way the last one was left, and a restart
 * resets them. Module-level for the same reason.
 */
const views = { description: true, fp: true, threeD: false };

/**
 * `BITMAP_BUTTON` with `SetIsRadioButton()` and `Check()`, the bottom panel's
 * three toggles. The same class paints the text-format bars, so it is their
 * `.ze-lp-iconbtn` rule and not a second one.
 */
function ViewToggle({
  bitmap,
  tooltip,
  checked,
  onClick,
}: {
  bitmap: string;
  tooltip: string;
  checked: boolean;
  onClick: () => void;
}): JSX.Element {
  const url = bitmapUrl(bitmap);
  return (
    <button
      type="button"
      className={`ze-lp-iconbtn${checked ? ' checked' : ''}`}
      title={tooltip}
      aria-pressed={checked}
      onClick={onClick}
    >
      {url ? <img src={url} alt="" /> : tooltip}
    </button>
  );
}

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
  /**
   * `SetTitle( GetTitle() + " (%d items loaded)" )` runs ONCE, in the
   * constructor, before any `Regenerate()` - so the count is the whole library
   * and ticking a filter never moves it. Ours recomputed it per filter and
   * dropped to 59.
   */
  const itemCount = useMemo(() => index.reduce((n, lib) => n + lib.footprints.length, 0), [index]);
  const [selected, setSelected] = useState<string | null>(preselect ?? null);

  /**
   * `cfg->m_FootprintChooser.use_fp_filters` / `.filter_on_pin_count` seed
   * these and are written back in the destructor (:302-306). BOTH DEFAULT TO
   * FALSE - `pcbnew_settings.cpp:146-150` registers each `PARAM<bool>( …,
   * false )` - so a chooser opens with the boxes present and UNTICKED, showing
   * the whole library. Ours opened ticked, which filtered the tree before the
   * user asked for it. The settings round trip is still to do.
   */
  const [useFpFilters, setUseFpFilters] = useState(false);
  const [filterByPins, setFilterByPins] = useState(false);

  const [showDescription, setShowDescription] = useState(views.description);
  const [showFp, setShowFp] = useState(views.fp);
  const [show3D, setShow3D] = useState(views.threeD);
  /** `m_show3DViewer`, unticked on every open — a plain wxCheckBox, no setting. */
  const [ownWindow, setOwnWindow] = useState(false);
  const holderBoard = useFootprintHolderBoard(show3D ? (selected ?? '') : '');

  /** `toggleBottomSplit` (:808-838). */
  const toggleDescription = (): void => {
    views.description = !showDescription;
    setShowDescription(views.description);
  };
  /**
   * `on3DviewReq` / `onFpViewReq` (:843-895): each may switch itself OFF only
   * while the other is on, so the right column is never empty. Turning 3D on
   * with "own window" ticked also opens the external viewer.
   */
  const toggle3D = (): void => {
    if (show3D) {
      if (!showFp) return;
      views.threeD = false;
    } else {
      views.threeD = true;
    }
    setShow3D(views.threeD);
  };
  const toggleFp = (): void => {
    if (showFp) {
      if (!show3D) return;
      views.fp = false;
    } else {
      views.fp = true;
    }
    setShowFp(views.fp);
  };

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
            history={footprintHistory()}
            showFpView={showFp}
            preview3D={show3D ? <FootprintPreview3D board={holderBoard} /> : undefined}
            showDetails={showDescription}
            onSelect={setSelected}
            onChoose={(id) => onOk(id)}
          />
        </div>
        {/* buttonsSizer (:144-191): a stretch spacer, then the three
            BITMAP_BUTTONs with their two separators, the checkbox, a 20px
            spacer and the wxStdDialogButtonSizer — everything right-aligned. */}
        <div className="ze-cp-buttons ze-fpchooser-foot">
          <ViewToggle
            bitmap={showDescription ? 'text_visibility_off' : 'text_visibility'}
            tooltip="Show/hide description panel"
            checked={showDescription}
            onClick={toggleDescription}
          />
          <span className="ze-lp-sep" />
          <ViewToggle
            bitmap="shape_3d"
            tooltip="Show/hide 3D view panel"
            checked={show3D}
            onClick={toggle3D}
          />
          <ViewToggle
            bitmap="module"
            tooltip="Show/hide footprint view panel"
            checked={showFp}
            onClick={toggleFp}
          />
          <span className="ze-lp-sep" />
          {/* m_show3DViewer (:178) — `onExternalViewer3DEnable`: ticked with
              the 3D view on opens EDA_3D_VIEWER_FRAME; unticked closes it. */}
          <label className="ze-check">
            <input
              type="checkbox"
              checked={ownWindow}
              onChange={(e) => setOwnWindow(e.target.checked)}
            />
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
      {/* `Show3DViewerFrame` (:370-387): the child EDA_3D_VIEWER_FRAME over
          the holder board, titled `_( "3D Viewer" ) + " — " + fpID.Format()`
          (:396-398). Closing it is the frame's own close; the checkbox stays
          ticked upstream too, until the user clears it. */}
      {show3D && ownWindow && (
        <Viewer3DFrame
          board={holderBoard}
          title={`3D Viewer — ${selected ?? ''}`}
          backLabel="← Footprint Chooser"
          imageBaseName={(selected ?? 'footprint').replace(/^.*:/, '')}
          onClose={() => setOwnWindow(false)}
        />
      )}
    </div>
  );
}
