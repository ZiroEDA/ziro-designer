// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/connection_graph.h` / `connection_graph.cpp`: `CONNECTION_SUBGRAPH` and
 * `CONNECTION_GRAPH`, the schematic connectivity (netlist) engine, on the live `SCH_*`
 * items.
 *
 * This stands beside the record-model engine in `connectivity/` (a union-find over the
 * plain records); nothing in the app calls this one yet.
 *
 * Differences forced by the language, not the algorithm:
 *
 *  - C++ keeps `std::set<SCH_ITEM*>` / `std::unordered_*` containers keyed by pointer; their
 *    iteration order is the heap's.  Here every such container is an insertion-ordered
 *    `Set` / `Map`.  Where upstream sorts a vector by pointer and removes duplicates (the
 *    items at one connection point) the first occurrence is kept in place.
 *  - `std::map<VECTOR2I, …>` iterates in `std::less<VECTOR2I>` order (x, then y); the
 *    connection map here is sorted the same way before it is walked.
 *  - A sheet path used as a key is keyed by `SCH_SHEET_PATH::PathAsString()`, the key the
 *    items' own connection maps use.
 *  - The thread pool loops run in order on the one thread.
 *
 * Not here: `PROF_TIMER` / `wxLogTrace` / `APP_MONITOR` instrumentation, the progress
 * reporter.
 */

