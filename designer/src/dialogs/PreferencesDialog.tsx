// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
import { useEffect, useState, type JSX } from 'react';
import {
  settings,
  type CommonSettings,
  type EeschemaSettings,
  type PcbnewSettings,
  type PlEditorSettings,
  type PrivacySettings,
} from '../prefs/settings.js';
import { FIRST_PAGE, PAGES, labelOf, ownerOf } from './prefs/registry.js';
import { loadPrefsPanel, peekPrefsPanel } from './prefs/lazy_pages.js';
import {
  DEFAULT_RESET_TOOLTIP,
  type PrefsContext,
  type PrefsPageId,
  type PrefsPanelModule,
} from './prefs/types.js';
import type { HotkeyOverrides } from '../editors/schematic/hotkey_bindings.js';
import { setReportingEnabled } from '../telemetry/reporter.js';
import { sentrySink } from '../telemetry/sentrySink.js';
import { useModalEscape } from '../ui/useModalEscape.js';

/**
 * The Preferences dialog shell, the web mirror of KiCad's PAGED_DIALOG
 * preferences (`EDA_BASE_FRAME::ShowPreferences`, common/eda_base_frame.cpp:1585):
 * a page tree on the left, one panel on the right, OK / Cancel / Reset.
 *
 * The shell knows page ids and labels and nothing else. Which pages exist and
 * which module builds each one lives in `dialogs/prefs/registry.ts`, and a page
 * is constructed the first time it is opened — upstream's `AddLazyPage` /
 * `AddLazySubPage`. Here that laziness is also what keeps a code-split editor's
 * bundle out of the dialog until one of its pages is asked for.
 *
 * Edits go to a working copy and commit on OK, as KiCad's TransferDataFromWindow
 * does. "Reset to Defaults" resets the current page only (RESETTABLE_PANEL), by
 * asking that page for its own reset — the shell never learns which settings a
 * page owns, and a page with no reset greys the button out.
 */
