// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * An RC_TREE_MODEL in its wxDataViewCtrl (common/rc_item.cpp): the marker rows,
 * each expanded, and their item and comment children. DIALOG_DRC and
 * DIALOG_CLEANUP_TRACKS_AND_VIAS both show their tree this way upstream.
 */
import { type JSX, useEffect, useMemo, useRef } from 'react';
import {
  type RC_TREE_MODEL,
  type RC_TREE_NODE,
  RC_TREE_NODE_TYPE,
  type RC_TREE_VIEW_STATE,
} from '../rc_item.js';
import { rcTreeRowStyle, rcTreeTextColour } from './rc_tree_style.js';

/** One RC_TREE_MODEL as a wxDataViewCtrl: the marker rows and their item children. */
export function RcTreeView({
  model,
  view,
  onDoubleClick,
  onContextMenu,
  testId,
}: {
  model: RC_TREE_MODEL;
  view: RC_TREE_VIEW_STATE;
  /** The data view's wxEVT_DATAVIEW_ITEM_ACTIVATED / left double click. */
  onDoubleClick?: (node: RC_TREE_NODE) => void;
  onContextMenu?: (e: React.MouseEvent, node: RC_TREE_NODE) => void;
  testId?: string;
}): JSX.Element {
  const selectedRowRef = useRef<HTMLDivElement>(null);
  const selection = view.GetSelection();

  // `EnsureVisible( ToItem( candidate ) )`: the selected row scrolls into view.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the selection is the trigger; the ref is read
  useEffect(() => {
    selectedRowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selection]);

  const textColour = useMemo(rcTreeTextColour, []);

  const rowStyle = (node: RC_TREE_NODE): React.CSSProperties =>
    rcTreeRowStyle(model.GetAttr(node, textColour), textColour);

  return (
    <div className="ze-erc-list" data-testid={testId}>
      {model.GetTree().map((node, i) => (
        <div key={i} className="ze-erc-item">
          <div
            ref={selection === node ? selectedRowRef : undefined}
            className={`ze-erc-row${selection === node ? ' selected' : ''}`}
            style={rowStyle(node)}
            onClick={() => view.Select(node)}
            onDoubleClick={() => onDoubleClick?.(node)}
            onContextMenu={(e) => {
              e.preventDefault();
              view.Select(node);
              onContextMenu?.(e, node);
            }}
          >
            {/* the expander of a container row; every marker row is expanded (ExpandAll) */}
            <span className="twisty expandable open" />
            <span className="msg">{model.GetValue(node)}</span>
          </div>
          {node.m_Children.map((child, k) => (
            <div
              key={k}
              className={`ze-erc-subrow${selection === child ? ' selected' : ''}${
                child.m_Type === RC_TREE_NODE_TYPE.COMMENT ? ' comment' : ''
              }`}
              style={rowStyle(child)}
              onClick={() => view.Select(child)}
              onDoubleClick={() => onDoubleClick?.(child)}
              onContextMenu={(e) => {
                e.preventDefault();
                view.Select(child);
                onContextMenu?.(e, child);
              }}
            >
              {model.GetValue(child)}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
