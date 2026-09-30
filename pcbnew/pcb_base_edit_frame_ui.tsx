// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PCB_BASE_EDIT_FRAME::OpenVertexEditor`'s floating pane
 * (`pcb_base_edit_frame.cpp:439-462`): `.Float()`, caption "Edit Vertices",
 * `.CloseButton( true )`, `.DestroyOnClose( true )`, `.MinSize( 260, 200 )`,
 * `.BestSize( 260, 320 )`, `.FloatingSize( 320, 360 )`.
 *
 * Closing it destroys the pane (`~PCB_VERTEX_EDITOR_PANE` ->
 * `OnVertexEditorPaneClosed`), so the owner drops its reference in `onClose`.
 */
import { type JSX, useState, useSyncExternalStore } from 'react';
import type { PCB_VERTEX_EDITOR_PANE } from './widgets/vertex_editor_pane.js';
import { PcbVertexEditorPane } from './widgets/vertex_editor_pane.js';

/** [data] `.FloatingSize( 320, 360 )`, `.MinSize( 260, 200 )` (`pcb_base_edit_frame.cpp:452-454`). */
export const VERTEX_EDITOR_FLOATING_SIZE = { width: 320, height: 360 } as const;
/** [data] `.MinSize( 260, 200 )` (`pcb_base_edit_frame.cpp:452`). */
export const VERTEX_EDITOR_MIN_SIZE = { width: 260, height: 200 } as const;

interface VertexEditorWindowProps {
  pane: PCB_VERTEX_EDITOR_PANE;
  onClose: () => void;
}

export function VertexEditorWindow({ pane, onClose }: VertexEditorWindowProps): JSX.Element {
  const revision = useSyncExternalStore(
    (l) => pane.Subscribe(l),
    () => pane.GetRevision(),
  );
  const [at, setAt] = useState({ x: 80, y: 80 });

  const startDrag = (e: React.MouseEvent): void => {
    e.preventDefault();
    const sx = e.clientX - at.x;
    const sy = e.clientY - at.y;
    const onMove = (ev: MouseEvent): void => setAt({ x: ev.clientX - sx, y: ev.clientY - sy });
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  return (
    <div
      className="ze-panel"
      data-testid="pcb-vertex-editor"
      style={{
        position: 'fixed',
        left: at.x,
        top: at.y,
        width: VERTEX_EDITOR_FLOATING_SIZE.width,
        height: VERTEX_EDITOR_FLOATING_SIZE.height,
        minWidth: VERTEX_EDITOR_MIN_SIZE.width,
        minHeight: VERTEX_EDITOR_MIN_SIZE.height,
        zIndex: 50,
        resize: 'both',
        overflow: 'hidden',
      }}
    >
      <div className="ze-panel-header" onMouseDown={startDrag} style={{ cursor: 'move' }}>
        <span>Edit Vertices</span>
        <button
          type="button"
          className="ze-pane-close"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={onClose}
          title="Close"
        >
          ⊠
        </button>
      </div>
      <div className="ze-panel-body">
        <PcbVertexEditorPane pane={pane} revision={revision} />
      </div>
    </div>
  );
}
