// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/connectivity/topo_match.h` / `.cpp`: TMATCH, topology matching of two
 * sets of footprints by the connectivity between their pads (the core of
 * Repeat Layout / multichannel). Built as a graph of COMPONENT -> PIN, then a
 * backtracking search with the minimum-remaining-values heuristic finds an
 * isomorphism between two graphs.
 *
 * Differences from the C++, none of which change a result: the thread pool
 * that evaluates the structural precomputation and the MRV scan in parallel is
 * a plain loop (the tasks are read-only and independent, so order does not
 * matter); `std::atomic` cancel/progress slots are `{ value }` objects; `_()`
 * strings are the English source; wxLogTrace is not ported.
 */
import { type KIID, niluuid } from '@ziroeda/common/kiid.js';
import { GetRefDesPrefix } from '@ziroeda/common/refdes_utils.js';
import type { FOOTPRINT } from '../footprint.js';

export interface ISOMORPHISM_PARAMS {
  m_cancelled?: { value: boolean } | null;
  m_matchedComponents?: { value: number } | null;
  m_totalComponents?: { value: number } | null;
}

export class TOPOLOGY_MISMATCH_REASON {
  m_reference = '';
  m_candidate = '';
  m_reason = '';
}

/** `std::sort` comparator over wxString `<`: code-unit order. */
const strLess = (a: string, b: string): boolean => a < b;

export class COMPONENT {
  m_raOffset: { x: number; y: number } | null;
  m_reference: string;
  m_prefix: string;
  m_parentFootprint: FOOTPRINT | null;
  m_pins: PIN[] = [];

  constructor(
    aRef: string,
    aParentFp: FOOTPRINT | null,
    aRaOffset: { x: number; y: number } | null = null,
  ) {
    this.m_raOffset = aRaOffset;
    this.m_reference = aRef;
    this.m_parentFootprint = aParentFp;
    this.m_prefix = GetRefDesPrefix(aRef);
  }

  /**
   * Channel identifiers contain no letters, only digits and separator symbols
   * (dots, underscores, hyphens, etc.).
   */
  private static isChannelSuffix(aSuffix: string): boolean {
    if (aSuffix === '') return true;

    for (const ch of aSuffix) {
      if (/[A-Za-z]/.test(ch)) return false;
    }

    return true;
  }

  /**
   * Two prefixes share a common starting sequence, and what remains after it
   * is a valid channel suffix (no letters), e.g. TRIM_1.1 and TRIM_2.1.
   */
  private static prefixesShareCommonBase(aPrefixA: string, aPrefixB: string): boolean {
    if (aPrefixA === aPrefixB) return true;

    let commonLen = 0;
    const minLen = Math.min(aPrefixA.length, aPrefixB.length);

    while (commonLen < minLen && aPrefixA[commonLen] === aPrefixB[commonLen]) commonLen++;

    if (commonLen === 0) return false;

    return (
      COMPONENT.isChannelSuffix(aPrefixA.slice(commonLen)) &&
      COMPONENT.isChannelSuffix(aPrefixB.slice(commonLen))
    );
  }

  /** True for un-annotated placeholder refs like REF** that match on FPID and topology alone. */
  private static isUnannotatedRef(aRef: string): boolean {
    const prefix = GetRefDesPrefix(aRef);

    return prefix !== '' && (prefix.endsWith('*') || prefix.endsWith('?'));
  }

  IsSameKind(b: COMPONENT): boolean {
    if (
      !COMPONENT.isUnannotatedRef(this.m_reference) &&
      !COMPONENT.isUnannotatedRef(b.m_reference) &&
      !COMPONENT.prefixesShareCommonBase(this.m_prefix, b.m_prefix)
    ) {
      return false;
    }

    const a = this.m_parentFootprint!.GetFPID();
    const o = b.m_parentFootprint!.GetFPID();

    return a.equals(o) || (a.empty() && o.empty());
  }

