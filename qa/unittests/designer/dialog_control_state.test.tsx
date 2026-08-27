// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Per-dialog control-state persistence — `DIALOG_SHIM::SaveControlState` /
 * `LoadControlState` (common/dialog_shim.cpp:654, :765).
 *
 * The bug this pins: tick "Place repeated copies" in Choose Symbol, place a few
 * symbols, press Esc, and the chooser comes back with the box cleared. Real
 * KiCad still has it ticked, even after the placer tool has been closed and
 * reopened with `A` — and nothing in `dialog_symbol_chooser.cpp` does that. The
 * checkbox is built with no `SetValue` (:79), the dialog holds no statics, and
 * `picksymbol.cpp:62` constructs it fresh on every call. `DIALOG_SHIM`, the base
 * class every KiCad dialog inherits, is what remembers it.
 *
 * So these are tests of the *shared* mechanism, driven through synthetic
 * dialogs, and they are per-control and per-dialog on purpose. A single blanket
 * "the value came back" check passes against an implementation that files every
 * control in the app under one key — which is worse than not persisting at all,
 * because one dialog's value then silently lands in another's control.
 *
 * The Choose Symbol dialog itself cannot be mounted here (its preview is
 * WebGL — see `chooser_shell_metrics.test.tsx`), so the last block reads its
 * source, with comments stripped first so a commented-out call cannot satisfy
 * it.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  dialogKeyFromTitle,
  loadDialogControl,
  restoredValue,
} from '@ziroeda/designer/src/ui/dialog_control_state.js';
import { useDialogControl } from '@ziroeda/designer/src/ui/useDialogControl.js';
import {
  COMMON_DEFAULTS,
  mergeCommon,
  normalizeDialogControls,
  settings,
  sliceStorageKey,
} from '@ziroeda/designer/src/prefs/settings.js';

/** The chooser's real title while its tree is still loading. */
const CHOOSE_SYMBOL = 'Choose Symbol (1234 items loaded)';
/** ... and the other dialog that shares its panel. */
const CHOOSE_POWER = 'Choose Power Symbol (56 items loaded)';

beforeEach(() => {
  settings.updateCommon((s) => {
    s.dialog.controls = {};
  });
  localStorage.clear();
});
afterEach(cleanup);

/** One checkbox, wired the way the chooser wires "Place repeated copies". */
function CheckBox({
  title,
  control,
  defaultValue,
}: {
  title: string | null;
  control: string;
  defaultValue: boolean;
}): JSX.Element {
  const [value, setValue] = useDialogControl(title, control, defaultValue);
  return (
    <input
      type="checkbox"
      aria-label={control}
      checked={value}
      onChange={(e) => setValue(e.target.checked)}
    />
  );
}

/** The chooser's footer: two checkboxes with opposite defaults, one dialog. */
function ChooserFooter({ title }: { title: string | null }): JSX.Element {
  return (
    <>
      <CheckBox title={title} control="keepSymbol" defaultValue={false} />
      <CheckBox title={title} control="placeAllUnits" defaultValue={true} />
    </>
  );
}

const box = (label: string): HTMLInputElement => screen.getByLabelText(label) as HTMLInputElement;

describe('a control keeps what it was last set to', () => {
  it('brings a ticked box back ticked on the next open', () => {
    render(<CheckBox title={CHOOSE_SYMBOL} control="keepSymbol" defaultValue={false} />);
    expect(box('keepSymbol').checked).toBe(false);
    fireEvent.click(box('keepSymbol'));
    expect(box('keepSymbol').checked).toBe(true);

    cleanup(); // the dialog closes
    render(<CheckBox title={CHOOSE_SYMBOL} control="keepSymbol" defaultValue={false} />);
    expect(box('keepSymbol').checked).toBe(true);
  });

  it('brings an unticked box back unticked, against a default of true', () => {
    // The other direction has to be tested separately: an implementation that
    // restores nothing passes the first case if the default happens to be true.
    render(<CheckBox title={CHOOSE_SYMBOL} control="placeAllUnits" defaultValue={true} />);
    fireEvent.click(box('placeAllUnits'));
    expect(box('placeAllUnits').checked).toBe(false);

    cleanup();
    render(<CheckBox title={CHOOSE_SYMBOL} control="placeAllUnits" defaultValue={true} />);
    expect(box('placeAllUnits').checked).toBe(false);
  });

  it('uses the constructor default on a first-ever open', () => {
    // `m_keepSymbol` gets no SetValue and `m_useUnits` gets SetValue( true )
    // (dialog_symbol_chooser.cpp:79, :83); with nothing stored, both stand.
    render(<ChooserFooter title={CHOOSE_SYMBOL} />);
    expect(box('keepSymbol').checked).toBe(false);
    expect(box('placeAllUnits').checked).toBe(true);
  });

  it('writes on close, not on every click', () => {
    // `SaveControlState` is called from `Show( false )` (:542) and
    // `OnCloseWindow` (:1603). There is no wxEVT_CHECKBOX handler doing it.
    render(<CheckBox title={CHOOSE_SYMBOL} control="keepSymbol" defaultValue={false} />);
    fireEvent.click(box('keepSymbol'));
    expect(loadDialogControl('Choose Symbol', 'keepSymbol')).toBeUndefined();

    cleanup();
    expect(loadDialogControl('Choose Symbol', 'keepSymbol')).toBe(true);
  });
});

