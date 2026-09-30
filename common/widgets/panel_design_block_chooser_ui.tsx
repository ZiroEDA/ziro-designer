// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PANEL_DESIGN_BLOCK_CHOOSER` (common/widgets/panel_design_block_chooser.{h,cpp}):
 * the Design Blocks dock's body — a `LIB_TREE` (ALL_WIDGETS: search, details)
 * over a `DESIGN_BLOCK_TREE_MODEL_ADAPTER`, split horizontally from the details
 * panel that holds the editor's preview widget (`SetPreviewWidget`), with the
 * "-- Recently Used --" group rebuilt from the history list.
 *
 * The sizer tree (panel_design_block_chooser.cpp:60-100): one vertical sizer,
 * `m_vsplitter` (`wxSP_LIVE_UPDATE`, gravity 0.5, minimum pane 20) with the
 * tree panel on top and `m_detailsPanel` below; the tree fills its panel.
 *
 * A double click places (`m_selectHandler`, after `onCloseTimer`'s mouse-up
 * wait, which a DOM double click does not need) and records the block in the
 * history. Timers upstream used to dodge GTK redraw issues are not needed.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from 'react';
import type { DESIGN_BLOCK } from '../design_block.js';
import type { DESIGN_BLOCK_LIBRARY_ADAPTER } from '../design_block_library_adapter.js';
import { DESIGN_BLOCK_TREE_MODEL_ADAPTER } from '../design_block_tree_model_adapter.js';
import { LIB_ID } from '../lib_id.js';
import { type LibTreeNode, LibTreeNodeType, makeItemNode } from '../lib_tree_model.js';
import type { SortMode } from '../lib_tree_model_adapter.js';
import type { LIBRARY_MANAGER } from '../libraries/library_manager.js';
import type { DESIGN_BLOCK_PANE } from './design_block_pane.js';
import { LibTree } from './lib_tree.js';
import { Sash } from './wx_splitter_window.js';

/** `g_designBlockSearchString`: kept between openings. */
let g_designBlockSearchString = '';

/** `addDesignBlockToHistory`'s cap: `while( size >= 8 ) pop_back()`, so at most seven. [data] */
const HISTORY_CAP = 8;

/**
 * `addDesignBlockToHistory` (panel_design_block_chooser.cpp:352-375): the id
 * moved to the front, duplicates dropped, trimmed below eight.
 */
export function AddDesignBlockToHistory(aHistory: LIB_ID[], aLibId: LIB_ID): void {
  // Remove duplicates
  for (let i = aHistory.length - 1; i >= 0; --i) {
    if (aHistory[i]!.Format() === aLibId.Format()) aHistory.splice(i, 1);
  }

  // Add the new name at the beginning of the history list
  aHistory.unshift(aLibId);

  // Remove extra names
  while (aHistory.length >= HISTORY_CAP) aHistory.pop();
}

export interface PanelDesignBlockChooserProps {
  pane: DESIGN_BLOCK_PANE;
  libs: DESIGN_BLOCK_LIBRARY_ADAPTER;
  manager: LIBRARY_MANAGER;
  /** `m_Session.pinned_design_block_libs` ∪ the project's. */
  pinned: readonly string[];
  /** `m_selectHandler`: what a double click runs (the editor's place action). */
  onChosen: () => void;
  /** `SetPreviewWidget`: the editor's preview of the selected block. */
  renderPreview?: (aDesignBlock: DESIGN_BLOCK | null) => ReactNode;
  /** `m_DesignBlockChooserPanel` as stored: sort mode and the vertical sash. */
  sortMode: number;
  sashPosV: number;
  onSortModeChanged: (aMode: number) => void;
  onSashPosVChanged: (aPos: number) => void;
  /** `m_LibTree.open_libs`. */
  openLibs: readonly string[];
  onToggleLibrary?: (aNode: LibTreeNode, aOpen: boolean) => void;
  onPinLibrary?: (aNode: LibTreeNode, aPinned: boolean) => void;
  onItemContextMenu?: (aNode: LibTreeNode, x: number, y: number) => void;
}