  AddPin(aPin: PIN): void {
    this.m_pins.push(aPin);
    aPin.SetParent(this);
  }

  GetPinCount(): number {
    return this.m_pins.length;
  }

  Pins(): PIN[] {
    return this.m_pins;
  }

  GetParent(): FOOTPRINT {
    return this.m_parentFootprint!;
  }

  HasRAOffset(): boolean {
    return this.m_raOffset !== null;
  }

  GetRAOffset(): { x: number; y: number } {
    return this.m_raOffset!;
  }

  sortPinsByName(): void {
    this.m_pins.sort((a, b) =>
      strLess(a.GetReference(), b.GetReference())
        ? -1
        : strLess(b.GetReference(), a.GetReference())
          ? 1
          : 0,
    );
  }

  MatchesWith(b: COMPONENT, aReason: TOPOLOGY_MISMATCH_REASON): boolean {
    if (this.GetPinCount() !== b.GetPinCount()) {
      aReason.m_reference = this.GetParent().GetReferenceAsString();
      aReason.m_candidate = b.GetParent().GetReferenceAsString();
      aReason.m_reason = `Component ${aReason.m_reference} has ${this.GetPinCount()} pads but candidate ${aReason.m_candidate} has ${b.GetPinCount()}.`;
      return false;
    }

    if (!this.IsSameKind(b)) {
      aReason.m_reference = this.GetParent().GetReferenceAsString();
      aReason.m_candidate = b.GetParent().GetReferenceAsString();

      if (
        !COMPONENT.isUnannotatedRef(this.m_reference) &&
        !COMPONENT.isUnannotatedRef(b.m_reference) &&
        !COMPONENT.prefixesShareCommonBase(this.m_prefix, b.m_prefix)
      ) {
        aReason.m_reason = `Reference prefix mismatch: ${aReason.m_reference} uses prefix '${this.m_prefix}' but candidate ${aReason.m_candidate} uses '${b.m_prefix}'.`;
      } else {
        let refFootprint = this.GetParent().GetFPIDAsString();
        let candFootprint = b.GetParent().GetFPIDAsString();

        if (refFootprint === '') refFootprint = '(no library ID)';
        if (candFootprint === '') candFootprint = '(no library ID)';

        aReason.m_reason = `Library link mismatch: ${aReason.m_reference} expects '${refFootprint}' but candidate ${aReason.m_candidate} is '${candFootprint}'.`;
      }

      return false;
    }

    for (let pin = 0; pin < b.GetPinCount(); pin++) {
      // The reference pin is the subject so the reason's reference/candidate match
      // MatchesWith's own orientation (this == reference, b == candidate).
      if (!this.m_pins[pin]!.IsIsomorphic(b.m_pins[pin]!, aReason)) {
        if (aReason.m_reason === '') {
          aReason.m_reference = this.GetParent().GetReferenceAsString();
          aReason.m_candidate = b.GetParent().GetReferenceAsString();
          aReason.m_reason = `Component pads differ between ${aReason.m_reference} and ${aReason.m_candidate}.`;
        }

        return false;
      }
    }

    return true;
  }
}

export class PIN {
  m_ref = '';
  m_netcode = 0;
  m_parent: COMPONENT | null = null;
  m_conns: PIN[] = [];

  SetParent(parent: COMPONENT): void {
    this.m_parent = parent;
  }

  Format(): string {
    return `${this.m_parent!.m_reference}-${this.m_ref}`;
  }

  AddConnection(pin: PIN): void {
    this.m_conns.push(pin);
  }

  IsTopologicallySimilar(b: PIN): boolean {
    if (!this.m_parent!.IsSameKind(b.m_parent!)) return false;

    return this.m_ref === b.m_ref;
  }

