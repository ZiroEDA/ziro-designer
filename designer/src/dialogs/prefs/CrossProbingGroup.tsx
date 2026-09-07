// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
import type { JSX, ReactNode } from 'react';
import type { CrossProbingSettings } from '@ziroeda/common/src/cross_probing_settings.js';
import { Check, Group } from './widgets.js';

/**
 * The "Cross-probing" group, written once because KiCad writes it twice: the
 * same five checkboxes over the same `CROSS_PROBING_SETTINGS` appear in
 * PANEL_EESCHEMA_DISPLAY_OPTIONS (eeschema/dialogs/panel_eeschema_display_options_base.cpp:33-60)
 * and PANEL_DISPLAY_OPTIONS (pcbnew/dialogs/panel_display_options_base.cpp:168-193).
 *
 * Only the wording of three of them differs, because each panel names the *other*
 * editor — "corresponding to PCB selection" in eeschema, "corresponding to
 * schematic selection" in pcbnew — so that is all this takes as a parameter,
 * along with whether the side that owns them reads them.
 *
 * It took a `note` too: a paragraph of ours under the checkboxes saying that
 * the schematic's copy is inert. KiCad has no such text, the sentence was one
 * long line that gave the page a horizontal scrollbar and pushed the Appearance
 * column off the edge of it, and "this control does nothing" is what `disabled`
 * says. The reason belongs in the call site's source, and it is there.
 */
export function CrossProbingGroup({
  value,
  onChange,
  peer,
  disabled,
  children,
}: {
  value: CrossProbingSettings;
  onChange: (fn: (s: CrossProbingSettings) => void) => void;
  /** The editor on the far end of the probe, as this panel's labels name it. */
  peer: 'pcb' | 'schematic';
  /** `wxWindow::Enable( false )` on all five — drawn, but nothing reads them. */
  disabled?: boolean;
  /**
   * Anything else `bSizer8` holds. Only pcbnew's page uses it, for
   * `m_live3Drefresh` (`panel_display_options_base.cpp:196-199`) — a checkbox
   * that is not a cross-probe setting and only shares the group's sizer, so it
   * belongs to the call site and not to this component.
   */
  children?: ReactNode;
}): JSX.Element {
  const sch = peer === 'schematic';
  return (
    <Group title="Cross-probing">
      <Check
        label={`Select/highlight objects corresponding to ${sch ? 'schematic' : 'PCB'} selection`}
        title={`Highlight ${sch ? 'footprints' : 'symbols'} corresponding to selected ${
          sch ? 'symbols' : 'footprints'
        }`}
        checked={value.on_selection}
        disabled={disabled}
        onChange={(v) =>
          onChange((s) => {
            s.on_selection = v;
          })
        }
      />
      <Check
        label="Center view on cross-probed items"
        title={`Ensures that cross-probed ${
          sch ? 'footprints' : 'symbols'
        } are visible in the current view`}
        checked={value.center_on_items}
        disabled={disabled}
        onChange={(v) =>
          onChange((s) => {
            s.center_on_items = v;
          })
        }
      />
      <Check
        label="Zoom to fit cross-probed items"
        checked={value.zoom_to_fit}
        disabled={disabled}
        onChange={(v) =>
          onChange((s) => {
            s.zoom_to_fit = v;
          })
        }
      />
      <Check
        label="Highlight cross-probed nets"
        title={`Highlight nets when they are highlighted in the ${
          sch ? 'schematic' : 'PCB'
        } editor`}
        checked={value.auto_highlight}
        disabled={disabled}
        onChange={(v) =>
          onChange((s) => {
            s.auto_highlight = v;
          })
        }
      />
      <Check
        label="Flash cross-probed selection"
        title="Temporarily flash the newly cross-probed selection 3 times"
        checked={value.flash_selection}
        disabled={disabled}
        onChange={(v) =>
          onChange((s) => {
            s.flash_selection = v;
          })
        }
      />
      {children}
    </Group>
  );
}
