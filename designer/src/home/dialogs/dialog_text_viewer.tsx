// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/** Read-only text viewer, the web reinterpretation of the launcher's
 * "Open Text Editor" (no upstream counterpart file; upstream shells out to
 * the OS text editor). Shows a project text file in a monospace modal. */

import type { JSX } from 'react';
import { useModalEscape } from '../../ui/useModalEscape.js';

export function TextViewerDialog({
  name,
  text,
  onClose,
}: {
  name: string;
  text: string;
  onClose: () => void;
}): JSX.Element {
  // wxDialog maps Esc to wxID_CANCEL for free; ours has to ask. See
  // ui/modal_escape.ts.
  useModalEscape(onClose);

  return (
    <div className="ze-modal-backdrop" onMouseDown={onClose}>
      <div
        className="ze-modal"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="ze-modal-header">
          {name}
          <span className="x" title="Close" onClick={onClose}>
            ✕
          </span>
        </div>
        <pre
          style={{
            margin: 0,
            padding: 12,
            maxHeight: '60vh',
            overflow: 'auto',
            fontSize: 12,
            lineHeight: 1.45,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {text}
        </pre>
        <div className="ze-modal-footer">
          <button type="button" className="ze-btn primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