  IsIsomorphic(b: PIN, aReason: TOPOLOGY_MISMATCH_REASON): boolean {
    if (this.m_conns.length !== b.m_conns.length) {
      aReason.m_reference = this.m_parent!.GetParent().GetReferenceAsString();
      aReason.m_candidate = b.m_parent!.GetParent().GetReferenceAsString();
      aReason.m_reason = `Pad ${this.m_ref} of ${aReason.m_reference} connects to ${this.m_conns.length} pads, but candidate pad ${b.m_ref} of ${aReason.m_candidate} connects to ${b.m_conns.length}.`;
      return false;
    }

    if (this.m_conns.length === 0) return true;

    const matches: boolean[] = this.m_conns.map(() => false);
    let nref = 0;

    for (const cref of this.m_conns) {
      for (let i = 0; i < this.m_conns.length; i++) {
        if (b.m_conns[i]!.IsTopologicallySimilar(cref)) {
          matches[nref] = true;
          break;
        }
      }

      nref++;
    }

    for (let i = 0; i < this.m_conns.length; i++) {
      if (!matches[i]) {
        aReason.m_reference = this.m_parent!.GetParent().GetReferenceAsString();
        aReason.m_candidate = b.m_parent!.GetParent().GetReferenceAsString();
        aReason.m_reason = `Pad ${this.m_ref} of ${aReason.m_reference} cannot match candidate pad ${b.m_ref} of ${aReason.m_candidate} due to differing connectivity.`;
        return false;
      }
    }

    return true;
  }

  GetNetCode(): number {
    return this.m_netcode;
  }

  GetReference(): string {
    return this.m_ref;
  }

  GetParent(): COMPONENT {
    return this.m_parent!;
  }
}

export class BACKTRACK_STAGE {
  m_ref: COMPONENT | null = null;
  m_currentMatch = -1;
  m_nloops = 0;
  m_matches: COMPONENT[] = [];
  m_locked = new Map<COMPONENT, COMPONENT>();
  m_refIndex = 0;

  /** The copy constructor. */
  static from(other: BACKTRACK_STAGE): BACKTRACK_STAGE {
    const s = new BACKTRACK_STAGE();
    s.m_currentMatch = other.m_currentMatch;
    s.m_ref = other.m_ref;
    s.m_matches = [...other.m_matches];
    s.m_locked = new Map(other.m_locked);
    s.m_nloops = other.m_nloops;
    s.m_refIndex = other.m_refIndex;
    return s;
  }

  GetMatchingComponentPairs(): ReadonlyMap<COMPONENT, COMPONENT> {
    return this.m_locked;
  }
}

export type COMPONENT_MATCHES = Map<FOOTPRINT, FOOTPRINT>;

export function buildBaseNetMapping(aMatches: BACKTRACK_STAGE): Map<number, number> {
  const mapping = new Map<number, number>();

  for (const [tgtCmp, refCmp] of aMatches.GetMatchingComponentPairs()) {
    const refPins = refCmp.Pins();
    const tgtPins = tgtCmp.Pins();

    for (let i = 0; i < refPins.length && i < tgtPins.length; i++)
      mapping.set(refPins[i]!.GetNetCode(), tgtPins[i]!.GetNetCode());
  }

  return mapping;
}

