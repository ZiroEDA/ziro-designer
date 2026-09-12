// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PANEL_FOOTPRINT_CHOOSER` (pcbnew/widgets/panel_footprint_chooser.cpp).
 *
 * Its own class, not the symbol chooser with a flag. Upstream keeps
 * PANEL_SYMBOL_CHOOSER and PANEL_FOOTPRINT_CHOOSER separate and shares
 * `LIB_TREE` between them, and the two panels really do differ: this one has a
 * footprint preview rather than a symbol one, no unit rows, no "Already
 * Placed" group, and a filters slot its FRAME fills.
 *
 * The layout is two nested splitters (`:110-155`):
 *
 *     vsplitter   SplitHorizontally( hsplitter, detailsPanel )
 *                 SetSashGravity( 0.5 ), SetMinimumPaneSize( 80 )
 *     hsplitter   SplitVertically( m_tree, RightPanel )
 *                 SetSashGravity( 0.8 ), SetMinimumPaneSize( 20 )
 *
 * so the tree and the preview share the top and the details pane has the
 * bottom half. The tree is built with `LIB_TREE::FLAGS::ALL_WIDGETS` and is
 * HANDED the details window:
 *
 *     m_tree = new LIB_TREE( m_hsplitter, wxT( "footprints" ), m_adapter,
 *                            LIB_TREE::FLAGS::ALL_WIDGETS, m_details );
 *
 * — the tree writes the description itself, which is why nothing here listens
 * for a selection just to fill that pane.
 *
 * `GetFiltersSizer()` is a one-line forward to the tree's, and the frame is
 * what puts checkboxes in it: only the frame knows the symbol's fp_filters and
 * pin count. That is the whole reason the slot exists.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { JSX } from 'react';
import { LibTree } from '../../../widgets/lib_tree.js';
import { LibTreeModelAdapter } from '../../../widgets/lib_tree_model_adapter.js';
import { LibTreeNodeType, type LibTreeNode } from '../../../widgets/lib_tree_model.js';
import { FootprintPreviewWidget } from '../../../widgets/footprint_preview_widget.js';
import type { FpIndexEntry } from '../../../widgets/footprint_list.js';
import {
  addFootprintHistory,
  addFootprintLibraries,
  type FootprintTreeFilter,
} from './fp_tree_model_adapter.js';
import { generateFootprintInfo } from './generate_footprint_info.js';

/** `m_vsplitter->SetSashGravity( 0.5 )` — tree+preview over details. [data] */
const V_SASH_GRAVITY = 0.5;
/** `m_hsplitter->SetSashGravity( 0.8 )` — tree over preview. [data] */
const H_SASH_GRAVITY = 0.8;

/**
 * The default history, ONE array for the life of the module. A `= []` default
 * parameter is a fresh array on every render, and the adapter is memoised on
 * `history` — so every render rebuilt the tree, the rebuild bumped the
 * regenerate nonce, the nonce re-rendered, and the panel never settled. The
 * chooser test spun at 100% CPU for as long as it was left.
 */
const NO_HISTORY: readonly string[] = [];

export interface PanelFootprintChooserProps {
  /** The shipped footprint index; the frame loads it and hands it over. */
  index: readonly FpIndexEntry[];
  /**
   * `adapter->SetFilter( &m_filter )` (:104). The frame owns this — it is the
   * state of the two checkboxes it put in the filters slot.
   */
  filter?: FootprintTreeFilter;
  /** What the frame put in `GetFiltersSizer()`. */
  filters?: ReactNode;
  /** `SetPreselect`: the caller's current footprint, if it names one. */
  preselect?: string;
  /**
   * `aFootprintHistoryList` — the "-- Recently Used --" group's LIB_IDs, most
   * recent first. The group is built even when this is empty (:97-99).
   */
  history?: readonly string[];
  /** `viewFpPanel->Show( m_showFpMode )` (footprint_chooser_frame.cpp:925). */
  showFpView?: boolean;
  /**
   * `m_preview3DCanvas`, which the FRAME builds and adds to this panel's
   * `m_RightPanelSizer` under the footprint view (:796); absent when
   * `m_show3DMode` is off.
   */
  preview3D?: ReactNode;
  /** `GetDetailsPanel()->Show( m_showDescription )` (:814). */
  showDetails?: boolean;
  /** EVT_LIBITEM_SELECTED — the frame tracks it for OK. */
  onSelect: (libId: string | null) => void;
  /** EVT_LIBITEM_CHOSEN — a double-click, which accepts. */
  onChoose: (libId: string) => void;
  /**
   * `m_adapter->GetItemCount()` AFTER the current filter. Not the frame's
   * title: that is set once in the constructor from the unfiltered tree and
   * never moves, so a caller wanting "items loaded" must not take it from here.
   */
  onItemCountChanged?: (n: number) => void;
}

/** `LIB_ID::Format()` for a tree item, or null for a library or nothing. */
function libIdOf(node: LibTreeNode | null): string | null {
  if (!node || node.type !== LibTreeNodeType.ITEM) return null;
  return `${node.libNickname}:${node.libItemName}`;
}

