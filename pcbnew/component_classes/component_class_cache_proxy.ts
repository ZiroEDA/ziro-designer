// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/** `pcbnew/component_classes/component_class_cache_proxy.h` + `.cpp`. */
import type { FOOTPRINT } from '../footprint.js';
import type { COMPONENT_CLASS } from './component_class.js';
import type { COMPONENT_CLASS_MANAGER } from './component_class_manager.js';

/*
 * A class which acts as a cache-aware proxy for a FOOTPRINT's component class.
 * Creating dynamic component classes (from component class generators) is an
 * expensive operation, so we want to cache the results. This class is a cache
 * proxy which tracks the validity of the cached component class with respect
 * to loaded static and dynamic component class rules
 */
export class COMPONENT_CLASS_CACHE_PROXY {
  protected m_footprint: FOOTPRINT;

  protected m_staticComponentClass: COMPONENT_CLASS | null = null;
  protected m_dynamicComponentClass: COMPONENT_CLASS | null = null;
  protected m_finalComponentClass: COMPONENT_CLASS | null = null;

  protected m_lastTickerValue = -1;

  constructor(footprint: FOOTPRINT) {
    this.m_footprint = footprint;
  }

  /// Sets the static component class
  /// Static component classes are assigned in the schematic, and are transferred through the
  /// netlist
  SetStaticComponentClass(compClass: COMPONENT_CLASS | null): void {
    this.m_staticComponentClass = compClass;
  }

  /// Gets the static component class
  GetStaticComponentClass(): COMPONENT_CLASS | null {
    return this.m_staticComponentClass;
  }

  /// Gets the full component class (static + dynamic resultant component class)
  GetComponentClass(): COMPONENT_CLASS | null {
    const mgr = this.m_footprint.GetBoard()!.GetComponentClassManager();

    if (mgr.GetTicker() > this.m_lastTickerValue) {
      this.RecomputeComponentClass(mgr);
    }

    return this.m_finalComponentClass;
  }

  /// Forces recomputation of the component class
  RecomputeComponentClass(manager: COMPONENT_CLASS_MANAGER | null = null): void {
    const mgr = manager ?? this.m_footprint.GetBoard()!.GetComponentClassManager();

    this.m_dynamicComponentClass = mgr.GetDynamicComponentClassesForFootprint(this.m_footprint);
    this.m_finalComponentClass = mgr.GetCombinedComponentClass(
      this.m_staticComponentClass,
      this.m_dynamicComponentClass,
    );
    this.m_lastTickerValue = mgr.GetTicker();
  }

  /// Invalidates the cache
  /// The component class will be recalculated on the next access
  InvalidateCache(): void {
    this.m_lastTickerValue = -1;
  }
}