export function checkCandidateNetConsistency(
  aBaseMapping: ReadonlyMap<number, number>,
  aRef: COMPONENT,
  aTgt: COMPONENT,
  aReason: TOPOLOGY_MISMATCH_REASON,
  aExternalNets: ReadonlySet<number>,
): boolean {
  if (aRef.Pins().length !== aTgt.Pins().length) {
    aReason.m_reference = aRef.GetParent().GetReferenceAsString();
    aReason.m_candidate = aTgt.GetParent().GetReferenceAsString();
    aReason.m_reason = `Component ${aReason.m_reference} expects ${aRef.Pins().length} matching pads but candidate ${aReason.m_candidate} provides ${aTgt.Pins().length}.`;
    return false;
  }

  // Net mappings introduced by this candidate's pins that aren't yet in the base mapping.
  // Two pins sharing the same ref net must map to the same target net.
  const candidateAdditions = new Map<number, number>();

  for (let i = 0; i < aRef.Pins().length; i++) {
    const refNet = aRef.Pins()[i]!.GetNetCode();
    const tgtNet = aTgt.Pins()[i]!.GetNetCode();

    // Pads on external (global/power) nets may be tied to different global nets in different
    // channels (e.g. an address-select pin on +3V3 in one channel and GND in another).
    if (aExternalNets.has(refNet) || aExternalNets.has(tgtNet)) continue;

    const base = aBaseMapping.get(refNet);

    if (base !== undefined) {
      if (base !== tgtNet) {
        aReason.m_reference = aRef.GetParent().GetReferenceAsString();
        aReason.m_candidate = aTgt.GetParent().GetReferenceAsString();

        let refNetName = aRef.GetParent().GetBoard()?.FindNet(refNet)?.GetNetname() ?? '';
        let tgtNetName = aTgt.GetParent().GetBoard()?.FindNet(tgtNet)?.GetNetname() ?? '';

        if (refNetName === '') refNetName = `net ${refNet}`;
        if (tgtNetName === '') tgtNetName = `net ${tgtNet}`;

        aReason.m_reason = `Pad ${aRef.Pins()[i]!.GetReference()} of ${aReason.m_reference} is on net ${refNetName} but its match in candidate ${aReason.m_candidate} is on net ${tgtNetName}.`;
        return false;
      }

      continue;
    }

    const local = candidateAdditions.get(refNet);

    if (local !== undefined) {
      if (local !== tgtNet) {
        aReason.m_reference = aRef.GetParent().GetReferenceAsString();
        aReason.m_candidate = aTgt.GetParent().GetReferenceAsString();
        aReason.m_reason = `Pad ${aRef.Pins()[i]!.GetReference()} of ${aReason.m_reference} has inconsistent net mapping in candidate ${aReason.m_candidate}.`;
        return false;
      }

      continue;
    }

    candidateAdditions.set(refNet, tgtNet);
  }

  return true;
}

/** `std::rotate( begin, begin + idx, begin + idx + 1 )`: bring element idx to the front. */
function rotateToFront<T>(a: T[], idx: number): void {
  const [x] = a.splice(idx, 1);
  a.unshift(x!);
}

export class CONNECTION_GRAPH {
  readonly c_ITER_LIMIT = 10000;

  private m_components: COMPONENT[] = [];
  private m_externalNets = new Set<number>();

  Components(): COMPONENT[] {
    return this.m_components;
  }

