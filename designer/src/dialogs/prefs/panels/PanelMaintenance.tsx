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
 * filesystem path.
 *
 * All four buttons are live. `m_clearDontShowAgain` was the last greyed one,
 * on the grounds that this port had no "do not show again" dialog — which was
 * true and was a reason to BUILD one, not to grey the button that clears them.
 * `KIDIALOG` is `ui/kidialog.tsx` now, and `doClearDontShowAgain`'s two halves
 * are `clearDoNotShowAgainSettings` (the six persisted bools) and
 * `clearDoNotShowAgainDialogs` (the session map) — the same two stores, in the
 * two modules that own them.
 *
 * Note what the other two buttons therefore do: `doClearDialogState` opens with
 * `doClearDontShowAgain()` (`:117-119`) and `onResetAll` calls
 * `doClearDialogState()` (`:140`), so all three of the reset buttons clear the
 * don't-show-agains and only the first of them says so.
 *
 * `Reset All Dialogs to Defaults` IS live: `doClearDialogState` empties
 * `m_dialogControlValues`, and `common.dialog.controls` is the port of exactly
 * that map. It reads as unbuildable and is not -- which is why the button was
 * greyed here at first.
 *
 * So was the spin control, on the reading that a browser ages its own caches.
 * That was true of an `<img>` and is not true of this: `editors/pcb/
 * model_cache.ts` is OUR IndexedDB store, keyed by the hash of a model's bytes,
 * with a `usedAt` column written on every hit — the access time upstream asks a
 * filesystem for. `cleanup3dCache` reads this value when the board editor
 * closes, exactly where `PCB_BASE_FRAME::canCloseWindow` calls
 * `PROJECT_PCB::Cleanup3DCache`.
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
  clearDoNotShowAgainSettings,
  clearFileHistory,
  resetAllSettings,
} from '../../../prefs/maintenance.js';
import { clearDoNotShowAgainDialogs } from '../../../ui/do_not_show_again.js';
import type { PrefsContext } from '../types.js';

/** `m_cacheLifetime`'s own tooltip, upstream's text verbatim. [data] */
const CACHE_TOOLTIP =
  '3D cache files older than this are deleted.\nIf set to 0, cache clearing is disabled';

/**
 * `new wxSpinCtrl( …, wxSP_ARROW_KEYS, 0, 120, 30 )`
 * (`panel_maintenance_base.cpp:27`) — the control's own range. [data]
 *
 * The 30 in that call is the initial value wxFormBuilder emits and never the
 * one shown: `TransferDataToWindow` overwrites it from the settings object, so
 * the default belongs to `COMMON_DEFAULTS` and is read from there.
 */
const CACHE_DAYS_MIN = 0;
const CACHE_DAYS_MAX = 120;

export function PanelMaintenance({ ctx }: { ctx: PrefsContext }): JSX.Element {
  // What the last button press did, shown where upstream shows an infobar.
  const [note, setNote] = useState<string | null>(null);

  return (
    <>
      {/* `margins`, added to `bPanelSizer` with proportion 0 and no wxEXPAND
          (`:61`), so the whole page is as wide as its widest control insists
          and not as wide as the page area. See `.ze-maintenance`. */}
      <div className="ze-maintenance">
        <Num
          label="3D cache file duration:"
          value={ctx.common.system.clear_3d_cache_interval}
          onChange={(v) =>
            ctx.upC((s) => {
              s.system.clear_3d_cache_interval = v;
            })
          }
          unit="days"
          min={CACHE_DAYS_MIN}
          max={CACHE_DAYS_MAX}
          title={CACHE_TOOLTIP}
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

          <button
            type="button"
            className="ze-btn"
            onClick={() => {
              // `doClearDontShowAgain()` — the persisted six and the session
              // map, in that order, exactly as upstream (`:94-105`).
              const n = clearDoNotShowAgainSettings() + clearDoNotShowAgainDialogs();
              // `_( "\"Don't show again\" dialogs reset." )` [data]
              setNote(
                n > 0 ? '"Don\'t show again" dialogs reset.' : 'No dialog had been silenced.',
              );
            }}
          >
            Reset &quot;Don&apos;t Show Again&quot; Dialogs
          </button>

          <button
            type="button"
            className="ze-btn"
            onClick={() => {
              // `doClearDialogState` opens with `doClearDontShowAgain()`, whose
              // session half is not storage and so cannot live in
              // `clearDialogState`.
              clearDoNotShowAgainDialogs();
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
              // `onResetAll` -> `doClearDialogState()` -> `doClearDontShowAgain()`.
              // `resetAllSettings` drops the whole prefix, which takes the six
              // persisted bools with it; the session map is not in storage.
              clearDoNotShowAgainDialogs();
              resetAllSettings();
              // `wxQueueEvent( m_parent, … wxID_CANCEL )`: the working copy must
              // not be committed over the defaults we just wrote.
              ctx.cancelDialog();
            }}
          >
            Reset All Program Settings to Defaults
          </button>
        </div>
      </div>

      {/* Outside `margins`: upstream this is the DIALOG's `wxInfoBar`, not a
          control on the page, so it must not be one of the widths `margins`
          sizes itself to. */}
      {note !== null && <div className="ze-pref-hint">{note}</div>}
    </>
  );
}