describe('one control does not answer for another', () => {
  it('keeps two controls of the same dialog apart', () => {
    // Both driven off the defaults they do NOT have, so a single shared key
    // would show them agreeing.
    render(<ChooserFooter title={CHOOSE_SYMBOL} />);
    fireEvent.click(box('keepSymbol'));
    fireEvent.click(box('placeAllUnits'));
    cleanup();

    render(<ChooserFooter title={CHOOSE_SYMBOL} />);
    expect(box('keepSymbol').checked).toBe(true);
    expect(box('placeAllUnits').checked).toBe(false);
    expect(settings.common.dialog.controls['Choose Symbol']).toEqual({
      keepSymbol: true,
      placeAllUnits: false,
    });
  });

  it('keeps two dialogs apart', () => {
    render(<CheckBox title={CHOOSE_SYMBOL} control="keepSymbol" defaultValue={false} />);
    fireEvent.click(box('keepSymbol'));
    cleanup();

    // Same control key, different dialog: it must not see the other's value.
    render(<CheckBox title={CHOOSE_POWER} control="keepSymbol" defaultValue={false} />);
    expect(box('keepSymbol').checked).toBe(false);
    cleanup();

    expect(Object.keys(settings.common.dialog.controls).sort()).toEqual([
      'Choose Power Symbol',
      'Choose Symbol',
    ]);
    expect(loadDialogControl('Choose Symbol', 'keepSymbol')).toBe(true);
    expect(loadDialogControl('Choose Power Symbol', 'keepSymbol')).toBe(false);
  });
});

describe('the dialog key, getDialogKeyFromTitle (dialog_shim.cpp:79-95)', () => {
  it('strips a trailing parenthesised suffix, and the space before it', () => {
    expect(dialogKeyFromTitle('Choose Symbol (1234 items loaded)')).toBe('Choose Symbol');
    expect(dialogKeyFromTitle('Choose Symbol   (0 items loaded)')).toBe('Choose Symbol');
  });

  it('leaves a title with no suffix alone', () => {
    expect(dialogKeyFromTitle('Annotate Schematic')).toBe('Annotate Schematic');
  });

  it('strips only the last group, and never the whole title', () => {
    // `rfind`, and `parenPos > 0`: a title that *starts* with a bracket would
    // otherwise be filed under the empty string, colliding with every other.
    expect(dialogKeyFromTitle('Edit (net) properties (3 selected)')).toBe('Edit (net) properties');
    expect(dialogKeyFromTitle('(unnamed)')).toBe('(unnamed)');
  });

  it('finds what it saved even though the item count moved', () => {
    // This is the reason the strip exists at all, in the words of the C++:
    // otherwise each count would be its own key, "flooding the settings file".
    render(
      <CheckBox title="Choose Symbol (0 items loaded)" control="keepSymbol" defaultValue={false} />,
    );
    fireEvent.click(box('keepSymbol'));
    cleanup();

    render(
      <CheckBox
        title="Choose Symbol (98765 items loaded)"
        control="keepSymbol"
        defaultValue={false}
      />,
    );
    expect(box('keepSymbol').checked).toBe(true);
  });
});

describe('a stored value that is not the right kind of value', () => {
  it('does not reach a checkbox', () => {
    // `LoadControlState` asks `j.is_boolean()` before touching a wxCheckBox
    // (dialog_shim.cpp:~825); a value that fails leaves the constructor's.
    settings.setDialogControl('Choose Symbol', 'keepSymbol', 'true');
    render(<CheckBox title={CHOOSE_SYMBOL} control="keepSymbol" defaultValue={false} />);
    expect(box('keepSymbol').checked).toBe(false);

    settings.setDialogControl('Choose Symbol', 'placeAllUnits', 0);
    render(<CheckBox title={CHOOSE_SYMBOL} control="placeAllUnits" defaultValue={true} />);
    expect(box('placeAllUnits').checked).toBe(true);
  });

  it('is decided by type, per control type', () => {
    expect(restoredValue(true, false)).toBe(true);
    expect(restoredValue(false, true)).toBe(false);
    expect(restoredValue(3, 0)).toBe(3);
    expect(restoredValue('mm', 'in')).toBe('mm');
    expect(restoredValue(undefined, 'in')).toBe('in');
    expect(restoredValue('3', 0)).toBe(0);
    expect(restoredValue(1, false)).toBe(false);
    expect(restoredValue(true, 'in')).toBe('in');
  });
});

