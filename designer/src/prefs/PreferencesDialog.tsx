// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
import { useEffect, useState, type JSX } from 'react';
import {
  PCBNEW_DEFAULTS,
  settings,
  type CommonSettings,
  type EeschemaSettings,
  type PcbnewSettings,
  type PrivacySettings,
} from './settings.js';
import { CrossProbingGroup } from '../dialogs/prefs/CrossProbingGroup.js';
import {
  FIRST_PAGE,
  PAGES,
  loadPrefsPanel,
  ownerOf,
  peekPrefsPanel,
} from '../dialogs/prefs/registry.js';
import type { PrefsContext, PrefsPageId, PrefsPanelModule } from '../dialogs/prefs/types.js';
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
 * asking that page for its own reset.
 */

export function PreferencesDialog({ onClose }: { onClose: () => void }): JSX.Element {
  // wxDialog maps Esc to wxID_CANCEL for free; ours has to ask. See
  // ui/modal_escape.ts.
  useModalEscape(onClose);

  const [page, setPage] = useState<PrefsPageId>(FIRST_PAGE);
  const [common, setCommon] = useState<CommonSettings>(() => structuredClone(settings.common));
  const [eeschema, setEeschema] = useState<EeschemaSettings>(() =>
    structuredClone(settings.eeschema),
  );
  const [userColors, setUserColors] = useState<Record<string, string>>(() => ({
    ...settings.userColors,
  }));
  const [pcbnew, setPcbnew] = useState<PcbnewSettings>(() => structuredClone(settings.pcbnew));
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

  const ok = (): void => {
    settings.updateCommon((s) => Object.assign(s, common));
    settings.updateEeschema((s) => Object.assign(s, eeschema));
    settings.updatePcbnew((s) => Object.assign(s, pcbnew));
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
    privacy,
    userColors,
    hotkeys,
    upC,
    upE,
    upP,
    setCommon,
    setEeschema,
    setPcbnew,
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

  // RESETTABLE_PANEL::ResetPanel on the page that is up: the panel owns its own
  // defaults, as every `panel_*.cpp` does.
  const resetPage = (): void => {
    const built = peekPrefsPanel(page);
    if (built) {
      built.reset(ctx);
      return;
    }
    // Not yet registry-owned: the arm from the original switch, unchanged.
    switch (page) {
      default:
        setPcbnew(structuredClone(PCBNEW_DEFAULTS));
        break;
    }
  };

  // Pages not yet moved out of this switch. Each one leaves as its owning
  // editor's `prefs/` module lands; the registry is the only route once it has.
  const body = (): JSX.Element | null => {
    switch (page) {
      case 'pcb-display':
        return (
          <CrossProbingGroup
            peer="schematic"
            value={pcbnew.cross_probing}
            onChange={(fn) => upP((s) => fn(s.cross_probing))}
          />
        );
      default:
        return null;
    }
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
          <div className="ze-prefs-panel">{panel ? <panel.Panel ctx={ctx} /> : body()}</div>
        </div>
        <div className="ze-modal-footer">
          <button className="ze-btn" onClick={resetPage}>
            Reset to Defaults
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
