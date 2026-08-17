// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The two key spaces this dialog sits between, and why there are two.
 *
 * Upstream has one: `TOOL_ACTION::GetName()` is app-qualified, the store is
 * keyed on it, and `ACTION_MANAGER` dispatches on it. Here the schematic's key
 * handler predates the store and resolves `overrides[h.id]` against the bare
 * ids in `editors/schematic/hotkeys.ts` - `save`, not `eeschema.save` - and
 * that is what the Hotkeys preference page writes.
 *
 * So the rows are named the upstream way and the settings map is keyed the way
 * the dispatcher reads it, and this converts between them. Without it, a key
 * changed here would be stored under a name nothing consults: the dialog would
 * look like it worked and change nothing, which is worse than a disabled
 * button.
 *
 * The conversion is only needed for the schematic, because it is the only
 * editor with a key dispatcher; the other sections' rows are still listed and
 * still take an import, but nothing dispatches them yet. Retiring this pair of
 * functions means qualifying the dispatcher's ids, which is a change to the
 * editor's key handling rather than to this window.
 */
import type { HotkeyOverrides } from './hotkeys_inventory.js';

const DISPATCHED_APP = 'eeschema.';

/** Settings key -> row name, so a key set in Preferences shows here. */
export const toRowNames = (stored: Readonly<Record<string, string | null>>): HotkeyOverrides => {
  const out: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(stored)) {
    out[k.includes('.') ? k : `${DISPATCHED_APP}${k}`] = v;
  }
  return out;
};

/** Row name -> settings key, so a key set here reaches the dispatcher. */
export const toStoredKeys = (rows: HotkeyOverrides): Record<string, string | null> => {
  const out: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(rows)) {
    out[k.startsWith(DISPATCHED_APP) ? k.slice(DISPATCHED_APP.length) : k] = v;
  }
  return out;
};