  private findMatchingComponents(
    aRef: COMPONENT,
    aStructuralMatches: readonly COMPONENT[],
    aStructuralReason: TOPOLOGY_MISMATCH_REASON,
    partialMatches: BACKTRACK_STAGE,
    aMismatchReasons: TOPOLOGY_MISMATCH_REASON[],
    aCancelled: { value: boolean } | null = null,
  ): COMPONENT[] {
    if (aCancelled?.value) return [];

    aMismatchReasons.length = 0;
    const matches: COMPONENT[] = [];

    // The net consistency map from locked pairs, built once for this evaluation pass.
    const baseNetMapping = buildBaseNetMapping(partialMatches);

    for (const cmpTarget of aStructuralMatches) {
      if (partialMatches.m_locked.has(cmpTarget)) continue;

      const localReason = new TOPOLOGY_MISMATCH_REASON();
      localReason.m_reference = aRef.GetParent().GetReferenceAsString();
      localReason.m_candidate = cmpTarget.GetParent().GetReferenceAsString();

      if (
        checkCandidateNetConsistency(
          baseNetMapping,
          aRef,
          cmpTarget,
          localReason,
          this.m_externalNets,
        )
      ) {
        matches.push(cmpTarget);
      } else {
        aMismatchReasons.push(localReason);
      }
    }

    const simScores = new Map<COMPONENT, number>();

    for (const match of matches) {
      let n = 0;

      for (let i = 0; i < aRef.m_pins.length; i++) {
        if (aRef.m_pins[i]!.GetNetCode() === match.m_pins[i]!.GetNetCode()) n++;
      }

      simScores.set(match, n / aRef.m_pins.length);
    }

    matches.sort((a, b) => {
      const simA = simScores.get(a)!;
      const simB = simScores.get(b)!;

      if (simA !== simB) return simA > simB ? -1 : 1;

      const ra = a.GetParent().GetReferenceAsString();
      const rb = b.GetParent().GetReferenceAsString();

      return strLess(ra, rb) ? -1 : strLess(rb, ra) ? 1 : 0;
    });

    if (matches.length === 0 && aMismatchReasons.length === 0) {
      // No net-consistency reasons were recorded, so there were no structural candidates:
      // surface the structural reason captured during precomputation.
      if (aStructuralReason.m_reason !== '') {
        aMismatchReasons.push(aStructuralReason);
      } else {
        const reason = new TOPOLOGY_MISMATCH_REASON();
        reason.m_reference = aRef.GetParent().GetReferenceAsString();
        reason.m_reason = 'No compatible component found in the target area.';
        aMismatchReasons.push(reason);
      }
    }

    return matches;
  }

  /**
   * Many times components are electrically/topologically identical (a bank of
   * decoupling capacitors on the same rails), yet the user doesn't want them
   * picked randomly, so ties are broken by symbol UUID and then by value.
   */
  private breakTie(aRef: COMPONENT, aMatches: COMPONENT[]): void {
    if (aMatches.length <= 1) return;

    if (this.breakTieBySymbolUuid(aRef, aMatches)) return;

    this.breakTieByValue(aRef, aMatches);
    // TODO (upstream): other tie breakers, e.g. by position or reference designator.
  }

  /** Break a tie by footprint value when the symbol UUID can't (NC_0 vs NO_1). */
  private breakTieByValue(aRef: COMPONENT | null, aMatches: COMPONENT[]): boolean {
    const refFp = aRef ? aRef.GetParent() : null;

    if (!refFp) return false;

    const refValue = refFp.GetValue();

    if (refValue === '') return false;

    let valueHitCount = 0;
    let uniqueMatchIdx = -1;

    for (let i = 0; i < aMatches.length; i++) {
      if (aMatches[i]!.GetParent().GetValue() === refValue) {
        if (uniqueMatchIdx < 0) uniqueMatchIdx = i;

        valueHitCount++;
      }
    }

    // Several same-value candidates tell us nothing.
    if (valueHitCount === 1) {
      rotateToFront(aMatches, uniqueMatchIdx);
      return true;
    }

    return false;
  }

  /**
   * The most useful tie breaker: multiple channels in a design are very often
   * multiple instances of the same sheet, so the symbol instance UUID (the
   * tail of the footprint's path) identifies the counterpart.
   */
  private breakTieBySymbolUuid(aRef: COMPONENT | null, aMatches: COMPONENT[]): boolean {
    const getSymbolInstanceUuid = (aFootprint: FOOTPRINT | null): KIID => {
      if (!aFootprint) return niluuid;

      const path = aFootprint.GetPath();

      if (path.length === 0) return niluuid;

      return path[path.length - 1]!;
    };

    const refFp = aRef ? aRef.GetParent() : null;
    const refSymbolUuid = getSymbolInstanceUuid(refFp);
    let symbolUuidHitCount = 0;
    let uniqueMatchIdx = -1;

    if (refSymbolUuid === niluuid) return false;

    for (let i = 0; i < aMatches.length; i++) {
      const candidateSymbolUuid = getSymbolInstanceUuid(aMatches[i]!.GetParent());

      if (candidateSymbolUuid === refSymbolUuid) {
        if (uniqueMatchIdx < 0) uniqueMatchIdx = i;

        symbolUuidHitCount++;
      }
    }

    // One match is what we want: two instances of the same sheet. Several (copy and paste)
    // is not usable, and none means these probably aren't sheet instances.
    if (symbolUuidHitCount === 1) {
      rotateToFront(aMatches, uniqueMatchIdx);
      return true;
    }

    return false;
  }

