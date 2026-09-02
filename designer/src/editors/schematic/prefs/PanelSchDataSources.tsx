// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Preferences > Schematic Editor > Data Sources — `PANEL_SCH_DATA_SOURCES`
 * (`eeschema/dialogs/panel_sch_data_sources.cpp`), which eeschema builds for
 * `PANEL_SCH_DATA_SOURCES` (`eeschema/eeschema.cpp:367-377`).
 *
 * There is no `_base.cpp` for this one — the panel builds its own sizer in the
 * constructor (`:39-73`), which is four things in a vertical box:
 *
 *     m_description  0, wxALL|wxEXPAND, 12      Wrap( 480 ), GetInfoFont
 *     m_sourcesList  1, wxLEFT|wxRIGHT|wxBOTTOM|wxEXPAND, 12   MinSize( -1, 160 )
 *     m_status       0, wxLEFT|wxBOTTOM|wxEXPAND, 12           GetSmallInfoFont().Italic()
 *     m_manageButton 0, wxRIGHT|wxALIGN_RIGHT, 12
 *
 * This page is LIVE, which is not obvious: it holds no settings at all. It
 * reads the Plugin and Content Manager's installed packages and shows the ones
 * whose type is `PT_DATASOURCE` (`populateInstalledSources`, `:96-138`), so
 * what makes it live is `pcm`, which we already have — the same store the
 * Colors page asks for installed themes.
 *
 * The button is `SetActivePackageType( PT_DATASOURCE )` then `ShowModal()` on
 * DIALOG_PCM (`:141-152`). Ours opens the same manager on the same tab; that
 * is what `initialTab` on `PluginManagerDialog` is for, and this is its first
 * caller.
 */
import { useState, type JSX } from 'react';
import { pcm, usePcmVersion } from '../../../pcm/pcmStore.js';
import { PluginManagerDialog } from '../../../pcm/PluginManagerDialog.js';

export function PanelSchDataSources(): JSX.Element {
  usePcmVersion();
  const [managing, setManaging] = useState(false);

  /**
   * `populateInstalledSources`: every installed package of the data-source
   * type, labelled `name (version) — repository`, the two suffixes each
   * dropped when empty, sorted with `CmpNoCase`.
   */
  const entries = pcm
    .installedList()
    .filter((p) => p.kind === 'datasource')
    .map((p) => {
      let label = p.name;
      if (p.currentVersion !== '') label += ` (${p.currentVersion})`;
      if (p.source !== '') label += ` — ${p.source}`;
      return label;
    })
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

  return (
    <div className="ze-datasources">
      {/* `m_description->SetFont( KIUI::GetInfoFont( this ) )` and
          `Wrap( FromDIP( 480 ) )`. */}
      <p className="ze-datasources-desc">
        Install schematic data sources from the Plugin and Content Manager. Data sources extend
        KiCad by linking schematic items to external data providers.
      </p>

      {/* `m_sourcesList`, a wxListBox at proportion 1 with `MinSize( -1, 160 )`. */}
      <div className="ze-datasources-list" role="listbox" aria-label="Installed data sources">
        {entries.map((label) => (
          <div key={label} className="ze-datasources-row" role="option" aria-selected="false">
            {label}
          </div>
        ))}
      </div>

      {/* `m_status`, `KIUI::GetSmallInfoFont( this ).Italic()`. Both strings are
          upstream's own (`:122` and `:136`). */}
      <div className="ze-datasources-status">
        {entries.length === 0
          ? 'No data sources are currently installed.'
          : 'Installed data sources are listed above.'}
      </div>

      <div className="ze-datasources-btnrow">
        <button type="button" className="ze-btn" onClick={() => setManaging(true)}>
          Manage Data Sources...
        </button>
      </div>

      {managing && (
        <PluginManagerDialog initialTab="datasource" onClose={() => setManaging(false)} />
      )}
    </div>
  );
}
