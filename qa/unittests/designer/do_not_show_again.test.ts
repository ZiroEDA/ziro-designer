// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `KIDIALOG`'s "do not show again" memory (`common/kidialog.cpp`), and the two
 * stores Preferences > Maintenance clears.
 *
 * The rules here are small and every one of them is silent when wrong: a dialog
 * that forgets it was silenced looks exactly like a dialog the user never
 * silenced, and a dialog that remembers the WRONG answer looks like the user
 * choosing it. Nothing about either shows up as an error.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DO_NOT_SHOW_KEYS,
  clearDoNotShowAgainDialogs,
  doNotShowAgainAnswer,
  rememberDoNotShowAgain,
} from '@ziroeda/designer/src/ui/do_not_show_again.js';
import {
  STORAGE_PREFIX,
  clearDialogState,
  clearDoNotShowAgainSettings,
} from '@ziroeda/designer/src/prefs/maintenance.js';
import { COMMON_DEFAULTS } from '@ziroeda/designer/src/prefs/settings.js';

const KEY = 'test/dialog.cpp:Ask';

beforeEach(() => {
  clearDoNotShowAgainDialogs();
});

describe('what the map stores', () => {
  it('is the ANSWER, so a silenced dialog goes on answering the same way', () => {
    // `g_doNotShowAgainDlgs[m_hash] = ret;` and `ShowModal` returns `it->second`.
    // Not a boolean: a dialog silenced on Cancel must keep cancelling, and one
    // that came back "ok" every time would apply the thing the user refused.
    rememberDoNotShowAgain(KEY, 'cancel', { checked: true, cancelMeansCancel: false });
    expect(doNotShowAgainAnswer(KEY)).toBe('cancel');

    clearDoNotShowAgainDialogs();
    rememberDoNotShowAgain(KEY, 'ok', { checked: true, cancelMeansCancel: false });
    expect(doNotShowAgainAnswer(KEY)).toBe('ok');
  });

  it('is undefined for a dialog that was never silenced', () => {
    expect(doNotShowAgainAnswer(KEY)).toBeUndefined();
  });

  it('stores nothing when the box was not ticked', () => {
    rememberDoNotShowAgain(KEY, 'ok', { checked: false, cancelMeansCancel: true });
    expect(doNotShowAgainAnswer(KEY)).toBeUndefined();
  });
});

describe('m_cancelMeansCancel', () => {
  // `if( IsCheckBoxChecked() && ( !m_cancelMeansCancel || ret != wxID_CANCEL ) )`
  it('does not remember a real Cancel, however firmly the box is ticked', () => {
    // The button still says "Cancel", so ticking the box and cancelling is not
    // a request to have "no" applied forever without being asked.
    rememberDoNotShowAgain(KEY, 'cancel', { checked: true, cancelMeansCancel: true });
    expect(doNotShowAgainAnswer(KEY)).toBeUndefined();
  });

  it('does remember it once the dialog has renamed the Cancel button', () => {
    // `SetOKCancelLabels` clears the flag (`include/kidialog.h:52-56`): a
    // renamed Cancel is doing some other job and is worth keeping.
    rememberDoNotShowAgain(KEY, 'cancel', { checked: true, cancelMeansCancel: false });
    expect(doNotShowAgainAnswer(KEY)).toBe('cancel');
  });

  it('remembers OK either way — the flag is only about Cancel', () => {
    rememberDoNotShowAgain(KEY, 'ok', { checked: true, cancelMeansCancel: true });
    expect(doNotShowAgainAnswer(KEY)).toBe('ok');
  });
});

describe('clearing the session map', () => {
  it('empties it and reports how many went, which is the infobar line', () => {
    rememberDoNotShowAgain('a', 'ok', { checked: true, cancelMeansCancel: true });
    rememberDoNotShowAgain('b', 'cancel', { checked: true, cancelMeansCancel: false });

    expect(clearDoNotShowAgainDialogs()).toBe(2);
    expect(doNotShowAgainAnswer('a')).toBeUndefined();
    expect(doNotShowAgainAnswer('b')).toBeUndefined();
    // ...and the page says "No dialog had been silenced." the second time.
    expect(clearDoNotShowAgainDialogs()).toBe(0);
  });
});

describe('the keys', () => {
  it('are declared once, so one cannot be edited in passing', () => {
    // Upstream derives the key from `__FILE__, __LINE__` and has no list.
    // Ours is written by hand, and changing one silently un-silences every
    // user's dialog while looking like a rename.
    expect(DO_NOT_SHOW_KEYS.symbolEditorPinClash).toBe(
      'eeschema/tools/symbol_editor_pin_tool.cpp:PlacePin',
    );
  });
});

/** Enough of the Storage interface for the settings half. */
function fakeStore(entries: Record<string, string>): Storage {
  const map = new Map(Object.entries(entries));
  return {
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  } as Storage;
}

const silenced = (): Storage =>
  fakeStore({
    [`${STORAGE_PREFIX}.common`]: JSON.stringify({
      do_not_show_again: { ...COMMON_DEFAULTS.do_not_show_again, zone_fill_warning: true },
      dialog: { controls: { dialog_x: { ctl: 1 } } },
      system: { file_history_size: 9 },
    }),
  });

describe('the persisted half', () => {
  const read = (s: Storage): { do_not_show_again: Record<string, boolean> } =>
    JSON.parse(s.getItem(`${STORAGE_PREFIX}.common`) as string);

  it('puts all six back to false, which is what `= {}` means on that struct', () => {
    const s = silenced();
    expect(clearDoNotShowAgainSettings(s)).toBe(1);
    expect(read(s).do_not_show_again).toEqual(COMMON_DEFAULTS.do_not_show_again);
  });

  it('leaves the rest of the common slice alone', () => {
    // `m_DoNotShowAgain = {}` is one member of COMMON_SETTINGS, not the file.
    const s = silenced();
    clearDoNotShowAgainSettings(s);
    const after = JSON.parse(s.getItem(`${STORAGE_PREFIX}.common`) as string);
    expect(after.system.file_history_size).toBe(9);
    expect(after.dialog.controls).toEqual({ dialog_x: { ctl: 1 } });
  });

  it('is quiet when nothing was silenced', () => {
    expect(clearDoNotShowAgainSettings(fakeStore({}))).toBe(0);
  });
});

describe('Reset All Dialogs to Defaults clears the don’t-show-agains too', () => {
  it('because doClearDialogState opens with doClearDontShowAgain()', () => {
    // `panel_maintenance.cpp:117-119`. Without this, a user who reset "all
    // dialogs" still had a silenced dialog staying silent.
    const s = silenced();
    clearDialogState(s);
    const after = JSON.parse(s.getItem(`${STORAGE_PREFIX}.common`) as string);
    expect(after.do_not_show_again.zone_fill_warning).toBe(false);
    expect(after.dialog.controls).toEqual({});
  });
});