  private sortByPinCount(): void {
    this.m_components.sort((a, b) => {
      if (a.GetPinCount() !== b.GetPinCount()) return a.GetPinCount() > b.GetPinCount() ? -1 : 1;

      const ra = a.GetParent().GetReferenceAsString();
      const rb = b.GetParent().GetReferenceAsString();

      return strLess(ra, rb) ? -1 : strLess(rb, ra) ? 1 : 0;
    });
  }

  BuildConnectivity(aExternalNets: ReadonlySet<number> = new Set()): void {
    this.m_externalNets = new Set(aExternalNets);

    const nets = new Map<number, PIN[]>();

    this.sortByPinCount();

    for (const c of this.m_components) {
      c.sortPinsByName();

      for (const p of c.Pins()) {
        if (p.GetNetCode() > 0) {
          let l = nets.get(p.GetNetCode());
          if (!l) nets.set(p.GetNetCode(), (l = []));
          l.push(p);
        }
      }
    }

    // std::map: netcode ascending. The order does not change any pin's connection set.
    for (const [netcode, pins] of [...nets].sort((a, b) => a[0] - b[0])) {
      // Skip nets that extend beyond this channel's footprint set: global rails are shared
      // across channels and create spurious intra-channel connections.
      if (aExternalNets.has(netcode)) continue;

      for (const p of pins) {
        for (const p2 of pins) {
          if (p !== p2) p.m_conns.push(p2);
        }
      }
    }
  }

