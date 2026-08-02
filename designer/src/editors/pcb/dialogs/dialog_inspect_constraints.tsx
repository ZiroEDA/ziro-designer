// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Clearance Resolution and Constraints Resolution.
 * Counterpart: `DIALOG_BOOK_REPORTER` as driven by
 * `BOARD_INSPECTION_TOOL::InspectClearance` / `InspectConstraints`.
 *
 * Upstream shows one page per constraint in a notebook; this shows the same
 * sections stacked, which reads the same way without needing tab chrome for
 * what is usually one or five short blocks.
 *
 * The content is assembled in pcbnew (drc_inspect.ts) from the same rule walk
 * DRC performs. This component only renders it — deliberately, so that what
 * the user is told and what DRC decided cannot drift apart.
 */
import type { JSX, Ref } from 'react';
import type { InspectSection } from '@ziroeda/pcbnew';

interface Props {
  /** "Clearance Resolution" or "Constraints Resolution". */
  title: string;
  /** Assembled by buildClearanceReport / buildConstraintsReport. */
  sections: InspectSection[];
  /** Why there is nothing to show, when there is nothing to show. */
  hint?: string;
  onClose: () => void;
  rootRef?: Ref<HTMLDivElement>;
}

export function DialogInspectConstraints({
  title,
  sections,
  hint,
  onClose,
  rootRef,
}: Props): JSX.Element {
  return (
    <div
      ref={rootRef}
      style={{
        position: 'absolute',
        top: 60,
        left: 80,
        width: 560,
        maxHeight: '70vh',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--chrome-bg)',
        border: '1px solid var(--chrome-border)',
        borderRadius: 6,
        boxShadow: '0 8px 28px rgba(0,0,0,0.45)',
        zIndex: 40,
      }}
    >
      <div
        style={{
          padding: '8px 10px',
          borderBottom: '1px solid var(--chrome-border)',
          fontWeight: 600,
          fontSize: 13,
        }}
      >
        {title}
      </div>

      <div style={{ overflow: 'auto', padding: '8px 10px', flex: 1 }}>
        {sections.length === 0 ? (
          <div style={{ fontSize: 12, opacity: 0.75 }}>
            {hint ?? 'Select two items to see how their clearance resolves.'}
          </div>
        ) : (
          sections.map((s, i) => (
            // Sections are a fixed list per item pair, so the index is stable.
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length report
            <div key={i} style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 3 }}>{s.title}</div>

              <ul style={{ margin: '0 0 6px 0', paddingLeft: 18, fontSize: 12, opacity: 0.85 }}>
                {s.subjects.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>

              <div
                style={{
                  fontFamily: 'var(--mono, monospace)',
                  fontSize: 11.5,
                  whiteSpace: 'pre-wrap',
                  lineHeight: 1.5,
                  paddingLeft: 4,
                }}
              >
                {s.lines.join('\n')}
              </div>
            </div>
          ))
        )}
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 8,
          padding: '8px 10px',
          borderTop: '1px solid var(--chrome-border)',
        }}
      >
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
