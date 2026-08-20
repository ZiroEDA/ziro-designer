// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Page Preview Settings, the web counterpart of the page-settings dialog
 * `pl_editor` opens for its preview data (PL_EDITOR_CONTROL::PageSetup →
 * DIALOG_PAGES_SETTINGS): the preview paper size and orientation plus the
 * title-block fields (issue date, revision, title, company, comments) that
 * the `${…}` text variables resolve against. In the standalone sheet editor
 * these are preview data only, they are not stored in the `.kicad_wks`.
 */

import { useState, type JSX } from 'react';
import { PAPER_CHOICES, PAPER_MM } from '@ziroeda/common';
import {
  defaultPreviewSettings,
  paperDescription,
  previewPageMM,
  type PreviewSettings,
} from './preview_settings.js';
import { Combo, type ComboOption } from '../../ui/Combo.js';
import { useModalEscape } from '../../ui/useModalEscape.js';

/** PAGE_SETUP's orientation choice (dialog_page_settings_base.cpp). */
const ORIENTATION_CHOICES: readonly ComboOption[] = [
  { value: 'landscape', label: 'Landscape' },
  { value: 'portrait', label: 'Portrait' },
];

/**
 * Re-exported so the importers that already had these keep working. The table
 * itself is `common/src/page_info.ts` — `common/page_info.cpp` upstream.
 */
export { PAPER_CHOICES, PAPER_MM };
export { defaultPreviewSettings, paperDescription, previewPageMM, type PreviewSettings };

export function PageSettingsDialog({
  value,
  onOk,
  onCancel,
}: {
  value: PreviewSettings;
  onOk: (next: PreviewSettings) => void;
  onCancel: () => void;
}): JSX.Element {
  // wxDialog maps Esc to wxID_CANCEL for free; ours has to ask. See
  // ui/modal_escape.ts.
  useModalEscape(onCancel);

  const [s, setS] = useState<PreviewSettings>({ ...value, comments: [...value.comments] });
  const set = (patch: Partial<PreviewSettings>): void => setS((cur) => ({ ...cur, ...patch }));

  const row: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    margin: '4px 0',
  };
  const lab: React.CSSProperties = { width: 92, fontSize: 12, flex: '0 0 auto' };

  return (
    <div className="ze-modal-backdrop" onMouseDown={onCancel}>
      <div
        className="ze-modal"
        style={{ width: 560, maxWidth: '94vw' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="ze-modal-header">
          {/* DIALOG_PAGES_SETTINGS::DIALOG_PAGES_SETTINGS
              (common/dialogs/dialog_page_settings.cpp:82-93) re-labels three
              strings when its parent is PL_EDITOR_FRAME_NAME, because in this
              frame the page and the title block are PREVIEW data and are not
              saved anywhere. Ours used the other frames' wording. */}
          Preview Settings
          <span className="x" onClick={onCancel}>
            ✕
          </span>
        </div>
        <div style={{ display: 'flex', gap: 18, padding: '10px 14px' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 6 }}>Preview Paper</div>
            <div style={row}>
              <span style={lab}>Size:</span>
              <Combo
                style={{ flex: 1 }}
                value={s.paper}
                options={PAPER_CHOICES.map((p) => ({ value: p.id, label: p.label }))}
                onChange={(v) => set({ paper: v })}
                autoFocus
              />
            </div>
            <div style={row}>
              <span style={lab}>Orientation:</span>
              <Combo
                style={{ flex: 1 }}
                value={s.portrait ? 'portrait' : 'landscape'}
                options={ORIENTATION_CHOICES}
                onChange={(v) => set({ portrait: v === 'portrait' })}
              />
            </div>
            {s.paper === 'User' && (
              <>
                <div style={row}>
                  <span style={lab}>Custom width:</span>
                  <input
                    className="ze-search"
                    type="number"
                    style={{ width: 90 }}
                    value={s.customWidthMM}
                    onChange={(e) => set({ customWidthMM: Number(e.target.value) || 0 })}
                  />
                  <span className="ze-muted" style={{ fontSize: 11 }}>
                    mm
                  </span>
                </div>
                <div style={row}>
                  <span style={lab}>Custom height:</span>
                  <input
                    className="ze-search"
                    type="number"
                    style={{ width: 90 }}
                    value={s.customHeightMM}
                    onChange={(e) => set({ customHeightMM: Number(e.target.value) || 0 })}
                  />
                  <span className="ze-muted" style={{ fontSize: 11 }}>
                    mm
                  </span>
                </div>
              </>
            )}
          </div>
          <div style={{ flex: 1.2 }}>
            <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 6 }}>
              Preview Title Block Data
            </div>
            <div style={row}>
              <span style={lab}>Issue Date:</span>
              <input
                className="ze-search"
                style={{ flex: 1 }}
                value={s.date}
                onChange={(e) => set({ date: e.target.value })}
              />
              <button
                className="ze-btn"
                title="Set to today"
                onClick={() => set({ date: new Date().toISOString().slice(0, 10) })}
              >
                ◀
              </button>
            </div>
            <div style={row}>
              <span style={lab}>Revision:</span>
              <input
                className="ze-search"
                style={{ flex: 1 }}
                value={s.rev}
                onChange={(e) => set({ rev: e.target.value })}
              />
            </div>
            <div style={row}>
              <span style={lab}>Title:</span>
              <input
                className="ze-search"
                style={{ flex: 1 }}
                value={s.title}
                onChange={(e) => set({ title: e.target.value })}
              />
            </div>
            <div style={row}>
              <span style={lab}>Company:</span>
              <input
                className="ze-search"
                style={{ flex: 1 }}
                value={s.company}
                onChange={(e) => set({ company: e.target.value })}
              />
            </div>
            {s.comments.map((c, i) => (
              <div style={row} key={i}>
                <span style={lab}>Comment{i + 1}:</span>
                <input
                  className="ze-search"
                  style={{ flex: 1 }}
                  value={c}
                  onChange={(e) => {
                    const comments = [...s.comments];
                    comments[i] = e.target.value;
                    set({ comments });
                  }}
                />
              </div>
            ))}
          </div>
        </div>
        <div className="ze-modal-footer">
          <button className="ze-btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="ze-btn primary" onClick={() => onOk(s)}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
