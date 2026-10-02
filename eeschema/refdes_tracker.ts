// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Reference-designator tracker. Counterpart: `eeschema/refdes_tracker.cpp`
 * (REFDES_TRACKER), remembers every designator ever assigned so that, with
 * "reuse designators" off, annotation never re-issues a freed number. The
 * state persists as `schematic.used_designators` in the project file via
 * Serialize/Deserialize (compact `R1-R4,R7,U1` ranges with `\`-escaping of
 * `\`, `,` and `-`; a prefix-only entry marks a bare prefix as used).
 *
 * The C++ thread-safety mutex and the next-free-number caches are omitted:
 * the caches are a lookup optimisation (annotate's first-free loop plays that
 * role here), not semantics.
 */

import { STD_UNORDERED_MAP } from '@ziroeda/common/libc/unordered_map.js';
import type { SCH_REFERENCE } from './sch_reference_list.js';

interface PrefixData {
  /** Used numbers; 0 marks a prefix-only entry, like upstream. */
  usedNumbers: Set<number>;
}

/** `UNITS_CHECKER_FUNC<SCH_REFERENCE>`: whether \a aRequiredUnits are free among the
 *  references already holding a number. */
export type UNITS_CHECKER_FUNC = (
  aTestRef: SCH_REFERENCE,
  aExistingRefs: readonly SCH_REFERENCE[],
  aRequiredUnits: readonly number[],
) => boolean;

export class REFDES_TRACKER {
  /** m_reuseRefDes: when true, previously-used-but-freed numbers may be
   *  reassigned (the constructor's default, and the PARAM's, reuse_designators). */
  private m_reuseRefDes = true;

  /** m_externalUnitsChecker: replaces areUnitsAvailable when set. */
  private m_externalUnitsChecker: UNITS_CHECKER_FUNC | null = null;

  /// m_prefixData: a std::unordered_map upstream, and Serialize writes it in that map's
  /// iteration order, so it is libstdc++'s order here too.
  private prefixData = new STD_UNORDERED_MAP<PrefixData>();
  private allRefDes = new Set<string>();

  /** REFDES_TRACKER::parseRefDes: split on the trailing run of digits so any
   *  non-digit prefix (including '#' for power/flag symbols) is preserved. */
  private parseRefDes(refDes: string): [string, number] {
    if (refDes === '') return ['', 0];
    let pos = refDes.length;
    while (pos > 0 && refDes[pos - 1]! >= '0' && refDes[pos - 1]! <= '9') pos--;
    if (pos === 0) return [refDes, 0];
    if (pos === refDes.length) return [refDes, 0];
    return [refDes.slice(0, pos), Number.parseInt(refDes.slice(pos), 10)];
  }

  /** REFDES_TRACKER::Insert, false when already present. */
  Insert(refDes: string): boolean {
    if (this.allRefDes.has(refDes)) return false;
    const [prefix, number] = this.parseRefDes(refDes);
    this.allRefDes.add(refDes);
    return this.insertNumber(prefix, number);
  }

  private insertNumber(prefix: string, number: number): boolean {
    const data = this.prefixData.getOrInsert(prefix, () => ({ usedNumbers: new Set() }));
    if (data.usedNumbers.has(number)) return false;
    data.usedNumbers.add(number);
    return true;
  }

  /** REFDES_TRACKER::Contains. */
  Contains(refDes: string): boolean {
    return this.allRefDes.has(refDes);
  }

  /** REFDES_TRACKER::Clear. */
  Clear(): void {
    this.prefixData.clear();
    this.allRefDes.clear();
  }

  /** REFDES_TRACKER::Size. */
  Size(): number {
    return this.allRefDes.size;
  }

  /** `GetReuseRefDes()`. */
  GetReuseRefDes(): boolean {
    return this.m_reuseRefDes;
  }

  /** `SetReuseRefDes()`. */
  SetReuseRefDes(aReuse: boolean): void {
    this.m_reuseRefDes = aReuse;
  }

  /** `SetUnitsChecker()`. */
  SetUnitsChecker(aChecker: UNITS_CHECKER_FUNC): void {
    this.m_externalUnitsChecker = aChecker;
  }

  /** `ClearUnitsChecker()`. */
  ClearUnitsChecker(): void {
    this.m_externalUnitsChecker = null;
  }

  /**
   * `REFDES_TRACKER::GetNextRefDesForUnits` (refdes_tracker.cpp:90): the first number from
   * \a aMinValue that is either unused (and, without reuse, never used) - recorded as used -
   * or in use by references that leave all of \a aRequiredUnits free.
   *
   * (`GetNextRefDes( prefix, min )` is declared in 10.0.6's header but has no body.)
   */
  GetNextRefDesForUnits(
    aRef: SCH_REFERENCE,
    aRefNumberMap: ReadonlyMap<number, readonly SCH_REFERENCE[]>,
    aRequiredUnits: readonly number[],
    aMinValue: number,
  ): number {
    // Filter out negative unit numbers
    const validUnits = aRequiredUnits.filter((unit) => unit >= 0);

    let candidate = aMinValue;

    while (true) {
      // Check if this candidate number is currently in use
      const inUse = aRefNumberMap.get(candidate);

      if (inUse === undefined) {
        // Not currently in use - check if it was previously used
        const candidateRefDes = `${aRef.GetRef()}${candidate}`;

        if (this.m_reuseRefDes || !this.allRefDes.has(candidateRefDes)) {
          // Completely unused - this is our answer
          this.insertNumber(aRef.GetRefStr(), candidate);
          this.allRefDes.add(candidateRefDes);
          return candidate;
        }

        // Previously used but no longer active - skip to next candidate
        candidate++;
        continue;
      }

      // Currently in use - check if required units are available
      if (validUnits.length === 0) {
        // Need completely unused reference, but this one is in use
        candidate++;
        continue;
      }

      const unitsAvailable = this.m_externalUnitsChecker
        ? this.m_externalUnitsChecker(aRef, inUse, validUnits)
        : this.areUnitsAvailable(aRef, inUse, validUnits);

      // All required units are available - this is our answer
      // Note: Don't insert into tracker since reference is already in use
      if (unitsAvailable) return candidate;

      // Some required units are not available - try next candidate
      candidate++;
    }
  }

  /** `REFDES_TRACKER::areUnitsAvailable` (refdes_tracker.cpp:172). */
  private areUnitsAvailable(
    aRef: SCH_REFERENCE,
    aRefVector: readonly SCH_REFERENCE[],
    aRequiredUnits: readonly number[],
  ): boolean {
    for (const unit of aRequiredUnits) {
      for (const ref of aRefVector) {
        // If we have a different library or different value,
        // we cannot share a reference designator.  Also, if the unit matches,
        // the reference designator + unit is already in use.
        if (
          ref.CompareLibName(aRef) !== 0 ||
          ref.CompareValue(aRef) !== 0 ||
          ref.GetUnit() === unit
        )
          return false; // Conflict found
      }
    }

    return true; // All required units are available
  }

  /** escapeForSerialization: backslash-escape `\`, `,` and `-`. */
  private static escape(s: string): string {
    let out = '';
    for (const c of s) {
      if (c === '\\' || c === ',' || c === '-') out += '\\';
      out += c;
    }
    return out;
  }

  /** unescapeFromSerialization. */
  private static unescape(s: string): string {
    let out = '';
    let escaped = false;
    for (const c of s) {
      if (escaped) {
        out += c;
        escaped = false;
      } else if (c === '\\') {
        escaped = true;
      } else {
        out += c;
      }
    }
    return out;
  }

  /** splitString: delimiter-split that honours `\`-escapes (the escape stays
   *  in the part, for unescape to consume). */
  private static split(s: string, delimiter: string): string[] {
    const result: string[] = [];
    let current = '';
    let escaped = false;
    for (const c of s) {
      if (escaped) {
        current += c;
        escaped = false;
      } else if (c === '\\') {
        escaped = true;
        current += c;
      } else if (c === delimiter) {
        result.push(current);
        current = '';
      } else {
        current += c;
      }
    }
    if (current !== '') result.push(current);
    return result;
  }

  /** REFDES_TRACKER::Serialize: the prefixes in m_prefixData's (unordered) order, each with
   *  its consecutive numbers collapsed to `start-end` ranges, prefix-only
   *  entries last per prefix. */
  Serialize(): string {
    const parts: string[] = [];
    for (const [prefix, data] of this.prefixData) {
      const escapedPrefix = REFDES_TRACKER.escape(prefix);
      const numbers = [...data.usedNumbers].filter((n) => n > 0).sort((a, b) => a - b);
      const hasPrefix = data.usedNumbers.has(0);
      if (numbers.length === 0 && !hasPrefix) continue;

      const ranges: [number, number][] = [];
      if (numbers.length > 0) {
        let start = numbers[0]!;
        let end = numbers[0]!;
        for (let i = 1; i < numbers.length; i++) {
          if (numbers[i] === end + 1) {
            end = numbers[i]!;
          } else {
            ranges.push([start, end]);
            start = end = numbers[i]!;
          }
        }
        ranges.push([start, end]);
      }
      for (const [start, end] of ranges) {
        parts.push(start === end ? `${escapedPrefix}${start}` : `${escapedPrefix}${start}-${end}`);
      }
      if (hasPrefix) parts.push(escapedPrefix);
    }
    return parts.join(',');
  }

  /** REFDES_TRACKER::Deserialize, malformed input clears and returns false,
   *  never throws. The prefix regexes anchor on the final non-digit before
   *  the trailing digit run, so prefixes may embed digits (e.g. "U1U2"). */
  Deserialize(data: string): boolean {
    this.Clear();
    if (data === '') return true;

    const rangePattern = /^(.*\D)(\d+)-(\d+)$/;
    const numberedPattern = /^(.*\D)(\d+)$/;
    const parsePositiveInt = (s: string): number | null => {
      const v = Number.parseInt(s, 10);
      return Number.isFinite(v) && String(v) === s && v > 0 ? v : null;
    };

    for (const part of REFDES_TRACKER.split(data, ',')) {
      const unescaped = REFDES_TRACKER.unescape(part);
      let m = rangePattern.exec(unescaped);
      if (m) {
        const start = parsePositiveInt(m[2]!);
        const end = parsePositiveInt(m[3]!);
        if (start === null || end === null) {
          this.Clear();
          return false;
        }
        for (let i = start; i <= end; i++) this.Insert(`${m[1]}${i}`);
        continue;
      }
      m = numberedPattern.exec(unescaped);
      if (m) {
        const number = parsePositiveInt(m[2]!);
        if (number === null) {
          this.Clear();
          return false;
        }
        this.Insert(`${m[1]}${number}`);
        continue;
      }
      if (unescaped.length > 0) {
        this.Insert(unescaped);
        continue;
      }
      this.Clear();
      return false;
    }
    return true;
  }
}
