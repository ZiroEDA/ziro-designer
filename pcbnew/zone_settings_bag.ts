// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/zone_settings_bag.h` / `.cpp`: `ZONE_SETTINGS_BAG`, the working
 * copy a zone-priority editor mutates — a clone per eligible zone plus its
 * `ZONE_SETTINGS`, and a (initial, current) priority pair per clone so
 * `UpdateClonedZones` can skip writing priorities that never moved.
 */
import type { BOARD } from './board.js';
import { ZONE } from './zone.js';
import { ZONE_SETTINGS } from './zone_settings.js';

export class ZONE_SETTINGS_BAG {
  // original : clone
  private m_zonesCloneMap = new Map<ZONE, ZONE>();
  // clone : current settings
  private m_zoneSettings = new Map<ZONE, ZONE_SETTINGS>();
  // clone : [initial pri, current pri]
  private m_zonePriorities = new Map<ZONE, [number, number]>();
  private m_clonedZoneList: ZONE[] = [];

  constructor(aBoard: BOARD);
  constructor(aZone: ZONE, aSettings: ZONE_SETTINGS);
  constructor(aBoardOrZone: BOARD | ZONE, aSettings?: ZONE_SETTINGS) {
    if (aSettings) {
      // ZONE_SETTINGS_BAG( ZONE* aZone, ZONE_SETTINGS* aSettings )
      this.m_zoneSettings.set(aBoardOrZone as ZONE, aSettings.clone());
      return;
    }

    const board = aBoardOrZone as BOARD;

    for (const zone of board.Zones()) {
      if (!zone.GetIsRuleArea() && !zone.IsTeardropArea() && zone.IsOnCopperLayer()) {
        const zoneClone = zone.Clone();
        this.m_zonesCloneMap.set(zone, zoneClone);
        this.m_clonedZoneList.push(zoneClone);
      }
    }

    for (const zone of this.m_clonedZoneList) {
      const settings = new ZONE_SETTINGS();
      settings.importFrom(zone);
      this.m_zoneSettings.set(zone, settings);
    }

    const sortedClonedZones = [...this.m_clonedZoneList].sort((l, r) =>
      l.HigherPriority(r) ? -1 : r.HigherPriority(l) ? 1 : 0,
    );

    let currentPriority = sortedClonedZones.length - 1;

    for (const zone of sortedClonedZones) {
      this.m_zonePriorities.set(zone, [currentPriority, currentPriority]);
      --currentPriority;
    }
  }

  GetZoneSettings(aZone: ZONE): ZONE_SETTINGS | undefined {
    return this.m_zoneSettings.get(aZone);
  }

  GetZonePriority(aZone: ZONE): number {
    return this.m_zonePriorities.get(aZone)?.[1] ?? 0;
  }

  SwapPriority(aZone: ZONE, aOtherZone: ZONE): void {
    const a = this.m_zonePriorities.get(aZone);
    const b = this.m_zonePriorities.get(aOtherZone);

    if (!a || !b) return;

    [a[1], b[1]] = [b[1], a[1]];
  }

  /**
   * Update the tracked priority for a cloned zone. This keeps both the
   * m_zonePriorities pair and the ZONE_SETTINGS m_ZonePriority in sync so
   * that UpdateClonedZones() will not revert auto-assigned values.
   */
  SetZonePriority(aClone: ZONE, aPriority: number): void {
    const pri = this.m_zonePriorities.get(aClone);

    if (pri) pri[1] = aPriority;
    else this.m_zonePriorities.set(aClone, [aPriority, aPriority]);

    const settings = this.m_zoneSettings.get(aClone);
    if (settings) settings.m_ZonePriority = aPriority;
  }

  /** The cloned list is the working storage. */
  UpdateClonedZones(): void {
    for (const zone of this.m_clonedZoneList) {
      this.m_zoneSettings.get(zone)?.ExportSetting(zone);
    }

    // Prevent version-control churn by not updating potentially sparse priorities if their
    // order didn't change.
    let priorityChanged = false;

    for (const zone of this.m_clonedZoneList) {
      const pri = this.m_zonePriorities.get(zone);

      if (pri && pri[0] !== pri[1]) {
        priorityChanged = true;
        break;
      }
    }

    if (priorityChanged) {
      for (const zone of this.m_clonedZoneList) {
        const pri = this.m_zonePriorities.get(zone);
        if (pri) zone.SetAssignedPriority(pri[1]);
      }
    }
  }

  GetClonedZoneList(): ZONE[] {
    return this.m_clonedZoneList;
  }
  GetZonesCloneMap(): ReadonlyMap<ZONE, ZONE> {
    return this.m_zonesCloneMap;
  }
}
