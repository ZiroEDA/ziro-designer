// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Calculator Tools frame: menu bar, collapsible navigation tree (General
 * system design / Power, current and isolation / High Speed / Memo) and the
 * active calculator panel.
 * Counterpart: KiCad `pcb_calculator/pcb_calculator_frame.cpp`.
 */

import { useState, type JSX } from 'react';
import { MenuBar, type Menu } from '../../ui/MenuBar.js';
import { Modal } from './fields.js';
import { PanelRegulator } from './panels/panel_regulator.js';
import { PanelRCalculator } from './panels/panel_r_calculator.js';
import { PanelElectricalSpacing } from './panels/panel_electrical_spacing.js';
import { PanelViaSize } from './panels/panel_via_size.js';
import { PanelTrackWidth } from './panels/panel_track_width.js';
import { PanelFusingCurrent } from './panels/panel_fusing_current.js';
import { PanelCableSize } from './panels/panel_cable_size.js';
import { PanelWavelength } from './panels/panel_wavelength.js';
import { PanelRfAttenuators } from './panels/panel_rf_attenuators.js';
import { PanelTransline } from './panels/panel_transline.js';
import { PanelEseriesDisplay } from './panels/panel_eseries_display.js';
import { PanelColorCode } from './panels/panel_color_code.js';
import { PanelBoardClass } from './panels/panel_board_class.js';
import { PanelGalvanicCorrosion } from './panels/panel_galvanic_corrosion.js';
import './calculator.css';
import { standardHelpMenu } from '../../ui/help_menu.js';
import { useMenuHotkeys } from '../../ui/useMenuHotkeys.js';
import { addClose, addQuit } from '../../ui/action_menu.js';
import { showHotkeyList } from '../../ui/hotkey_list_action.js';
import { ABOUT_TITLES, aboutWindowTitle } from '../../ui/about_titles.js';
import { PreferencesDialog } from '../../dialogs/PreferencesDialog.js';
import { setLanguageMenuItem } from '../../ui/language_menu.js';
import { settings } from '../../prefs/settings.js';
import { useCommonSettings } from '../../prefs/useSettings.js';

interface TreeItem {
  id: string;
  name: string;
  panel: () => JSX.Element;
}

interface TreeGroup {
  name: string;
  items: TreeItem[];
}

const TREE: TreeGroup[] = [
  {
    name: 'General system design',
    items: [
      { id: 'regulators', name: 'Regulators', panel: PanelRegulator },
      { id: 'r_calculator', name: 'Resistor Calculator', panel: PanelRCalculator },
    ],
  },
  {
    name: 'Power, current and isolation',
    items: [
      { id: 'electrical_spacing', name: 'Electrical Spacing', panel: PanelElectricalSpacing },
      { id: 'via_size', name: 'Via Size', panel: PanelViaSize },
      { id: 'track_width', name: 'Track Width', panel: PanelTrackWidth },
      { id: 'fusing_current', name: 'Fusing Current', panel: PanelFusingCurrent },
      { id: 'cable_size', name: 'Cable Size', panel: PanelCableSize },
    ],
  },
  {
    name: 'High Speed',
    items: [
      { id: 'wavelength', name: 'Wavelength', panel: PanelWavelength },
      { id: 'rf_attenuators', name: 'RF Attenuators', panel: PanelRfAttenuators },
      { id: 'transmission_lines', name: 'Transmission Lines', panel: PanelTransline },
    ],
  },
  {
    name: 'Memo',
    items: [
      { id: 'eseries', name: 'E-Series', panel: PanelEseriesDisplay },
      { id: 'color_code', name: 'Color Code', panel: PanelColorCode },
      { id: 'board_classes', name: 'Board Classes', panel: PanelBoardClass },
      { id: 'galvanic_corrosion', name: 'Galvanic Corrosion', panel: PanelGalvanicCorrosion },
    ],
  },
];

