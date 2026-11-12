// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `APPEARANCE_CONTROLS_BASE` (pcbnew/widgets/appearance_controls_base.cpp): the notebook of
 * Layers / Objects / Nets pages, the Nets page's `m_netsTabSplitter` between nets and net
 * classes, and the Presets and Viewports choices under it. The rows of every page and the two
 * display-option panes are what APPEARANCE_CONTROLS builds into it (appearance_controls.tsx).
 */
import { type JSX, type ReactNode, useRef, useState } from 'react';
import { KiBitmapBundle } from '@ziroeda/common/bitmap.js';
import { Sash } from '@ziroeda/common/widgets/wx_splitter_window.js';
import { BITMAPS } from '@ziroeda/include/bitmaps/bitmaps_list.js';
import { Combo } from '@ziroeda/wx/combobox.js';
import { _ } from '@ziroeda/wx/translation.js';
import { wxFormat } from '@ziroeda/wx/wxstring.js';

/** A wxChoice whose rows may be disabled (Delete preset... with nothing to delete). */
export interface APPEARANCE_CHOICE {
  value: string;
  items: readonly { label: string; disabled?: boolean }[];
  onChange: (aLabel: string) => void;
}

export interface APPEARANCE_CONTROLS_BASE_PROPS<TAB extends string> {
  /** The notebook's pages; the footprint editor RemovePage()s Nets. */
  tabs: readonly TAB[];
  page: TAB;
  onTab: (aTab: TAB) => void;
  /** m_windowLayers' rows, and m_paneLayerDisplayOptions under them. */
  layersContent: ReactNode;
  layerDisplayPane: ReactNode;
  /** m_windowObjects' rows. */
  objectsContent: ReactNode;
  /** The Nets page; absent in the footprint editor. */
  nets?: {
    /** m_netsGrid */
    netsList: ReactNode;
    onShowNetInspector?: () => void;
    /** m_netclassScrolledWindow */
    netclassList: ReactNode;
    onConfigureNetclasses: () => void;
    netDisplayPane: ReactNode;
  };
  m_cbLayerPresets: APPEARANCE_CHOICE;
  m_cbViewports: APPEARANCE_CHOICE;
}

/* `m_netsTabSplitter->SplitHorizontally( ..., 300 )` and `SetMinimumPaneSize( 80 )`
   (appearance_controls_base.cpp:52, :144). */
const NETS_SASH_POS = 300;
const NETS_MIN_PANE = 80;

