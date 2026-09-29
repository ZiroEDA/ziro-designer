// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PNS::LOGGER` — `pcbnew/router/pns_logger.{h,cpp}`. A flat event log the
 * router appends to as the user routes (`ROUTER::StartRouting`/`Move`/
 * `FixRoute`/`UndoLastSegment`/`ToggleViaPlacement`/`StartDragging`), plus a
 * text format for dumping and replaying a session — upstream's router debug
 * dialog (`PNS_LOG_VIEWER`).
 *
 * Upstream only ever constructs one (`ROUTER::ROUTER()`, guarded by
 * `ADVANCED_CFG::GetCfg().m_EnableRouterDump`), so every call site is wrapped
 * in `if( m_logger )` and the class has no user-visible effect in a shipping
 * build (documented on `pns_router.ts`'s constructor, which is why this file
 * did not exist until now). `pns_router.ts` wires it the same way: an opt-in
 * flag (`PnsRouterDeps.enableRouterDump`) that defaults to unset, so nothing
 * changes for a caller that does not ask for it.
 *
 * Two adaptations, both from features this repo's `router/` does not carry:
 *
 *  - `LogM`'s per-item UUID collection (`item->Parent()->m_Uuid`) reads
 *    `PnsBoardItem.uuid`, a field added to that interface by this port
 *    (`pns_item.ts`) — nothing currently *writes* it (`pns_board_iface.ts`
 *    does not stamp a UUID onto the board items it wraps), so it is empty
 *    until that wiring exists. The collection logic itself is exact.
 *  - `FormatLogFileAsString` takes its added/head item lines pre-formatted
 *    (`aAddedItemLines`/`aHeadLines`) rather than calling `ITEM::Format()`
 *    itself — that method (a debug s-expression dump) is not ported anywhere
 *    in this repo, the same gap `router_preview_item.ts`'s doc comment notes
 *    for `ITEM::Format()`'s only other caller. `aRemovedUuids` likewise takes
 *    a plain ordered list rather than upstream's `std::set<KIID>`: this repo
 *    has no `KIID` class to give that set its comparator, so the caller
 *    supplies the order rather than this method re-deriving one that might
 *    not match `KIID::operator<`'s byte comparison.
 */

import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import type { PnsItem } from './pns_item.js';
import { PnsSizesSettings, type PnsViaTypeSetting } from './pns_sizes_settings.js';

/** `LOGGER::EVENT_TYPE` — pns_logger.h:46-55. */
export enum PnsLoggerEventType {
  EVT_START_ROUTE = 0,
  EVT_START_DRAG = 1,
  EVT_FIX = 2,
  EVT_MOVE = 3,
  EVT_ABORT = 4,
  EVT_TOGGLE_VIA = 5,
  EVT_UNFIX = 6,
  EVT_START_MULTIDRAG = 7,
}

/** `LOGGER::EVENT_ENTRY` — pns_logger.h:57-78. */
export interface PnsLoggerEventEntry {
  p: Vec2;
  type: PnsLoggerEventType;
  uuids: string[];
  sizes: PnsSizesSettings;
  layer: number;
}

function defaultEntry(): PnsLoggerEventEntry {
  return {
    p: { x: 0, y: 0 },
    type: PnsLoggerEventType.EVT_START_ROUTE,
    uuids: [],
    sizes: new PnsSizesSettings(),
    layer: 0,
  };
}

/** `static_cast<int>( VIATYPE )`, matching `pcb_track_types.ts`'s `VIATYPE`
 *  ints exactly (`THROUGH`=4, `BURIED`=3, `BLIND`=2, `MICROVIA`=1). Local to
 *  this one debug-format line: nothing else in `router/` needs a
 *  `PnsViaTypeSetting → int` conversion, so there is no central copy to
 *  reuse. `NOT_DEFINED`=0 has no `PnsViaTypeSetting` spelling and so cannot
 *  occur here. */
const VIA_TYPE_INT: Record<PnsViaTypeSetting, number> = {
  through: 4,
  buried: 3,
  blind: 2,
  micro: 1,
};

/** `wxAtoi`: the leading integer, or 0 for anything that isn't one
 *  (including an empty token, which `wxStringTokenizer::GetNextToken()`
 *  returns once it runs out — `wxAtoi( wxEmptyString )` is 0). */
function wxAtoi(s: string): number {
  const n = Number.parseInt(s, 10);
  return Number.isNaN(n) ? 0 : n;
}

/** `PNS::LOGGER` — pns_logger.h:42-108. */
export class PnsLogger {
  private mEvents: PnsLoggerEventEntry[] = [];