export function PreferencesDialog({
  onClose,
  initialPage,
}: {
  onClose: () => void;
  /**
   * `EDA_BASE_FRAME::ShowPreferences( aStartPage, aStartParentPage )`
   * (`common/eda_base_frame.cpp:1585`), the page the dialog opens on.
   *
   * It is not decoration: `COMMON_TOOLS::GridProperties` is nothing BUT this
   * argument — it runs `ShowPreferences( _( "Grids" ), <frame name> )` and
   * returns (`common/tool/common_tools.cpp:609-634`), so an "Edit Grids..."
   * that opened the book at Common would not be the action at all.
   *
   * Upstream names the page by its LABEL and its parent's label, because the
   * book is a wxTreebook of strings. Ours names it by id, which is the same
   * thing said unambiguously — two editors can both have a page labelled
   * "Grids".
   */
  initialPage?: PrefsPageId;
}): JSX.Element {
  // wxDialog maps Esc to wxID_CANCEL for free; ours has to ask. See
  // ui/modal_escape.ts.
  useModalEscape(onClose);

  const [page, setPage] = useState<PrefsPageId>(initialPage ?? FIRST_PAGE);
  const [common, setCommon] = useState<CommonSettings>(() => structuredClone(settings.common));
  const [eeschema, setEeschema] = useState<EeschemaSettings>(() =>
    structuredClone(settings.eeschema),
  );
  const [userColors, setUserColors] = useState<Record<string, string>>(() => ({
    ...settings.userColors,
  }));
  const [pcbnew, setPcbnew] = useState<PcbnewSettings>(() => structuredClone(settings.pcbnew));
  const [plEditor, setPlEditor] = useState<PlEditorSettings>(() =>
    structuredClone(settings.plEditor),
  );
  const [privacy, setPrivacy] = useState<PrivacySettings>(() => structuredClone(settings.privacy));
  const [hotkeys, setHotkeys] = useState<HotkeyOverrides>(() => ({ ...settings.hotkeys }));

  const upC = (fn: (s: CommonSettings) => void): void =>
    setCommon((s) => {
      const n = structuredClone(s);
      fn(n);
      return n;
    });
  const upE = (fn: (s: EeschemaSettings) => void): void =>
    setEeschema((s) => {
      const n = structuredClone(s);
      fn(n);
      return n;
    });

  const upP = (fn: (s: PcbnewSettings) => void): void =>
    setPcbnew((s) => {
      const n = structuredClone(s);
      fn(n);
      return n;
    });

  const upPl = (fn: (s: PlEditorSettings) => void): void =>
    setPlEditor((s) => {
      const n = structuredClone(s);
      fn(n);
      return n;
    });

  const ok = (): void => {
    settings.updateCommon((s) => Object.assign(s, common));
    settings.updateEeschema((s) => Object.assign(s, eeschema));
    settings.updatePcbnew((s) => Object.assign(s, pcbnew));
    settings.updatePlEditor((s) => Object.assign(s, plEditor));
    settings.setUserColors(userColors);
    settings.setHotkeys(hotkeys);
    // Routed through the reporter rather than written directly: switching this
    // off has to tear the transport down now, not merely record a preference.
    if (privacy.crash_reports !== settings.privacy.crash_reports)
      setReportingEnabled(privacy.crash_reports, sentrySink);
    onClose();
  };

  // The working copy and its setters, handed to whichever panel is up. Upstream
  // a wx panel writes into the settings object directly; ours edit this and the
  // shell commits it on OK.
  const ctx: PrefsContext = {
    common,
    eeschema,
    pcbnew,
    plEditor,
    privacy,
    userColors,
    hotkeys,
    upC,
    upE,
    upP,
    upPl,
    setCommon,
    setEeschema,
    setPcbnew,
    setPlEditor,
    setPrivacy,
    setUserColors,
    setHotkeys,
  };

  // `AddLazySubPage`: the page is constructed the first time it is opened, and
  // kept after that, exactly as the wxTreebook keeps a realised page.
  const [panel, setPanel] = useState<PrefsPanelModule | null>(
    () => peekPrefsPanel(FIRST_PAGE) ?? null,
  );
  useEffect(() => {
    if (!ownerOf(page)) {
      setPanel(null);
      return;
    }
    const cached = peekPrefsPanel(page);
    if (cached) {
      setPanel(cached);
      return;
    }
    setPanel(null);
    let live = true;
    void loadPrefsPanel(page).then((m) => {
      if (live) setPanel(m);
    });
    return () => {
      live = false;
    };
  }, [page]);

  // PAGED_DIALOG::UpdateResetButton (common/widgets/paged_dialog.cpp:329-355):
  // the button is enabled, named after the page and given the page's tooltip
  // only while a RESETTABLE_PANEL is up; otherwise it reads "Reset to Defaults"
  // and is disabled. A page that is not resettable — upstream's
  // PANEL_TEMPLATE_FIELDNAMES, a plain wxPanel — simply has no `reset`, and a
  // page not yet constructed has no panel at all, which is upstream's
  // `ResolvePage` returning null.
  //
  // Which FIELDS the reset touches is the panel's business, not the shell's:
  // this only knows whether the page has one. See prefs/reset.ts.
  const resettable = panel?.reset !== undefined;
  const resetLabel = resettable ? `Reset ${labelOf(page) ?? ''} to Defaults` : 'Reset to Defaults';
  const resetPage = (): void => {
    panel?.reset?.(ctx);
  };

  return (
    <div className="ze-modal-backdrop" onMouseDown={onClose}>
      <div className="ze-modal ze-prefs-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header">
          Preferences
          <span className="x" onClick={onClose}>
            ✕
          </span>
        </div>
        <div className="ze-prefs-body">
          <div className="ze-prefs-tree">
            {PAGES.map((p) =>
              p.id === null ? (
                <div key={p.label} className="ze-prefs-parent">
                  {p.label}
                </div>
              ) : (
                <div
                  key={p.id}
                  className={`ze-prefs-page${page === p.id ? ' active' : ''}${p.indent ? ' indent' : ''}`}
                  onClick={() => setPage(p.id!)}
                >
                  {p.label}
                </div>
              ),
            )}
          </div>
          <div className="ze-prefs-panel">{panel ? <panel.Panel ctx={ctx} /> : null}</div>
        </div>
        <div className="ze-modal-footer">
          <button
            className="ze-btn"
            disabled={!resettable}
            title={resettable ? (panel?.resetTooltip ?? DEFAULT_RESET_TOOLTIP) : undefined}
            onClick={resetPage}
          >
            {resetLabel}
          </button>
          <span style={{ flex: 1 }} />
          <button className="ze-btn" onClick={onClose}>
            Cancel
          </button>
          <button className="ze-btn primary" onClick={ok}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