export function CalculatorTools({ onExitToHome }: { onExitToHome: () => void }): JSX.Element {
  const [active, setActive] = useState('regulators');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [aboutOpen, setAboutOpen] = useState(false);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const common = useCommonSettings();

  const menus: Menu[] = [
    {
      label: 'File',
      items: [
        addClose('Calculator Tools', onExitToHome),
        addQuit('Calculator Tools', onExitToHome),
      ],
    },
    // PCB_CALCULATOR_FRAME::doReCreateMenuBar (pcb_calculator_frame.cpp:215-222)
    // is two entries and nothing else: ACTIONS::openPreferences, a separator,
    // then AddMenuLanguageList. The frame overrides no InstallPreferences, so
    // the dialog it opens is EDA_BASE_FRAME's own - the CENTRAL one every other
    // frame opens, with no calculator page of its own. Ours had invented a
    // "Reset stored data (regulators)" item instead and offered neither.
    {
      label: 'Preferences',
      items: [
        { label: 'Preferences…', shortcut: 'Ctrl+,', action: () => setPrefsOpen(true) },
        { sep: true },
        setLanguageMenuItem({
          current: common.system.language,
          onSelect: (label) =>
            settings.updateCommon((c) => {
              c.system.language = label;
            }),
        }),
      ],
    },
    standardHelpMenu({ showHotkeys: showHotkeyList, showAbout: () => setAboutOpen(true) }),
  ];

  useMenuHotkeys(menus, 'calculator');

  return (
    <div className="calc-frame ze-app">
      <MenuBar
        menus={menus}
        leftSlot={
          <div className="ze-home-link" onClick={onExitToHome} title="Back to project manager">
            ⌂ ZiroEDA
          </div>
        }
        title="Calculator Tools"
      />
      <div className="calc-body">
        <nav className="calc-tree" data-testid="calc-tree">
          {TREE.map((group) => (
            <div key={group.name}>
              <div
                className="calc-tree-group"
                onClick={() =>
                  setCollapsed((prev) => {
                    const next = new Set(prev);
                    if (next.has(group.name)) next.delete(group.name);
                    else next.add(group.name);
                    return next;
                  })
                }
              >
                <span className={`twisty expandable${collapsed.has(group.name) ? '' : ' open'}`} />
                {group.name}
              </div>
              {!collapsed.has(group.name) &&
                group.items.map((it) => (
                  <div
                    key={it.id}
                    className={`calc-tree-item${it.id === active ? ' active' : ''}`}
                    onClick={() => setActive(it.id)}
                  >
                    {it.name}
                  </div>
                ))}
            </div>
          ))}
        </nav>
        {/* A wxTreebook builds EVERY page when the frame is created and only
            shows one at a time (wxBookCtrlBase::AddPage), so a value typed on
            Regulators is still there after a trip through Cable Size. Rendering
            only the selected panel unmounted the other thirteen and reset them,
            which is the one behaviour of this frame a user notices instantly.
            Hidden, not unmounted. */}
        <main className="calc-panel" data-testid="calc-panel">
          {TREE.flatMap((g) => g.items).map((it) => {
            const Panel = it.panel;
            return (
              <div key={it.id} hidden={it.id !== active} className="calc-page">
                <Panel />
              </div>
            );
          })}
        </main>
      </div>
      {prefsOpen && <PreferencesDialog onClose={() => setPrefsOpen(false)} />}

      {aboutOpen && (
        <Modal
          title={aboutWindowTitle(ABOUT_TITLES.calculator)}
          onClose={() => setAboutOpen(false)}
          footer={
            <button type="button" className="calc-btn primary" onClick={() => setAboutOpen(false)}>
              Close
            </button>
          }
        >
          <p style={{ margin: '0 0 8px' }}>
            Engineering calculators for PCB design, organised like KiCad's Calculator Tools:
          </p>
          <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
            <li>General system design, regulators, resistor substitution</li>
            <li>Power, current & isolation, spacing, via, track width, fusing, cable</li>
            <li>High speed, wavelength, RF attenuators, transmission lines</li>
            <li>Memo, E-series, colour code, board classes, galvanic corrosion</li>
          </ul>
        </Modal>
      )}
    </div>
  );
}
