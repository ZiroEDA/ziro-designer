// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The two `.Bottom()` panes of `PCB_EDIT_FRAME`'s AUI layout
 * (`pcb_edit_frame.cpp:396-412`): the Net Inspector and the Search pane.
 *
 * Neither names a layer, so both take the innermost ring, side by side in one
 * dock under the canvas, in `AddPane` order (Net Inspector first). Each is
 * `.PaneBorder( false )` and `.CloseButton( true )`; the dock's height is the
 * tallest `BestSize` of what is shown until it is dragged.
 */
import type { JSX, ReactNode } from 'react';

/** Data: `.MinSize( 180, 60 )`, `.BestSize( 180, 100 )` (`pcb_edit_frame.cpp:408-409`). */
export const PCB_SEARCH_PANE_SIZE = { minHeight: 60, bestHeight: 100 } as const;

/** Data: `.MinSize( 240, 60 )`, `.BestSize( 300, 200 )` (`pcb_edit_frame.cpp:399-400`). */
export const PCB_NET_INSPECTOR_SIZE = { minHeight: 60, bestHeight: 200 } as const;

/** The dock's height for what is shown, when the user has not dragged it (or `SetAuiPaneSize( -1 )`'s stored -1). */
export function bottomDockHeight(
  aShowSearch: boolean,
  aShowNetInspector: boolean,
  aStored: number,
): number {
  if (aStored > 0) return aStored;

  return Math.max(
    aShowSearch ? PCB_SEARCH_PANE_SIZE.bestHeight : 0,
    aShowNetInspector ? PCB_NET_INSPECTOR_SIZE.bestHeight : 0,
  );
}

/** The floor a drag stops at: the tallest `MinSize` of what is shown. */
export function bottomDockMinHeight(aShowSearch: boolean, aShowNetInspector: boolean): number {
  return Math.max(
    aShowSearch ? PCB_SEARCH_PANE_SIZE.minHeight : 0,
    aShowNetInspector ? PCB_NET_INSPECTOR_SIZE.minHeight : 0,
  );
}

interface PaneProps {
  caption: string;
  testId: string;
  onClose: () => void;
  children: ReactNode;
}

function DockedPane({ caption, testId, onClose, children }: PaneProps): JSX.Element {
  return (
    <div className="ze-panel" style={{ flex: '1 1 0', minWidth: 0 }} data-testid={testId}>
      <div className="ze-panel-header">
        <span>{caption}</span>
        <button type="button" className="ze-pane-close" onClick={onClose} title="Close">
          ⊠
        </button>
      </div>
      <div className="ze-panel-body">{children}</div>
    </div>
  );
}

interface Props {
  /** `m_auimgr.GetPane( SearchPaneName() ).IsShown()`. */
  showSearch: boolean;
  /** `NetInspectorShown()`. */
  showNetInspector: boolean;
  /** The stored height, `search_panel_height`; -1 until dragged. */
  height: number;
  onHeightChange: (aHeight: number) => void;
  onCloseSearch: () => void;
  onCloseNetInspector: () => void;
  netInspector: ReactNode;
  search: ReactNode;
}

export function PcbBottomDock({
  showSearch,
  showNetInspector,
  height,
  onHeightChange,
  onCloseSearch,
  onCloseNetInspector,
  netInspector,
  search,
}: Props): JSX.Element | null {
  if (!showSearch && !showNetInspector) return null;

  const minHeight = bottomDockMinHeight(showSearch, showNetInspector);

  // The sash is ABOVE the pane, so dragging down shrinks it.
  const startResize = (e: React.MouseEvent): void => {
    e.preventDefault();
    const dock = (e.currentTarget as HTMLElement).nextElementSibling as HTMLElement | null;
    const startY = e.clientY;
    const startH =
      dock?.getBoundingClientRect().height ??
      bottomDockHeight(showSearch, showNetInspector, height);
    const onMove = (ev: MouseEvent): void =>
      onHeightChange(Math.max(minHeight, Math.round(startH - (ev.clientY - startY))));
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'row-resize';
  };

  return (
    <>
      <div
        className="ze-splitter horizontal"
        data-testid="pcb-bottom-dock-sash"
        onMouseDown={startResize}
        title="Drag to resize"
      />
      <div
        className="ze-bottomdock"
        data-testid="pcb-bottom-dock"
        style={{
          height: bottomDockHeight(showSearch, showNetInspector, height),
          flexDirection: 'row',
        }}
      >
        {showNetInspector && (
          <DockedPane
            caption="Net Inspector"
            testId="pcb-net-inspector"
            onClose={onCloseNetInspector}
          >
            {netInspector}
          </DockedPane>
        )}
        {showSearch && (
          <DockedPane caption="Search" testId="pcb-search-pane" onClose={onCloseSearch}>
            {search}
          </DockedPane>
        )}
      </div>
    </>
  );
}
