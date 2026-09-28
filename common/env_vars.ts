// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `ENV_VAR` (include/env_vars.h, common/env_vars.cpp): the environment
 * variables KiCad predefines, their versioned names (`KICAD10_SYMBOL_DIR`),
 * and the help text the Configure Paths dialog shows for each.
 */
import { GetMajorMinorPatchTuple } from './build_version.js';
import type { ENV_VAR_MAP } from './settings/environment.js';
import { wxGetEnv } from './wx/utils.js';

export namespace ENV_VAR {
  /**
   * `IsEnvVarImmutable`: whether `aEnvVar` is one of KiCad's predefined
   * variables, which the user cannot redefine.
   */
  export function IsEnvVarImmutable(aEnvVar: string): boolean {
    for (const s of predefinedEnvVars) {
      if (s === aEnvVar) return true;
    }

    return false;
  }

  /** `GetPredefinedEnvVars`. */
  export function GetPredefinedEnvVars(): readonly string[] {
    return predefinedEnvVars;
  }

  /** `GetEnvVarAutocompleteTokens`: add each predefined variable `aVars` lacks. */
  export function GetEnvVarAutocompleteTokens(aVars: string[]): void {
    for (const v of GetPredefinedEnvVars()) {
      if (!aVars.includes(v)) aVars.push(v);
    }
  }

  /** `GetVersionedEnvVarName`: `KICAD<major>_<base>`. */
  export function GetVersionedEnvVarName(aBaseName: string): string {
    const [version] = GetMajorMinorPatchTuple();

    return `KICAD${version}_${aBaseName}`;
  }

  /** `IsVersionedEnvVar`: `KICAD<digits>_<base>`, any version. */
  export function IsVersionedEnvVar(aName: string, aBaseName: string): boolean {
    const prefix = 'KICAD';
    const suffix = `_${aBaseName}`;

    if (!aName.startsWith(prefix) || !aName.endsWith(suffix)) return false;

    const version = aName.substring(prefix.length, aName.length - suffix.length);

    return version !== '' && /^[0-9]+$/.test(version);
  }

  /**
   * `GetVersionedEnvVarValue`: this version's variable if the map has it,
   * otherwise the first of any version, in the map's (key) order.
   */
  export function GetVersionedEnvVarValue(
    aMap: ENV_VAR_MAP,
    aBaseName: string,
  ): string | undefined {
    const exactMatch = GetVersionedEnvVarName(aBaseName);

    const exact = aMap.get(exactMatch);
    if (exact) return exact.GetValue();

    for (const [k, v] of aMap) {
      if (IsVersionedEnvVar(k, aBaseName)) return v.GetValue();
    }

    return undefined;
  }

  /** `LookUpEnvVarHelp`: the help text, or "" for a variable KiCad does not know. */
  export function LookUpEnvVarHelp(aEnvVar: string): string {
    if (envVarHelpText.size === 0) initialiseEnvVarHelp(envVarHelpText);

    return envVarHelpText.get(aEnvVar) ?? '';
  }

  /** `GetEnvVar<wxString>`. */
  export function GetEnvVar(aEnvVarName: string): string | undefined {
    return wxGetEnv(aEnvVarName);
  }

  /** `GetEnvVar<double>`: undefined when unset or not a number (`ToDouble`). */
  export function GetEnvVarDouble(aEnvVarName: string): number | undefined {
    const env = wxGetEnv(aEnvVarName);
    if (env === undefined) return undefined;
    const value = Number(env.trim());
    return env.trim() !== '' && Number.isFinite(value) ? value : undefined;
  }
}

/**
 * List of pre-defined environment variables.
 *
 * @todo Instead of defining these values here, extract them from elsewhere in the program
 * (where they are originally defined).
 */
const predefinedEnvVars: readonly string[] = [
  'KIPRJMOD',
  ENV_VAR.GetVersionedEnvVarName('SYMBOL_DIR'),
  ENV_VAR.GetVersionedEnvVarName('3DMODEL_DIR'),
  ENV_VAR.GetVersionedEnvVarName('FOOTPRINT_DIR'),
  ENV_VAR.GetVersionedEnvVarName('TEMPLATE_DIR'),
  'KICAD_USER_TEMPLATE_DIR',
  'KICAD_PTEMPLATES',
  ENV_VAR.GetVersionedEnvVarName('3RD_PARTY'),
];

const envVarHelpText = new Map<string, string>();

function initialiseEnvVarHelp(aMap: Map<string, string>): void {
  const v = ENV_VAR.GetVersionedEnvVarName;

  aMap.set(
    v('FOOTPRINT_DIR'),
    'The base path of locally installed system footprint libraries (.pretty folders).',
  );
  aMap.set(v('3DMODEL_DIR'), 'The base path of system footprint 3D shapes (.3Dshapes folders).');
  aMap.set(v('SYMBOL_DIR'), 'The base path of the locally installed symbol libraries.');
  aMap.set(v('TEMPLATE_DIR'), 'A directory containing project templates installed with KiCad.');
  aMap.set(
    'KICAD_USER_TEMPLATE_DIR',
    'Optional. Can be defined if you want to create your own project templates folder.',
  );
  aMap.set(
    v('3RD_PARTY'),
    'A directory containing 3rd party plugins, libraries and other downloadable content.',
  );
  aMap.set(
    'KIPRJMOD',
    'Internally defined by KiCad (cannot be edited) and is set to the absolute path of the currently ' +
      'loaded project file.  This environment variable can be used to define files and paths relative ' +
      'to the currently loaded project.  For instance, ${KIPRJMOD}/libs/footprints.pretty can be ' +
      'defined as a folder containing a project specific footprint library named footprints.pretty.',
  );
  aMap.set(v('SCRIPTING_DIR'), 'A directory containing system-wide scripts installed with KiCad.');
  aMap.set(
    v('USER_SCRIPTING_DIR'),
    'A directory containing user-specific scripts installed with KiCad.',
  );

  // Deprecated vars
  const DEP = (aVar: string): string => `Deprecated version of ${aVar}.`;

  aMap.set('KICAD_PTEMPLATES', DEP(v('TEMPLATE_DIR')));
  aMap.set('KISYS3DMOD', DEP(v('3DMODEL_DIR')));
  aMap.set('KISYSMOD', DEP(v('FOOTPRINT_DIR')));
  aMap.set('KICAD_SYMBOL_DIR', DEP(v('SYMBOL_DIR')));
}