describe('OptOut — what is never remembered', () => {
  it('neither reads nor writes for a dialog that opted out', () => {
    // `OptOut( this )` (dialog_shim.cpp:931) as used by dialog_group_properties,
    // dialog_global_deletion, dialog_grid_settings and the rest: the walkers
    // return before touching anything. A null title is that.
    settings.setDialogControl('Choose Symbol', 'keepSymbol', true);
    const before = structuredClone(settings.common.dialog.controls);

    render(<CheckBox title={null} control="keepSymbol" defaultValue={false} />);
    expect(box('keepSymbol').checked).toBe(false); // did not read
    fireEvent.click(box('keepSymbol'));
    cleanup();

    expect(settings.common.dialog.controls).toEqual(before); // did not write
  });
});

describe('where the values live: common.json', () => {
  it('survives a reload, not just a reopen', () => {
    // The whole point is that KiCad's checkbox is still ticked in a later
    // session. `dialog.controls` is a COMMON_SETTINGS param written to
    // common.json (common_settings.cpp:478-505), so ours must reach the
    // `common` slice's storage and come back out of it.
    render(<CheckBox title={CHOOSE_SYMBOL} control="keepSymbol" defaultValue={false} />);
    fireEvent.click(box('keepSymbol'));
    cleanup();

    const raw = localStorage.getItem(sliceStorageKey('common'));
    expect(raw).not.toBeNull();
    const stored: unknown = JSON.parse(raw as string);
    expect(mergeCommon(stored).dialog.controls['Choose Symbol']).toEqual({ keepSymbol: true });
  });

  it('survives arriving from the account, not just from localStorage', () => {
    // The second route into the same value. A subtree repaired on only one of
    // them is the `colors.user` bug: written on every change here, dropped the
    // moment the slice comes back from the other side.
    settings.adoptSlice(
      'common',
      { ...structuredClone(COMMON_DEFAULTS), dialog: { controls: { Dlg: { flag: true } } } },
      1,
    );
    expect(settings.common.dialog.controls).toEqual({ Dlg: { flag: true } });
  });

  it('is not eaten by deepMerge on the way back in', () => {
    // The trap `normalizeHotkeys` and `colors.user` both document: deepMerge
    // keeps only keys the *defaults* have, and the default here is `{}`. Loaded
    // that way every dialog would be written and silently discarded.
    const stored = {
      ...structuredClone(COMMON_DEFAULTS),
      dialog: { controls: { 'Choose Symbol': { keepSymbol: true } } },
    };
    expect(mergeCommon(stored).dialog.controls).toEqual({ 'Choose Symbol': { keepSymbol: true } });
  });

  it('drops damage the way the PARAM_LAMBDA setter does', () => {
    // common_settings.cpp:488-503 checks `aVal.is_object()` and then
    // `dlgVal.is_object()` per dialog, and skips anything else.
    expect(normalizeDialogControls(undefined)).toEqual({});
    expect(normalizeDialogControls('nope')).toEqual({});
    expect(normalizeDialogControls([1, 2])).toEqual({});
    expect(normalizeDialogControls({ Dlg: 'nope' })).toEqual({});
    expect(normalizeDialogControls({ Dlg: { ok: true, bad: { x: 1 }, worse: [1] } })).toEqual({
      Dlg: { ok: true },
    });
  });

  it('does not re-store a value that is already stored', () => {
    // Upstream's assignment is free — an in-memory std::map, flushed to file
    // once at exit. Ours stamps the slice dirty and wakes the account sync, so
    // opening and closing a dialog unchanged must not push common.json.
    settings.setDialogControl('Choose Symbol', 'keepSymbol', true);
    const version = settings.version;
    settings.setDialogControl('Choose Symbol', 'keepSymbol', true);
    expect(settings.version).toBe(version);
    settings.setDialogControl('Choose Symbol', 'keepSymbol', false);
    expect(settings.version).toBe(version + 1);
  });
});

describe('the Choose Symbol dialog opts both checkboxes in', () => {
  /**
   * Its source with comments removed. The dialog cannot be mounted here, so
   * this is a text check — and a text check that matched a commented-out call
   * would pass against a dialog that persists nothing.
   */
  const SRC = readFileSync(
    resolve(process.cwd(), '../designer/src/editors/schematic/dialogs/dialog_symbol_chooser.tsx'),
    'utf8',
  )
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

  it('takes "Place repeated copies" from the shared hook, defaulting to false', () => {
    expect(SRC).toMatch(
      /const \[keepSymbol, setKeepSymbol\] = useDialogControl\(title, 'keepSymbol', false\)/,
    );
  });

  it('takes "Place all units" from the shared hook, defaulting to true', () => {
    expect(SRC).toMatch(
      /const \[placeAllUnits, setPlaceAllUnits\] = useDialogControl\(title, 'placeAllUnits', true\)/,
    );
  });

  it('hands the hook the displayed title, item count and all', () => {
    // Not the bare "Choose Symbol": the count is what getDialogKeyFromTitle is
    // for, and passing a pre-stripped string would leave that untested here and
    // wrong in the next dialog that copies this one.
    expect(SRC).toMatch(/const title = `\$\{originalTitle\} \(\$\{itemCount\} items loaded\)`/);
    expect(SRC).not.toMatch(/useState\(false\)|useState\(true\)/);
  });
});
