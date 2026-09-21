// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * User hotkey bindings: rebinding a key, and clearing one.
 *
 * Counterpart: `HOTKEY_STORE` / `PANEL_HOTKEYS_EDITOR` (common/widgets), which
 * hold a per-action override on top of each `TOOL_ACTION`'s `DefaultHotkey` and
 * write them to `user.hotkeys`. Upstream lets a binding be set to *nothing*,
 * which is what "clear" means: the action keeps existing and loses its key.
 *
 * **How this reaches a 470-line `else if` chain without rewriting it.**
 *
 * The editor's key handler matches raw events — `(e.ctrlKey || e.metaKey) &&
 * e.key === 's'` — sixty-odd times, each branch carrying its own extra
 * conditions (is the user typing, is anything selected, is a dialog open).
 * Rewriting every condition to ask "which action is this?" is the obvious
 * approach and the wrong one: it touches the busiest path in the editor, and a
 * mistake in any branch breaks a key silently.
 *
 * So the chain is left alone and the *event* is translated first. If the user
 * has bound Save to `Ctrl+Q`, pressing `Ctrl+Q` produces an event that the chain
 * sees as `Ctrl+S` — the default combo for the action the user actually asked
 * for. The chain never learns that bindings are configurable.
 *
 * Three outcomes from {@link remapEvent}:
 *  - `null` — the key is cleared, or it is the default combo of an action the
 *    user moved elsewhere. The caller drops the event.
 *  - the same event — nothing about this key is customised.
 *  - a stand-in carrying the *default* combo of the bound action.
 */

import { APP_REGISTRIES, qualify, type AppKey, type RegistryAction } from '../../ui/hotkey_apps.js';
import { HOTKEY_APP } from './hotkeys.js';
import {
  type KeyLike,
  comboFromEvent,
  eventFromCombo,
  RESERVED_HOTKEYS,
  isReservedHotkey,
} from '@ziroeda/common/src/hotkeys_basic_keys.js';

export { type KeyLike, comboFromEvent, eventFromCombo, RESERVED_HOTKEYS, isReservedHotkey };

/**
 * A per-action override, keyed on `TOOL_ACTION::GetName()` - `eeschema.save`,
 * not `save`. `null` clears the action's key; a string rebinds it. An action
 * with no entry keeps its default.
 */
export type HotkeyOverrides = Readonly<Record<string, string | null>>;

const registryOf = (app: AppKey): readonly RegistryAction[] => APP_REGISTRIES[app] ?? [];

/**
 * The combo each action answers to, after overrides. `null` means cleared.
 *
 * Keyed on the action's name, as HOTKEY_STORE's map is, so the same key opens
 * this and the settings file and the Hotkey List's rows.
 */
export function effectiveBindings(
  overrides: HotkeyOverrides = {},
  app: AppKey = HOTKEY_APP,
): Map<string, string | null> {
  const out = new Map<string, string | null>();
  for (const h of registryOf(app)) {
    const name = qualify(app, h.id);
    out.set(name, Object.hasOwn(overrides, name) ? overrides[name]! : h.keys);
  }
  return out;
}

/** Actions whose default combo is this one, by name. */
const defaultsFor = (combo: string, app: AppKey): string[] =>
  registryOf(app)
    .filter((h) => h.keys.toLowerCase() === combo.toLowerCase())
    .map((h) => qualify(app, h.id));

/**
 * Translate an event into what the editor's key chain should see.
 *
 * Returns `null` when the event must be dropped, the original when nothing is
 * customised, and a stand-in carrying the bound action's *default* combo
 * otherwise.
 */
export function remapEvent<T extends KeyLike>(
  e: T,
  overrides: HotkeyOverrides = {},
  app: AppKey = HOTKEY_APP,
): KeyLike | null {
  // Nothing customised: the overwhelmingly common case, and it must cost
  // nothing — this runs on every keystroke.
  if (Object.keys(overrides).length === 0) return e;

  const combo = comboFromEvent(e);
  const bindings = effectiveBindings(overrides, app);

  // Is some action bound *to* this combo? A user rebinding wins over whatever
  // holds the combo by default.
  for (const [name, keys] of bindings) {
    if (keys === null || !Object.hasOwn(overrides, name)) continue;
    if (keys.toLowerCase() !== combo.toLowerCase()) continue;
    const def = registryOf(app).find((h) => qualify(app, h.id) === name)?.keys;
    if (!def) continue;
    // Already the default combo: no translation needed.
    return def.toLowerCase() === combo.toLowerCase() ? e : eventFromCombo(def, e);
  }

  // No action claims it. If it is the default combo of an action that has been
  // cleared or moved away, the key must now do nothing — otherwise the chain
  // would still match it and "clear" would have changed nothing.
  const owners = defaultsFor(combo, app);
  if (
    owners.length > 0 &&
    owners.every((name) => bindings.get(name)?.toLowerCase() !== combo.toLowerCase())
  )
    return null;

  return e;
}