export function PanelFootprintChooser({
  index,
  filter,
  filters,
  preselect,
  history = NO_HISTORY,
  showFpView = true,
  preview3D,
  showDetails = true,
  onSelect,
  onChoose,
  onItemCountChanged,
}: PanelFootprintChooserProps): JSX.Element {
  // `if( historyInfos.size() ) adapter->SetPreselectNode( historyInfos[0]… )`
  // in the constructor (:101-102), then the caller's `SetPreselect` on the
  // built panel — so an explicit preselect wins over the history's.
  const effectivePreselect = preselect || history[0];
  const [selected, setSelected] = useState<string | null>(effectivePreselect ?? null);
  /**
   * `LIB_TREE::SelectLibId` only takes effect once the node it names EXISTS,
   * which is why LibTree keys that effect on this nonce as well as on the id.
   * The index arrives after mount, so without bumping it here the preselection
   * silently never happened: the chooser opened on nothing even when the field
   * already named a footprint.
   */
  const [regenerateNonce, setRegenerateNonce] = useState(0);

  /**
   * What the details pane draws. `FP_TREE_MODEL_ADAPTER::GenerateInfo` calls
   * `GenerateFootprintInfo( m_libs, aLibId )` (fp_tree_model_adapter.cpp:79),
   * which reads the FOOTPRINT_INFO for that id; ours reads the same three
   * fields out of the index rather than fetching the .kicad_mod.
   */
  const selectedInfo = useMemo(() => {
    if (!selected) return null;
    const colon = selected.indexOf(':');
    if (colon < 0) return null;
    const nick = selected.slice(0, colon);
    const name = selected.slice(colon + 1);
    const lib = index.find((l) => l.name === nick);
    const i = lib?.footprints.indexOf(name) ?? -1;
    if (!lib || i < 0) return { libId: selected };
    return { libId: selected, description: lib.descr?.[i], keywords: lib.tags?.[i] };
  }, [selected, index]);

  // `m_adapter = FP_TREE_MODEL_ADAPTER::Create(...)` then `AddLibraries`.
  // Rebuilt when the filter changes, which is what `Regenerate()` does when a
  // checkbox is ticked (footprint_chooser_frame.cpp:580).
  const adapter = useMemo(() => {
    const a = new LibTreeModelAdapter();
    // The history group first (:79-99), then `AddLibraries` (:105).
    addFootprintHistory(a, index, history);
    addFootprintLibraries(a, index, filter ?? {});
    onItemCountChanged?.(a.getItemCount());
    return a;
  }, [index, filter, history, onItemCountChanged]);

  // A new tree is a new chance for the preselection to find its node.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the adapter identity
  useEffect(() => {
    setRegenerateNonce((n) => n + 1);
  }, [adapter]);

  const select = useCallback(
    (node: LibTreeNode | null) => {
      const id = libIdOf(node);
      setSelected(id);
      onSelect(id);
    },
    [onSelect],
  );

  const choose = useCallback(
    (node: LibTreeNode) => {
      const id = libIdOf(node);
      if (id) onChoose(id);
    },
    [onChoose],
  );

  return (
    <div className="ze-fpchooser">
      {/* m_hsplitter: the tree, then the preview panel. */}
      <div className="ze-fpchooser-top" style={{ ['--h-sash' as string]: H_SASH_GRAVITY }}>
        <div className="ze-fpchooser-tree">
          <LibTree
            adapter={adapter}
            recentSearchesKey="footprints"
            filters={filters}
            selectLibId={effectivePreselect}
            regenerateNonce={regenerateNonce}
            // The tree owns the details pane upstream; ours renders it below
            // rather than inside, so it is told not to draw its own.
            hasExternalDetails
            onSelect={select}
            onChoose={choose}
          />
        </div>
        {/* m_RightPanel / m_RightPanelSizer: the FOOTPRINT_PREVIEW_WIDGET,
            then the frame's 3D canvas under it, each `Add( …, 1, wxEXPAND )`
            so two shown share the column. The frame's two view buttons
            never hide both (on3DviewReq / onFpViewReq refuse the last). */}
        <div className="ze-fpchooser-preview">
          {showFpView && (
            <FootprintPreviewWidget
              footprint={selected ?? ''}
              // `m_preview_ctrl->SetStatusText( _( "No footprint selected" ) )`
              // (panel_footprint_chooser.cpp:367).
              statusText={selected ? '' : 'No footprint selected'}
            />
          )}
          {preview3D}
        </div>
      </div>
      {/* m_detailsPanel -> HTML_WINDOW, `SetMinimumPaneSize( 80 )`. The tree
          is handed this window upstream and writes it itself; ours renders it
          here, which is what `hasExternalDetails` tells the tree. */}
      {showDetails && (
        <div
          className="ze-libtree-details external ze-fpchooser-details"
          style={{ ['--v-sash' as string]: V_SASH_GRAVITY }}
          // biome-ignore lint/security/noDangerouslySetInnerHtml: generateFootprintInfo escapes all library data
          dangerouslySetInnerHTML={{ __html: generateFootprintInfo(selectedInfo) }}
        />
      )}
    </div>
  );
}