  /** `LOGGER::Clear()` — cpp:45-48. */
  clear(): void {
    this.mEvents = [];
  }

  /** `LOGGER::LogM(...)` — cpp:51-72. */
  logM(
    evt: PnsLoggerEventType,
    pos: Vec2 = { x: 0, y: 0 },
    items: readonly (PnsItem | null)[] = [],
    sizes: PnsSizesSettings | null = null,
    aLayer = 0,
  ): void {
    const ent: PnsLoggerEventEntry = {
      type: evt,
      p: pos,
      layer: aLayer,
      sizes: sizes ? sizes.clone() : new PnsSizesSettings(),
      uuids: [],
    };

    for (const item of items) {
      const parent = item?.parent();
      if (item && parent?.uuid !== undefined) ent.uuids.push(parent.uuid);
    }

    this.mEvents.push(ent);
  }

  /** `LOGGER::Log(...)` — cpp:75-81. */
  log(
    evt: PnsLoggerEventType,
    pos: Vec2 = { x: 0, y: 0 },
    item: PnsItem | null = null,
    sizes: PnsSizesSettings | null = null,
    aLayer = 0,
  ): void {
    this.logM(evt, pos, [item], sizes, aLayer);
  }

  /** `LOGGER::GetEvents()` — pns_logger.h:91-94. */
  getEvents(): readonly PnsLoggerEventEntry[] {
    return this.mEvents;
  }

  /**
   * `LOGGER::FormatEvent( const EVENT_ENTRY& )` — cpp:108-130. Byte-exact:
   * `"event "` plus five ints, each `uuid + " "`, then seven more ints
   * joined by single spaces (no leading/trailing space of their own — the
   * trailing space after the last uuid, or after the five-int header when
   * there are none, supplies the one separator), then `"\n"`.
   */
  static formatEvent(aEvent: PnsLoggerEventEntry): string {
    let str = `event ${aEvent.p.x} ${aEvent.p.y} ${aEvent.type} ${aEvent.layer} ${aEvent.uuids.length} `;

    for (const uuid of aEvent.uuids) str += `${uuid} `;

    const s = aEvent.sizes;
    str += [
      s.trackWidth(),
      s.viaDiameter(),
      s.viaDrill(),
      s.trackWidthIsExplicit() ? 1 : 0,
      s.getLayerBottom(),
      s.getLayerTop(),
      VIA_TYPE_INT[s.viaType()],
    ].join(' ');

    str += '\n';

    return str;
  }

  /**
   * `LOGGER::ParseEvent( const wxString& )` — cpp:133-153. Only the five
   * header ints and the UUID list are read back; the seven `sizes` ints
   * `FormatEvent` writes are never parsed, so a round trip loses them —
   * `ent.sizes` comes back as a fresh default `SIZES_SETTINGS()`. Upstream,
   * reproduced exactly (not a bug this port introduced).
   */
  static parseEvent(aLine: string): PnsLoggerEventEntry {
    const tokens = aLine.trim().length === 0 ? [] : aLine.trim().split(/\s+/);
    let i = 0;
    const next = (): string => tokens[i++] ?? '';

    const cmd = next();

    if (cmd !== 'event') return defaultEntry();

    const evt: PnsLoggerEventEntry = defaultEntry();
    evt.p = { x: wxAtoi(next()), y: wxAtoi(next()) };
    evt.type = wxAtoi(next()) as PnsLoggerEventType;
    evt.layer = wxAtoi(next());
    const nUuids = wxAtoi(next());

    for (let n = 0; n < nUuids; n++) evt.uuids.push(next());

    return evt;
  }

  /**
   * `LOGGER::FormatLogFileAsString(...)` — cpp:84-105. See the module doc
   * comment for `aAddedItemLines`/`aHeadLines`/`aRemovedUuids`, the three
   * parameters this repo's missing `ITEM::Format()`/`KIID` reshape.
   */
  static formatLogFileAsString(
    aMode: number,
    aAddedItemLines: readonly string[],
    aRemovedUuids: readonly string[],
    aHeadLines: readonly string[],
    aEvents: readonly PnsLoggerEventEntry[],
  ): string {
    let result = `mode ${aMode}\n`;

    for (const evt of aEvents) result += PnsLogger.formatEvent(evt);

    for (const uuid of aRemovedUuids) result += `removed ${uuid}\n`;

    for (const line of aAddedItemLines) result += `added ${line}\n`;

    for (const line of aHeadLines) result += `head ${line}\n`;

    return result;
  }
}