  FindIsomorphism(
    aTarget: CONNECTION_GRAPH,
    aResult: COMPONENT_MATCHES,
    aMismatchReasons: TOPOLOGY_MISMATCH_REASON[],
    aParams: ISOMORPHISM_PARAMS = {},
  ): boolean {
    const stack: BACKTRACK_STAGE[] = [];
    const top = new BACKTRACK_STAGE();

    aMismatchReasons.length = 0;

    if (aParams.m_totalComponents) aParams.m_totalComponents.value = this.m_components.length;

    let localReasons: TOPOLOGY_MISMATCH_REASON[] = [];

    if (this.m_components.length === 0 || aTarget.m_components.length === 0) {
      const reason = new TOPOLOGY_MISMATCH_REASON();
      reason.m_reason = 'One or both of the areas has no components assigned.';
      aMismatchReasons.push(reason);
      return false;
    }

    if (this.m_components.length !== aTarget.m_components.length) {
      const reason = new TOPOLOGY_MISMATCH_REASON();
      reason.m_reason = 'Component count mismatch';
      aMismatchReasons.push(reason);
      return false;
    }

    // Structural compatibility (MatchesWith) depends only on immutable graph properties, so it
    // is computed once per source component.
    const numRef = this.m_components.length;
    const structuralMatches: COMPONENT[][] = Array.from({ length: numRef }, () => []);
    const structuralReasons: TOPOLOGY_MISMATCH_REASON[] = Array.from(
      { length: numRef },
      () => new TOPOLOGY_MISMATCH_REASON(),
    );

    const cancelled = aParams.m_cancelled ?? null;

    for (let i = 0; i < numRef; i++) {
      if (cancelled?.value) continue;

      const ref = this.m_components[i]!;
      let reason = new TOPOLOGY_MISMATCH_REASON();
      let bestReason = new TOPOLOGY_MISMATCH_REASON();

      for (const tgt of aTarget.m_components) {
        if (ref.MatchesWith(tgt, reason)) {
          structuralMatches[i]!.push(tgt);
        } else if (bestReason.m_reason === '' || ref.IsSameKind(tgt)) {
          // Prefer the reason from a same-kind counterpart: the candidate the user expects.
          bestReason = Object.assign(new TOPOLOGY_MISMATCH_REASON(), reason);
        }
      }

      if (structuralMatches[i]!.length === 0) structuralReasons[i] = bestReason;
    }

    if (cancelled?.value) return false;

    top.m_ref = this.m_components[0]!;
    top.m_refIndex = 0;

    stack.push(top);

    let nloops = 0;

    while (stack.length > 0) {
      if (cancelled?.value) return false;

      nloops++;
      const current = stack[stack.length - 1]!;

      for (const [k, v] of current.m_locked) {
        if (v === current.m_ref) {
          current.m_locked.delete(k);
          break;
        }
      }

      if (nloops >= this.c_ITER_LIMIT) {
        const reason = new TOPOLOGY_MISMATCH_REASON();
        reason.m_reason = 'Iteration count exceeded (timeout)';

        if (aMismatchReasons.length === 0) aMismatchReasons.push(reason);
        else aMismatchReasons.unshift(reason);

        return false;
      }

      if (current.m_currentMatch < 0) {
        localReasons = [];
        current.m_matches = aTarget.findMatchingComponents(
          current.m_ref!,
          structuralMatches[current.m_refIndex]!,
          structuralReasons[current.m_refIndex]!,
          current,
          localReasons,
          cancelled,
        );

        if (
          current.m_matches.length === 0 &&
          aMismatchReasons.length === 0 &&
          localReasons.length > 0
        )
          aMismatchReasons.push(...localReasons);

        current.m_currentMatch = 0;
      }

      if (current.m_currentMatch === 0 && current.m_matches.length > 1)
        this.breakTie(current.m_ref!, current.m_matches);

      if (current.m_matches.length === 0) {
        stack.pop();
        continue;
      }

      if (current.m_currentMatch >= 0 && current.m_currentMatch >= current.m_matches.length) {
        stack.pop();
        continue;
      }

      const match = current.m_matches[current.m_currentMatch]!;

      current.m_currentMatch++;
      current.m_locked.set(match, current.m_ref!);

      if (aParams.m_matchedComponents) aParams.m_matchedComponents.value = current.m_locked.size;

      if (current.m_locked.size === this.m_components.length) {
        current.m_nloops = nloops;

        aResult.clear();
        aMismatchReasons.length = 0;

        for (const [tgt, ref] of current.m_locked) aResult.set(ref.GetParent(), tgt.GetParent());

        return true;
      }

      // MRV heuristic: the unlocked component with the fewest candidate matches.
      interface MRV_CANDIDATE {
        m_cmp: COMPONENT;
        m_index: number;
        m_matches: COMPONENT[];
        m_reasons: TOPOLOGY_MISMATCH_REASON[];
      }

      const mrvCandidates: MRV_CANDIDATE[] = [];
      const lockedRefs = new Set<COMPONENT>(current.m_locked.values());

      for (let i = 0; i < this.m_components.length; i++) {
        const cmp = this.m_components[i]!;

        if (cmp !== current.m_ref && !lockedRefs.has(cmp))
          mrvCandidates.push({ m_cmp: cmp, m_index: i, m_matches: [], m_reasons: [] });
      }

      for (const c of mrvCandidates) {
        c.m_matches = aTarget.findMatchingComponents(
          c.m_cmp,
          structuralMatches[c.m_index]!,
          structuralReasons[c.m_index]!,
          current,
          c.m_reasons,
          cancelled,
        );
      }

      if (cancelled?.value) return false;

      let minMatches = 2147483647;
      let altNextRef: COMPONENT | null = null;
      let bestNextRef: COMPONENT | null = null;
      let bestRefIndex = 0;
      let altRefIndex = 0;
      let bestMatches: COMPONENT[] = [];

      for (const c of mrvCandidates) {
        const nMatches = c.m_matches.length;

        if (nMatches === 1) {
          bestNextRef = c.m_cmp;
          bestRefIndex = c.m_index;
          bestMatches = c.m_matches;
          break;
        }
        if (nMatches === 0) {
          altNextRef = c.m_cmp;
          altRefIndex = c.m_index;

          if (aMismatchReasons.length === 0 && c.m_reasons.length > 0)
            aMismatchReasons.push(...c.m_reasons);
        } else if (nMatches < minMatches) {
          minMatches = nMatches;
          bestNextRef = c.m_cmp;
          bestRefIndex = c.m_index;
          bestMatches = c.m_matches;
        }
      }

      const next = BACKTRACK_STAGE.from(current);

      if (bestNextRef) {
        next.m_ref = bestNextRef;
        next.m_refIndex = bestRefIndex;
        next.m_matches = bestMatches;
        next.m_currentMatch = 0;
      } else {
        next.m_ref = altNextRef;
        next.m_refIndex = altRefIndex;
        next.m_currentMatch = -1;
      }

      stack.push(next);
    }

    return false;
  }

