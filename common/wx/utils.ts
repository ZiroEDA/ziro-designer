// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The part of `<wx/utils.h>` KiCad reads: `wxGetEnv` / `wxSetEnv` /
 * `wxUnsetEnv`, the process environment.
 *
 * A page has no process environment of its own, so it starts empty: what
 * `wxSetEnv` puts there (PGM_BASE sets KiCad's variables at startup), over
 * whatever a host that does have one (a node harness, a test) installs as its
 * lookup.
 */

export type EnvVarLookup = (aName: string) => string | undefined;

let s_envVarLookup: EnvVarLookup = () => undefined;

/** Install the environment `wxGetEnv` reads. */
export function SetEnvVarLookup(aLookup: EnvVarLookup): void {
  s_envVarLookup = aLookup;
}

/** Variables set in this process with `wxSetEnv`. */
const s_env = new Map<string, string>();

/** `wxGetEnv( aName, &value )`: the value, or undefined when it is not set. */
export function wxGetEnv(aName: string): string | undefined {
  return s_env.get(aName) ?? s_envVarLookup(aName);
}

/** `wxSetEnv( aName, aValue )`. */
export function wxSetEnv(aName: string, aValue: string): boolean {
  s_env.set(aName, aValue);
  return true;
}

/** `wxUnsetEnv( aName )`. */
export function wxUnsetEnv(aName: string): boolean {
  return s_env.delete(aName);
}
