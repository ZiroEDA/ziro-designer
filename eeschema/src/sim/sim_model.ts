// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Simulation model resolution for ERC. Counterpart: `eeschema/sim/sim_model.cpp`
 * (`SIM_MODEL::ReadTypeFromFields`, `SIM_MODEL::InferSimModel`) and
 * `eeschema/sim/sim_lib_mgr.cpp` (`SIM_LIB_MGR::CreateModel`).
 *
 * `TestSimModelIssues` builds a model for every simulated symbol and turns
 * whatever the reporter collected into the ERC message, so this module's job is
 * to reproduce those diagnostics exactly:
 *
 *  - "Simulation model library not found at '%s'"
 *  - "Error loading simulation model: no 'Sim.Name' field"
 *  - "Error loading simulation model: could not find base model '%s' in library '%s'"
 *  - "No simulation model definition found for symbol '%s'."
 *
 * Inference comes first (RLC and V/I symbols carrying only a Value need no
 * `Sim.*` fields at all), exactly as CreateModel calls InferSimModel before
 * reading the type.
 */

import type { LibSymbol, SchSymbol } from '../types.js';
import { strNumCmp } from '@ziroeda/common/src/string_utils.js';
import {
  SIM_DEVICE_FIELD,
  SIM_DEVICE_FIELD_VALUES,
  SIM_LIBRARY_FIELD,
  SIM_NAME_FIELD,
  SIM_PARAMS_FIELD,
  SIM_PINS_FIELD,
  SIM_TYPE_FIELD,
  SIM_TYPES,
} from './sim_model_types.js';

/** One diagnostic, as the reporter would have collected it. */
export interface SimModelIssue {
  message: string;
}

const fieldValue = (sym: SchSymbol, key: string): string =>
  sym.fields.find((f) => f.key === key)?.value ?? '';

/**
 * SIM_MODEL::InferSimModel, reduced to the question ERC asks: do these fields
 * describe a model that needs no `Sim.Device`/`Sim.Type` because it can be
 * inferred from the reference prefix and the Value?
 *
 * The two branches upstream recognises, verbatim: a two-pin R/L/C, and a
 * two-pin V/I source (`Sim.Type` empty or "DC").
 */
export function inferSimModelType(
  sym: SchSymbol,
  lib: LibSymbol | undefined,
): { deviceType: string; modelType: string } | null {
  const pinCount = (lib?.units ?? []).reduce((n, u) => n + u.pins.length, 0);
  if (pinCount !== 2) return null;

  const reference = fieldValue(sym, 'Reference');
  const prefix = reference.replace(/[0-9?]+$/, '');
  const library = fieldValue(sym, SIM_LIBRARY_FIELD);
  const modelName = fieldValue(sym, SIM_NAME_FIELD);
  const value = fieldValue(sym, 'Value');
  const deviceType = fieldValue(sym, SIM_DEVICE_FIELD);
  const modelType = fieldValue(sym, SIM_TYPE_FIELD);

  const isRLC =
    ((deviceType === 'R' || deviceType === 'L' || deviceType === 'C') && modelType === '') ||
    (library === '' &&
      modelName === '' &&
      deviceType === '' &&
      modelType === '' &&
      value !== '' &&
      (prefix.startsWith('R') || prefix.startsWith('L') || prefix.startsWith('C')));

  if (isRLC) {
    return {
      deviceType: deviceType === '' ? prefix.slice(0, 1) : deviceType,
      // An ideal value keeps the empty type; anything else is behavioural ("=").
      modelType: modelType === '' && !IDEAL_VALUE.test(value) ? '=' : modelType,
    };
  }

  const isSource =
    ((deviceType === 'V' || deviceType === 'I') && (modelType === '' || modelType === 'DC')) ||
    (deviceType === '' &&
      modelType === '' &&
      value !== '' &&
      (prefix.startsWith('V') || prefix.startsWith('I')));

  if (isSource) {
    return {
      deviceType: deviceType === '' ? prefix.slice(0, 1) : deviceType,
      modelType: modelType === '' ? 'DC' : modelType,
    };
  }

  return null;
}

