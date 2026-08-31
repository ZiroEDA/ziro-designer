// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PANEL_MAINTENANCE` (common/dialogs/panel_maintenance_base.cpp), the last row
 * of the Preferences tree.
 *
 * The sizer tree is one column: a labelled spin control, then four buttons.
 *
 *     m_cacheLifetime      wxSpinCtrl   _("3D cache file duration:") … _("days")
 *     m_clearFileHistory   wxButton     _("Clear \"Open Recent\" History")
 *     m_clearDontShowAgain wxButton     _("Reset \"Don't Show Again\" Dialogs")
 *     m_clearDialogState   wxButton     _("Reset All Dialogs to Defaults")
 *     m_resetAll           wxButton     _("Reset All Program Settings to Defaults")
 *
 * Of KiCad's generic pages this is the one that ports whole, because it
 * manipulates the settings store rather than describing a device or a
 * filesystem path. Three of the four buttons are live.
 *
 * The fourth is not, and the reason is narrow: `doClearDontShowAgain` empties
 * `COMMON_SETTINGS::m_DoNotShowAgain` and calls
 * `KIDIALOG::ClearDoNotShowAgainDialogs()`, and this port has no "do not show
 * again" dialog at all. Nothing to clear is not the same as nothing to build.
 *
 * `Reset All Dialogs to Defaults` IS live: `doClearDialogState` empties
 * `m_dialogControlValues`, and `common.dialog.controls` is the port of exactly
 * that map. It reads as unbuildable and is not -- which is why the button was
 * greyed here at first.
 *
 * No confirmation prompt: upstream there is none (`:82-148`). The button states
 * what it does, acts, and shows an infobar message. `onResetAll` additionally
 * queues a `wxID_CANCEL` at the dialog — which matters, and is not cosmetic:
 * the panels edit a working copy the shell commits on OK, so a Reset All that
 * left the dialog open would write the pre-reset copy straight back over the
 * defaults on the way out.
 */
import { useState, type JSX } from 'react';
import { Num } from '../widgets.js';
import {
  clearDialogState,
  clearFileHistory,
  resetAllSettings,
} from '../../../prefs/maintenance.js';
import type { PrefsContext } from '../types.js';

/** `m_cacheLifetime`'s own tooltip, upstream's text verbatim. [data] */
const CACHE_TOOLTIP =
  '3D cache files older than this are deleted.\nIf set to 0, cache clearing is disabled';

const NO_3D_CACHE =
  'KiCad caches converted 3D models in its user directory and ages them out. Ours are fetched ' +
  'and held by the browser, which decides its own eviction; there is no duration for us to set.';

const NO_DO_NOT_SHOW =
  'Nothing to reset yet: this port has no "do not show again" dialogs, so ' +
  'COMMON_SETTINGS::m_DoNotShowAgain has no counterpart here.';

export function PanelMaintenance({ ctx }: { ctx: PrefsContext }): JSX.Element {
  // What the last button press did, shown where upstream shows an infobar.
  const [note, setNote] = useState<string | null>(null);

  return (
    <>
      <Num
        label="3D cache file duration:"
        value={30}
        onChange={() => {}}
        unit="days"
        min={0}
        disabled
        title={`${CACHE_TOOLTIP}\n\n${NO_3D_CACHE}`}
      />

      <div className="ze-pref-buttoncol">
        <button
          type="button"
          className="ze-btn"
          onClick={() => {
            const n = clearFileHistory();
            // `_( "File history cleared." )` [data]
            setNote(n > 0 ? 'File history cleared.' : 'File history was already empty.');
          }}
        >
          Clear &quot;Open Recent&quot; History
        </button>

        <button type="button" className="ze-btn" disabled title={NO_DO_NOT_SHOW}>
          Reset &quot;Don&apos;t Show Again&quot; Dialogs
        </button>

        <button
          type="button"
          className="ze-btn"
          onClick={() => {
            const n = clearDialogState();
            // `_( "All dialogs reset to defaults." )` [data]
            setNote(
              n > 0 ? 'All dialogs reset to defaults.' : 'No dialog had remembered any state.',
            );
          }}
        >
          Reset All Dialogs to Defaults
        </button>

        <button
          type="button"
          className="ze-btn"
          onClick={() => {
            resetAllSettings();
            // `wxQueueEvent( m_parent, … wxID_CANCEL )`: the working copy must
            // not be committed over the defaults we just wrote.
            ctx.cancelDialog();
          }}
        >
          Reset All Program Settings to Defaults
        </button>
      </div>

      {note !== null && <div className="ze-pref-hint">{note}</div>}
    </>
  );
}