import { RECURSE_MODE } from '@ziroeda/common/eda_item.js';
import { CONNECTIVITY_CANDIDATE } from '@ziroeda/common/eda_item_flags.js';
import { SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { ELECTRICAL_PINTYPE } from '@ziroeda/common/pin_type.js';
import { ESCAPE_CONTEXT, EscapeString, unescapeString } from '@ziroeda/common/string_utils.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import type { BUS_ALIAS } from './bus_alias.js';
import { ERC_ITEM } from './erc/erc_item.js';
import { ERCE_T } from './erc/erc_settings.js';
import type { SCH_BUS_BUS_ENTRY, SCH_BUS_WIRE_ENTRY } from './sch_bus_entry.js';
import { CONNECTION_TYPE, SCH_CONNECTION, type SCH_CONNECTION_GRAPH } from './sch_connection.js';
import type { SCH_FIELD } from './sch_field.js';
import type { SCH_ITEM } from './sch_item.js';
import { LABEL_FLAG_SHAPE, SCH_LABEL_BASE, type SCH_HIERLABEL } from './sch_label.js';
import type { SCH_LINE } from './sch_line.js';
import { SCH_MARKER } from './sch_marker.js';
import type { SCH_PIN } from './sch_pin.js';
import type { SCH_SHEET } from './sch_sheet.js';
import type { SCH_SHEET_PIN } from './sch_sheet_pin.js';
import { type SCH_SHEET_LIST, SCH_SHEET_PATH } from './sch_sheet_path.js';
import type { SCH_SYMBOL } from './sch_symbol.js';
import type { SCH_TEXT } from './sch_text.js';
import type { SCHEMATIC } from './schematic.js';

/** The key a sheet path is looked up by (`std::hash<SCH_SHEET_PATH>` / `operator==`). */
function sheetKey(aSheet: SCH_SHEET_PATH): string {
  return aSheet.PathAsString();
}

const samePt = (a: VECTOR2I, b: VECTOR2I): boolean => a.x === b.x && a.y === b.y;

/** `std::vector::push_back` into the map's vector, creating it (`operator[]`). */
function pushInto<K, V>(aMap: Map<K, V[]>, aKey: K, aValue: V): void {
  let vec = aMap.get(aKey);

  if (!vec) {
    vec = [];
    aMap.set(aKey, vec);
  }

  vec.push(aValue);
}

/** `std::erase( vec, value )`. */
function eraseFrom<T>(aVec: T[], aValue: T): void {
  for (let i = aVec.length - 1; i >= 0; i--) if (aVec[i] === aValue) aVec.splice(i, 1);
}

/** wxString `<` on a pair of net names: code-unit order, as `wxString::compare`. */
function lessStr(a: string, b: string): boolean {
  return a < b;
}

/**
 * A subgraph is a set of items that are electrically connected on a single sheet.
 *
 * For example, a label connected to a wire and so on.
 * A net is composed of one or more subgraphs.
 *
 * A set of items that appears to be physically connected may actually be more
 * than one subgraph, because some items don't connect electrically.
 *
 * For example, multiple bus wires can come together at a junction but have
 * different labels on each branch.  Each label+wire branch is its own subgraph.
 *
 * The members are public: `CONNECTION_GRAPH` is a `friend` upstream.
 */
export class CONNECTION_SUBGRAPH {
  static readonly PRIORITY = {
    INVALID: -1,
    NONE: 0,
    PIN: 1,
    SHEET_PIN: 2,
    HIER_LABEL: 3,
    LOCAL_LABEL: 4,
    LOCAL_POWER_PIN: 5,
    GLOBAL_POWER_PIN: 6,
    GLOBAL: 7,
  } as const;

  m_graph: CONNECTION_GRAPH | null;

  m_dirty = false;

  /// True if this subgraph has been absorbed into another.  No pointers here are safe if so!
  m_absorbed = false;

  /**
   *  True if the subgraph is not actually part of a net.  These are created for bus members
   *  to ensure that bus-to-bus connection happens but they don't have any valid data
   */
  m_is_bus_member = false;

  /// If this subgraph is absorbed, points to the absorbing (and valid) subgraph
  m_absorbed_by: CONNECTION_SUBGRAPH | null = null;

  /// Set of subgraphs that have been absorbed by this subgraph
  m_absorbed_subgraphs = new Set<CONNECTION_SUBGRAPH>();

  m_code = -1;

  /**
   * True if this subgraph contains more than one driver that should be
   * shorted together in the netlist.  For example, two labels or
   * two power ports.
   */
  m_multiple_drivers = false;

  /// True if the driver is "strong": a label or power object.
  m_strong_driver = false;

  /// True if the driver is a local (i.e. non-global) type.
  m_local_driver = false;

  /// Bus entry in graph, if any.
  m_bus_entry: SCH_ITEM | null = null;

  m_drivers = new Set<SCH_ITEM>();

  /**
   * If a subgraph is a bus, this map contains links between the bus members and any
   * local sheet neighbors with the same connection name.
   *
   * For example, if this subgraph is a bus D[7..0], and on the same sheet there is
   * a net with label D7, this map will contain an entry for the D7 bus member, and
   * the set will contain a pointer to the D7 net subgraph.
   */
  m_bus_neighbors = new Map<SCH_CONNECTION, Set<CONNECTION_SUBGRAPH>>();

  /**
   * If this is a net, this vector contains links to any same-sheet buses that contain it.
   * The string key is the name of the connection that forms the link (which isn't necessarily
   * the same as the name of the connection driving this subgraph)
   */
  m_bus_parents = new Map<SCH_CONNECTION, Set<CONNECTION_SUBGRAPH>>();

  /// Cache for lookup of any hierarchical (sheet) pins on this subgraph (for referring down).
  m_hier_pins = new Set<SCH_SHEET_PIN>();

  /// Cache for lookup of any hierarchical ports on this subgraph (for referring up).
  m_hier_ports = new Set<SCH_HIERLABEL>();

  /// If not null, this indicates the subgraph on a higher level sheet that is linked to this one.
  m_hier_parent: CONNECTION_SUBGRAPH | null = null;

  /// If not null, this indicates the subgraph(s) on a lower level sheet that are linked to
  /// this one.
  m_hier_children = new Set<CONNECTION_SUBGRAPH>();

  /// A cache of escaped netnames from schematic items.
  private m_driver_name_cache = new Map<SCH_ITEM, string>();

  /// Fully-resolved driver for the subgraph (might not exist in this subgraph).
  m_driver: SCH_ITEM | null = null;

  /// Contents of the subgraph.
  m_items = new Set<SCH_ITEM>();

  /// No-connect item in graph, if any.
  m_no_connect: SCH_ITEM | null = null;

  /// On which logical sheet is the subgraph contained.
  m_sheet: SCH_SHEET_PATH = new SCH_SHEET_PATH();

  /// Cache for driver connection.
  m_driver_connection: SCH_CONNECTION | null = null;

  /// A cache of connections that are part of this subgraph but that don't have
  /// an owning element (i.e. bus members)
  private m_bus_element_connections = new Set<SCH_CONNECTION>();

  constructor(aGraph: CONNECTION_GRAPH | null) {
    this.m_graph = aGraph;
  }

  /**
   * Determine which potential driver should drive the subgraph.
   *
   * If multiple possible drivers exist, picks one according to the priority.
   * If multiple "winners" exist, returns false and sets #m_driver to nullptr.
   *
   * @param aCheckMultipleDrivers controls whether the second driver should be captured for ERC.
   * @return true if m_driver was set, or false if a conflict occurred.
   */
  ResolveDrivers(_aCheckMultipleDrivers = false): boolean {
    const P = CONNECTION_SUBGRAPH.PRIORITY;

    // Collect candidate drivers of highest priority in a simple vector which will be
    // sorted later.  Using a vector makes the ranking logic explicit and easier to
    // maintain than relying on the ordering semantics of std::set.
    let highest_priority: number = P.INVALID;
    let candidates: SCH_ITEM[] = [];
    const strong_drivers = new Set<SCH_ITEM>();

    this.m_driver = null;

    // Hierarchical labels are lower priority than local labels here,
    // because on the first pass we want local labels to drive subgraphs
    // so that we can identify same-sheet neighbors and link them together.
    // Hierarchical labels will end up overriding the final net name if
    // a higher-level sheet has a different name during the hierarchical
    // pass.

    for (const item of this.m_drivers) {
      const item_priority = CONNECTION_SUBGRAPH.GetDriverPriority(item);

      if (item_priority === P.PIN) {
        const pin = item as SCH_PIN;

        if (!(pin.GetParentSymbol() as unknown as SCH_SYMBOL).IsInNetlist()) continue;
      }

      if (item_priority >= P.HIER_LABEL) strong_drivers.add(item);

      if (item_priority > highest_priority) {
        candidates = [item];
        highest_priority = item_priority;
      } else if (candidates.length > 0 && item_priority === highest_priority) {
        candidates.push(item);
      }
    }

    if (highest_priority >= P.HIER_LABEL) this.m_strong_driver = true;

    // Power pins are 5, global labels are 6
    this.m_local_driver = highest_priority < P.GLOBAL_POWER_PIN;

    if (candidates.length > 0) {
      // Candidates are ranked using the following rules (in order):
      // 1. Prefer bus supersets over subsets to keep the widest connection.
      // 2. Prefer pins on power symbols (global first, then local) over regular pins.
      // 3. Prefer output sheet pins over input sheet pins.
      // 4. Prefer names that do not look auto-generated (avoid "-Pad" suffixes).
      // 5. Fall back to alphabetical comparison for deterministic ordering.
      const candidate_cmp = (a: SCH_ITEM, b: SCH_ITEM): boolean => {
        const ac = a.Connection(this.m_sheet)!;
        const bc = b.Connection(this.m_sheet)!;

        if (ac.IsBus() && bc.IsBus()) {
          if (bc.IsSubsetOf(ac) && !ac.IsSubsetOf(bc)) return true;

          if (!bc.IsSubsetOf(ac) && ac.IsSubsetOf(bc)) return false;
        }

        if (a.Type() === KICAD_T.SCH_PIN_T && b.Type() === KICAD_T.SCH_PIN_T) {
          const pa = a as SCH_PIN;
          const pb = b as SCH_PIN;

          const aParent = pa.GetLibPin() ? pa.GetLibPin()!.GetParentSymbol() : null;
          const bParent = pb.GetLibPin() ? pb.GetLibPin()!.GetParentSymbol() : null;

          const aGlobal = !!aParent && aParent.IsGlobalPower();
          const bGlobal = !!bParent && bParent.IsGlobalPower();

          if (aGlobal !== bGlobal) return aGlobal;

          const aLocal = !!aParent && aParent.IsLocalPower();
          const bLocal = !!bParent && bParent.IsLocalPower();

          if (aLocal !== bLocal) return aLocal;
        }

        if (a.Type() === KICAD_T.SCH_SHEET_PIN_T && b.Type() === KICAD_T.SCH_SHEET_PIN_T) {
          const sa = a as SCH_SHEET_PIN;
          const sb = b as SCH_SHEET_PIN;

          if (sa.GetShape() !== sb.GetShape()) {
            if (sa.GetShape() === LABEL_FLAG_SHAPE.L_OUTPUT) return true;
            if (sb.GetShape() === LABEL_FLAG_SHAPE.L_OUTPUT) return false;
          }
        }

        const a_name = this.GetNameForDriver(a);
        const b_name = this.GetNameForDriver(b);

        const a_lowQualityName = a_name.includes('-Pad');
        const b_lowQualityName = b_name.includes('-Pad');

        if (a_lowQualityName !== b_lowQualityName) return !a_lowQualityName;

        return lessStr(a_name, b_name);
      };

      candidates.sort((a, b) => (candidate_cmp(a, b) ? -1 : candidate_cmp(b, a) ? 1 : 0));

      this.m_driver = candidates[0]!;
    }

    if (strong_drivers.size > 1) this.m_multiple_drivers = true;

    // Drop weak drivers
    if (this.m_strong_driver) this.m_drivers = new Set(strong_drivers);

    // Cache driver connection
    if (this.m_driver) {
      this.m_driver_connection = this.m_driver.Connection(this.m_sheet)!;
      this.m_driver_connection.ConfigureFromLabel(this.GetNameForDriver(this.m_driver));
      this.m_driver_connection.SetDriver(this.m_driver);
      this.m_driver_connection.ClearDirty();
    } else if (!this.m_is_bus_member) {
      this.m_driver_connection = null;
    }

    return this.m_driver !== null;
  }

  /** Find all items in the subgraph as well as child subgraphs recursively. */
  getAllConnectedItems(
    aItems: Map<string, [SCH_SHEET_PATH, SCH_ITEM]>,
    aSubgraphs: Set<CONNECTION_SUBGRAPH>,
  ): void {
    let sg: CONNECTION_SUBGRAPH = this;

    while (sg.m_absorbed_by) {
      if (sg.m_graph !== sg.m_absorbed_by.m_graph) break; // wxCHECK2( …, continue )
      sg = sg.m_absorbed_by;
    }

    // If we are unable to insert the subgraph into the set, then we have already
    // visited it and don't need to add it again.
    if (aSubgraphs.has(sg)) return;

    aSubgraphs.add(sg);

    for (const absorbed of sg.m_absorbed_subgraphs) aSubgraphs.add(absorbed);

    for (const item of sg.m_items)
      aItems.set(`${sheetKey(this.m_sheet)}\u0000${item.m_Uuid}`, [this.m_sheet, item]);

    for (const child_sg of sg.m_hier_children) child_sg.getAllConnectedItems(aItems, aSubgraphs);
  }

  /**
   * Return the fully-qualified net name for this subgraph (if one exists)
   */
  GetNetName(): string {
    if (!this.m_driver || this.m_dirty) return '';

    const conn = this.m_driver.Connection(this.m_sheet);

    if (!conn) return '';

    return conn.Name();
  }

  /// Return all the all bus labels attached to this subgraph (if any).
  GetAllBusLabels(): SCH_ITEM[] {
    const labels: SCH_ITEM[] = [];

    for (const item of this.m_drivers) {
      switch (item.Type()) {
        case KICAD_T.SCH_LABEL_T:
        case KICAD_T.SCH_GLOBAL_LABEL_T:
        case KICAD_T.SCH_HIER_LABEL_T: {
          const type = item.Connection(this.m_sheet)!.Type();

          // Only consider bus vectors
          if (type === CONNECTION_TYPE.BUS || type === CONNECTION_TYPE.BUS_GROUP) labels.push(item);

          break;
        }

        default:
          break;
      }
    }

    return labels;
  }

  /// Return all the vector-based bus labels attached to this subgraph (if any).
  GetVectorBusLabels(): SCH_ITEM[] {
    const labels: SCH_ITEM[] = [];

    for (const item of this.m_drivers) {
      switch (item.Type()) {
        case KICAD_T.SCH_LABEL_T:
        case KICAD_T.SCH_GLOBAL_LABEL_T:
        case KICAD_T.SCH_HIER_LABEL_T: {
          const label_conn = item.Connection(this.m_sheet)!;

          // Only consider bus vectors
          if (label_conn.Type() === CONNECTION_TYPE.BUS) labels.push(item);

          break;
        }

        default:
          break;
      }
    }

    return labels;
  }

  private driverName(aItem: SCH_ITEM): string {
    switch (aItem.Type()) {
      case KICAD_T.SCH_PIN_T: {
        const pin = aItem as SCH_PIN;
        const forceNoConnect = this.m_no_connect !== null;

        return pin.GetDefaultNetName(this.m_sheet, forceNoConnect);
      }

      case KICAD_T.SCH_LABEL_T:
      case KICAD_T.SCH_GLOBAL_LABEL_T:
      case KICAD_T.SCH_HIER_LABEL_T: {
        const label = aItem as SCH_LABEL_BASE;

        // NB: any changes here will need corresponding changes in SCH_LABEL_BASE::cacheShownText()
        return EscapeString(label.GetShownText(this.m_sheet, false), ESCAPE_CONTEXT.CTX_NETNAME);
      }

      case KICAD_T.SCH_SHEET_PIN_T: {
        // Sheet pins need to use their parent sheet as their starting sheet or they will resolve
        // variables on the current sheet first
        const sheetPin = aItem as SCH_SHEET_PIN;
        const path = this.m_sheet.Clone();

        if (path.Last() !== sheetPin.GetParent()) path.push_back(sheetPin.GetParent());

        return EscapeString(sheetPin.GetShownText(path, false), ESCAPE_CONTEXT.CTX_NETNAME);
      }

      default:
        console.assert(false, 'Unhandled item type in GetNameForDriver'); // wxFAIL_MSG
        return '';
    }
  }

  /// Return the candidate net name for a driver.
  GetNameForDriver(aItem: SCH_ITEM): string {
    if (aItem.HasCachedDriverName()) return aItem.GetCachedDriverName();

    const cached = this.m_driver_name_cache.get(aItem);

    if (cached !== undefined) return cached;

    const name = this.driverName(aItem);
    this.m_driver_name_cache.set(aItem, name);
    return name;
  }

  /// Return the resolved netclasses for the item, and the source item providing the netclass
  GetNetclassesForDriver(aItem: SCH_ITEM): [string, SCH_ITEM][] {
    const foundNetclasses: [string, SCH_ITEM][] = [];

    // Get netclasses on attached rule areas
    for (const ruleArea of aItem.GetRuleAreaCache()) {
      const ruleAreaNetclasses = ruleArea.GetResolvedNetclasses(this.m_sheet);

      if (ruleAreaNetclasses.length > 0) foundNetclasses.push(...ruleAreaNetclasses);
    }

    // Get netclasses on child fields
    aItem.RunOnChildren((aChild: SCH_ITEM) => {
      if (aChild.Type() === KICAD_T.SCH_FIELD_T) {
        const field = aChild as SCH_FIELD;

        if (field.GetCanonicalName() === 'Netclass') {
          const netclass = field.GetShownText(this.m_sheet, false);

          if (netclass !== '') foundNetclasses.push([netclass, aItem]);
        }
      }
    }, RECURSE_MODE.NO_RECURSE);

    // std::sort by name: stable here, where upstream's is not, so equal names keep their order.
    foundNetclasses.sort((i1, i2) => (lessStr(i1[0], i2[0]) ? -1 : lessStr(i2[0], i1[0]) ? 1 : 0));

    return foundNetclasses;
  }

  /// Combine another subgraph on the same sheet into this one.
  Absorb(aOther: CONNECTION_SUBGRAPH): void {
    if (!this.m_sheet.equals(aOther.m_sheet)) return; // wxCHECK

    for (const item of aOther.m_items) {
      item.Connection(this.m_sheet)!.SetSubgraphCode(this.m_code);
      this.AddItem(item);
    }

    this.m_absorbed_subgraphs.add(aOther);

    for (const sg of aOther.m_absorbed_subgraphs) this.m_absorbed_subgraphs.add(sg);

    // std::unordered_map::insert: an existing key keeps its value
    for (const [k, v] of aOther.m_bus_neighbors)
      if (!this.m_bus_neighbors.has(k)) this.m_bus_neighbors.set(k, v);

    for (const [k, v] of aOther.m_bus_parents)
      if (!this.m_bus_parents.has(k)) this.m_bus_parents.set(k, v);

    this.m_multiple_drivers ||= aOther.m_multiple_drivers;

    const set_absorbed_by = (child: CONNECTION_SUBGRAPH): void => {
      child.m_absorbed_by = this;

      for (const subchild of child.m_absorbed_subgraphs) set_absorbed_by(subchild);
    };

    aOther.m_absorbed = true;
    aOther.m_dirty = false;
    aOther.m_driver = null;
    aOther.m_driver_connection = null;

    set_absorbed_by(aOther);
  }

  /// Add a new item to the subgraph.
  AddItem(aItem: SCH_ITEM): void {
    this.m_items.add(aItem);

    if (aItem.Connection(this.m_sheet)!.IsDriver()) this.m_drivers.add(aItem);

    if (aItem.Type() === KICAD_T.SCH_SHEET_PIN_T) this.m_hier_pins.add(aItem as SCH_SHEET_PIN);
    else if (aItem.Type() === KICAD_T.SCH_HIER_LABEL_T)
      this.m_hier_ports.add(aItem as SCH_HIERLABEL);
  }

  /// Update all items to match the driver connection.
  UpdateItemConnections(): void {
    if (!this.m_driver_connection) return;

    for (const item of this.m_items) {
      const item_conn = item.GetOrInitConnection(this.m_sheet, this.m_graph);

      if (!item_conn) continue;

      if (
        (this.m_driver_connection.IsBus() && item_conn.IsNet()) ||
        (this.m_driver_connection.IsNet() && item_conn.IsBus())
      ) {
        continue;
      }

      item_conn.Clone(this.m_driver_connection);
      item_conn.ClearDirty();
    }
  }

  /// Provide a read-only reference to the items in the subgraph.
  GetItems(): ReadonlySet<SCH_ITEM> {
    return this.m_items;
  }

  /**
   * Return the priority (higher is more important) of a candidate driver
   *
   * 0: Invalid driver
   * 1: Symbol pin
   * 2: Hierarchical sheet pin
   * 3: Hierarchical label
   * 4: Local label
   * 5: Power pin
   * 6: Global label
   */
  static GetDriverPriority(aDriver: SCH_ITEM | null): number {
    const P = CONNECTION_SUBGRAPH.PRIORITY;

    if (!aDriver) return P.NONE;

    const libSymbolRef = (symbol: SCH_SYMBOL): string => {
      const part = symbol.GetLibSymbolRef();

      if (part) return part.GetReferenceField().GetText();

      return '';
    };

    switch (aDriver.Type()) {
      case KICAD_T.SCH_SHEET_PIN_T:
        return P.SHEET_PIN;
      case KICAD_T.SCH_HIER_LABEL_T:
        return P.HIER_LABEL;
      case KICAD_T.SCH_LABEL_T:
        return P.LOCAL_LABEL;
      case KICAD_T.SCH_GLOBAL_LABEL_T:
        return P.GLOBAL;

      case KICAD_T.SCH_PIN_T: {
        const sch_pin = aDriver as SCH_PIN;
        const sym = sch_pin.GetParentSymbol() as unknown as SCH_SYMBOL | null;

        if (sch_pin.IsGlobalPower()) return P.GLOBAL_POWER_PIN;
        else if (sch_pin.IsLocalPower()) return P.LOCAL_POWER_PIN;
        else if (!sym || sym.GetExcludedFromBoard() || libSymbolRef(sym).startsWith('#'))
          return P.NONE;
        else return P.PIN;
      }

      default:
        return P.NONE;
    }
  }

  /** `GetDriverPriority()` of this subgraph's driver. */
  GetOwnDriverPriority(): number {
    if (this.m_driver) return CONNECTION_SUBGRAPH.GetDriverPriority(this.m_driver);
    else return CONNECTION_SUBGRAPH.PRIORITY.NONE;
  }

  /**
   * @return pointer to the SCH_ITEM whose name sets the subgraph netname.
   *         N.B. This item may not be in the subgraph.
   */
  GetDriver(): SCH_ITEM | null {
    return this.m_driver;
  }

  /** @return #SCH_CONNECTION object for m_driver on #m_sheet. */
  GetDriverConnection(): SCH_CONNECTION | null {
    return this.m_driver_connection;
  }

  /** @return pointer to the item causing a no-connect or nullptr if none. */
  GetNoConnect(): SCH_ITEM | null {
    return this.m_no_connect;
  }

  GetSheet(): SCH_SHEET_PATH {
    return this.m_sheet;
  }

  GetBusParents(): ReadonlyMap<SCH_CONNECTION, Set<CONNECTION_SUBGRAPH>> {
    return this.m_bus_parents;
  }

  RemoveItem(aItem: SCH_ITEM): void {
    this.m_items.delete(aItem);
    this.m_drivers.delete(aItem);

    if (aItem === this.m_driver) {
      this.m_driver = null;
      this.m_driver_connection = null;
    }

    if (aItem.Type() === KICAD_T.SCH_SHEET_PIN_T) this.m_hier_pins.delete(aItem as SCH_SHEET_PIN);

    if (aItem.Type() === KICAD_T.SCH_HIER_LABEL_T) this.m_hier_ports.delete(aItem as SCH_HIERLABEL);
  }

  /** Replaces all references to #aOldItem with #aNewItem in the subgraph. */
  ExchangeItem(aOldItem: SCH_ITEM, aNewItem: SCH_ITEM): void {
    this.m_items.delete(aOldItem);
    this.m_items.add(aNewItem);

    this.m_drivers.delete(aOldItem);
    this.m_drivers.add(aNewItem);

    if (aOldItem === this.m_driver) {
      this.m_driver = aNewItem;
      this.m_driver_connection = aNewItem.GetOrInitConnection(this.m_sheet, this.m_graph);
    }

    const old_conn = aOldItem.Connection(this.m_sheet);
    const new_conn = aNewItem.GetOrInitConnection(this.m_sheet, this.m_graph);

    if (old_conn && new_conn) {
      new_conn.Clone(old_conn);

      if (old_conn.IsDriver()) new_conn.SetDriver(aNewItem);

      new_conn.ClearDirty();
    }

    if (aOldItem.Type() === KICAD_T.SCH_SHEET_PIN_T) {
      this.m_hier_pins.delete(aOldItem as SCH_SHEET_PIN);
      this.m_hier_pins.add(aNewItem as SCH_SHEET_PIN);
    }

    if (aOldItem.Type() === KICAD_T.SCH_HIER_LABEL_T) {
      this.m_hier_ports.delete(aOldItem as SCH_HIERLABEL);
      this.m_hier_ports.add(aNewItem as SCH_HIERLABEL);
    }
  }

  // Use this to keep a connection pointer that is not owned by any item
  // This will be destroyed with the subgraph
  StoreImplicitConnection(aConnection: SCH_CONNECTION): SCH_CONNECTION {
    this.m_bus_element_connections.add(aConnection);
    return aConnection;
  }
}

/** `NET_NAME_CODE_CACHE_KEY`: a net's name and code. */
export interface NET_NAME_CODE_CACHE_KEY {
  readonly Name: string;
  readonly Netcode: number;
}

/**
 * `NET_MAP`: associate a #NET_CODE_NAME with all the subgraphs in that net.  The
 * `unordered_map` keyed by the (name, code) pair; iteration is insertion order.
 */
export class NET_MAP {
  private m_map = new Map<string, [NET_NAME_CODE_CACHE_KEY, CONNECTION_SUBGRAPH[]]>();

  private static key(aKey: NET_NAME_CODE_CACHE_KEY): string {
    return `${aKey.Netcode}\u0000${aKey.Name}`;
  }

  /** `operator[]`: the subgraph vector for the key, created empty if absent. */
  at(aKey: NET_NAME_CODE_CACHE_KEY): CONNECTION_SUBGRAPH[] {
    const k = NET_MAP.key(aKey);
    let entry = this.m_map.get(k);

    if (!entry) {
      entry = [{ Name: aKey.Name, Netcode: aKey.Netcode }, []];
      this.m_map.set(k, entry);
    }

    return entry[1];
  }

  get(aKey: NET_NAME_CODE_CACHE_KEY): CONNECTION_SUBGRAPH[] | undefined {
    return this.m_map.get(NET_MAP.key(aKey))?.[1];
  }

  set(aKey: NET_NAME_CODE_CACHE_KEY, aValue: CONNECTION_SUBGRAPH[]): void {
    this.m_map.set(NET_MAP.key(aKey), [{ Name: aKey.Name, Netcode: aKey.Netcode }, aValue]);
  }

  delete(aKey: NET_NAME_CODE_CACHE_KEY): void {
    this.m_map.delete(NET_MAP.key(aKey));
  }

  clear(): void {
    this.m_map.clear();
  }

  get size(): number {
    return this.m_map.size;
  }

  *[Symbol.iterator](): IterableIterator<[NET_NAME_CODE_CACHE_KEY, CONNECTION_SUBGRAPH[]]> {
    for (const entry of this.m_map.values()) yield entry;
  }
}

/**
 * Calculate the connectivity of a schematic and generates netlists.
 */
export class CONNECTION_GRAPH implements SCH_CONNECTION_GRAPH {
  /// All the sheets in the schematic (as long as we don't have partial updates).
  private m_sheetList: SCH_SHEET_PATH[] = [];

  /// All connectable items in the schematic.
  private m_items: SCH_ITEM[] = [];

  /// The owner of all #CONNECTION_SUBGRAPH objects.
  private m_subgraphs: CONNECTION_SUBGRAPH[] = [];

  /// Cache of a subset of #m_subgraphs.
  private m_driver_subgraphs: CONNECTION_SUBGRAPH[] = [];

  /// Cache to lookup subgraphs in #m_driver_subgraphs by sheet path.
  private m_sheet_to_subgraphs_map = new Map<string, CONNECTION_SUBGRAPH[]>();

  private m_global_power_pins: [SCH_SHEET_PATH, SCH_PIN][] = [];

  private m_bus_alias_cache = new Map<string, BUS_ALIAS>();

  private m_net_name_to_code_map = new Map<string, number>();

  private m_bus_name_to_code_map = new Map<string, number>();

  private m_global_label_cache = new Map<string, CONNECTION_SUBGRAPH[]>();

  /// Keyed by the sheet path's key and the local name (a `std::pair` upstream).
  private m_local_label_cache = new Map<string, CONNECTION_SUBGRAPH[]>();

  private m_net_name_to_subgraphs_map = new Map<string, CONNECTION_SUBGRAPH[]>();

  /// Every subgraph referencing the item, one per instantiating sheet path for items on shared
  /// screens.  Removal must purge all of them or a freed item leaves a dangling driver behind.
  private m_item_to_subgraph_map = new Map<SCH_ITEM, CONNECTION_SUBGRAPH[]>();

  private m_net_code_to_subgraphs_map = new NET_MAP();

  private m_last_net_code = 1;
  private m_last_bus_code = 1;
  private m_last_subgraph_code = 1;

  private m_schematic: SCHEMATIC | null; ///< The schematic this graph represents.

  /**
   * `ADVANCED_CFG::m_MinorSchematicGraphSize`: the default (10000) of the advanced config,
   * which is not ported.
   */
  static MinorSchematicGraphSize = 10000;

  constructor(aSchematic: SCHEMATIC | null = null) {
    this.m_schematic = aSchematic;
  }

  private static localLabelKey(aSheet: SCH_SHEET_PATH, aName: string): string {
    return `${sheetKey(aSheet)}\u0000${aName}`;
  }

  Reset(): void {
    for (const subgraph of this.m_subgraphs) {
      /// Only delete subgraphs of which we are the owner
      if (subgraph.m_graph === this) subgraph.m_graph = null;
    }

    this.m_items = [];
    this.m_subgraphs = [];
    this.m_driver_subgraphs = [];
    this.m_sheet_to_subgraphs_map.clear();
    this.m_global_power_pins = [];
    this.m_bus_alias_cache.clear();
    this.m_net_name_to_code_map.clear();
    this.m_bus_name_to_code_map.clear();
    this.m_net_code_to_subgraphs_map.clear();
    this.m_net_name_to_subgraphs_map.clear();
    this.m_item_to_subgraph_map.clear();
    this.m_local_label_cache.clear();
    this.m_global_label_cache.clear();
    this.m_last_net_code = 1;
    this.m_last_bus_code = 1;
    this.m_last_subgraph_code = 1;
  }

  SetSchematic(aSchematic: SCHEMATIC | null): void {
    this.m_schematic = aSchematic;
  }

  SetLastCodes(aOther: CONNECTION_GRAPH): void {
    this.m_last_net_code = aOther.m_last_net_code;
    this.m_last_bus_code = aOther.m_last_bus_code;
    this.m_last_subgraph_code = aOther.m_last_subgraph_code;
  }

  /**
   * Update the connection graph for the given list of sheets.
   *
   * @param aSheetList is the list of possibly modified sheets
   * @param aUnconditional is true if an unconditional full recalculation should be done
   * @param aChangedItemHandler an optional handler to receive any changed items
   */
  Recalculate(
    aSheetList: SCH_SHEET_LIST | readonly SCH_SHEET_PATH[],
    aUnconditional = false,
    aChangedItemHandler: ((aItem: SCH_ITEM) => void) | null = null,
  ): void {
    if (aUnconditional) this.Reset();

    this.m_sheetList = [...aSheetList];
    const dirty_items = new Set<SCH_ITEM>();

    for (const sheet of aSheetList) {
      const items: SCH_ITEM[] = [];

      // Store current unit value, to replace it after calculations
      const symbolsChanged: [SCH_SYMBOL, number][] = [];

      for (const item of sheet.LastScreen()!.Items()) {
        if (item.IsConnectable() && (aUnconditional || item.IsConnectivityDirty())) {
          items.push(item);
          dirty_items.add(item);

          // Add any symbol dirty pins to the dirty_items list
          if (item.Type() === KICAD_T.SCH_SYMBOL_T) {
            const symbol = item as SCH_SYMBOL;

            for (const pin of symbol.GetPins(sheet)) {
              if (pin.IsConnectivityDirty()) dirty_items.add(pin);
            }
          }
        }
        // If the symbol isn't dirty, look at the pins
        // TODO: remove symbols from connectivity graph and only use pins
        else if (item.Type() === KICAD_T.SCH_SYMBOL_T) {
          const symbol = item as SCH_SYMBOL;

          for (const pin of symbol.GetPins(sheet)) {
            if (pin.IsConnectivityDirty()) {
              items.push(pin);
              dirty_items.add(pin);
            }
          }
        } else if (item.Type() === KICAD_T.SCH_SHEET_T) {
          const sheetItem = item as SCH_SHEET;

          for (const pin of sheetItem.GetPins()) {
            if (pin.IsConnectivityDirty()) {
              items.push(pin);
              dirty_items.add(pin);
            }
          }
        }

        // Ensure the hierarchy info stored in the SCH_SCREEN (such as symbol units) reflects
        // the current SCH_SHEET_PATH
        if (item.Type() === KICAD_T.SCH_SYMBOL_T) {
          const symbol = item as SCH_SYMBOL;
          const new_unit = symbol.GetUnitSelection(sheet);

          // Store the initial unit value so we can restore it after calculations
          if (symbol.GetUnit() !== new_unit) symbolsChanged.push([symbol, symbol.GetUnit()]);

          symbol.SetUnit(new_unit);
        }
      }

      this.updateItemConnectivity(sheet, items);

      // UpdateDanglingState() also adds connected items for SCH_TEXT
      sheet.LastScreen()!.TestDanglingEnds(sheet, aChangedItemHandler);

      // Restore the m_unit member variables where we had to change them
      for (const [symbol, originalUnit] of symbolsChanged) symbol.SetUnit(originalUnit);
    }

    // Restore the dangling states of items in the current SCH_SCREEN to match the current
    // SCH_SHEET_PATH.
    const currentScreen = this.m_schematic!.CurrentSheet().LastScreen();

    if (currentScreen)
      currentScreen.TestDanglingEnds(this.m_schematic!.CurrentSheet(), aChangedItemHandler);

    for (const item of dirty_items) item.SetConnectivityDirty(false);

    this.buildConnectionGraph(aChangedItemHandler, aUnconditional);
  }

  /**
   * For a set of items, this will remove the connected items and their
   * associated data including subgraphs and generated codes from the connection graph.
   *
   * @param aItems A vector of items whose presence should be removed from the graph.
   * @return The full set of all items associated with the input items that were removed.
   */
  ExtractAffectedItems(aItems: Iterable<SCH_ITEM>): [SCH_SHEET_PATH, SCH_ITEM][] {
    const retvals = new Map<string, [SCH_SHEET_PATH, SCH_ITEM]>();
    const subgraphs = new Set<CONNECTION_SUBGRAPH>();

    const traverse_subgraph = (aSubgraph: CONNECTION_SUBGRAPH): void => {
      // Find the primary subgraph on this sheet
      while (aSubgraph.m_absorbed_by) aSubgraph = aSubgraph.m_absorbed_by;

      // Find the top most connected subgraph on all sheets
      while (aSubgraph.m_hier_parent) aSubgraph = aSubgraph.m_hier_parent;

      // Recurse through all subsheets to collect connected items
      aSubgraph.getAllConnectedItems(retvals, subgraphs);
    };

    const extract_element = (aItem: SCH_ITEM): void => {
      const item_sg = this.GetSubgraphForItem(aItem);

      if (!item_sg) return;

      item_sg.ResolveDrivers(true);

      let sg_to_scan = [...this.GetAllSubgraphs(item_sg.GetNetName())];

      if (sg_to_scan.length === 0) sg_to_scan = [item_sg];

      for (const sg of sg_to_scan) {
        traverse_subgraph(sg);

        for (const bus_sgs of sg.m_bus_neighbors.values())
          for (const bus_sg of bus_sgs) traverse_subgraph(bus_sg);

        for (const bus_sgs of sg.m_bus_parents.values())
          for (const bus_sg of bus_sgs) traverse_subgraph(bus_sg);
      }

      eraseFrom(this.m_items, aItem);
    };

    for (const item of aItems) {
      if (item.Type() === KICAD_T.SCH_SHEET_T) {
        const sheet = item as SCH_SHEET;

        for (const pin of sheet.GetPins()) extract_element(pin);
      } else if (item.Type() === KICAD_T.SCH_SYMBOL_T) {
        const symbol = item as SCH_SYMBOL;

        for (const pin of symbol.GetPins(this.m_schematic!.CurrentSheet())) extract_element(pin);
      } else {
        extract_element(item);
      }
    }

    this.removeSubgraphs(subgraphs);

    for (const [, item] of retvals.values()) eraseFrom(this.m_items, item);

    return [...retvals.values()];
  }

  /**
   * Combine the input graph contents into the current graph.
   *
   * @warning After merging, the original graph is invalid.
   */
  Merge(aGraph: CONNECTION_GRAPH): void {
    this.m_items.push(...aGraph.m_items);

    for (const item of aGraph.m_items) item.SetConnectionGraph(this);

    this.m_subgraphs.push(...aGraph.m_subgraphs);

    for (const sg of aGraph.m_subgraphs) {
      if (sg.m_driver_connection) sg.m_driver_connection.SetGraph(this);

      sg.m_graph = this;
    }

    this.m_driver_subgraphs.push(...aGraph.m_driver_subgraphs);

    this.m_global_power_pins.push(...aGraph.m_global_power_pins);

    for (const [key, value] of aGraph.m_net_name_to_subgraphs_map)
      this.m_net_name_to_subgraphs_map.set(key, value);

    for (const [key, value] of aGraph.m_sheet_to_subgraphs_map)
      this.m_sheet_to_subgraphs_map.set(key, value);

    for (const [key, value] of aGraph.m_net_name_to_code_map)
      this.m_net_name_to_code_map.set(key, value);

    for (const [key, value] of aGraph.m_bus_name_to_code_map)
      this.m_bus_name_to_code_map.set(key, value);

    for (const [key, value] of aGraph.m_net_code_to_subgraphs_map)
      this.m_net_code_to_subgraphs_map.set(key, value);

    // Union rather than replace.  An incremental pass may only have rebuilt the item on some of
    // its sheet paths, and dropping the surviving subgraphs here would orphan their references
    // to the item so a later removal could no longer find them.
    for (const [key, value] of aGraph.m_item_to_subgraph_map) {
      let existing = this.m_item_to_subgraph_map.get(key);

      if (!existing) {
        existing = [];
        this.m_item_to_subgraph_map.set(key, existing);
      }

      for (const sg of value) if (!existing.includes(sg)) existing.push(sg);
    }

    for (const [key, value] of aGraph.m_local_label_cache) this.m_local_label_cache.set(key, value);

    for (const [key, value] of aGraph.m_global_label_cache)
      this.m_global_label_cache.set(key, value);

    this.m_last_bus_code = Math.max(this.m_last_bus_code, aGraph.m_last_bus_code);
    this.m_last_net_code = Math.max(this.m_last_net_code, aGraph.m_last_net_code);
    this.m_last_subgraph_code = Math.max(this.m_last_subgraph_code, aGraph.m_last_subgraph_code);
  }

  /**
   * Remove references to the given subgraphs from all structures in the connection graph.
   *
   * Upstream sorts `m_driver_subgraphs`, `m_subgraphs` and each sheet's vector by pointer to
   * binary-search them; here each occurrence is erased in place and the order is kept.
   */
  private removeSubgraphs(aSubgraphs: Set<CONNECTION_SUBGRAPH>): void {
    const codes_to_remove = new Set<number>();

    for (const sg of aSubgraphs) {
      for (const [conn, neighbors] of sg.m_bus_neighbors) {
        for (const neighbor of neighbors) {
          const parents = neighbor.m_bus_parents.get(conn);

          if (parents) {
            parents.delete(sg);

            if (parents.size === 0) neighbor.m_bus_parents.delete(conn);
          }
        }
      }

      for (const [conn, parents] of sg.m_bus_parents) {
        for (const parent of parents) {
          const neighbors = parent.m_bus_neighbors.get(conn);

          if (neighbors) {
            neighbors.delete(sg);

            if (neighbors.size === 0) parent.m_bus_neighbors.delete(conn);
          }
        }
      }

      eraseFrom(this.m_driver_subgraphs, sg);
      eraseFrom(this.m_subgraphs, sg);

      for (const vec of this.m_sheet_to_subgraphs_map.values()) eraseFrom(vec, sg);

      const remove_sg = (aVec: readonly CONNECTION_SUBGRAPH[]): boolean => aVec.includes(sg);

      for (const [key, vec] of [...this.m_global_label_cache])
        if (remove_sg(vec)) this.m_global_label_cache.delete(key);

      for (const [key, vec] of [...this.m_local_label_cache])
        if (remove_sg(vec)) this.m_local_label_cache.delete(key);

      for (const [key, vec] of [...this.m_net_code_to_subgraphs_map]) {
        if (remove_sg(vec)) {
          codes_to_remove.add(key.Netcode);
          this.m_net_code_to_subgraphs_map.delete(key);
        }
      }

      for (const [key, vec] of [...this.m_net_name_to_subgraphs_map])
        if (remove_sg(vec)) this.m_net_name_to_subgraphs_map.delete(key);

      for (const [item, vec] of [...this.m_item_to_subgraph_map]) {
        eraseFrom(vec, sg);

        if (vec.length === 0) this.m_item_to_subgraph_map.delete(item);
      }
    }

    for (const [name, code] of [...this.m_net_name_to_code_map])
      if (codes_to_remove.has(code)) this.m_net_name_to_code_map.delete(name);

    for (const [name, code] of [...this.m_bus_name_to_code_map])
      if (codes_to_remove.has(code)) this.m_bus_name_to_code_map.delete(name);

    for (const sg of aSubgraphs) {
      sg.m_code = -1;
      sg.m_graph = null;
    }
  }

  RemoveItem(aItem: SCH_ITEM): void {
    const sgs = this.m_item_to_subgraph_map.get(aItem);

    if (!sgs) return;

    // The item sits in one subgraph per instantiating sheet path, and every one of them must
    // drop it here or a subsequent recalculation resolves drivers against freed memory
    for (let subgraph of sgs) {
      while (subgraph.m_absorbed_by) subgraph = subgraph.m_absorbed_by;

      subgraph.RemoveItem(aItem);
    }

    eraseFrom(this.m_items, aItem);
    this.m_item_to_subgraph_map.delete(aItem);
  }

  /** Replace all references to #aOldItem with #aNewItem in the graph. */
  ExchangeItem(aOldItem: SCH_ITEM, aNewItem: SCH_ITEM): void {
    if (aOldItem.Type() !== aNewItem.Type()) return; // wxCHECK2

    const exchange = (aOld: SCH_ITEM, aNew: SCH_ITEM): void => {
      const sgs = this.m_item_to_subgraph_map.get(aOld);

      if (!sgs) return;

      for (const sg of sgs) sg.ExchangeItem(aOld, aNew);

      this.m_item_to_subgraph_map.delete(aOld);
      // emplace: an existing entry for aNew is kept
      if (!this.m_item_to_subgraph_map.has(aNew)) this.m_item_to_subgraph_map.set(aNew, sgs);

      const idx = this.m_items.indexOf(aOld);

      if (idx >= 0) this.m_items[idx] = aNew;
    };

    exchange(aOldItem, aNewItem);

    if (aOldItem.Type() === KICAD_T.SCH_SYMBOL_T) {
      const oldSymbol = aOldItem as SCH_SYMBOL;
      const newSymbol = aNewItem as SCH_SYMBOL;
      const oldPins = oldSymbol.GetPins(this.m_schematic!.CurrentSheet());
      const newPins = newSymbol.GetPins(this.m_schematic!.CurrentSheet());

      if (oldPins.length !== newPins.length) return; // wxCHECK2

      for (let ii = 0; ii < oldPins.length; ii++) exchange(oldPins[ii]!, newPins[ii]!);
    }
  }

  /**
   * We modify how we handle the connectivity graph for small graphs vs large
   * graphs.  Partially this is to avoid unneeded complexity for small graphs,
   * where the performance of the graph is not a concern.
   */
  IsMinor(): boolean {
    return this.m_items.length < CONNECTION_GRAPH.MinorSchematicGraphSize;
  }

  /**
   * Update the connectivity of a symbol and its pins.
   */
  private updateSymbolConnectivity(
    aSheet: SCH_SHEET_PATH,
    aSymbol: SCH_SYMBOL,
    aConnectionMap: Map<string, [VECTOR2I, SCH_ITEM[]]>,
  ): void {
    const updatePin = (aPin: SCH_PIN, aConn: SCH_CONNECTION): void => {
      aConn.SetType(CONNECTION_TYPE.NET);
      const name = aPin.GetDefaultNetName(aSheet);
      aPin.ClearConnectedItems(aSheet);

      if (aPin.IsGlobalPower()) {
        aConn.SetName(name);
        this.m_global_power_pins.push([aSheet, aPin]);
      }
    };

    // std::map<wxString, …>: walked in key order below
    const pinNumberMap = new Map<string, SCH_PIN[]>();

    for (const pin of aSymbol.GetPins(aSheet)) {
      this.m_items.push(pin);
      const conn = pin.InitializeConnection(aSheet, this);
      updatePin(pin, conn);
      mapPush(aConnectionMap, pin.GetPosition(), pin);
      pushInto(pinNumberMap, pin.GetNumber(), pin);
    }

    const linkPinsInVec = (aVec: readonly SCH_PIN[]): void => {
      for (let i = 0; i < aVec.length; ++i) {
        for (let j = i + 1; j < aVec.length; ++j) {
          aVec[i]!.AddConnectionTo(aSheet, aVec[j]!);
          aVec[j]!.AddConnectionTo(aSheet, aVec[i]!);
        }
      }
    };

    const libSymbol = aSymbol.GetLibSymbolRef();

    if (libSymbol) {
      if (libSymbol.GetDuplicatePinNumbersAreJumpers()) {
        for (const number of [...pinNumberMap.keys()].sort())
          linkPinsInVec(pinNumberMap.get(number)!);
      }

      for (const group of libSymbol.JumperPinGroups()) {
        const pins: SCH_PIN[] = [];

        for (const pinNumber of group) {
          const pin = aSymbol.GetPin(pinNumber);

          if (pin) pins.push(pin);
        }

        linkPinsInVec(pins);
      }
    }
  }

  /**
   * Update the connectivity of a pin and its connections.
   */
  private updatePinConnectivity(aSheet: SCH_SHEET_PATH, aPin: SCH_PIN, aConn: SCH_CONNECTION) {
    aConn.SetType(CONNECTION_TYPE.NET);

    // because calling the first time is not thread-safe
    const name = aPin.GetDefaultNetName(aSheet);
    aPin.ClearConnectedItems(aSheet);

    if (aPin.IsGlobalPower()) {
      aConn.SetName(name);
      this.m_global_power_pins.push([aSheet, aPin]);
    }
  }

  /**
   * Update the connectivity of items that are not pins or symbols.
   */
  private updateGenericItemConnectivity(
    aSheet: SCH_SHEET_PATH,
    aItem: SCH_ITEM,
    aConnectionMap: Map<string, [VECTOR2I, SCH_ITEM[]]>,
  ): void {
    let points = aItem.GetConnectionPoints();
    aItem.ClearConnectedItems(aSheet);

    this.m_items.push(aItem);
    const conn = aItem.InitializeConnection(aSheet, this);

    switch (aItem.Type()) {
      case KICAD_T.SCH_LINE_T:
        conn.SetType(
          aItem.GetLayer() === SCH_LAYER_ID.LAYER_BUS ? CONNECTION_TYPE.BUS : CONNECTION_TYPE.NET,
        );
        break;

      case KICAD_T.SCH_BUS_BUS_ENTRY_T:
        conn.SetType(CONNECTION_TYPE.BUS);
        (aItem as SCH_BUS_BUS_ENTRY).m_connected_bus_items[0] = null;
        (aItem as SCH_BUS_BUS_ENTRY).m_connected_bus_items[1] = null;
        break;

      case KICAD_T.SCH_PIN_T:
        if (points.length === 0) points = [(aItem as SCH_PIN).GetPosition()];

        this.updatePinConnectivity(aSheet, aItem as SCH_PIN, conn);
        break;

      case KICAD_T.SCH_BUS_WIRE_ENTRY_T:
        conn.SetType(CONNECTION_TYPE.NET);
        (aItem as SCH_BUS_WIRE_ENTRY).m_connected_bus_item = null;
        break;

      default:
        break;
    }

    for (const point of points) mapPush(aConnectionMap, point, aItem);
  }

  /**
   * Update the graphical connectivity between items (i.e. where they touch)
   * The items passed in must be on the same sheet.
   *
   * In the first phase, all items in aItemList have their connections
   * initialized for the given sheet (since they may have connections on more
   * than one sheet, and each needs to be calculated individually).  The
   * graphical connection points for the item are added to a map that stores
   * (x, y) -> [list of items].
   *
   * Any item that is stored in the list of items that have a connection point
   * at a given (x, y) location will eventually be electrically connected.
   * This means that we can't store SCH_SYMBOLs in this map -- we must store
   * a structure that links a specific pin on a symbol back to that symbol: a
   * SCH_PIN_CONNECTION.  This wrapper class is a convenience for linking a pin
   * and symbol to a specific (x, y) point.
   *
   * In the second phase, we iterate over each value in the map, which is a
   * vector of items that have overlapping connection points.  After some
   * checks to ensure that the items should actually connect, the items are
   * linked together using ConnectedItems().
   *
   * As a side effect, items are loaded into m_items for BuildConnectionGraph().
   */
  private updateItemConnectivity(aSheet: SCH_SHEET_PATH, aItemList: readonly SCH_ITEM[]): void {
    const connection_map = new Map<string, [VECTOR2I, SCH_ITEM[]]>();

    for (const item of aItemList) {
      item.GetConnectionPoints();
      item.ClearConnectedItems(aSheet);

      if (item.Type() === KICAD_T.SCH_SHEET_T) {
        for (const pin of (item as SCH_SHEET).GetPins()) {
          pin.InitializeConnection(aSheet, this);

          pin.ClearConnectedItems(aSheet);

          mapPush(connection_map, pin.GetTextPos(), pin);
          this.m_items.push(pin);
        }
      } else if (item.Type() === KICAD_T.SCH_SYMBOL_T) {
        this.updateSymbolConnectivity(aSheet, item as SCH_SYMBOL, connection_map);
      } else {
        this.updateGenericItemConnectivity(aSheet, item, connection_map);

        /// Special case for labels that overlap wires
        /// While this is an ERC error as there is not an explicit junction,
        /// we want to enforce connectivity for all items under the label position.
        if (item instanceof SCH_LABEL_BASE) {
          const point = item.GetPosition();
          const screen = aSheet.LastScreen()!;
          // Overlapping( point ) filtered to lines: asked of the lines directly (same answer).
          const items = screen.Items().Overlapping(KICAD_T.SCH_LINE_T, point);
          const overlapping_items = items.filter(
            (test_item) => test_item.Type() === KICAD_T.SCH_LINE_T && test_item.HitTest(point, -1),
          );

          // We need at least two connnectable lines that are not the label here
          // Otherwise, the label will be normally assigned to one or the other
          if (overlapping_items.length < 2) continue;

          for (const test_item of overlapping_items) mapPush(connection_map, point, test_item);
        }

        // Junctions connect wires that pass through their position as midpoints.
        // This handles schematics where a wire was not split at a junction point,
        // which can happen when a wire is placed over an existing junction without
        // the schematic topology being updated.
        if (item.Type() === KICAD_T.SCH_JUNCTION_T) {
          const point = item.GetPosition();
          const screen = aSheet.LastScreen()!;

          for (const wire of screen.GetBusesAndWires(point, true))
            mapPush(connection_map, point, wire);
        }
      }
    }

    // std::map<VECTOR2I, …> iterates in std::less<VECTOR2I> order: x, then y.
    const entries = [...connection_map.values()].sort(([a], [b]) =>
      a.x !== b.x ? a.x - b.x : a.y - b.y,
    );

    for (const [point, rawVec] of entries) {
      // std::sort by pointer + alg::remove_duplicates: the first occurrence is kept here.
      const connection_vec = [...new Set(rawVec)];

      // Pre-scan to see if we have a bus at this location
      const busLine = aSheet.LastScreen()!.GetBus(point);

      for (const connected_item of connection_vec) {
        // Bus entries are special: they can have connection points in the
        // middle of a wire segment, because the junction algo doesn't split
        // the segment in two where you place a bus entry.  This means that
        // bus entries that don't land on the end of a line segment need to
        // have "virtual" connection points to the segments they graphically
        // touch.
        if (connected_item.Type() === KICAD_T.SCH_BUS_WIRE_ENTRY_T) {
          // If this location only has the connection point of the bus
          // entry itself, this means that either the bus entry is not
          // connected to anything graphically, or that it is connected to
          // a segment at some point other than at one of the endpoints.
          if (connection_vec.length === 1) {
            if (busLine) {
              const bus_entry = connected_item as SCH_BUS_WIRE_ENTRY;
              bus_entry.m_connected_bus_item = busLine;
            }
          }
        }
        // Bus-to-bus entries are treated just like bus wires
        else if (connected_item.Type() === KICAD_T.SCH_BUS_BUS_ENTRY_T) {
          if (busLine) {
            const bus_entry = connected_item as SCH_BUS_BUS_ENTRY;

            if (samePt(point, bus_entry.GetPosition()))
              bus_entry.m_connected_bus_items[0] = busLine;
            else bus_entry.m_connected_bus_items[1] = busLine;

            bus_entry.AddConnectionTo(aSheet, busLine);
            busLine.AddConnectionTo(aSheet, bus_entry);
            continue;
          }
        }
        // Change junctions to be on bus junction layer if they are touching a bus
        else if (connected_item.Type() === KICAD_T.SCH_JUNCTION_T) {
          connected_item.SetLayer(
            busLine ? SCH_LAYER_ID.LAYER_BUS_JUNCTION : SCH_LAYER_ID.LAYER_JUNCTION,
          );
        }

        for (const test_item of connection_vec) {
          let bus_connection_ok = true;

          if (test_item === connected_item) continue;

          // Set up the link between the bus entry net and the bus
          if (connected_item.Type() === KICAD_T.SCH_BUS_WIRE_ENTRY_T) {
            if (test_item.GetLayer() === SCH_LAYER_ID.LAYER_BUS) {
              const bus_entry = connected_item as SCH_BUS_WIRE_ENTRY;
              bus_entry.m_connected_bus_item = test_item;
            }
          }

          // Bus entries only connect to bus lines on the end that is touching a bus line.
          // If the user has overlapped another net line with the endpoint of the bus entry
          // where the entry connects to a bus, we don't want to short-circuit it.
          if (connected_item.Type() === KICAD_T.SCH_BUS_WIRE_ENTRY_T) {
            bus_connection_ok = !busLine || test_item.GetLayer() === SCH_LAYER_ID.LAYER_BUS;
          } else if (test_item.Type() === KICAD_T.SCH_BUS_WIRE_ENTRY_T) {
            bus_connection_ok = !busLine || connected_item.GetLayer() === SCH_LAYER_ID.LAYER_BUS;
          }

          if (
            connected_item.ConnectionPropagatesTo(test_item) &&
            test_item.ConnectionPropagatesTo(connected_item) &&
            bus_connection_ok
          ) {
            connected_item.AddConnectionTo(aSheet, test_item);
          }
        }

        // If we got this far and did not find a connected bus item for a bus entry,
        // we should do a manual scan in case there is a bus item on this connection
        // point but we didn't pick it up earlier because there is *also* a net item here.
        if (connected_item.Type() === KICAD_T.SCH_BUS_WIRE_ENTRY_T) {
          const bus_entry = connected_item as SCH_BUS_WIRE_ENTRY;

          if (!bus_entry.m_connected_bus_item) {
            const screen = aSheet.LastScreen()!;
            const bus = screen.GetBus(point);

            if (bus) bus_entry.m_connected_bus_item = bus;
          }
        }
      }
    }
  }

  /**
   * Generate the connection graph (after all item connectivity has been updated).
   *
   * In the first phase, the algorithm iterates over all items, and then over
   * all items that are connected (graphically) to each item, placing them into
   * CONNECTION_SUBGRAPHs.  Items that can potentially drive connectivity (i.e.
   * labels, pins, etc.) are added to the m_drivers vector of the subgraph.
   *
   * In the second phase, each subgraph is resolved.  To resolve a subgraph,
   * the driver is first selected by CONNECTION_SUBGRAPH::ResolveDrivers(),
   * and then the connection for the chosen driver is propagated to all the
   * other items in the subgraph.
   */
  private buildItemSubGraphs(): void {
    // Recache all bus aliases for later use
    if (!this.m_schematic) return; // wxCHECK_RET

    this.m_bus_alias_cache.clear();

    for (const alias of this.m_schematic.GetAllBusAliases()) {
      if (alias) this.m_bus_alias_cache.set(alias.GetName(), alias);
    }

    // Hash position in m_sheetList for each sheet path so that subgraphs are
    // created in a deterministic order matching the sheet hierarchy
    // https://gitlab.com/kicad/code/kicad/-/issues/24409
    const sheetOrder = new Map<string, number>();

    for (let i = 0; i < this.m_sheetList.length; ++i) {
      const key = sheetKey(this.m_sheetList[i]!);

      // unordered_map::emplace keeps the first
      if (!sheetOrder.has(key)) sheetOrder.set(key, i);
    }

    const sheetRank = (aKey: string): number => sheetOrder.get(aKey) ?? Number.MAX_SAFE_INTEGER;

    // Build subgraphs from items (on a per-sheet basis).
    for (const item of this.m_items) {
      const ordered: [number, SCH_CONNECTION][] = [];

      for (const [key, connection] of item.ConnectionMap())
        ordered.push([sheetRank(key), connection]);

      ordered.sort((a, b) => a[0] - b[0]);

      for (const [, connection] of ordered) {
        // The map key's sheet: SetSheet (InitializeConnection) set it, Clone never touches it.
        const sheet = connection.LocalSheet();

        if (connection.SubgraphCode() === 0) {
          const subgraph = new CONNECTION_SUBGRAPH(this);

          subgraph.m_code = this.m_last_subgraph_code++;
          subgraph.m_sheet = sheet;

          subgraph.AddItem(item);

          connection.SetSubgraphCode(subgraph.m_code);
          pushInto(this.m_item_to_subgraph_map, item, subgraph);

          const memberlist: SCH_ITEM[] = [];

          const get_items = (aItem: SCH_ITEM): boolean => {
            const conn = aItem.GetOrInitConnection(sheet, this);
            const unique = !(aItem.GetFlags() & CONNECTIVITY_CANDIDATE);

            if (conn && !conn.SubgraphCode()) aItem.SetFlags(CONNECTIVITY_CANDIDATE);

            return unique && !!conn && conn.SubgraphCode() === 0;
          };

          for (const c of item.ConnectedItems(sheet)) if (get_items(c)) memberlist.push(c);

          // std::list: items appended while walking are visited too
          for (let m = 0; m < memberlist.length; m++) {
            const connected_item = memberlist[m]!;

            if (connected_item.Type() === KICAD_T.SCH_NO_CONNECT_T)
              subgraph.m_no_connect = connected_item;

            const connected_conn = connected_item.Connection(sheet);

            if (!connected_conn) continue; // wxCHECK2

            if (connected_conn.SubgraphCode() === 0) {
              connected_conn.SetSubgraphCode(subgraph.m_code);
              pushInto(this.m_item_to_subgraph_map, connected_item, subgraph);
              subgraph.AddItem(connected_item);
              const citemset = connected_item.ConnectedItems(sheet);

              for (const citem of citemset) {
                if (citem.HasFlag(CONNECTIVITY_CANDIDATE)) continue;

                if (get_items(citem)) memberlist.push(citem);
              }
            }
          }

          for (const connected_item of memberlist)
            connected_item.ClearFlags(CONNECTIVITY_CANDIDATE);

          subgraph.m_dirty = true;
          this.m_subgraphs.push(subgraph);
        }
      }
    }
  }

  /**
   * Find all subgraphs in the connection graph and calls ResolveDrivers() in parallel.
   */
  private resolveAllDrivers(): void {
    // Resolve drivers for subgraphs and propagate connectivity info
    const dirty_graphs = this.m_subgraphs.filter((candidate) => candidate.m_dirty);

    const update_lambda = (subgraph: CONNECTION_SUBGRAPH): number => {
      if (!subgraph.m_dirty) return 0;

      // Special processing for some items
      for (const item of subgraph.m_items) {
        switch (item.Type()) {
          case KICAD_T.SCH_NO_CONNECT_T:
            subgraph.m_no_connect = item;
            break;

          case KICAD_T.SCH_BUS_WIRE_ENTRY_T:
            subgraph.m_bus_entry = item;
            break;

          case KICAD_T.SCH_PIN_T: {
            const pin = item as SCH_PIN;

            if (pin.GetType() === ELECTRICAL_PINTYPE.PT_NC) subgraph.m_no_connect = item;

            break;
          }

          default:
            break;
        }
      }

      subgraph.ResolveDrivers(true);
      subgraph.m_dirty = false;

      return 1;
    };

    for (const sg of dirty_graphs) update_lambda(sg);

    // Now discard any non-driven subgraphs from further consideration

    for (const candidate of this.m_subgraphs)
      if (candidate.m_driver) this.m_driver_subgraphs.push(candidate);
  }

  /**
   * Map the driver values for each subgraph.
   */
  private collectAllDriverValues(): void {
    // Check for subgraphs with the same net name but only weak drivers.
    // For example, two wires that are both connected to hierarchical
    // sheet pins that happen to have the same name, but are not the same.

    for (const subgraph of this.m_driver_subgraphs) {
      const full_name = subgraph.m_driver_connection!.Name();
      const name = subgraph.m_driver_connection!.Name(true);
      pushInto(this.m_net_name_to_subgraphs_map, full_name, subgraph);

      // For vector buses, we need to cache the prefix also, as two different instances of the
      // weakly driven pin may have the same prefix but different vector start and end.  We need
      // to treat those as needing renaming also, because otherwise if they end up on a sheet with
      // common usage, they will be incorrectly merged.
      if (subgraph.m_driver_connection!.Type() === CONNECTION_TYPE.BUS) {
        const prefixOnly = `${beforeFirst(full_name, '[')}[]`;
        pushInto(this.m_net_name_to_subgraphs_map, prefixOnly, subgraph);
      }

      subgraph.m_dirty = true;

      if (subgraph.m_strong_driver) {
        const driver = subgraph.m_driver!;
        const sheet = subgraph.m_sheet;

        switch (driver.Type()) {
          case KICAD_T.SCH_LABEL_T:
          case KICAD_T.SCH_HIER_LABEL_T: {
            pushInto(
              this.m_local_label_cache,
              CONNECTION_GRAPH.localLabelKey(sheet, name),
              subgraph,
            );
            break;
          }
          case KICAD_T.SCH_GLOBAL_LABEL_T: {
            pushInto(this.m_global_label_cache, name, subgraph);
            break;
          }
          case KICAD_T.SCH_PIN_T: {
            const pin = driver as SCH_PIN;
            if (pin.IsGlobalPower()) {
              pushInto(this.m_global_label_cache, name, subgraph);
            } else if (pin.IsLocalPower()) {
              pushInto(
                this.m_local_label_cache,
                CONNECTION_GRAPH.localLabelKey(sheet, name),
                subgraph,
              );
            } else {
              // wxLogTrace: "Unexpected normal pin"
            }

            break;
          }
          default: {
            // wxLogTrace: "Unexpected strong driver"
            break;
          }
        }
      }
    }
  }

  /**
   * Iterate through labels to create placeholders for bus elements.
   */
  private generateBusAliasMembers(): void {
    const new_subgraphs: CONNECTION_SUBGRAPH[] = [];

    for (const subgraph of this.m_driver_subgraphs) {
      const vec = subgraph.GetAllBusLabels();

      for (const item of vec) {
        const label = item as SCH_LABEL_BASE;

        const dummy = new SCH_CONNECTION(item, subgraph.m_sheet);
        dummy.SetGraph(this);
        dummy.ConfigureFromLabel(label.GetShownText(subgraph.m_sheet, false));

        for (const conn of dummy.Members()) {
          // Only create subgraphs for NET members, not nested buses
          if (!conn.IsNet()) continue;

          const name = conn.FullLocalName();

          const new_sg = new CONNECTION_SUBGRAPH(this);

          // This connection cannot form a part of the item because the item is not, itself
          // connected to this subgraph.  It exists as part of a virtual item that may be
          // connected to other items but is not in the schematic.
          const new_conn = new SCH_CONNECTION(item, subgraph.m_sheet);
          new_conn.SetGraph(this);
          new_conn.SetName(name);
          new_conn.SetType(CONNECTION_TYPE.NET);

          const new_conn_ptr = subgraph.StoreImplicitConnection(new_conn);
          const code = this.assignNewNetCode(new_conn_ptr);

          new_sg.m_driver_connection = new_conn_ptr;
          new_sg.m_code = this.m_last_subgraph_code++;
          new_sg.m_sheet = subgraph.GetSheet();
          new_sg.m_is_bus_member = true;
          new_sg.m_strong_driver = true;

          /// Need to figure out why these sgs are not getting connected to their bus parents
          const key: NET_NAME_CODE_CACHE_KEY = { Name: new_sg.GetNetName(), Netcode: code };
          this.m_net_code_to_subgraphs_map.at(key).push(new_sg);
          pushInto(this.m_net_name_to_subgraphs_map, name, new_sg);
          this.m_subgraphs.push(new_sg);
          new_subgraphs.push(new_sg);
        }
      }
    }

    this.m_driver_subgraphs.push(...new_subgraphs);
  }

  /**
   * Iterate through the global power pins to collect the global labels as drivers.
   */
  private generateGlobalPowerPinSubGraphs(): void {
    // Generate subgraphs for global power pins.  These will be merged with other subgraphs
    // on the same sheet in the next loop.
    // These are NOT limited to power symbols, we support legacy invisible + power-in pins
    // on non-power symbols.

    // Sort power pins for deterministic processing order. This ensures that when multiple
    // power pins share the same net name, the same pin consistently creates the subgraph
    // across different ERC runs.
    const cmp = (a: [SCH_SHEET_PATH, SCH_PIN], b: [SCH_SHEET_PATH, SCH_PIN]): number => {
      const pathCmp = a[0].Cmp(b[0]);

      if (pathCmp !== 0) return pathCmp < 0 ? -1 : 1;

      const symA = a[1].GetParentSymbol() as unknown as SCH_SYMBOL | null;
      const symB = b[1].GetParentSymbol() as unknown as SCH_SYMBOL | null;

      const refA = symA ? symA.GetRef(a[0], false) : '';
      const refB = symB ? symB.GetRef(b[0], false) : '';

      if (refA !== refB) return refA < refB ? -1 : 1;

      const na = a[1].GetNumber();
      const nb = b[1].GetNumber();
      return na < nb ? -1 : na > nb ? 1 : 0;
    };

    this.m_global_power_pins.sort(cmp);

    const global_power_pin_subgraphs = new Map<number, CONNECTION_SUBGRAPH>();

    for (const [sheet, pin] of this.m_global_power_pins) {
      const libParent = pin.GetLibPin() ? pin.GetLibPin()!.GetParentSymbol() : null;

      if (pin.ConnectedItems(sheet).length > 0 && (!libParent || !libParent.IsGlobalPower())) {
        // ERC will warn about this: user has wired up an invisible pin
        continue;
      }

      const connection = pin.GetOrInitConnection(sheet, this);

      // If this pin already has a subgraph, don't need to process
      if (!connection || connection.SubgraphCode() > 0) continue;

      // Proper modern power symbols get their net name from the value field
      // in the symbol, but we support legacy non-power symbols with global
      // power connections based on invisible, power-in, pin's names.
      if (libParent && libParent.IsGlobalPower())
        connection.SetName(pin.GetParentSymbol()!.GetValue(true, sheet, false));
      else connection.SetName(pin.GetShownName());

      const code = this.assignNewNetCode(connection);

      connection.SetNetCode(code);

      let subgraph: CONNECTION_SUBGRAPH;
      const jj = global_power_pin_subgraphs.get(code);

      if (jj) {
        subgraph = jj;
        subgraph.AddItem(pin);
      } else {
        subgraph = new CONNECTION_SUBGRAPH(this);

        subgraph.m_code = this.m_last_subgraph_code++;
        subgraph.m_sheet = sheet;

        subgraph.AddItem(pin);
        subgraph.ResolveDrivers();

        const key: NET_NAME_CODE_CACHE_KEY = { Name: subgraph.GetNetName(), Netcode: code };
        this.m_net_code_to_subgraphs_map.at(key).push(subgraph);
        this.m_subgraphs.push(subgraph);
        this.m_driver_subgraphs.push(subgraph);

        global_power_pin_subgraphs.set(code, subgraph);
      }

      connection.SetSubgraphCode(subgraph.m_code);
    }
  }

  /**
   * Process all subgraphs to assign netcodes and merge subgraphs based on labels.
   */
  private processSubGraphs(): void {
    // Here we do all the local (sheet) processing of each subgraph, including assigning net
    // codes, merging subgraphs together that use label connections, etc.

    // Cache remaining valid subgraphs by sheet path
    for (const subgraph of this.m_driver_subgraphs)
      pushInto(this.m_sheet_to_subgraphs_map, sheetKey(subgraph.m_sheet), subgraph);

    const invalidated_subgraphs = new Set<CONNECTION_SUBGRAPH>();

    for (const subgraph of this.m_driver_subgraphs) {
      if (subgraph.m_absorbed) continue;

      const connection = subgraph.m_driver_connection!;
      const sheet = subgraph.m_sheet;
      let name = connection.Name();

      // Test subgraphs with weak drivers for net name conflicts and fix them
      let suffix = 1;

      const base_name = connection.Name();

      const create_new_name = (aConn: SCH_CONNECTION): string => {
        const suffixStr = String(suffix);

        // For group buses with a prefix, we can add the suffix to the prefix.
        // If they don't have a prefix, we force the creation of a prefix so that
        // two buses don't get inadvertently shorted together.
        if (aConn.Type() === CONNECTION_TYPE.BUS_GROUP) {
          let prefix = aConn.BusPrefix();

          if (prefix.length === 0) prefix = 'BUS'; // So result will be "BUS_1{...}"

          // Use BusPrefix length to skip past any formatting markers
          // in the prefix (e.g. ~{RESET}) rather than AfterFirst('{')
          // which would split at a formatting brace.
          const members = base_name.slice(aConn.BusPrefix().length);

          const newName = `${prefix}_${suffixStr}${members}`;

          aConn.ConfigureFromLabel(newName);
        } else {
          // Reset to the unsuffixed base so retries generate base_1, base_2, ...
          // instead of stacking suffixes onto the previous attempt.
          aConn.SetSuffix(`_${suffixStr}`);
        }

        suffix++;
        return aConn.Name();
      };

      // Promote a weakly-driven sheet-pin subgraph to a strong driver so that it is considered
      // below for propagation/merging.  A sheet pin sharing its (path-less) name with a global
      // label on the same sheet would then be treated as if it had a matching local label, so we
      // skip the promotion in that case to avoid a false merge.
      const promote_sheet_pin_driver = (): void => {
        if (!subgraph.m_driver || subgraph.m_driver.Type() !== KICAD_T.SCH_SHEET_PIN_T) return;

        const global_name = connection.Name(true);
        const kk = this.m_net_name_to_subgraphs_map.get(global_name);

        if (kk) {
          for (const candidate of kk) {
            if (candidate.m_sheet.equals(sheet)) return;
          }
        }

        subgraph.m_strong_driver = true;
      };

      if (!subgraph.m_strong_driver) {
        let vec: CONNECTION_SUBGRAPH[] = this.m_net_name_to_subgraphs_map.get(name) ?? [];

        // If we are a unique bus vector, check if we aren't actually unique because of another
        // subgraph with a similar bus vector
        if (vec.length <= 1 && subgraph.m_driver_connection!.Type() === CONNECTION_TYPE.BUS) {
          const prefixOnly = `${beforeFirst(name, '[')}[]`;
          const prefixVec = this.m_net_name_to_subgraphs_map.get(prefixOnly);

          if (prefixVec) vec = prefixVec;
        }

        if (vec.length > 1) {
          let new_name = create_new_name(connection);

          while (this.m_net_name_to_subgraphs_map.has(new_name))
            new_name = create_new_name(connection);

          eraseFrom(vec, subgraph);

          pushInto(this.m_net_name_to_subgraphs_map, new_name, subgraph);

          name = new_name;

          // The renamed sheet pin still drives its own bus members through the hierarchy, so
          // it must be promoted for propagation to reach them (issue #21798).
          promote_sheet_pin_driver();
        } else if (subgraph.m_driver) {
          promote_sheet_pin_driver();
        }
      }

      // Assign net codes
      if (connection.IsBus()) {
        let code = -1;
        const it = this.m_bus_name_to_code_map.get(name);

        if (it !== undefined) {
          code = it;
        } else {
          code = this.m_last_bus_code++;
          this.m_bus_name_to_code_map.set(name, code);
        }

        connection.SetBusCode(code);
        this.assignNetCodesToBus(connection);
      } else {
        this.assignNewNetCode(connection);
      }

      // Reset the flag for the next loop below
      subgraph.m_dirty = true;

      // Next, we merge together subgraphs that have label connections, and create
      // neighbor links for subgraphs that are part of a bus on the same sheet.
      // For merging, we consider each possible strong driver.

      // If this subgraph doesn't have a strong driver, let's skip it, since there is no
      // way it will be merged with anything.
      if (!subgraph.m_strong_driver) continue;

      // candidate_subgraphs will contain each valid, non-bus subgraph on the same sheet
      // as the subgraph we are considering that has a strong driver.
      // Weakly driven subgraphs are not considered since they will never be absorbed or
      // form neighbor links.
      const sameSheet = this.m_sheet_to_subgraphs_map.get(sheetKey(subgraph.m_sheet)) ?? [];
      const candidate_subgraphs = sameSheet.filter(
        (candidate) => !candidate.m_absorbed && candidate.m_strong_driver && candidate !== subgraph,
      );

      // This is a list of connections on the current subgraph to compare to the
      // drivers of each candidate subgraph.  If the current subgraph is a bus,
      // we should consider each bus member.
      const connections_to_check: SCH_CONNECTION[] = [];

      // Also check the main driving connection
      connections_to_check.push(SCH_CONNECTION.copyOf(connection));

      const add_connections_to_check = (aSubgraph: CONNECTION_SUBGRAPH): void => {
        for (const possible_driver of aSubgraph.m_items) {
          if (possible_driver === aSubgraph.m_driver) continue;

          const c = this.getDefaultConnection(possible_driver, aSubgraph);

          if (c) {
            if (c.Type() !== aSubgraph.m_driver_connection!.Type()) continue;

            if (c.Name(true) === aSubgraph.m_driver_connection!.Name(true)) continue;

            connections_to_check.push(c);
          }
        }
      };

      // Now add other strong drivers
      // The actual connection attached to these items will have been overwritten
      // by the chosen driver of the subgraph, so we need to create a dummy connection
      add_connections_to_check(subgraph);

      const checked_connections = new Set<SCH_CONNECTION>();

      for (let i = 0; i < connections_to_check.length; i++) {
        const member = connections_to_check[i]!;

        // Don't check the same connection twice
        if (checked_connections.has(member)) continue;

        checked_connections.add(member);

        if (member.IsBus()) connections_to_check.push(...member.Members());

        const test_name = member.Name(true);

        for (const candidate of candidate_subgraphs) {
          if (candidate.m_absorbed || candidate === subgraph) continue;

          let match = false;

          if (candidate.m_driver_connection!.Name(true) === test_name) {
            match = true;
          } else {
            if (!candidate.m_multiple_drivers) continue;

            for (const driver of candidate.m_drivers) {
              if (driver === candidate.m_driver) continue;

              // Sheet pins are not candidates for merging
              if (driver.Type() === KICAD_T.SCH_SHEET_PIN_T) continue;

              if (driver.Type() === KICAD_T.SCH_PIN_T) {
                const pin = driver as SCH_PIN;

                if (pin.IsPower() && pin.GetDefaultNetName(sheet) === test_name) {
                  match = true;
                  break;
                }
              } else {
                // Should we skip this if the driver type is not one of these types?
                if (subgraph.GetNameForDriver(driver) === test_name) {
                  match = true;
                  break;
                }
              }
            }
          }

          if (match) {
            if (connection.IsBus() && candidate.m_driver_connection!.IsNet()) {
              setInsert(subgraph.m_bus_neighbors, member, candidate);
              setInsert(candidate.m_bus_parents, member, subgraph);
            } else if (
              (!connection.IsBus() && !candidate.m_driver_connection!.IsBus()) ||
              connection.Type() === candidate.m_driver_connection!.Type()
            ) {
              // Candidate may have other non-chosen drivers we need to follow
              add_connections_to_check(candidate);

              subgraph.Absorb(candidate);
              invalidated_subgraphs.add(subgraph);
            }
          }
        }
      }
    }

    // Update any subgraph that was invalidated above
    for (const subgraph of invalidated_subgraphs) {
      if (subgraph.m_absorbed) continue;

      if (!subgraph.ResolveDrivers()) continue;

      if (subgraph.m_driver_connection!.IsBus())
        this.assignNetCodesToBus(subgraph.m_driver_connection!);
      else this.assignNewNetCode(subgraph.m_driver_connection!);
    }
  }

  /**
   * Generate the connection graph (after all item connectivity has been updated).
   *
   * If the unconitional flag is set, all existing net classes will be removed
   * and re-created.  Otherwise, we will preserve existing net classes that do not
   * conflict with the new net classes.
   */
  private buildConnectionGraph(
    aChangedItemHandler: ((aItem: SCH_ITEM) => void) | null,
    aUnconditional: boolean,
  ): void {
    // Recache all bus aliases for later use
    if (!this.m_schematic) return; // wxCHECK_RET

    this.m_bus_alias_cache.clear();

    for (const alias of this.m_schematic.GetAllBusAliases()) {
      if (alias) this.m_bus_alias_cache.set(alias.GetName(), alias);
    }

    this.buildItemSubGraphs();

    /**
     * TODO(JE): Net codes are non-deterministic.  Fortunately, they are also not really used for
     * anything. We should consider removing them entirely and just using net names everywhere.
     */

    this.resolveAllDrivers();

    this.collectAllDriverValues();

    this.generateGlobalPowerPinSubGraphs();

    this.generateBusAliasMembers();

    this.processSubGraphs();

    // Absorbed subgraphs should no longer be considered
    this.m_driver_subgraphs = this.m_driver_subgraphs.filter((candidate) => !candidate.m_absorbed);

    // Store global subgraphs for later reference
    const global_subgraphs = this.m_driver_subgraphs.filter(
      (candidate) => !candidate.m_local_driver,
    );

    // Recache remaining valid subgraphs by sheet path
    this.m_sheet_to_subgraphs_map.clear();

    for (const subgraph of this.m_driver_subgraphs)
      pushInto(this.m_sheet_to_subgraphs_map, sheetKey(subgraph.m_sheet), subgraph);

    for (const sg of this.m_driver_subgraphs) sg.UpdateItemConnections();

    // Build equivalence classes over global subgraphs that are linked by shared
    // global label names. Two global subgraphs are in the same class whenever
    // (transitively) some subgraph has a global driver named X and another
    // subgraph has a global driver also named X, OR a single multi-driver
    // subgraph has both X and Y as global drivers.
    //
    // This is the transitive closure over the relation "shares a global name".
    // When users chain nets across sheets via differently-named global labels,
    // every subgraph reachable through any sequence of shared names must end
    // up on the same final net.
    //
    // The per-subgraph promote pass that follows is order-dependent and walks
    // candidates by their *original* driver text rather than by their already-
    // promoted name. As a result, when subgraph S2 promotes subgraph S1 to a
    // new name, and then a third subgraph S3 later renames S2 again, S1 is
    // left orphaned with the intermediate name. This pre-pass solves the
    // transitivity problem before the order-dependent loop runs (issue 23719).
    if (global_subgraphs.length > 0) {
      const sg_root = new Map<CONNECTION_SUBGRAPH, CONNECTION_SUBGRAPH>();

      const find_sg_root = (aSg: CONNECTION_SUBGRAPH): CONNECTION_SUBGRAPH => {
        let cur = aSg;

        while (true) {
          const it = sg_root.get(cur);

          if (it === undefined || it === cur) return cur;

          // Path compression. Hop the current node directly to its
          // grandparent on the way up so subsequent finds are O(1).
          const parent_it = sg_root.get(it);

          if (parent_it !== undefined && parent_it !== it) sg_root.set(cur, parent_it);

          cur = sg_root.get(cur)!;
        }
      };

      // Pick the subgraph whose primary driver CONNECTION_SUBGRAPH::ResolveDrivers
      // would have preferred as the representative for the equivalence class.
      // Higher driver priority wins; ties broken by alphabetically lower current
      // primary name (matching ResolveDrivers' candidate_cmp tie-break).
      const prefer_as_representative = (
        aA: CONNECTION_SUBGRAPH,
        aB: CONNECTION_SUBGRAPH,
      ): boolean => {
        const pa = CONNECTION_SUBGRAPH.GetDriverPriority(aA.m_driver);
        const pb = CONNECTION_SUBGRAPH.GetDriverPriority(aB.m_driver);

        if (pa !== pb) return pa > pb;

        return lessStr(aA.m_driver_connection!.Name(), aB.m_driver_connection!.Name());
      };

      const union_sgs = (aA: CONNECTION_SUBGRAPH, aB: CONNECTION_SUBGRAPH): void => {
        if (!sg_root.has(aA)) sg_root.set(aA, aA);
        if (!sg_root.has(aB)) sg_root.set(aB, aB);

        const root_a = find_sg_root(aA);
        const root_b = find_sg_root(aB);

        if (root_a === root_b) return;

        if (prefer_as_representative(root_a, root_b)) sg_root.set(root_b, root_a);
        else sg_root.set(root_a, root_b);
      };

      const name_to_sgs = new Map<string, CONNECTION_SUBGRAPH[]>();

      for (const subgraph of global_subgraphs) {
        for (const driver of subgraph.m_drivers) {
          if (
            CONNECTION_SUBGRAPH.GetDriverPriority(driver) <
            CONNECTION_SUBGRAPH.PRIORITY.GLOBAL_POWER_PIN
          ) {
            continue;
          }

          pushInto(name_to_sgs, subgraph.GetNameForDriver(driver), subgraph);
        }
      }

      for (const sgs of name_to_sgs.values()) {
        if (sgs.length < 2) continue;

        for (let ii = 1; ii < sgs.length; ++ii) union_sgs(sgs[0]!, sgs[ii]!);
      }

      // Every subgraph in sg_root now maps (with path compression) to the
      // representative of its equivalence class. Clone the representative's
      // connection into each member that currently differs.
      for (const sg of [...sg_root.keys()]) {
        const root = find_sg_root(sg);

        if (sg === root) continue;

        if (sg.m_driver_connection!.Name() === root.m_driver_connection!.Name()) continue;

        sg.m_driver_connection!.Clone(root.m_driver_connection!);
      }
    }

    // Next time through the subgraphs, we do some post-processing to handle things like
    // connecting bus members to their neighboring subgraphs, and then propagate connections
    // through the hierarchy
    for (const subgraph of this.m_driver_subgraphs) {
      if (!subgraph.m_dirty) continue;

      // For subgraphs that are driven by a global (power port or label) and have more
      // than one global driver, we need to seek out other subgraphs driven by the
      // same name as the non-chosen driver and update them to match the chosen one.

      if (!subgraph.m_local_driver && subgraph.m_multiple_drivers) {
        for (const driver of subgraph.m_drivers) {
          if (driver === subgraph.m_driver) continue;

          const secondary_name = subgraph.GetNameForDriver(driver);

          if (secondary_name === subgraph.m_driver_connection!.Name()) continue;

          const secondary_is_global =
            CONNECTION_SUBGRAPH.GetDriverPriority(driver) >=
            CONNECTION_SUBGRAPH.PRIORITY.GLOBAL_POWER_PIN;

          for (const candidate of global_subgraphs) {
            if (candidate === subgraph) continue;

            if (!secondary_is_global && !candidate.m_sheet.equals(subgraph.m_sheet)) continue;

            for (const candidate_driver of candidate.m_drivers) {
              if (candidate.GetNameForDriver(candidate_driver) === secondary_name) {
                candidate.m_driver_connection!.Clone(subgraph.m_driver_connection!);

                candidate.m_dirty = false;
                this.propagateToNeighbors(candidate, false);
              }
            }
          }
        }
      }

      // This call will handle descending the hierarchy and updating child subgraphs
      this.propagateToNeighbors(subgraph, false);
    }

    // After processing and allowing some to be skipped if they have hierarchical
    // pins connecting both up and down the hierarchy, we check to see if any of them
    // have not been processed.  This would indicate that they do not have off-sheet connections
    // but we still need to handle the subgraph
    for (const subgraph of this.m_driver_subgraphs) {
      if (subgraph.m_dirty) this.propagateToNeighbors(subgraph, true);
    }

    // Handle buses that have been linked together somewhere by member (net) connections.
    // This feels a bit hacky, perhaps this algorithm should be revisited in the future.

    // For net subgraphs that have more than one bus parent, we need to ensure that those
    // buses are linked together in the final netlist.  The final name of each bus might not
    // match the local name that was used to establish the parent-child relationship, because
    // the bus may have been renamed by a hierarchical connection.  So, for each of these cases,
    // we need to identify the appropriate bus members to link together (and their final names),
    // and then update all instances of the old name in the hierarchy.
    for (const subgraph of this.m_driver_subgraphs) {
      // All SGs should have been processed by propagateToNeighbors above
      console.assert(!subgraph.m_dirty, 'Subgraph not processed by propagateToNeighbors!');

      if (subgraph.m_bus_parents.size < 2) continue;

      const conn = subgraph.m_driver_connection!;

      // Should we skip everything after this if this is not a net?
      if (!conn.IsNet()) continue; // wxCHECK2

      for (const [link_member, parents] of subgraph.m_bus_parents) {
        for (let parent of parents) {
          while (parent.m_absorbed) parent = parent.m_absorbed_by!;

          const match = CONNECTION_GRAPH.matchBusMember(parent.m_driver_connection!, link_member);

          if (!match) continue;

          if (conn.Name() !== match.Name()) {
            const old_name = match.Name();

            match.Clone(conn);

            const jj = this.m_net_name_to_subgraphs_map.get(old_name);

            if (!jj) continue;

            // Copy the vector to avoid iterator invalidation when recaching
            const old_subgraphs = [...jj];

            for (let old_sg of old_subgraphs) {
              while (old_sg.m_absorbed) old_sg = old_sg.m_absorbed_by!;

              const old_sg_name = old_sg.m_driver_connection!.Name();
              old_sg.m_driver_connection!.Clone(conn);

              if (old_sg_name !== old_sg.m_driver_connection!.Name())
                this.recacheSubgraphName(old_sg, old_sg_name);
            }
          }
        }
      }
    }

    const updateItemConnectionsTask = (subgraph: CONNECTION_SUBGRAPH): number => {
      // Make sure weakly-driven single-pin nets get the unconnected_ prefix
      if (
        !subgraph.m_strong_driver &&
        subgraph.m_drivers.size === 1 &&
        subgraph.m_driver!.Type() === KICAD_T.SCH_PIN_T
      ) {
        const pin = subgraph.m_driver as SCH_PIN;
        const name = pin.GetDefaultNetName(subgraph.m_sheet, true);

        subgraph.m_driver_connection!.ConfigureFromLabel(name);
      }

      subgraph.m_dirty = false;
      subgraph.UpdateItemConnections();

      // No other processing to do on buses
      if (subgraph.m_driver_connection!.IsBus()) return 0;

      // As a visual aid, we can check sheet pins that are driven by themselves to see
      // if they should be promoted to buses
      if (subgraph.m_driver && subgraph.m_driver.Type() === KICAD_T.SCH_SHEET_PIN_T) {
        const pin = subgraph.m_driver as SCH_SHEET_PIN;
        const sheet = pin.GetParent();

        if (sheet) {
          const pinText = pin.GetShownText(false);
          const screen = sheet.GetScreen()!;

          for (const item of screen.Items().OfType(KICAD_T.SCH_HIER_LABEL_T)) {
            const label = item as SCH_HIERLABEL;

            if (label.GetShownText(subgraph.m_sheet, false) === pinText) {
              const path = subgraph.m_sheet.Clone();
              path.push_back(sheet);

              const parent_conn = label.Connection(path);

              if (parent_conn?.IsBus()) subgraph.m_driver_connection!.SetType(CONNECTION_TYPE.BUS);

              break;
            }
          }

          if (subgraph.m_driver_connection!.IsBus()) return 0;
        }
      }

      return 1;
    };

    for (const sg of this.m_driver_subgraphs) updateItemConnectionsTask(sg);

    this.m_net_code_to_subgraphs_map.clear();
    this.m_net_name_to_subgraphs_map.clear();

    for (const subgraph of this.m_driver_subgraphs) {
      const key: NET_NAME_CODE_CACHE_KEY = {
        Name: subgraph.GetNetName(),
        Netcode: subgraph.m_driver_connection!.NetCode(),
      };
      this.m_net_code_to_subgraphs_map.at(key).push(subgraph);

      pushInto(this.m_net_name_to_subgraphs_map, subgraph.m_driver_connection!.Name(), subgraph);
    }

    this.updateNetclassAssignments(aChangedItemHandler, aUnconditional);
  }

  /** The netclass half of `buildConnectionGraph` (the tail of the same function upstream). */
  private updateNetclassAssignments(
    aChangedItemHandler: ((aItem: SCH_ITEM) => void) | null,
    aUnconditional: boolean,
  ): void {
    const netSettings = this.m_schematic!.Project().GetProjectFile().m_NetSettings;

    // std::map copy: the assignments are cleared below
    const oldAssignments = new Map<string, Set<string>>();

    for (const [k, v] of netSettings.GetNetclassLabelAssignments())
      oldAssignments.set(k, new Set(v));

    const affectedNetclassNetAssignments = new Set<string>();

    netSettings.ClearNetclassLabelAssignments();

    const dirtySubgraphs = (subgraphs: readonly CONNECTION_SUBGRAPH[]): void => {
      if (aChangedItemHandler) {
        for (const subgraph of subgraphs) {
          for (const item of subgraph.m_items) aChangedItemHandler(item);
        }
      }
    };

    const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean =>
      a.size === b.size && [...a].every((x) => b.has(x));

    const checkNetclassDrivers = (
      netName: string,
      subgraphs: readonly CONNECTION_SUBGRAPH[],
    ): void => {
      if (subgraphs.length === 0) return; // wxCHECK_RET( !subgraphs.empty(), "Invalid empty subgraph" )

      // std::set<wxString>: sorted
      const netclassNames: string[] = [];

      // Collect all netclasses on all subgraphs for this net
      for (const subgraph of subgraphs) {
        for (const item of subgraph.m_items) {
          for (const [name] of subgraph.GetNetclassesForDriver(item)) netclassNames.push(name);
        }
      }

      const netclasses = new Set([...new Set(netclassNames)].sort());

      // Append the netclasses to any included bus members
      for (const subgraph of subgraphs) {
        if (subgraph.m_driver_connection!.IsBus()) {
          const processBusMember = (member: SCH_CONNECTION): void => {
            if (netclasses.size > 0)
              netSettings.AppendNetclassLabelAssignment(member.Name(), netclasses);

            const ii = this.m_net_name_to_subgraphs_map.get(member.Name());
            const old = oldAssignments.get(member.Name());

            if (old) {
              if (!sameSet(old, netclasses)) {
                affectedNetclassNetAssignments.add(member.Name());

                if (ii) dirtySubgraphs(ii);
              }
            } else if (netclasses.size > 0) {
              affectedNetclassNetAssignments.add(member.Name());

              if (ii) dirtySubgraphs(ii);
            }
          };

          for (const member of subgraph.m_driver_connection!.Members()) {
            // Check if this member itself is a bus (which can be the case for vector buses as members
            // of a bus, see https://gitlab.com/kicad/code/kicad/-/issues/16545
            if (member.IsBus()) {
              for (const nestedMember of member.Members()) processBusMember(nestedMember);
            } else {
              processBusMember(member);
            }
          }
        }
      }

      // Assign the netclasses to the root netname
      if (netclasses.size > 0) netSettings.AppendNetclassLabelAssignment(netName, netclasses);

      const old = oldAssignments.get(netName);

      if (old) {
        if (!sameSet(old, netclasses)) {
          affectedNetclassNetAssignments.add(netName);
          dirtySubgraphs(subgraphs);
        }
      } else if (netclasses.size > 0) {
        affectedNetclassNetAssignments.add(netName);
        dirtySubgraphs(subgraphs);
      }
    };

    // Check for netclass assignments
    for (const [netname, subgraphs] of this.m_net_name_to_subgraphs_map)
      checkNetclassDrivers(netname, subgraphs);

    if (!aUnconditional) {
      for (const [netname, netclasses] of oldAssignments) {
        if (
          netSettings.GetNetclassLabelAssignments().has(netname) ||
          affectedNetclassNetAssignments.has(netname)
        ) {
          continue;
        }

        netSettings.SetNetclassLabelAssignment(netname, netclasses);
      }
    }
  }

  /**
   * @param aNetName string with the netname for coding
   * @return existing netcode (if it exists) or newly created one
   */
  private getOrCreateNetCode(aNetName: string): number {
    let code = this.m_net_name_to_code_map.get(aNetName);

    if (code === undefined) {
      code = this.m_last_net_code++;
      this.m_net_name_to_code_map.set(aNetName, code);
    }

    return code;
  }

  /**
   * Helper to assign a new net code to a connection.
   *
   * @return the assigned code
   */
  private assignNewNetCode(aConnection: SCH_CONNECTION): number {
    const code = this.getOrCreateNetCode(aConnection.Name());

    aConnection.SetNetCode(code);

    return code;
  }

  /**
   * Ensure all members of the bus connection have a valid net code assigned.
   */
  private assignNetCodesToBus(aConnection: SCH_CONNECTION): void {
    const connections_to_check = [...aConnection.Members()];

    for (let i = 0; i < connections_to_check.length; i++) {
      const member = connections_to_check[i]!;

      if (member.IsBus()) {
        connections_to_check.push(...member.Members());
        continue;
      }

      this.assignNewNetCode(member);
    }
  }

  /**
   * Update all neighbors of a subgraph with this one's connectivity info.
   *
   * If this subgraph contains hierarchical links, this method will descent the
   * hierarchy and propagate the connectivity across all linked sheets.
   *
   * @param aSubgraph is the subgraph being processed.
   * @param aForce prevents this routine from skipping subgraphs.
   */
  private propagateToNeighbors(aSubgraph: CONNECTION_SUBGRAPH, aForce: boolean): void {
    let conn = aSubgraph.m_driver_connection!;
    const search_list: CONNECTION_SUBGRAPH[] = [];
    const visited = new Set<CONNECTION_SUBGRAPH>();
    const stale_bus_members = new Set<SCH_CONNECTION>();

    const visit = (aParent: CONNECTION_SUBGRAPH): void => {
      for (const pin of aParent.m_hier_pins) {
        const path = aParent.m_sheet.Clone();
        path.push_back(pin.GetParent());

        const it = this.m_sheet_to_subgraphs_map.get(sheetKey(path));

        if (!it) continue;

        for (const candidate of it) {
          if (
            !candidate.m_strong_driver ||
            candidate.m_hier_ports.size === 0 ||
            visited.has(candidate)
          )
            continue;

          for (const label of candidate.m_hier_ports) {
            if (candidate.GetNameForDriver(label) === aParent.GetNameForDriver(pin)) {
              candidate.m_hier_parent = aParent;
              aParent.m_hier_children.add(candidate);

              search_list.push(candidate);
              break;
            }
          }
        }
      }

      for (const label of aParent.m_hier_ports) {
        const path = aParent.m_sheet.Clone();
        path.pop_back();

        const it = this.m_sheet_to_subgraphs_map.get(sheetKey(path));

        if (!it) continue;

        for (const candidate of it) {
          if (
            candidate.m_hier_pins.size === 0 ||
            visited.has(candidate) ||
            candidate.m_driver_connection!.Type() !== aParent.m_driver_connection!.Type()
          ) {
            continue;
          }

          const last_parent_uuid = aParent.m_sheet.Last()!.m_Uuid;

          for (const pin of candidate.m_hier_pins) {
            // If the last sheet UUIDs won't match, no need to check the full path
            if (pin.GetParent().m_Uuid !== last_parent_uuid) continue;

            const pin_path = path.Clone();
            pin_path.push_back(pin.GetParent());

            if (!pin_path.equals(aParent.m_sheet)) continue;

            if (aParent.GetNameForDriver(label) === candidate.GetNameForDriver(pin)) {
              aParent.m_hier_children.add(candidate);
              search_list.push(candidate);
              break;
            }
          }
        }
      }
    };

    const propagate_bus_neighbors = (aParentGraph: CONNECTION_SUBGRAPH): void => {
      // Sort bus neighbors by name to ensure deterministic processing order.
      // When multiple bus members (e.g., A0, A1, A2, A3) all connect to the same
      // shorted net in a child sheet, the first one processed "wins" and sets
      // the net name. Sorting ensures the alphabetically-first name is chosen.
      const sortedMembers = [...aParentGraph.m_bus_neighbors.keys()].sort((a, b) =>
        lessStr(a.Name(), b.Name()) ? -1 : lessStr(b.Name(), a.Name()) ? 1 : 0,
      );

      for (const member_conn of sortedMembers) {
        const neighbors = aParentGraph.m_bus_neighbors.get(member_conn);

        if (!neighbors) continue;

        for (let neighbor of neighbors) {
          // May have been absorbed but won't have been deleted
          while (neighbor.m_absorbed) neighbor = neighbor.m_absorbed_by!;

          const parent = aParentGraph.m_driver_connection!;

          // Now member may be out of date, since we just cloned the
          // connection from higher up in the hierarchy.  We need to
          // figure out what the actual new connection is.
          let member = CONNECTION_GRAPH.matchBusMember(parent, member_conn);

          if (!member) {
            // Try harder: we might match on a secondary driver
            for (const sg of neighbors) {
              if (sg.m_multiple_drivers) {
                for (const driver of sg.m_drivers) {
                  const c = this.getDefaultConnection(driver, sg);
                  member = c ? CONNECTION_GRAPH.matchBusMember(parent, c) : null;

                  if (member) break;
                }
              }

              if (member) break;
            }
          }

          // This is bad, probably an ERC error
          if (!member) continue;

          const neighbor_conn = neighbor.m_driver_connection;

          if (!neighbor_conn) continue; // wxCHECK2

          const neighbor_name = neighbor_conn.Name();

          // Matching name: no update needed
          if (neighbor_name === member.Name()) continue;

          // Was this neighbor already updated from a different sheet?  Don't rename it again,
          // unless this same parent bus updated it and the bus member name has since changed
          // (which can happen when a bus member is renamed via stale member update, issue #18299).
          if (!neighbor_conn.Sheet().equals(neighbor.m_sheet)) {
            // If the neighbor's connection sheet doesn't match this parent bus's sheet,
            // it was updated by a different bus entirely. Don't override.
            if (!neighbor_conn.Sheet().equals(parent.Sheet())) continue;

            // If the neighbor's connection sheet matches this parent bus's sheet but
            // the names differ, check if the neighbor's current name still matches
            // a member of this bus. If it does, the neighbor was updated by a different
            // member of this same bus and we should preserve that (determinism).
            // If it doesn't match any member, the bus member was renamed and we should
            // update. We compare by name rather than VectorIndex because non-bus
            // connections (e.g., "GND" from power pin propagation) have a default
            // VectorIndex of 0 that falsely matches the first bus member.
            let alreadyUpdatedByBusMember = false;

            for (const m of parent.Members()) {
              if (m.Name() === neighbor_name) {
                alreadyUpdatedByBusMember = true;
                break;
              }
            }

            if (alreadyUpdatedByBusMember) continue;
          }

          // Safety check against infinite recursion
          if (!neighbor_conn.IsNet()) continue; // wxCHECK2_MSG

          // Take whichever name is higher priority
          if (
            CONNECTION_SUBGRAPH.GetDriverPriority(neighbor.m_driver) >=
            CONNECTION_SUBGRAPH.PRIORITY.GLOBAL_POWER_PIN
          ) {
            member.Clone(neighbor_conn);
            stale_bus_members.add(member);
          } else {
            neighbor_conn.Clone(member);

            this.recacheSubgraphName(neighbor, neighbor_name);

            // Recurse onto this neighbor in case it needs to re-propagate
            neighbor.m_dirty = true;
            this.propagateToNeighbors(neighbor, aForce);

            // After hierarchy propagation, the neighbor's connection may have been
            // updated to a higher-priority driver (e.g., a power symbol discovered
            // through hierarchical sheet pins). If so, update the bus member to match.
            // This ensures that net names propagate correctly through bus connections
            // that span hierarchical boundaries (issue #18119).
            if (neighbor_conn.Name() !== member.Name()) {
              member.Clone(neighbor_conn);
              stale_bus_members.add(member);
            }
          }
        }
      }
    };

    // If we are a bus, we must propagate to local neighbors and then the hierarchy
    if (conn.IsBus()) propagate_bus_neighbors(aSubgraph);

    // If we have both ports and pins, skip processing as we'll be visited by a parent or child.
    // If we only have one or the other, process (we can either go bottom-up or top-down depending
    // on which subgraph comes up first)
    if (!aForce && aSubgraph.m_hier_ports.size > 0 && aSubgraph.m_hier_pins.size > 0) {
      return;
    } else if (aSubgraph.m_hier_ports.size === 0 && aSubgraph.m_hier_pins.size === 0) {
      aSubgraph.m_dirty = false;
      return;
    }

    visited.add(aSubgraph);

    visit(aSubgraph);

    for (let i = 0; i < search_list.length; i++) {
      const child = search_list[i]!;

      if (!visited.has(child)) {
        visited.add(child);
        visit(child);
      }

      child.m_dirty = false;
    }

    // Now, find the best driver for this chain of subgraphs
    const P = CONNECTION_SUBGRAPH.PRIORITY;
    let bestDriver = aSubgraph;
    let highest: number = CONNECTION_SUBGRAPH.GetDriverPriority(aSubgraph.m_driver);
    let bestIsStrong = highest >= P.HIER_LABEL;
    let bestName = aSubgraph.m_driver_connection!.Name();

    // Check if a subsheet has a higher-priority connection to the same net
    if (highest < P.GLOBAL_POWER_PIN) {
      for (const subgraph of visited) {
        if (subgraph === aSubgraph) continue;

        const priority = CONNECTION_SUBGRAPH.GetDriverPriority(subgraph.m_driver);

        const candidateStrong = priority >= P.HIER_LABEL;
        const candidateName = subgraph.m_driver_connection!.Name();
        const shorterPath = subgraph.m_sheet.size() < bestDriver.m_sheet.size();
        const asGoodPath = subgraph.m_sheet.size() <= bestDriver.m_sheet.size();

        // Pick a better driving subgraph if it:
        // a) has a power pin or global driver
        // b) is a strong driver and we're a weak driver
        // c) is a higher priority strong driver
        // d) matches our priority, is a strong driver, and has a shorter path
        // e) matches our strength and is at least as short, and is alphabetically lower

        if (
          priority >= P.GLOBAL_POWER_PIN ||
          (!bestIsStrong && candidateStrong) ||
          (priority > highest && candidateStrong) ||
          (priority === highest && candidateStrong && shorterPath) ||
          (bestIsStrong === candidateStrong &&
            asGoodPath &&
            priority === highest &&
            lessStr(candidateName, bestName))
        ) {
          bestDriver = subgraph;
          highest = priority;
          bestIsStrong = candidateStrong;
          bestName = candidateName;
        }
      }
    }

    conn = bestDriver.m_driver_connection!;

    for (const subgraph of visited) {
      const old_name = subgraph.m_driver_connection!.Name();

      subgraph.m_driver_connection!.Clone(conn);

      if (old_name !== conn.Name()) this.recacheSubgraphName(subgraph, old_name);

      if (conn.IsBus()) propagate_bus_neighbors(subgraph);
    }

    // Somewhere along the way, a bus member may have been upgraded to a global or power label.
    // Because this can happen anywhere, we need a second pass to update all instances of that bus
    // member to have the correct connection info
    if (conn.IsBus() && stale_bus_members.size > 0) {
      const cached_members = [...stale_bus_members];

      for (const stale_member of cached_members) {
        for (const subgraph of visited) {
          const member = CONNECTION_GRAPH.matchBusMember(
            subgraph.m_driver_connection!,
            stale_member,
          );

          if (!member) continue;

          member.Clone(stale_member);

          propagate_bus_neighbors(subgraph);
        }
      }
    }

    aSubgraph.m_dirty = false;
  }

  /**
   * Build a new default connection for the given item based on its properties.
   *
   * Handles strong drivers (power pins and labels) only.
   *
   * @param aItem is an item that can generate a connection name.
   * @param aSubgraph is used to determine the sheet to use and retrieve the cached name.
   * @return a connection generated from the item, or nullptr if item is not valid.
   */
  private getDefaultConnection(
    aItem: SCH_ITEM,
    aSubgraph: CONNECTION_SUBGRAPH,
  ): SCH_CONNECTION | null {
    let c: SCH_CONNECTION | null = null;

    switch (aItem.Type()) {
      case KICAD_T.SCH_PIN_T:
        if ((aItem as SCH_PIN).IsPower()) c = new SCH_CONNECTION(aItem, aSubgraph.m_sheet);

        break;

      case KICAD_T.SCH_GLOBAL_LABEL_T:
      case KICAD_T.SCH_HIER_LABEL_T:
      case KICAD_T.SCH_LABEL_T:
        c = new SCH_CONNECTION(aItem, aSubgraph.m_sheet);
        break;

      default:
        break;
    }

    if (c) {
      c.SetGraph(this);
      c.ConfigureFromLabel(aSubgraph.GetNameForDriver(aItem));
    }

    return c;
  }

  /**
   * Search for a matching bus member inside a bus connection.
   *
   * For bus groups, this returns a bus member that matches aSearch by name.
   * For bus vectors, this returns a bus member that matches by vector index.
   *
   * @param aBusConnection is the bus connection to search.
   * @param aSearch is the net connection to search for.
   * @returns a member of aBusConnection that matches aSearch.
   */
  static matchBusMember(
    aBusConnection: SCH_CONNECTION,
    aSearch: SCH_CONNECTION,
  ): SCH_CONNECTION | null {
    if (!aBusConnection.IsBus()) return null;

    let match: SCH_CONNECTION | null = null;

    if (aBusConnection.Type() === CONNECTION_TYPE.BUS) {
      // Vector bus: compare against index, because we allow the name
      // to be different

      for (const bus_member of aBusConnection.Members()) {
        if (bus_member.VectorIndex() === aSearch.VectorIndex()) {
          match = bus_member;
          break;
        }
      }
    } else {
      // Group bus
      for (const c of aBusConnection.Members()) {
        // Vector inside group: compare names, because for bus groups
        // we expect the naming to be consistent across all usages
        // TODO(JE) explain this in the docs
        if (c.Type() === CONNECTION_TYPE.BUS) {
          for (const bus_member of c.Members()) {
            if (bus_member.LocalName() === aSearch.LocalName()) {
              match = bus_member;
              break;
            }
          }
        } else if (c.LocalName() === aSearch.LocalName()) {
          match = c;
          break;
        }
      }

      if (!match && aSearch.VectorIndex() >= 0) {
        let flatIdx = 0;

        for (const c of aBusConnection.Members()) {
          if (c.Type() === CONNECTION_TYPE.BUS) {
            for (const bus_member of c.Members()) {
              if (flatIdx === aSearch.VectorIndex()) {
                match = bus_member;
                break;
              }

              flatIdx++;
            }
          } else {
            if (flatIdx === aSearch.VectorIndex()) {
              match = c;
              break;
            }

            flatIdx++;
          }

          if (match) break;
        }
      }
    }

    return match;
  }

  private recacheSubgraphName(aSubgraph: CONNECTION_SUBGRAPH, aOldName: string): void {
    const vec = this.m_net_name_to_subgraphs_map.get(aOldName);

    if (vec) eraseFrom(vec, aSubgraph);

    pushInto(this.m_net_name_to_subgraphs_map, aSubgraph.m_driver_connection!.Name(), aSubgraph);
  }

  /**
   * Return a bus alias pointer for the given name if it exists (from cache)
   *
   * CONNECTION_GRAPH caches these, they are owned by the SCH_SCREEN that
   * the alias was defined on.  The cache is only used to update the graph.
   */
  GetBusAlias(aName: string): BUS_ALIAS | null {
    return this.m_bus_alias_cache.get(aName) ?? null;
  }

  /**
   * Determine which subgraphs have more than one conflicting bus label.
   *
   * @see DIALOG_MIGRATE_BUSES
   * @return a list of subgraphs that need migration
   */
  GetBusesNeedingMigration(): CONNECTION_SUBGRAPH[] {
    const ret: CONNECTION_SUBGRAPH[] = [];

    for (const subgraph of this.m_subgraphs) {
      // Graph is supposed to be up-to-date before calling this
      if (!subgraph.m_driver) continue;

      const sheet = subgraph.m_sheet;
      const connection = subgraph.m_driver.Connection(sheet)!;

      if (!connection.IsBus()) continue;

      const labels = subgraph.GetVectorBusLabels();

      if (labels.length > 1) {
        let different = false;
        const first = (labels[0] as SCH_TEXT).GetShownText(sheet, false);

        for (let i = 1; i < labels.length; ++i) {
          if ((labels[i] as SCH_TEXT).GetShownText(sheet, false) !== first) {
            different = true;
            break;
          }
        }

        if (!different) continue;

        ret.push(subgraph);
      }
    }

    return ret;
  }

  GetNetMap(): NET_MAP {
    return this.m_net_code_to_subgraphs_map;
  }

  /**
   * Return the subgraph for a given net name on a given sheet.
   *
   * @param aNetName is the local net name to look for.
   * @param aPath is a sheet path to look on.
   * @return the subgraph matching the query, or nullptr if none is found.
   */
  FindSubgraphByName(aNetName: string, aPath: SCH_SHEET_PATH): CONNECTION_SUBGRAPH | null {
    const it = this.m_net_name_to_subgraphs_map.get(aNetName);

    if (!it) return null;

    for (const sg of it) {
      if (sg.m_sheet.equals(aPath) && sg.m_driver_connection!.Name() === aNetName) return sg;
    }

    return null;
  }

  /**
   * Retrieve a subgraph for the given net name, if one exists.
   *
   * Search every sheet.
   */
  FindFirstSubgraphByName(aNetName: string): CONNECTION_SUBGRAPH | null {
    const it = this.m_net_name_to_subgraphs_map.get(aNetName);

    if (!it) return null;

    return it[0] ?? null;
  }

  GetSubgraphForItem(aItem: SCH_ITEM | null): CONNECTION_SUBGRAPH | null {
    const sgs = aItem ? this.m_item_to_subgraph_map.get(aItem) : undefined;

    // Callers expect a single subgraph even for items registered on several sheet paths, so
    // hand back the most recently registered one
    let ret = sgs && sgs.length > 0 ? sgs[sgs.length - 1]! : null;

    while (ret?.m_absorbed) ret = ret.m_absorbed_by;

    return ret;
  }

  GetAllSubgraphs(aNetName: string): readonly CONNECTION_SUBGRAPH[] {
    return this.m_net_name_to_subgraphs_map.get(aNetName) ?? [];
  }

  /**
   * Return the fully-resolved netname for a given subgraph.
   *
   * @param aSubGraph Reference to the subgraph.
   * @return Netname string usable with m_net_name_to_subgraphs_map.
   */
  GetResolvedSubgraphName(aSubGraph: CONNECTION_SUBGRAPH): string {
    let retval = aSubGraph.GetNetName();

    // This is a hacky way to find the true subgraph net name (why do we not store it?)
    // TODO: Remove once the actual netname of the subgraph is stored with the subgraph

    for (const [name, graphs] of this.m_net_name_to_subgraphs_map) {
      if (graphs.includes(aSubGraph)) {
        retval = name;
        break;
      }
    }

    return retval;
  }

  /**
   * Run electrical rule checks on the connectivity graph.
   *
   * Precondition: graph is up-to-date
   *
   * @return the number of errors found
   */
  RunERC(): number {
    let error_count = 0;

    if (!this.m_schematic) return 1; // wxCHECK_MSG( m_schematic, true, … )

    const settings = this.m_schematic.ErcSettings();

    // We don't want to run many ERC checks more than once on a given screen even though it may
    // represent multiple sheets with multiple subgraphs.  We can tell these apart by drivers.
    const seenDriverInstances = new Set<SCH_ITEM | null>();

    for (const subgraph of this.m_subgraphs) {
      if (subgraph.m_absorbed) continue;

      if (seenDriverInstances.has(subgraph.m_driver)) continue;

      if (subgraph.m_driver) seenDriverInstances.add(subgraph.m_driver);

      /**
       * NOTE:
       *
       * We could check that labels attached to bus subgraphs follow the
       * proper format (i.e. actually define a bus).
       *
       * This check doesn't need to be here right now because labels
       * won't actually be connected to bus wires if they aren't in the right
       * format due to their TestDanglingEnds() implementation.
       */
      if (settings.IsTestEnabled(ERCE_T.ERCE_DRIVER_CONFLICT)) {
        if (!this.ercCheckMultipleDrivers(subgraph)) error_count++;
      }

      subgraph.ResolveDrivers(false);

      if (settings.IsTestEnabled(ERCE_T.ERCE_BUS_TO_NET_CONFLICT)) {
        if (!this.ercCheckBusToNetConflicts(subgraph)) error_count++;
      }

      if (settings.IsTestEnabled(ERCE_T.ERCE_BUS_ENTRY_CONFLICT)) {
        if (!this.ercCheckBusToBusEntryConflicts(subgraph)) error_count++;
      }

      if (settings.IsTestEnabled(ERCE_T.ERCE_BUS_TO_BUS_CONFLICT)) {
        if (!this.ercCheckBusToBusConflicts(subgraph)) error_count++;
      }

      if (settings.IsTestEnabled(ERCE_T.ERCE_WIRE_DANGLING)) {
        if (!this.ercCheckFloatingWires(subgraph)) error_count++;
      }

      if (settings.IsTestEnabled(ERCE_T.ERCE_UNCONNECTED_WIRE_ENDPOINT)) {
        if (!this.ercCheckDanglingWireEndpoints(subgraph)) error_count++;
      }

      if (
        settings.IsTestEnabled(ERCE_T.ERCE_NOCONNECT_CONNECTED) ||
        settings.IsTestEnabled(ERCE_T.ERCE_NOCONNECT_NOT_CONNECTED) ||
        settings.IsTestEnabled(ERCE_T.ERCE_PIN_NOT_CONNECTED)
      ) {
        if (!this.ercCheckNoConnects(subgraph)) error_count++;
      }

      if (
        settings.IsTestEnabled(ERCE_T.ERCE_LABEL_NOT_CONNECTED) ||
        settings.IsTestEnabled(ERCE_T.ERCE_LABEL_SINGLE_PIN)
      ) {
        if (!this.ercCheckLabels(subgraph)) error_count++;
      }
    }

    if (settings.IsTestEnabled(ERCE_T.ERCE_LABEL_NOT_CONNECTED)) {
      error_count += this.ercCheckDirectiveLabels();
    }

    // Hierarchical sheet checking is done at the schematic level
    if (
      settings.IsTestEnabled(ERCE_T.ERCE_HIERACHICAL_LABEL) ||
      settings.IsTestEnabled(ERCE_T.ERCE_PIN_NOT_CONNECTED)
    ) {
      error_count += this.ercCheckHierSheets();
    }

    if (settings.IsTestEnabled(ERCE_T.ERCE_SINGLE_GLOBAL_LABEL)) {
      error_count += this.ercCheckSingleGlobalLabel();
    }

    return error_count;
  }

  /** `new SCH_MARKER( ercItem, aPos )` appended to \a aScreen's sheet. */
  private static addMarker(aSheet: SCH_SHEET_PATH, aItem: ERC_ITEM, aPos: VECTOR2I): void {
    aSheet.LastScreen()!.Append(new SCH_MARKER(aItem, aPos));
  }

  /**
   * If the subgraph has multiple drivers of equal priority that are graphically connected,
   * ResolveDrivers() will have stored the second driver for use by this function, which actually
   * creates the markers.
   *
   * @return  true for no errors, false for errors
   */
  private ercCheckMultipleDrivers(aSubgraph: CONNECTION_SUBGRAPH): boolean {
    if (aSubgraph.m_multiple_drivers) {
      for (const driver of aSubgraph.m_drivers) {
        if (driver === aSubgraph.m_driver) continue;

        if (
          driver.Type() === KICAD_T.SCH_GLOBAL_LABEL_T ||
          driver.Type() === KICAD_T.SCH_HIER_LABEL_T ||
          driver.Type() === KICAD_T.SCH_LABEL_T ||
          (driver.Type() === KICAD_T.SCH_PIN_T && (driver as SCH_PIN).IsPower())
        ) {
          const primaryName = aSubgraph.GetNameForDriver(aSubgraph.m_driver!);
          const secondaryName = aSubgraph.GetNameForDriver(driver);

          if (primaryName === secondaryName) continue;

          const msg = `Both ${primaryName} and ${secondaryName} are attached to the same items; ${primaryName} will be used in the netlist`;

          const ercItem = ERC_ITEM.Create(ERCE_T.ERCE_DRIVER_CONFLICT)!;
          ercItem.SetItems(aSubgraph.m_driver, driver);
          ercItem.SetSheetSpecificPath(aSubgraph.GetSheet());
          ercItem.SetItemsSheetPaths(aSubgraph.GetSheet(), aSubgraph.m_sheet);
          ercItem.SetErrorMessage(msg);

          CONNECTION_GRAPH.addMarker(aSubgraph.m_sheet, ercItem, driver.GetPosition());

          return false;
        }
      }
    }

    return true;
  }

  /**
   * Check one subgraph for conflicting connections between net and bus labels.
   *
   * For example, a net wire connected to a bus port/pin, or vice versa
   */
  private ercCheckBusToNetConflicts(aSubgraph: CONNECTION_SUBGRAPH): boolean {
    const sheet = aSubgraph.m_sheet;

    let net_item: SCH_ITEM | null = null;
    let bus_item: SCH_ITEM | null = null;
    const conn = new SCH_CONNECTION(this);

    for (const item of aSubgraph.m_items) {
      switch (item.Type()) {
        case KICAD_T.SCH_LINE_T: {
          if (item.GetLayer() === SCH_LAYER_ID.LAYER_BUS) bus_item = !bus_item ? item : bus_item;
          else net_item = !net_item ? item : net_item;

          break;
        }

        case KICAD_T.SCH_LABEL_T:
        case KICAD_T.SCH_GLOBAL_LABEL_T:
        case KICAD_T.SCH_SHEET_PIN_T:
        case KICAD_T.SCH_HIER_LABEL_T: {
          const text = item as SCH_TEXT;
          conn.ConfigureFromLabel(
            EscapeString(text.GetShownText(sheet, false), ESCAPE_CONTEXT.CTX_NETNAME),
          );

          if (conn.IsBus()) bus_item = !bus_item ? item : bus_item;
          else net_item = !net_item ? item : net_item;

          break;
        }

        default:
          break;
      }
    }

    if (net_item && bus_item) {
      const ercItem = ERC_ITEM.Create(ERCE_T.ERCE_BUS_TO_NET_CONFLICT)!;
      ercItem.SetSheetSpecificPath(sheet);
      ercItem.SetItems(net_item, bus_item);

      CONNECTION_GRAPH.addMarker(sheet, ercItem, net_item.GetPosition());

      return false;
    }

    return true;
  }

  /**
   * Check one subgraph for conflicting connections between two bus items.
   *
   * For example, a labeled bus wire connected to a hierarchical sheet pin
   * where the labeled bus doesn't contain any of the same bus members as the
   * sheet pin.
   */
  private ercCheckBusToBusConflicts(aSubgraph: CONNECTION_SUBGRAPH): boolean {
    const sheet = aSubgraph.m_sheet;

    let label: SCH_ITEM | null = null;
    let port: SCH_ITEM | null = null;

    for (const item of aSubgraph.m_items) {
      switch (item.Type()) {
        case KICAD_T.SCH_TEXT_T:
        case KICAD_T.SCH_GLOBAL_LABEL_T:
          if (!label && item.Connection(sheet)!.IsBus()) label = item;
          break;

        case KICAD_T.SCH_SHEET_PIN_T:
        case KICAD_T.SCH_HIER_LABEL_T:
          if (!port && item.Connection(sheet)!.IsBus()) port = item;
          break;

        default:
          break;
      }
    }

    if (label && port) {
      let match = false;

      for (const member of label.Connection(sheet)!.Members()) {
        for (const test of port.Connection(sheet)!.Members()) {
          if (test !== member && member.Name() === test.Name()) {
            match = true;
            break;
          }
        }

        if (match) break;
      }

      if (!match) {
        const ercItem = ERC_ITEM.Create(ERCE_T.ERCE_BUS_TO_BUS_CONFLICT)!;
        ercItem.SetSheetSpecificPath(sheet);
        ercItem.SetItems(label, port);

        CONNECTION_GRAPH.addMarker(sheet, ercItem, label.GetPosition());

        return false;
      }
    }

    return true;
  }

  /**
   * Check one subgraph for conflicting bus entry to bus connections.
   *
   * For example, a wire with label "A0" is connected to a bus labeled "D[8..0]"
   *
   * Will also check for mistakes related to bus group names, for example:
   * A bus group named "USB{DP DM}" should have bus entry connections like
   * "USB.DP" but someone might accidentally just enter "DP".
   */
  private ercCheckBusToBusEntryConflicts(aSubgraph: CONNECTION_SUBGRAPH): boolean {
    let conflict = false;
    const sheet = aSubgraph.m_sheet;

    let bus_entry: SCH_BUS_WIRE_ENTRY | null = null;
    let bus_wire: SCH_ITEM | null = null;
    let bus_name = '';

    if (!aSubgraph.m_driver_connection) {
      // Incomplete bus entry.  Let the unconnected tests handle it.
      return true;
    }

    for (const item of aSubgraph.m_items) {
      switch (item.Type()) {
        case KICAD_T.SCH_BUS_WIRE_ENTRY_T:
          if (!bus_entry) bus_entry = item as SCH_BUS_WIRE_ENTRY;

          break;

        default:
          break;
      }
    }

    if (bus_entry?.m_connected_bus_item) {
      bus_wire = bus_entry.m_connected_bus_item;

      // In some cases, the connection list (SCH_CONNECTION*) can be null.
      // Skip null connections.
      if (
        bus_entry.Connection(sheet) &&
        bus_wire.Type() === KICAD_T.SCH_LINE_T &&
        bus_wire.Connection(sheet)
      ) {
        conflict = true; // Assume a conflict; we'll reset if we find it's OK

        bus_name = bus_wire.Connection(sheet)!.Name();

        const test_names = new Set<string>();
        test_names.add(bus_entry.Connection(sheet)!.FullLocalName());

        const baseName = sheet.PathHumanReadable();

        for (const driver of aSubgraph.m_drivers)
          test_names.add(baseName + aSubgraph.GetNameForDriver(driver));

        for (const member of bus_wire.Connection(sheet)!.Members()) {
          if (member.Type() === CONNECTION_TYPE.BUS) {
            for (const sub_member of member.Members()) {
              if (test_names.has(sub_member.FullLocalName())) conflict = false;
            }
          } else if (test_names.has(member.FullLocalName())) {
            conflict = false;
          }
        }
      }
    }

    // Don't report warnings if this bus member has been overridden by a higher priority power pin
    // or global label
    if (
      conflict &&
      CONNECTION_SUBGRAPH.GetDriverPriority(aSubgraph.m_driver) >=
        CONNECTION_SUBGRAPH.PRIORITY.GLOBAL_POWER_PIN
    ) {
      conflict = false;
    }

    if (conflict) {
      const netName = aSubgraph.m_driver_connection.Name();
      const msg = `Net ${unescapeString(netName)} is graphically connected to bus ${unescapeString(bus_name)} but is not a member of that bus`;
      const ercItem = ERC_ITEM.Create(ERCE_T.ERCE_BUS_ENTRY_CONFLICT)!;
      ercItem.SetSheetSpecificPath(sheet);
      ercItem.SetItems(bus_entry, bus_wire);
      ercItem.SetErrorMessage(msg);

      CONNECTION_GRAPH.addMarker(sheet, ercItem, bus_entry!.GetPosition());

      return false;
    }

    return true;
  }

  /**
   * Check one subgraph for proper presence or absence of no-connect symbols.
   *
   * A pin with a no-connect symbol should not have any connections.
   * A pin without a no-connect symbol should have at least one connection.
   */
  private ercCheckNoConnects(aSubgraph: CONNECTION_SUBGRAPH): boolean {
    const settings = this.m_schematic!.ErcSettings();
    const sheet = aSubgraph.m_sheet;
    const screen = sheet.LastScreen()!;
    let ok = true;
    let pin: SCH_PIN | null = null;

    const unique_pins = new Set<SCH_PIN>();
    const unique_labels = new Set<SCH_LABEL_BASE>();

    const netName = this.GetResolvedSubgraphName(aSubgraph);

    const process_subgraph = (aProcessGraph: CONNECTION_SUBGRAPH): void => {
      // Any subgraph that contains a no-connect should not
      // more than one pin (which would indicate it is connected
      for (const item of aProcessGraph.m_items) {
        switch (item.Type()) {
          case KICAD_T.SCH_PIN_T: {
            const test_pin = item as SCH_PIN;

            // Only link NC to pin on the current subgraph being checked
            if (aProcessGraph === aSubgraph) pin = test_pin;

            if (![...unique_pins].some((aPin) => test_pin.IsStacked(aPin)))
              unique_pins.add(test_pin);

            break;
          }

          case KICAD_T.SCH_LABEL_T:
          case KICAD_T.SCH_GLOBAL_LABEL_T:
          case KICAD_T.SCH_HIER_LABEL_T:
            unique_labels.add(item as SCH_LABEL_BASE);
            break;

          default:
            break;
        }
      }
    };

    const it = this.m_net_name_to_subgraphs_map.get(netName);

    if (it) {
      for (const subgraph of it) process_subgraph(subgraph);
    } else {
      process_subgraph(aSubgraph);
    }

    if (aSubgraph.m_no_connect !== null) {
      // If this subgraph reaches the rest of the schematic only through a hier
      // sheet pin (parent side) or hier label (inner side), and contains no real
      // connection points of its own, suppress the warning.  The user's intent
      // is to mark the hier link as unconnected -- whether the no-connect sits
      // on the pin or at the end of a short wire stub.
      if (aSubgraph.m_hier_pins.size > 0 || aSubgraph.m_hier_ports.size > 0) {
        let clean = true;

        for (const item of aSubgraph.m_items) {
          switch (item.Type()) {
            case KICAD_T.SCH_PIN_T:
            case KICAD_T.SCH_LABEL_T:
            case KICAD_T.SCH_GLOBAL_LABEL_T:
            case KICAD_T.SCH_DIRECTIVE_LABEL_T:
              clean = false;
              break;
            default:
              break;
          }

          if (!clean) break;
        }

        if (clean) return true;
      }

      // Special case: If the subgraph being checked consists of only a hier port/pin and
      // a no-connect, we don't issue a "no-connect connected" warning just because
      // connections exist on the sheet on the other side of the link.
      const noConnectPos = aSubgraph.m_no_connect.GetPosition();

      for (const hierPin of aSubgraph.m_hier_pins) {
        if (samePt(hierPin.GetPosition(), noConnectPos)) return true;
      }

      for (const hierLabel of aSubgraph.m_hier_ports) {
        if (samePt(hierLabel.GetPosition(), noConnectPos)) return true;
      }

      for (const item of screen.Items().Overlapping(KICAD_T.SCH_SYMBOL_T, noConnectPos)) {
        const symbol = item as SCH_SYMBOL;

        const test_pin = symbol.GetPin(noConnectPos);

        if (test_pin && test_pin.GetType() === ELECTRICAL_PINTYPE.PT_NC) return true;
      }

      if (unique_pins.size > 1 && settings.IsTestEnabled(ERCE_T.ERCE_NOCONNECT_CONNECTED)) {
        const ercItem = ERC_ITEM.Create(ERCE_T.ERCE_NOCONNECT_CONNECTED)!;
        ercItem.SetSheetSpecificPath(sheet);
        ercItem.SetItemsSheetPaths(sheet);

        let pos: VECTOR2I;

        if (pin) {
          const thePin = pin as SCH_PIN;
          ercItem.SetItems(thePin, aSubgraph.m_no_connect);
          pos = thePin.GetPosition();
        } else {
          ercItem.SetItems(aSubgraph.m_no_connect);
          pos = aSubgraph.m_no_connect.GetPosition();
        }

        CONNECTION_GRAPH.addMarker(sheet, ercItem, pos);

        ok = false;
      }

      if (
        unique_pins.size === 0 &&
        unique_labels.size === 0 &&
        settings.IsTestEnabled(ERCE_T.ERCE_NOCONNECT_NOT_CONNECTED)
      ) {
        const ercItem = ERC_ITEM.Create(ERCE_T.ERCE_NOCONNECT_NOT_CONNECTED)!;
        ercItem.SetItems(aSubgraph.m_no_connect);
        ercItem.SetSheetSpecificPath(sheet);
        ercItem.SetItemsSheetPaths(sheet);

        CONNECTION_GRAPH.addMarker(sheet, ercItem, aSubgraph.m_no_connect.GetPosition());

        ok = false;
      }
    } else {
      let has_other_connections = false;
      const pins: SCH_PIN[] = [];

      // Any subgraph that lacks a no-connect and contains a pin should also
      // contain at least one other potential driver

      for (const item of aSubgraph.m_items) {
        switch (item.Type()) {
          case KICAD_T.SCH_PIN_T: {
            const test_pin = item as SCH_PIN;

            // Stacked pins do not count as other connections but non-stacked pins do
            if (
              !has_other_connections &&
              pins.length > 0 &&
              !test_pin.GetParentSymbol()!.IsPower()
            ) {
              for (const other_pin of pins) {
                if (!test_pin.IsStacked(other_pin)) {
                  has_other_connections = true;
                  break;
                }
              }
            }

            pins.push(item as SCH_PIN);

            break;
          }

          default:
            if (CONNECTION_SUBGRAPH.GetDriverPriority(item) !== CONNECTION_SUBGRAPH.PRIORITY.NONE)
              has_other_connections = true;

            break;
        }
      }

      // For many checks, we can just use the first pin
      pin = pins.length === 0 ? null : pins[0]!;

      // But if there is a power pin, it might be connected elsewhere
      for (const test_pin of pins) {
        // Prefer the pin is part of a real component rather than some stray power symbol
        // Or else we may fail walking connected components to a power symbol pin since we
        // reject starting at a power symbol
        if (test_pin.GetType() === ELECTRICAL_PINTYPE.PT_POWER_IN && !test_pin.IsPower()) {
          pin = test_pin;
          break;
        }
      }

      // Check if power input pins connect to anything else via net name,
      // but not for power symbols (with visible or legacy invisible pins).
      // We want to throw unconnected errors for power symbols even if they are connected to other
      // net items by name, because usually failing to connect them graphically is a mistake
      const thePin = pin as SCH_PIN | null;
      const pinLibParent = thePin?.GetLibPin() ? thePin.GetLibPin()!.GetParentSymbol() : null;

      if (
        thePin &&
        !has_other_connections &&
        !thePin.IsPower() &&
        (!pinLibParent || !pinLibParent.IsPower())
      ) {
        const name = thePin.Connection(sheet)!.Name();
        const local_name = thePin.Connection(sheet)!.Name(true);

        if (
          this.m_global_label_cache.has(name) ||
          this.m_local_label_cache.has(CONNECTION_GRAPH.localLabelKey(sheet, local_name))
        ) {
          has_other_connections = true;
        }
      }

      // Only one pin, and it's not a no-connect pin
      if (
        thePin &&
        !has_other_connections &&
        thePin.GetType() !== ELECTRICAL_PINTYPE.PT_NC &&
        thePin.GetType() !== ELECTRICAL_PINTYPE.PT_NIC &&
        settings.IsTestEnabled(ERCE_T.ERCE_PIN_NOT_CONNECTED)
      ) {
        const ercItem = ERC_ITEM.Create(ERCE_T.ERCE_PIN_NOT_CONNECTED)!;
        ercItem.SetSheetSpecificPath(sheet);
        ercItem.SetItemsSheetPaths(sheet);
        ercItem.SetItems(thePin);

        CONNECTION_GRAPH.addMarker(sheet, ercItem, thePin.GetPosition());

        ok = false;
      }

      // If there are multiple pins in this SG, they might be indirectly connected (by netname)
      // rather than directly connected (by wires).  We want to flag dangling pins even if they
      // join nets with another pin, as it's often a mistake
      if (pins.length > 1) {
        for (const testPin of pins) {
          // We only apply this test to power symbols, because other symbols have
          // pins that are meant to be dangling, but the power symbols have pins
          // that are *not* meant to be dangling.
          const testLibParent = testPin.GetLibPin() ? testPin.GetLibPin()!.GetParentSymbol() : null;

          if (
            testLibParent?.IsPower() &&
            testPin.ConnectedItems(sheet).length === 0 &&
            settings.IsTestEnabled(ERCE_T.ERCE_PIN_NOT_CONNECTED)
          ) {
            const ercItem = ERC_ITEM.Create(ERCE_T.ERCE_PIN_NOT_CONNECTED)!;
            ercItem.SetSheetSpecificPath(sheet);
            ercItem.SetItemsSheetPaths(sheet);
            ercItem.SetItems(testPin);

            CONNECTION_GRAPH.addMarker(sheet, ercItem, testPin.GetPosition());

            ok = false;
          }
        }
      }
    }

    return ok;
  }

  /**
   * Check one subgraph for dangling wire endpoints.
   *
   * Will throw an error for any subgraph that has wires with only one endpoing
   *
   * Upstream returns `err_count > 0`, so a subgraph WITH dangling endpoints counts as "ok"
   * and one without counts as an error in RunERC's tally; kept as written.
   */
  private ercCheckDanglingWireEndpoints(aSubgraph: CONNECTION_SUBGRAPH): boolean {
    let err_count = 0;
    const sheet = aSubgraph.m_sheet;

    for (const item of aSubgraph.m_items) {
      if (item.GetLayer() !== SCH_LAYER_ID.LAYER_WIRE) continue;

      if (item.Type() === KICAD_T.SCH_LINE_T) {
        const line = item as SCH_LINE;

        if (line.IsGraphicLine()) continue;

        const report_error = (location: VECTOR2I): void => {
          const ercItem = ERC_ITEM.Create(ERCE_T.ERCE_UNCONNECTED_WIRE_ENDPOINT)!;

          ercItem.SetItems(line);
          ercItem.SetSheetSpecificPath(sheet);
          ercItem.SetErrorMessage('Unconnected wire endpoint');

          CONNECTION_GRAPH.addMarker(sheet, ercItem, location);

          err_count++;
        };

        if (line.IsStartDangling()) report_error(line.GetConnectionPoints()[0]!);

        if (line.IsEndDangling()) report_error(line.GetConnectionPoints()[1]!);
      } else if (item.Type() === KICAD_T.SCH_BUS_WIRE_ENTRY_T) {
        const entry = item as SCH_BUS_WIRE_ENTRY;

        const report_error = (location: VECTOR2I): void => {
          const ercItem = ERC_ITEM.Create(ERCE_T.ERCE_UNCONNECTED_WIRE_ENDPOINT)!;

          ercItem.SetItems(entry);
          ercItem.SetSheetSpecificPath(sheet);
          ercItem.SetErrorMessage('Unconnected wire to bus entry');

          CONNECTION_GRAPH.addMarker(sheet, ercItem, location);

          err_count++;
        };

        if (entry.IsStartDangling()) report_error(entry.GetConnectionPoints()[0]!);

        if (entry.IsEndDangling()) report_error(entry.GetConnectionPoints()[1]!);
      }
    }

    return err_count > 0;
  }

  /**
   * Check one subgraph for floating wires.
   *
   * Will throw an error for any subgraph that consists of just wires with no driver.
   */
  private ercCheckFloatingWires(aSubgraph: CONNECTION_SUBGRAPH): boolean {
    if (aSubgraph.m_driver) return true;

    const sheet = aSubgraph.m_sheet;
    const wires: SCH_ITEM[] = [];

    // We've gotten this far, so we know we have no valid driver.  All we need to do is check
    // for a wire that we can place the error on.
    for (const item of aSubgraph.m_items) {
      if (item.Type() === KICAD_T.SCH_LINE_T && item.GetLayer() === SCH_LAYER_ID.LAYER_WIRE)
        wires.push(item);
      else if (item.Type() === KICAD_T.SCH_BUS_WIRE_ENTRY_T) wires.push(item);
    }

    if (wires.length > 0) {
      const ercItem = ERC_ITEM.Create(ERCE_T.ERCE_WIRE_DANGLING)!;
      ercItem.SetSheetSpecificPath(sheet);
      ercItem.SetItems(wires[0]!, wires[1] ?? null, wires[2] ?? null, wires[3] ?? null);

      CONNECTION_GRAPH.addMarker(sheet, ercItem, wires[0]!.GetPosition());

      return false;
    }

    return true;
  }

  /**
   * Check one subgraph for proper connection of labels.
   *
   * Labels should be connected to something.
   */
  private ercCheckLabels(aSubgraph: CONNECTION_SUBGRAPH): boolean {
    // Label connection rules:
    // Any label without a no-connect needs to have at least 2 pins, otherwise it is invalid
    // Local labels are flagged if they don't connect to any pins and don't have a no-connect
    // Global labels are flagged if they appear only once, don't connect to any local labels,
    // and don't have a no-connect marker

    if (!aSubgraph.m_driver_connection) return true;

    // Buses are excluded from this test: many users create buses with only a single instance
    // and it's not really a problem as long as the nets in the bus pass ERC
    if (aSubgraph.m_driver_connection.IsBus()) return true;

    const sheet = aSubgraph.m_sheet;
    const settings = this.m_schematic!.ErcSettings();
    let ok = true;
    let pinCount = 0;
    let has_nc = !!aSubgraph.m_no_connect;

    // std::map<KICAD_T, …>: walked in type order below
    const label_map = new Map<KICAD_T, SCH_TEXT[]>();

    const hasPins = (aLocSubgraph: CONNECTION_SUBGRAPH): number => {
      let n = 0;

      for (const item of aLocSubgraph.m_items) if (item.Type() === KICAD_T.SCH_PIN_T) n++;

      return n;
    };

    const reportError = (aText: SCH_TEXT, errCode: number): void => {
      if (settings.IsTestEnabled(errCode)) {
        const ercItem = ERC_ITEM.Create(errCode)!;
        ercItem.SetSheetSpecificPath(sheet);
        ercItem.SetItems(aText);

        CONNECTION_GRAPH.addMarker(aSubgraph.m_sheet, ercItem, aText.GetPosition());
      }
    };

    pinCount = hasPins(aSubgraph);

    for (const item of aSubgraph.m_items) {
      switch (item.Type()) {
        case KICAD_T.SCH_LABEL_T:
        case KICAD_T.SCH_GLOBAL_LABEL_T:
        case KICAD_T.SCH_HIER_LABEL_T: {
          const text = item as SCH_TEXT;

          pushInto(label_map, item.Type(), text);

          // Below, we'll create an ERC if the whole subgraph is unconnected.  But, additionally,
          // we want to error if an individual label in the subgraph is floating, even if it's
          // connected to other valid things by way of another label on the same sheet.
          if (text.IsDangling()) {
            reportError(text, ERCE_T.ERCE_LABEL_NOT_CONNECTED);
            return false;
          }

          break;
        }

        default:
          break;
      }
    }

    if (label_map.size === 0) return true;

    // No-connects on net neighbors will be noticed before, but to notice them on bus parents we
    // need to walk the graph
    for (const subgraphs of aSubgraph.m_bus_parents.values()) {
      for (const busParent of subgraphs) {
        if (busParent.m_no_connect) {
          has_nc = true;
          break;
        }

        let hp = busParent.m_hier_parent;

        while (hp) {
          if (hp.m_no_connect) {
            has_nc = true;
            break;
          }

          hp = hp.m_hier_parent;
        }
      }
    }

    const netName = this.GetResolvedSubgraphName(aSubgraph);

    // Labels that have multiple pins connected are not dangling (may be used for naming segments)
    // so leave them without errors here
    if (pinCount > 1) return true;

    for (const type of [...label_map.keys()].sort((a, b) => a - b)) {
      for (const text of label_map.get(type)!) {
        let allPins = pinCount;
        let localPins = pinCount;
        let hasLocalHierarchy = false;

        if (aSubgraph.m_hier_pins.size > 0 || aSubgraph.m_hier_ports.size > 0) {
          // A label bridging multiple hierarchical connections
          // (e.g., connecting sheet pins from different sub-sheet
          // instances) is serving a valid routing purpose even
          // without local component pins.
          const uniquePortNames = new Set<string>();
          for (const port of aSubgraph.m_hier_ports)
            uniquePortNames.add(aSubgraph.GetNameForDriver(port));

          if (aSubgraph.m_hier_pins.size + uniquePortNames.size > 1) hasLocalHierarchy = true;

          // Also check bus parents for bus-based hierarchical
          // routing on the same sheet.
          for (const busParents of aSubgraph.m_bus_parents.values()) {
            for (const busParent of busParents) {
              if (
                busParent.m_sheet.equals(sheet) &&
                (busParent.m_hier_pins.size > 0 || busParent.m_hier_ports.size > 0)
              ) {
                hasLocalHierarchy = true;
                break;
              }
            }

            if (hasLocalHierarchy) break;
          }
        }

        const it = this.m_net_name_to_subgraphs_map.get(netName);

        if (it) {
          for (const neighbor of it) {
            if (neighbor === aSubgraph) continue;

            if (neighbor.m_no_connect) has_nc = true;

            const neighborPins = hasPins(neighbor);
            allPins += neighborPins;

            if (neighbor.m_sheet.equals(sheet)) {
              localPins += neighborPins;

              if (neighbor.m_hier_pins.size > 0 || neighbor.m_hier_ports.size > 0)
                hasLocalHierarchy = true;
            }
          }
        }

        if (allPins === 1 && !has_nc) {
          reportError(text, ERCE_T.ERCE_LABEL_SINGLE_PIN);
          ok = false;
        }

        // A local label that connects to other subgraphs with
        // hierarchical connections on the same sheet (through bus
        // parents or net-name neighbors) is routing signals and should
        // not be flagged even without local component pins.
        if (
          allPins === 0 ||
          (type === KICAD_T.SCH_LABEL_T &&
            localPins === 0 &&
            allPins > 1 &&
            !has_nc &&
            !hasLocalHierarchy)
        ) {
          reportError(text, ERCE_T.ERCE_LABEL_NOT_CONNECTED);
          ok = false;
        }
      }
    }

    return ok;
  }

  /**
   * Check that a global label is instantiated more that once across the schematic hierarchy
   */
  private ercCheckSingleGlobalLabel(): number {
    let errors = 0;

    // std::map<wxString, …>: walked in key order below
    const labelData = new Map<string, [number, SCH_ITEM | null, SCH_SHEET_PATH]>();

    for (const sheet of this.m_sheetList) {
      for (const item of sheet.LastScreen()!.Items().OfType(KICAD_T.SCH_GLOBAL_LABEL_T)) {
        const labelText = item as SCH_TEXT;
        const resolvedLabelText = EscapeString(
          labelText.GetShownText(sheet, false),
          ESCAPE_CONTEXT.CTX_NETNAME,
        );

        const entry = labelData.get(resolvedLabelText);

        if (!entry) {
          labelData.set(resolvedLabelText, [1, item, sheet]);
        } else {
          entry[0] += 1;
          entry[1] = null;
          entry[2] = sheet;
        }
      }
    }

    for (const name of [...labelData.keys()].sort()) {
      const [count, item, sheet] = labelData.get(name)!;

      if (count === 1) {
        const ercItem = ERC_ITEM.Create(ERCE_T.ERCE_SINGLE_GLOBAL_LABEL)!;
        ercItem.SetItems(item);
        ercItem.SetSheetSpecificPath(sheet);
        ercItem.SetItemsSheetPaths(sheet);

        CONNECTION_GRAPH.addMarker(sheet, ercItem, item!.GetPosition());

        errors++;
      }
    }

    return errors;
  }

  /**
   * Check directive labels should be connected to something.
   *
   * @return                the number of errors found.
   */
  private ercCheckDirectiveLabels(): number {
    let error_count = 0;

    for (const sheet of this.m_sheetList) {
      for (const item of sheet.LastScreen()!.Items().OfType(KICAD_T.SCH_DIRECTIVE_LABEL_T)) {
        const label = item as SCH_LABEL_BASE;

        if (label.IsDangling()) {
          const ercItem = ERC_ITEM.Create(ERCE_T.ERCE_LABEL_NOT_CONNECTED)!;
          ercItem.SetSheetSpecificPath(sheet);
          ercItem.SetItems(item);

          CONNECTION_GRAPH.addMarker(sheet, ercItem, item.GetPosition());
          error_count++;
        }
      }
    }

    return error_count;
  }

  /**
   * Check that a hierarchical sheet has at least one matching label inside the sheet for each
   * port on the parent sheet object.
   *
   * @return                the number of errors found.
   */
  private ercCheckHierSheets(): number {
    let errors = 0;

    const settings = this.m_schematic!.ErcSettings();

    for (const sheet of this.m_sheetList) {
      // Hierarchical labels in the top-level sheets cannot be connected to anything.
      if (sheet.Last()!.IsTopLevelSheet()) {
        for (const item of sheet.LastScreen()!.Items().OfType(KICAD_T.SCH_HIER_LABEL_T)) {
          const label = item as SCH_HIERLABEL;

          const msg = `Hierarchical label '${label.GetShownText(sheet, true)}' in root sheet cannot be connected to non-existent parent sheet`;
          const ercItem = ERC_ITEM.Create(ERCE_T.ERCE_PIN_NOT_CONNECTED)!;
          ercItem.SetItems(item);
          ercItem.SetErrorMessage(msg);

          CONNECTION_GRAPH.addMarker(sheet, ercItem, item.GetPosition());

          errors++;
        }
      }

      for (const item of sheet.LastScreen()!.Items().OfType(KICAD_T.SCH_SHEET_T)) {
        const parentSheet = item as SCH_SHEET;
        const parentSheetPath = sheet.Clone();

        parentSheetPath.push_back(parentSheet);

        // std::map<wxString, …>: walked in key order below
        const pins = new Map<string, SCH_SHEET_PIN>();
        const labels = new Map<string, SCH_HIERLABEL>();

        for (const pin of parentSheet.GetPins()) {
          if (settings.IsTestEnabled(ERCE_T.ERCE_HIERACHICAL_LABEL))
            pins.set(pin.GetShownText(parentSheetPath, false), pin);

          if (pin.IsDangling() && settings.IsTestEnabled(ERCE_T.ERCE_PIN_NOT_CONNECTED)) {
            const ercItem = ERC_ITEM.Create(ERCE_T.ERCE_PIN_NOT_CONNECTED)!;
            ercItem.SetItems(pin);
            ercItem.SetSheetSpecificPath(sheet);
            ercItem.SetItemsSheetPaths(sheet);

            CONNECTION_GRAPH.addMarker(sheet, ercItem, pin.GetPosition());

            errors++;
          }
        }

        if (settings.IsTestEnabled(ERCE_T.ERCE_HIERACHICAL_LABEL)) {
          const matchedPins = new Set<string>();

          for (const subItem of parentSheet.GetScreen()!.Items()) {
            if (subItem.Type() === KICAD_T.SCH_HIER_LABEL_T) {
              const label = subItem as SCH_HIERLABEL;
              const labelText = label.GetShownText(parentSheetPath, false);

              if (!pins.has(labelText)) labels.set(labelText, label);
              else matchedPins.add(labelText);
            }
          }

          for (const matched of matchedPins) pins.delete(matched);

          for (const name of [...pins.keys()].sort()) {
            const pin = pins.get(name)!;
            const msg = `Sheet pin ${unescapeString(name)} has no matching hierarchical label inside the sheet`;

            const ercItem = ERC_ITEM.Create(ERCE_T.ERCE_HIERACHICAL_LABEL)!;
            ercItem.SetItems(pin);
            ercItem.SetErrorMessage(msg);
            ercItem.SetSheetSpecificPath(sheet);
            ercItem.SetItemsSheetPaths(sheet);

            CONNECTION_GRAPH.addMarker(sheet, ercItem, pin.GetPosition());

            errors++;
          }

          for (const name of [...labels.keys()].sort()) {
            const label = labels.get(name)!;
            const msg = `Hierarchical label ${unescapeString(name)} has no matching sheet pin in the parent sheet`;

            const ercItem = ERC_ITEM.Create(ERCE_T.ERCE_HIERACHICAL_LABEL)!;
            ercItem.SetItems(label);
            ercItem.SetErrorMessage(msg);
            ercItem.SetSheetSpecificPath(parentSheetPath);
            ercItem.SetItemsSheetPaths(parentSheetPath);

            parentSheet.GetScreen()!.Append(new SCH_MARKER(ercItem, label.GetPosition()));

            errors++;
          }
        }
      }
    }

    return errors;
  }
}

/** `aConnectionMap[ aPoint ].push_back( aItem )` over the (x, y)-keyed map. */
function mapPush(
  aMap: Map<string, [VECTOR2I, SCH_ITEM[]]>,
  aPoint: VECTOR2I,
  aItem: SCH_ITEM,
): void {
  const key = `${aPoint.x},${aPoint.y}`;
  let entry = aMap.get(key);

  if (!entry) {
    entry = [{ x: aPoint.x, y: aPoint.y }, []];
    aMap.set(key, entry);
  }

  entry[1].push(aItem);
}

/** `aMap[ aKey ].insert( aValue )` for the bus neighbor/parent maps. */
function setInsert<K, V>(aMap: Map<K, Set<V>>, aKey: K, aValue: V): void {
  let set = aMap.get(aKey);

  if (!set) {
    set = new Set();
    aMap.set(aKey, set);
  }

  set.add(aValue);
}

/** `wxString::BeforeFirst`: the whole string when the character is absent. */
function beforeFirst(aStr: string, aCh: string): string {
  const i = aStr.indexOf(aCh);
  return i < 0 ? aStr : aStr.slice(0, i);
}