/** InferSimModel's "ideal value" pattern (a number with optional SI unit). */
const IDEAL_VALUE =
  /^([0-9,. ]+)([fFpPnNuUmMkKgGtTμµ𝛍𝜇𝝁 ]|M(e|E)(g|G))?([fFhHΩΩ𝛀𝛺𝝮rR]|ohm)?([-1-9 ]*)([fFhHΩΩ𝛀𝛺𝝮rR]|ohm)?$/u;

/**
 * SIM_MODEL::ReadTypeFromFields, the (device, type) pair must name a TYPE.
 * An empty `Sim.Type` is TYPE::NONE (no complaint); anything else that does not
 * resolve is the error TestSimModelIssues reports.
 */
export function readTypeFromFields(deviceType: string, modelType: string): { found: boolean } {
  if (deviceType !== '') {
    for (const [device, typeValue] of SIM_TYPES) {
      if (modelType === typeValue && deviceType === SIM_DEVICE_FIELD_VALUES[device]) {
        return { found: true };
      }
    }
  }
  // TYPE::NONE, nothing named, nothing to complain about.
  if (modelType === '') return { found: true };
  return { found: false };
}

/**
 * SIM_LIB_MGR::CreateModel for one symbol: the diagnostics a model build
 * produces, in upstream's order. `libraryText` resolves a `Sim.Library` path to
 * the library's contents; returning undefined is upstream's "not found".
 */
export function checkSimModel(
  sym: SchSymbol,
  lib: LibSymbol | undefined,
  libraryText: (path: string) => string | undefined,
): SimModelIssue[] {
  const issues: SimModelIssue[] = [];
  const reference = fieldValue(sym, 'Reference');

  // Inference runs first and fills in the device/type when it succeeds.
  const inferred = inferSimModelType(sym, lib);
  const deviceType = inferred?.deviceType ?? fieldValue(sym, SIM_DEVICE_FIELD);
  const modelType = inferred?.modelType ?? fieldValue(sym, SIM_TYPE_FIELD);

  const libraryPath = fieldValue(sym, SIM_LIBRARY_FIELD);
  const baseModelName = fieldValue(sym, SIM_NAME_FIELD);

  if (libraryPath !== '') {
    const text = libraryText(libraryPath);

    if (text === undefined) {
      issues.push({ message: `Simulation model library not found at '${libraryPath}'` });
    }

    if (baseModelName === '') {
      issues.push({ message: `Error loading simulation model: no '${SIM_NAME_FIELD}' field` });
    } else if (text !== undefined && !findSpiceModel(text, baseModelName)) {
      issues.push({
        message:
          `Error loading simulation model: could not find base model '${baseModelName}' ` +
          `in library '${libraryPath}'`,
      });
    }
    return issues;
  }

  if (!readTypeFromFields(deviceType, modelType).found) {
    issues.push({
      message:
        reference !== ''
          ? `No simulation model definition found for symbol '${reference}'.`
          : 'No simulation model definition found.',
    });
  }

  return issues;
}

/**
 * SIM_LIBRARY_SPICE::ReadFile, the model names a SPICE library defines.
 * `.model <name> …` and `.subckt <name> …`, case-insensitively, with `+`
 * continuation lines ignored (they never start a definition).
 */
export function spiceLibraryModelNames(text: string): string[] {
  const names: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const m = /^\.(model|subckt)\s+(\S+)/i.exec(line);
    if (m) names.push(m[2]!);
  }
  return names;
}

/** SIM_LIBRARY::FindModel, SPICE names are case-insensitive. */
export function findSpiceModel(libraryText: string, name: string): boolean {
  const wanted = name.toLowerCase();
  return spiceLibraryModelNames(libraryText).some((n) => n.toLowerCase() === wanted);
}

/** Pins sorted by number, as CreateModel sorts them (StrNumCmp, case-insensitive). */
export function sortPinNumbers(numbers: readonly string[]): string[] {
  return [...numbers].sort((a, b) => strNumCmp(a, b, true));
}