export function PanelDesignBlockChooser({
  pane,
  libs,
  manager,
  pinned,
  onChosen,
  renderPreview,
  sortMode,
  sashPosV,
  onSortModeChanged,
  onSashPosVChanged,
  openLibs,
  onToggleLibrary,
  onPinLibrary,
  onItemContextMenu,
}: PanelDesignBlockChooserProps): JSX.Element {
  const adapter = useMemo(() => {
    const a = new DESIGN_BLOCK_TREE_MODEL_ADAPTER(libs);
    a.generateInfo = (node) => a.GenerateInfo(new LIB_ID(node.libNickname, node.libItemName));
    return a;
  }, [libs]);
  const [regenerateNonce, setRegenerateNonce] = useState(0);
  const [selectLibId, setSelectLibId] = useState<string | undefined>(undefined);
  const [previewBlock, setPreviewBlock] = useState<DESIGN_BLOCK | null>(null);
  const [sashV, setSashV] = useState(sashPosV);
  const bodyRef = useRef<HTMLDivElement>(null);

  /** `rebuildHistoryNode` (:378-398). */
  const rebuildHistoryNode = useCallback((): void => {
    adapter.tree.children = adapter.tree.children.filter((n) => !n.isRecentlyUsedGroup);

    const group = adapter.addGroup('-- Recently Used --');
    group.isRecentlyUsedGroup = true;

    for (const lib of pane.m_historyList) {
      const info = libs.LoadDesignBlock(lib.GetLibNickname(), lib.GetLibItemName());

      // this can be null, for example, if the design block has been deleted from a library.
      if (info) {
        const item = makeItemNode(group, lib.GetLibNickname(), info.GetName());
        item.desc = info.GetDesc();
        item.sourceSearchTerms = info.GetSearchTerms();
      }
    }

    adapter.finishLibrary(group, true);
  }, [adapter, libs, pane]);

  /** `RefreshLibs` (:287-309). */
  const refreshLibs = useCallback((): void => {
    const savedSelection = pane.GetSelectedLibId();

    adapter.ClearLibraries();
    rebuildHistoryNode();

    if (pane.m_historyList.length > 0) adapter.setPreselectNode(pane.m_historyList[0]!.Format(), 0);

    adapter.AddLibraries(manager, pinned);
    setRegenerateNonce((n) => n + 1);

    if (savedSelection.IsValid()) setSelectLibId(savedSelection.Format());
  }, [adapter, manager, pinned, pane, rebuildHistoryNode]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the sort mode is read once, as FinishSetup does
  useEffect(() => {
    adapter.setSortMode(sortMode as SortMode);
    refreshLibs();
    const offRefresh = pane.OnRefresh(refreshLibs);
    const offSelect = pane.OnSelect((id) => setSelectLibId(id.Format()));
    return () => {
      offRefresh();
      offSelect();
    };
  }, [adapter, pane, refreshLibs]);

  /** `onDesignBlockSelected` (:320-332): the preview shows the selected block. */
  const onSelect = useCallback(
    (node: LibTreeNode | null): void => {
      const id =
        node && node.type === LibTreeNodeType.ITEM
          ? new LIB_ID(node.libNickname, node.libItemName)
          : node
            ? new LIB_ID(node.libNickname, '')
            : new LIB_ID();
      pane.SetSelectedLibId(id);
      setPreviewBlock(id.IsValid() ? pane.GetDesignBlock(id, true, true) : null);
    },
    [pane],
  );

  /** `onDesignBlockChosen` + `onCloseTimer` (:335-350): place, then remember. */
  const onChoose = useCallback(
    (node: LibTreeNode): void => {
      if (node.type !== LibTreeNodeType.ITEM) return;

      onChosen();

      AddDesignBlockToHistory(pane.m_historyList, new LIB_ID(node.libNickname, node.libItemName));
      rebuildHistoryNode();
      setRegenerateNonce((n) => n + 1);
    },
    [onChosen, pane, rebuildHistoryNode],
  );

  const setSash = (h: number): void => {
    setSashV(h);
    onSashPosVChanged(h);
  };

  return (
    <div className="ze-dbchooser" ref={bodyRef}>
      <div className="ze-dbchooser-tree">
        <LibTree
          adapter={adapter}
          recentSearchesKey="design_blocks"
          regenerateNonce={regenerateNonce}
          initialSearch={g_designBlockSearchString}
          onSearchChanged={(s) => {
            g_designBlockSearchString = s;
          }}
          onSelect={onSelect}
          onChoose={onChoose}
          onToggleLibrary={onToggleLibrary}
          onPinLibrary={onPinLibrary}
          onItemContextMenu={onItemContextMenu}
          onSortModeChanged={(m) => onSortModeChanged(m)}
          openLibs={openLibs}
          {...(selectLibId ? { selectLibId } : {})}
        />
      </div>
      {renderPreview && (
        <>
          <Sash
            edge="top"
            size={sashV}
            min={20}
            max={(bodyRef.current?.getBoundingClientRect().height ?? 0) - 20}
            onResize={setSash}
          />
          <div className="ze-dbchooser-details" style={{ height: sashV, flex: 'none' }}>
            {renderPreview(previewBlock)}
          </div>
        </>
      )}
    </div>
  );
}