export function APPEARANCE_CONTROLS_BASE<TAB extends string>(
  p: APPEARANCE_CONTROLS_BASE_PROPS<TAB>,
): JSX.Element {
  const { tabs, page } = p;
  const n = p.nets;
  const [netsSashPos, setNetsSashPos] = useState(NETS_SASH_POS);
  const netsPageRef = useRef<HTMLDivElement>(null);
  const choice = (c: APPEARANCE_CHOICE, aName: string) => (
    <Combo
      ariaLabel={aName}
      value={c.value}
      // The name is the key; what the combo shows is `wxGetTranslation( name )` (:2744).
      options={c.items.map((i) => ({ value: i.label, label: _(i.label), disabled: i.disabled }))}
      onChange={c.onChange}
    />
  );

  return (
    <div className="ze-appearance">
      {/* APPEARANCE_CONTROLS' wxNotebook (appearance_controls_base.cpp:22).
          The same widget pl_editor and GerbView draw, so it takes the shared
          .ze-nb-tabs rule and states nothing of its own.

          `.ze-nb-frame` is the notebook itself — a wxNotebook draws a box
          around the tab strip AND the page, and everything inside this element
          is what that box encloses: the strip, the layer/object/net list, and
          the "Layer Display Options" pane, which is a child of `m_panelLayers`
          (appearance_controls.cpp:625) and therefore inside the notebook.
          Presets and Viewports are children of the PANEL, so they stay
          outside it. [px] pcbnew 1920x1200: the frame's top edge at y=193,
          five pixels under the caption, and its bottom at y=834, immediately
          below the collapsed "Layer Display Options" strip. */}
      <div className="ze-nb-frame ze-appearance-nb">
        <div className="ze-nb-tabs" role="tablist">
          {tabs.map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={page === t}
              className={page === t ? 'active' : undefined}
              onClick={() => p.onTab(t)}
            >
              {_(t)}
            </button>
          ))}
        </div>

        {/* The notebook page. `m_layerPanelColour` is set on `m_windowLayers`
          alone — `m_windowObjects` is never given it (appearance_controls.cpp
          :1242-1248, and the Objects page's scroller appears nowhere in that
          function) — so the Layers page is the lighter list grey and the other
          two keep the notebook page's own background. [px] pcbnew: #4b4b4b
          behind a layer row, #272727 behind an object row. */}
        <div
          ref={netsPageRef}
          className={`ze-panel-body ze-appearance-page page-${page.toLowerCase()}`}
        >
          {page === 'Layers' && p.layersContent}

          {page === 'Objects' && p.objectsContent}

          {page === 'Nets' && n && (
            <>
              {/* `m_panelNets`, the upper half of `m_netsTabSplitter`. */}
              <div className="ze-nets-box" style={{ height: netsSashPos, flex: '0 0 auto' }}>
                {/* m_txtNetFilter is constructed and then Hide()n
                  (appearance_controls_base.cpp:67); what sits at the right of
                  this header is the Net Inspector button. */}
                <div className="ze-nets-header">
                  <span>{_('Nets')}</span>
                  {/* PCB_ACTIONS::showNetInspector. The panel it opens is not
                    ported, so the button is genuinely unavailable and says so. */}
                  <button
                    type="button"
                    className="ze-bitmap-btn"
                    title={_('Show the Net Inspector')}
                    onClick={n.onShowNetInspector}
                    disabled={!n.onShowNetInspector}
                  >
                    {/* `m_btnNetInspector->SetBitmap( KiBitmapBundle(
                      BITMAPS::list_nets_16 ) )` (appearance_controls.cpp:471).
                      Vendored from KiCad's own `sources/dark/list_nets_16.svg`;
                      what stood here was a hand-drawn stand-in out of
                      `icons.tsx`, whose header says as much. */}
                    <img src={KiBitmapBundle(BITMAPS.list_nets_16)} width="16" height="16" alt="" />
                  </button>
                </div>
                {n.netsList}
              </div>

              {/* `m_netsTabSplitter->SplitHorizontally( m_panelNets,
                  m_panelNetclasses, 300 )` with `SetMinimumPaneSize( 80 )`
                  (appearance_controls_base.cpp:52, :144). Without it a board
                  with 220 nets pushed Net Classes off the bottom of the pane
                  and there was no way to reach it. The bar is `ui/Sash`, the
                  shared wxSplitterWindow sash — the same one the symbol
                  chooser and the symbol viewer open. */}
              <Sash
                edge="bottom"
                size={netsSashPos}
                min={NETS_MIN_PANE}
                max={Math.max(
                  NETS_MIN_PANE,
                  (netsPageRef.current?.clientHeight ?? 0) - NETS_MIN_PANE,
                )}
                onResize={setNetsSashPos}
              />

              {/* `m_panelNetclasses`, the lower half. */}
              <div className="ze-nets-box grow">
                <div className="ze-nets-header">
                  <span>{_('Net Classes')}</span>
                  <button
                    type="button"
                    className="ze-bitmap-btn"
                    title={_('Configure net classes')}
                    onClick={n.onConfigureNetclasses}
                  >
                    {/* `m_btnConfigureNetClasses->SetBitmap( KiBitmapBundle(
                      BITMAPS::options_generic_16 ) )` (:474). */}
                    <img
                      src={KiBitmapBundle(BITMAPS.options_generic_16)}
                      width="16"
                      height="16"
                      alt=""
                    />
                  </button>
                </div>
                {n.netclassList}
              </div>
            </>
          )}
        </div>

        {/* "Net Display Options" collapsible pane on the Nets tab. */}
        {page === 'Nets' && n && n.netDisplayPane}

        {/* "Layer Display Options" collapsible pane at the bottom of the Layers
          tab (createControls). Both frames build it: `m_cbFlipBoard` and the
          three high-contrast radios are set from `GetDisplayOptions()` with no
          `m_isFpEditor` branch at all (UpdateDisplayOptions, :1500-1520). */}
        {page === 'Layers' && p.layerDisplayPane}
      </div>

      {/* Presets / Viewports below the notebook. Both live on the PANEL, not on
          a page (appearance_controls_base.cpp:140-186), so both frames get them
          — `rebuildLayerPresetsWidget` and `rebuildViewportsWidget` have no
          `m_isFpEditor` branch. */}
      <div className="ze-appearance-bottom">
        <div className="ze-info ze-inset">{_('Presets (Ctrl+Tab):')}</div>
        {/* `m_cbLayerPresets` is a wxChoice (appearance_controls_base.cpp:165),
            and a wxChoice is the shared `Combo` — never a native <select>,
            which brings the platform's own metrics, arrow and popup and cannot
            be made to match GTK's. */}
        {choice(p.m_cbLayerPresets, _('Presets'))}
        {/* `VIEWPORT_SWITCH_KEY` is WXK_SHIFT (appearance_controls.cpp), which
            is why the label reads Shift and not the Alt the wxFormBuilder stub
            carries. */}
        {/* wxString::Format( _( "Viewports (%s+Tab):" ), KeyNameFromKeyCode( VIEWPORT_SWITCH_KEY ) ) */}
        <div className="ze-info ze-inset ze-viewports-label">
          {wxFormat(_('Viewports (%s+Tab):'), 'Shift')}
        </div>
        {choice(p.m_cbViewports, _('Viewports'))}
      </div>
    </div>
  );
}
