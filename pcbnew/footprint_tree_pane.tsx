// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `FOOTPRINT_TREE_PANE` (`pcbnew/footprint_tree_pane.cpp`): the Footprint
 * Editor's docked Libraries pane, a panel whose whole body is one `LIB_TREE`
 * on the frame's `FP_TREE_SYNCHRONIZING_ADAPTER`, plus the one handler the
 * pane owns, `onComponentSelected`.
 *
 * Moved out of `footprint_edit_frame_ui.tsx`, where the pane was inline JSX
 * and its handler a callback of the window. The frame keeps what upstream's
 * frame keeps: the adapter, the selection it reads back (`GetTargetFPID`),
 * `FocusOnLibID`, the context menu, the settings writes and the AUI sash.
 */
import { useCallback, useState, type JSX, type ReactNode } from 'react';
import { LibTree, type LibTreeProps } from '@ziroeda/common/widgets/lib_tree.js';
import { LibTreeNodeType, type LibTreeNode } from '@ziroeda/common/lib_tree_model.js';

export interface FootprintTreePaneProps
  extends Pick<
    LibTreeProps,
    | 'adapter'
    | 'regenerateNonce'
    | 'selectLibId'
    | 'onSelect'
    | 'onToggleLibrary'
    | 'onItemContextMenu'
    | 'openLibs'
    | 'onColumnWidthsChanged'
    | 'onShownColumnsChanged'
  > {
  /** `m_LibWidth`, the dock's width. */
  width: number;
  /** Shown above the tree while there are no libraries yet (or `false`). */
  placeholder: ReactNode;
  /** `m_frame->LoadFootprintFromLibrary( aFPID )`. */
  onLoadFootprint: (libNickname: string, itemName: string) => void;
}

export function FootprintTreePane({
  width,
  placeholder,
  onLoadFootprint,
  adapter,
  regenerateNonce,
  selectLibId,
  onSelect,
  onToggleLibrary,
  onItemContextMenu,
  openLibs,
  onColumnWidthsChanged,
  onShownColumnsChanged,
}: FootprintTreePaneProps): JSX.Element {
  /**
   * `LIB_TREE::Unselect()`, which `FOOTPRINT_TREE_PANE::onComponentSelected`
   * calls right after the double-click has loaded the footprint (`:88-93`).
   */
  const [unselectNonce, setUnselectNonce] = useState(0);

  /**
   * `FOOTPRINT_TREE_PANE::onComponentSelected`, bound to `EVT_LIBITEM_CHOSEN`
   * (`footprint_tree_pane.cpp:48`):
   *
   *     m_frame->LoadFootprintFromLibrary( GetLibTree()->GetSelectedLibId() );
   *     // Make sure current-part highlighting doesn't get lost in seleciton highlighting
   *     m_tree->Unselect();
   */
  const onComponentSelected = useCallback(
    (node: LibTreeNode) => {
      if (node.type === LibTreeNodeType.LIBRARY) return;
      onLoadFootprint(node.libNickname, node.libItemName);
      setUnselectNonce((n) => n + 1);
    },
    [onLoadFootprint],
  );

  return (
    <div className="ze-leftdock" style={{ width, minWidth: width }}>
      <div className="ze-panel grow">
        <div className="ze-panel-header">Libraries</div>
        {/*
         * `FOOTPRINT_TREE_PANE` (`pcbnew/footprint_tree_pane.cpp:30-52`)
         * is a panel whose entire body is ONE `LIB_TREE`:
         *
         *     m_tree = new LIB_TREE( this, wxT( "footprints" ),
         *                            m_frame->GetLibTreeAdapter(),
         *                            LIB_TREE::SEARCH );
         *
         * SEARCH alone — no `MULTISELECT` and no `DETAILS`, hence
         * `hasExternalDetails`, which keeps the HTML info pane the
         * chooser has out of this dock.
         *
         * What stood here was a third tree: a `treeRows` memo and about
         * a hundred lines of JSX. That is why this pane had no "Item"
         * header, a bare `<input>` instead of the `wxSearchCtrl` with
         * its magnifier and its recent-search menu, no sort/expand
         * menu, a library glyph KiCad does not draw, no Description
         * column, no virtual scrolling and none of the row faces — and
         * why every fix made in `widgets/lib_tree.tsx` reached the
         * chooser and not this pane.
         */}
        {placeholder}
        <LibTree
          adapter={adapter}
          // `LIB_TREE( this, wxT( "footprints" ), … )` — the recent
          // searches key upstream gives this tree, which is the one
          // CvPcb's footprint tree shares and NOT the symbols' list.
          recentSearchesKey="footprints"
          regenerateNonce={regenerateNonce}
          selectLibId={selectLibId}
          unselectNonce={unselectNonce}
          onSelect={onSelect}
          onChoose={onComponentSelected}
          onToggleLibrary={onToggleLibrary}
          onItemContextMenu={onItemContextMenu}
          openLibs={openLibs}
          onColumnWidthsChanged={onColumnWidthsChanged}
          onShownColumnsChanged={onShownColumnsChanged}
          hasExternalDetails
        />
      </div>
    </div>
  );
}