  AddFootprint(aFp: FOOTPRINT, _aOffset: { x: number; y: number }): void {
    const cmp = new COMPONENT(aFp.GetReference(), aFp);

    for (const pad of aFp.Pads()) {
      const pin = new PIN();
      pin.m_netcode = pad.GetNetCode();
      pin.m_ref = pad.GetNumber();
      cmp.AddPin(pin);
    }

    this.m_components.push(cmp);
  }

  /**
   * @param aFps the channel whose graph is built.
   * @param aOtherChannelFps the channel it is matched against, used to spot a rail shared by both.
   * @param aGlobalNets netcodes already known to be global rails; excluded regardless of their
   *        pad count in aFps, so a rail with a single pad here is still ignored consistently.
   */
  static BuildFromFootprintSet(
    aFps: ReadonlySet<FOOTPRINT>,
    aOtherChannelFps: ReadonlySet<FOOTPRINT> = new Set(),
    aGlobalNets: ReadonlySet<number> = new Set(),
  ): CONNECTION_GRAPH {
    const cgraph = new CONNECTION_GRAPH();
    let ref = { x: 0, y: 0 };

    // `*aFps.begin()`: a std::set<FOOTPRINT*> ordered by pointer; here, insertion order.
    if (aFps.size > 0) ref = [...aFps][0]!.GetPosition();

    for (const fp of aFps) {
      const p = fp.GetPosition();
      cgraph.AddFootprint(fp, { x: p.x - ref.x, y: p.y - ref.y });
    }

    const count = (fps: ReadonlySet<FOOTPRINT>): Map<number, number> => {
      const counts = new Map<number, number>();

      for (const fp of fps) {
        for (const pad of fp.Pads()) {
          if (pad.GetNetCode() > 0)
            counts.set(pad.GetNetCode(), (counts.get(pad.GetNetCode()) ?? 0) + 1);
        }
      }

      return counts;
    };

    const localNetPadCounts = count(aFps);
    const otherChannelNetPadCounts = count(aOtherChannelFps);

    // Caller-supplied global rails, plus the pairwise fallback: nets with >=2 pads in both
    // channels. Single-pad boundary nets stay in the comparison; excluding them asymmetrically
    // breaks the match.
    const externalNets = new Set<number>(aGlobalNets);

    for (const [netCode, localCount] of localNetPadCounts) {
      const other = otherChannelNetPadCounts.get(netCode);

      if (localCount >= 2 && other !== undefined && other >= 2) externalNets.add(netCode);
    }

    cgraph.BuildConnectivity(externalNets);

    return cgraph;
  }
}
