// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The part of `<wx/utils.h>` KiCad reads: `wxGetEnv`, the process
 * environment.
 *
 * A browser has no environment, so the default answers nothing; a host that
 * does have one (a node harness, a test) installs its own lookup.
 */

export type EnvVarLookup = (aName: string) => string | undefined;

let s_envVarLookup: EnvVarLookup = () => undefined;

/** Install the environment `wxGetEnv` reads. */
export function SetEnvVarLookup(aLookup: EnvVarLookup): void {
  s_envVarLookup = aLookup;
}

/** `wxGetEnv( aName, &value )`: the value, or undefined when it is not set. */
export function wxGetEnv(aName: string): string | undefined {
  return s_envVarLookup(aName);
}
