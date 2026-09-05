// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
import { useEffect, useMemo, useState, type JSX } from 'react';
import {
  settings,
  TOOLBAR_APPS,
  type CommonSettings,
  type EeschemaSettings,
  type GerbviewSettings,
  type PcbnewSettings,
  type PlEditorSettings,
  type PrivacySettings,
  type SymbolEditorSettings,
  type ToolbarApp,
  type UserColorTheme,
} from '../prefs/settings.js';
import type { ToolbarSettings } from '../ui/toolbar_config.js';
import { usePagedDialogSize } from '../ui/paged_dialog_size.js';
import { PagedDialogTree } from '../ui/PagedDialogTree.js';
import { FIRST_PAGE, PAGES, labelOf, ownerOf } from './prefs/registry.js';
import { loadPrefsPanel, peekPrefsPanel } from './prefs/lazy_pages.js';
import {
  DEFAULT_RESET_TOOLTIP,
  type PrefsContext,
  type PrefsPageId,
  type PrefsPageOwner,
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

/**
 * `GetFrameType()` -> the heading that frame's KIFACE adds, which is the one
 * `expand` names. Upstream the two are tied by the guard sitting immediately
 * above the `AddPage` for that heading, so this table is that adjacency written
 * out; a heading with no frame of its own (the generic pages) is not in it.
 *
 * [data] the labels are `ShowPreferences`' own `_( "..." )` strings.
 */
const EXPANDED_SECTIONS: Readonly<Record<string, string | undefined>> = {
  symbol: 'Symbol Editor',
  schematic: 'Schematic Editor',
  pcb: 'PCB Editor',
  // `if( GetFrameType() == FRAME_GERBER ) expand.push_back( … )`
  // (`common/eda_base_frame.cpp:1710-1712`).
  gerbview: 'Gerber Viewer',
  drawingsheet: 'Drawing Sheet Editor',
};

export function PreferencesDialog({
  onClose,
  initialPage,
  frameOwner,
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
  /**
   * `GetFrameType()` — the window Preferences was opened FROM. Its section is
   * the one the tree opens expanded; see the `collapsed` state below.
   *
   * Optional because it is optional upstream in effect: a frame whose type
   * matches none of the seven guards (the project manager) pushes nothing onto
   * `expand`, and the tree opens fully collapsed. Omitting it here is that
   * case, not a missing argument.
   */
  frameOwner?: PrefsPageOwner;
}): JSX.Element {
  // wxDialog maps Esc to wxID_CANCEL for free; ours has to ask. See
  // ui/modal_escape.ts.
  useModalEscape(onClose);

  const [page, setPage] = useState<PrefsPageId>(initialPage ?? FIRST_PAGE);
  // The one place a PAGED_DIALOG's size is decided, shared rather than restated.
  const size = usePagedDialogSize(page);
  /**
   * Which sections start open. Exactly ONE can, and often none does.
   *
   * `ShowPreferences` collects an `expand` vector and every push into it is
   * guarded by the same shape (`common/eda_base_frame.cpp`):
   *
   *     if( GetFrameType() == FRAME_SCH )
   *         expand.push_back( (int) book->GetPageCount() );
   *     book->AddPage( new wxPanel( book ), _( "Schematic Editor" ) );
   *     ...
   *     for( int page : expand )
   *         book->ExpandNode( page );
   *
   * Seven such guards, on mutually exclusive frame types, so `expand` holds one
   * entry or zero — the section belonging to the window you opened Preferences
   * from. Everything else is collapsed, and opening it from the project manager
   * (whose frame type matches no guard) leaves the whole tree shut.
   *
   * This said "All expanded by default, as `ExpandNode` on every node leaves
   * it", which read the loop as running over every node rather than over the
   * one-or-zero `expand` holds. The visible result was our tree showing its
   * sub-pages when KiCad's shows fifteen closed rows.
   */
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    const open = new Set<string>();
    const forFrame = EXPANDED_SECTIONS[frameOwner ?? ''];
    if (forFrame !== undefined) open.add(forFrame);
    // ...and whichever section holds the start page, because selecting a
    // sub-page has to reveal it: `SetInitialPage` only records the page, and
    // `PAGED_DIALOG`'s ctor then runs `m_treebook->SetSelection( lastPageIndex )`
    // (paged_dialog.cpp:251) over a hierarchy search for it. A wxTreebook
    // selection ensures the item is visible, so its ancestors open. Without
    // this, "Edit Grids..." would select a row inside a shut node and show a
    // tree with nothing highlighted in it.
    if (initialPage !== undefined) {
      const at = PAGES.findIndex((p) => p.id === initialPage);
      for (let i = at; i >= 0; i--) {
        const row = PAGES[i];
        if (row?.id === null) {
          open.add(row.label);
          break;
        }
      }
    }
    return new Set(PAGES.filter((p) => p.id === null && !open.has(p.label)).map((p) => p.label));
  });
  const toggleSection = (label: string): void =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });

  /**
   * `PAGES` is the book in add-order, mirroring `InstallPreferences`: a row
   * with `id === null` is a heading (`AddPage( new wxPanel )`) and the indented
   * rows after it are its `AddLazySubPage`s. The shared tree wants that grouped,
   * with the leading parentless run - Common, Mouse and Touchpad, Hotkeys -
   * under an EMPTY label, which is how a treebook's top-level pages sit.
   */
  const treeSections = useMemo(() => {
    const out: { label: string; pages: { id: string; label: string }[] }[] = [
      { label: '', pages: [] },
    ];
    for (const p of PAGES) {
      if (p.id === null) {
        // `AddPage( new wxPanel )` — a heading, and the start of a section.
        out.push({ label: p.label, pages: [] });
        continue;
      }
      // `AddLazySubPage` goes under the heading above it; `AddPage` does NOT.
      // Grouping by position alone -- "every page since the last heading" --
      // is wrong at the tail of the book, where Packages and Updates, Plugins
      // and Maintenance are top-level pages added AFTER the last KIFACE's
      // heading. That put all three inside Drawing Sheet Editor, indented
      // under it and hidden whenever it was collapsed.
      const current = out[out.length - 1]!;
      if (p.indent === true && current.label !== '') {
        current.pages.push({ id: p.id, label: p.label });
      } else if (current.label === '') {
        current.pages.push({ id: p.id, label: p.label });
      } else {
        // A parentless run reopening after a section: its own empty-label
        // group, in place, so it draws after that section rather than being
        // folded back into the one at the top.
        out.push({ label: '', pages: [{ id: p.id, label: p.label }] });
      }
    }
    return out.filter((s) => s.pages.length > 0 || s.label !== '');
  }, []);
  const [common, setCommon] = useState<CommonSettings>(() => structuredClone(settings.common));
  const [eeschema, setEeschema] = useState<EeschemaSettings>(() =>
    structuredClone(settings.eeschema),
  );
  const [symbolEditor, setSymbolEditor] = useState<SymbolEditorSettings>(() =>
    structuredClone(settings.symbolEditor),
  );
  const [userThemes, setUserThemes] = useState<Record<string, UserColorTheme>>(() =>
    structuredClone(settings.userThemes),
  );
  const [userColors, setUserColors] = useState<Record<string, string>>(() => ({
    ...settings.userColors,
  }));
  const [pcbnew, setPcbnew] = useState<PcbnewSettings>(() => structuredClone(settings.pcbnew));
  const [gerbview, setGerbview] = useState<GerbviewSettings>(() =>
    structuredClone(settings.gerbview),
  );
  const [plEditor, setPlEditor] = useState<PlEditorSettings>(() =>
    structuredClone(settings.plEditor),
  );
  const [privacy, setPrivacy] = useState<PrivacySettings>(() => structuredClone(settings.privacy));
  const [hotkeys, setHotkeys] = useState<HotkeyOverrides>(() => ({ ...settings.hotkeys }));
  /**
   * Each app's `TOOLBAR_SETTINGS`, cloned like the rest. Upstream the Toolbars
   * page keeps its own shadow copy of the toolbars for exactly this reason —
   * `m_toolbars` in `PANEL_TOOLBAR_CUSTOMIZATION`, written back to the real
   * `TOOLBAR_SETTINGS` only in `TransferDataFromWindow`.
   */
  const [toolbars, setToolbars] = useState<Record<ToolbarApp, ToolbarSettings>>(() =>
    structuredClone(settings.toolbars),
  );

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

  const upSym = (fn: (s: SymbolEditorSettings) => void): void =>
    setSymbolEditor((s) => {
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

  const upGbr = (fn: (s: GerbviewSettings) => void): void =>
    setGerbview((s) => {
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

  const upTb = (app: ToolbarApp, fn: (s: ToolbarSettings) => void): void =>
    setToolbars((s) => {
      const n = structuredClone(s[app]);
      fn(n);
      return { ...s, [app]: n };
    });

  const ok = (): void => {
    settings.updateCommon((s) => Object.assign(s, common));
    settings.updateEeschema((s) => Object.assign(s, eeschema));
    settings.updateSymbolEditor((s) => Object.assign(s, symbolEditor));
    settings.updatePcbnew((s) => Object.assign(s, pcbnew));
    settings.updateGerbview((s) => Object.assign(s, gerbview));
    settings.updatePlEditor((s) => Object.assign(s, plEditor));
    // `TransferDataFromWindow` writes every toolbar back through
    // `SetStoredToolbarConfig`, changed or not
    // (`panel_toolbar_customization.cpp:352-354`).
    for (const app of TOOLBAR_APPS)
      settings.updateToolbars(app, (s) => Object.assign(s, toolbars[app]));
    settings.setUserColors(userColors);
    settings.setUserThemes(userThemes);
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
    symbolEditor,
    pcbnew,
    gerbview,
    plEditor,
    privacy,
    userColors,
    userThemes,
    hotkeys,
    toolbars,
    upC,
    upE,
    upSym,
    upP,
    upGbr,
    upPl,
    upTb,
    setCommon,
    setEeschema,
    setSymbolEditor,
    setPcbnew,
    setGerbview,
    setPlEditor,
    setPrivacy,
    setUserColors,
    setUserThemes,
    setHotkeys,
    // Cancel, not close: `onClose` is the shell's discard path, so the working
    // copy is dropped rather than committed. Which is the whole point of the
    // call site — see `PrefsContext.cancelDialog`.
    cancelDialog: onClose,
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
      {/* `newSize.IncTo( minSize )` (paged_dialog.cpp:446-450): the dialog grows
          to fit a page and never shrinks back, so changing page does not resize
          it under the user. `.ze-modal` is `width: max-content` and would do
          the opposite - track the current page and shrink on a smaller one. */}
      <div
        className="ze-modal ze-paged-dialog ze-prefs-dialog"
        ref={size.ref}
        style={size.style}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="ze-modal-header">
          Preferences
          <span className="x" onClick={onClose}>
            ✕
          </span>
        </div>
        <div className="ze-prefs-body">
          {/* The SAME tree Board Setup and Schematic Setup draw. Upstream all
              three are PAGED_DIALOGs over one wxTreebook, so none of them can
              have a different tree; ours had two, and this one's parents were
              dead headings with no expander and nothing to collapse. */}
          <PagedDialogTree
            sections={treeSections}
            page={page}
            collapsed={collapsed}
            onToggleSection={toggleSection}
            onSelect={(id) => setPage(id as PrefsPageId)}
          />
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
          {/* `m_openPrefsDirButton`, added straight after the reset button and
              before the stretch spacer (`common/widgets/paged_dialog.cpp:90-99`,
              under `aShowOpenFolder`, which the Preferences dialog passes).

              Disabled: our settings live in the browser's localStorage, so
              there is no directory to open - the same treatment every other
              control KiCad has and this app cannot back already gets, rather
              than a button that silently does nothing or a gap where KiCad has
              a control. */}
          <button
            className="ze-btn"
            disabled
            title="Settings are stored in the browser, not in a preferences directory."
          >
            Open Preferences Directory
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
