// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/sch_connection.h` / `sch_connection.cpp`: `CONNECTION_TYPE` and
 * `SCH_CONNECTION`, the logical connection (a net, a bus vector or a bus group)
 * a connectable item has on one sheet instance.
 *
 * Buses can be defined in multiple ways. A bus vector consists of a prefix and
 * a numeric range of suffixes:
 *
 *     BUS_NAME[M..N]
 *
 * For example, the bus A[3..0] will contain nets A3, A2, A1, and A0.
 * The BUS_NAME is required.  M and N must be integers but do not need to be in
 * any particular order -- A[0..3] produces the same result.
 *
 * Like net names, bus names cannot contain whitespace.
 *
 * A bus group is just a grouping of signals, separated by spaces, some
 * of which may be bus vectors.  Bus groups can have names, but do not need to.
 *
 *     MEMORY{A[15..0] D[7..0] RW CE OE}
 *
 * In named bus groups, the net names are expanded as <BUS_NAME>.<NET_NAME>
 * In the above example, the nets would be named like MEMORY.A15, MEMORY.D0, etc.
 *
 *     {USB_DP USB_DN}
 *
 * In the above example, the bus is unnamed and so the underlying net names are
 * just USB_DP and USB_DN.
 *
 * The graph is reached through {@link SCH_CONNECTION_GRAPH}, the two calls this class
 * makes of `CONNECTION_GRAPH`. Loading this module sets `SCH_ITEM.s_newConnection`, the
 * `new SCH_CONNECTION( this )` of `SCH_ITEM::InitializeConnection`. The
 * `#if defined(DEBUG)` rows of `AppendInfoToMsgPanel` are not here.
 */

import type { OutStr } from '@ziroeda/common/font/font.js';
import { NET_SETTINGS } from '@ziroeda/common/project/net_settings.js';
import { ESCAPE_CONTEXT, EscapeString, unescapeString } from '@ziroeda/common/string_utils.js';
import { MSG_PANEL_ITEM } from '@ziroeda/common/widgets/msgpanel.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { BUS_ALIAS } from './bus_alias.js';
import { SCH_ITEM } from './sch_item.js';
import type { SCH_PIN } from './sch_pin.js';
import { SCH_SHEET_PATH } from './sch_sheet_path.js';
import type { SCH_SYMBOL } from './sch_symbol.js';

export enum CONNECTION_TYPE {
  NONE, ///< No connection to this item
  NET, ///< This item represents a net
  BUS, ///< This item represents a bus vector
  BUS_GROUP, ///< This item represents a bus group
}

/** What `SCH_CONNECTION` asks of the `CONNECTION_GRAPH` it belongs to. */
export interface SCH_CONNECTION_GRAPH {
  GetBusAlias(aName: string): BUS_ALIAS | null;
  GetSubgraphForItem(aItem: SCH_ITEM | null): { GetNetName(): string } | null;
}

/**
 * Each graphical item can have a SCH_CONNECTION describing its logical
 * connection (to a bus or net).  These are generated when netlisting, or when
 * editing operations that can change the netlist are performed.
 *
 * In hierarchical schematics, a single SCH_ITEM object can refer to multiple
 * distinct parts of a design (in the case of a sub-sheet that is instanced
 * more than once in a higher level sheet).  Because of this, a single item may
 * contain more than one SCH_CONNECTION -- each is specific to a sheet.
 *
 * Symbols contain connections for each of their pins (and for each sheet they
 * exist on) but don't use their own connection object.
 */
export class SCH_CONNECTION {
  private m_dirty!: boolean;

  private m_sheet: SCH_SHEET_PATH; ///< The hierarchical sheet this connection is on

  /**
   * When a connection is overridden by one on a different hierarchical sheet, it will be cloned
   * and m_sheet will point to the parent sheet.  This member stores the original sheet so that it
   * can be used for applications such as net highlighting to retrieve the sheet of the parent
   * item from the highlighted connection.
   */
  private m_local_sheet: SCH_SHEET_PATH;

  private m_parent: SCH_ITEM | null; ///< The SCH_ITEM this connection is owned by
  private m_lastDriver: SCH_ITEM | null = null; ///< WEAK POINTER: equality comparisons only
  private m_driver: SCH_ITEM | null; ///< The SCH_ITEM that drives this connection's net

  private m_type!: CONNECTION_TYPE; ///< @see enum CONNECTION_TYPE

  private m_name = ''; ///< Name of the connection.
  private m_cached_name = ''; ///< Full name, including prefix and suffix
  private m_cached_name_with_path = ''; ///< Full name including sheet path (if not global)

  /**
   * For bus members, we want to keep track of the "local" name of a member, that is,
   * the name it takes on from its parent bus name.  This is because we always want to use
   * the local name for bus unfolding, matching within buses, etc.  The actual resolved name
   * of this bus member might change, for example if it's connected elsewhere to some other
   * item with higher priority.
   */
  private m_local_name = '';

  /// Prefix if connection is member of a labeled bus group (or "" if not)
  private m_prefix = '';

  /// Local prefix for group bus members (used with m_local_name)
  private m_local_prefix = '';

  /// Optional prefix of a bus group (always empty for nets and vector buses)
  private m_bus_prefix = '';

  private m_suffix = ''; ///< Name suffix (used only for disambiguation)

  private m_net_code!: number;
  private m_bus_code!: number;
  private m_subgraph_code!: number; ///< Groups directly-connected items

  private m_vector_index!: number; ///< Index of bus vector member nets
  private m_vector_start!: number; ///< Highest member of a vector bus
  private m_vector_end!: number; ///< Lowest member of a vector bus

  /// Prefix name of the vector, if m_type == CONNECTION_BUS (or "" if not).
  private m_vector_prefix = '';

  /**
   * For bus connections, store a list of member connections
   *
   * NOTE: All connections that Clone() others share the list of member
   * pointers.  This seems fine at the moment.
   */
  private m_members: SCH_CONNECTION[] = [];

  /**
   * Pointer to the connection graph for the schematic this connection exists on.
   * Needed for bus alias lookups.
   */
  private m_graph: SCH_CONNECTION_GRAPH | null;

  /** `SCH_CONNECTION( SCH_ITEM* aParent, const SCH_SHEET_PATH& aPath )`. */
  constructor(aParent?: SCH_ITEM | null, aPath?: SCH_SHEET_PATH);
  /** `SCH_CONNECTION( CONNECTION_GRAPH* aGraph )`. */
  constructor(aGraph: SCH_CONNECTION_GRAPH);
  constructor(a: SCH_ITEM | SCH_CONNECTION_GRAPH | null = null, aPath?: SCH_SHEET_PATH) {
    const isGraph =
      a !== null && typeof (a as SCH_CONNECTION_GRAPH).GetSubgraphForItem === 'function';

    this.m_sheet = aPath && !isGraph ? aPath.Clone() : new SCH_SHEET_PATH();
    this.m_local_sheet = this.m_sheet.Clone();
    this.m_parent = isGraph ? null : (a as SCH_ITEM | null);
    this.m_driver = null;
    this.m_graph = isGraph ? (a as SCH_CONNECTION_GRAPH) : null;

    this.Reset();
  }

  /** `SCH_CONNECTION( SCH_CONNECTION& aOther )`: no parent, then `Clone( aOther )`. */
  static copyOf(aOther: SCH_CONNECTION): SCH_CONNECTION {
    const c = new SCH_CONNECTION(null);
    c.Clone(aOther);
    return c;
  }

  /**
   * Note: the equality operator for SCH_CONNECTION only tests the net
   * properties, not the ownership / sheet location!
   */
  equals(aOther: SCH_CONNECTION): boolean {
    // NOTE: Not comparing m_dirty or net/bus/subgraph codes
    return (
      aOther.m_driver === this.m_driver &&
      aOther.m_type === this.m_type &&
      aOther.m_name === this.m_name &&
      aOther.m_sheet.equals(this.m_sheet)
    );
  }

  notEquals(aOther: SCH_CONNECTION): boolean {
    return !aOther.equals(this);
  }

  SetGraph(aGraph: SCH_CONNECTION_GRAPH | null): void {
    this.m_graph = aGraph;
  }

  /**
   * Configures the connection given a label.
   * For CONNECTION_NET, this just sets the name.
   * For CONNECTION_BUS, this will deduce the correct BUS_TYPE and also
   * generate a correct list of members.
   */
  ConfigureFromLabel(aLabel: string): void {
    this.m_members = [];

    this.m_name = aLabel;
    this.m_local_name = aLabel;
    this.m_local_prefix = this.m_prefix;

    const prefix: OutStr = { value: '' };
    const members: string[] = [];

    const unescaped = unescapeString(aLabel);

    if (NET_SETTINGS.ParseBusVector(unescaped, prefix, members)) {
      this.m_type = CONNECTION_TYPE.BUS;
      this.m_vector_prefix = prefix.value;

      let i = 0;

      for (const vector_member of members) {
        const member = new SCH_CONNECTION(this.m_parent, this.m_sheet);

        member.m_type = CONNECTION_TYPE.NET;
        member.m_prefix = this.m_prefix;
        member.m_local_name = vector_member;
        member.m_local_prefix = this.m_prefix;
        member.m_vector_index = i++;
        member.SetName(vector_member);
        member.SetGraph(this.m_graph);
        this.m_members.push(member);
      }
    } else if (NET_SETTINGS.ParseBusGroup(unescaped, prefix, members)) {
      this.m_type = CONNECTION_TYPE.BUS_GROUP;
      this.m_bus_prefix = prefix.value;

      // Named bus groups generate a net prefix, unnamed ones don't
      let netPrefix = prefix.value;

      if (netPrefix.length !== 0) netPrefix += '.';

      for (const group_member of members) {
        // Handle alias inside bus group member list
        const alias = this.m_graph!.GetBusAlias(group_member);

        if (alias) {
          for (const alias_member of alias.Members()) {
            const member = new SCH_CONNECTION(this.m_parent, this.m_sheet);
            member.SetPrefix(netPrefix);
            member.SetGraph(this.m_graph);
            member.ConfigureFromLabel(EscapeString(alias_member, ESCAPE_CONTEXT.CTX_NETNAME));
            this.m_members.push(member);
          }
        } else {
          const member = new SCH_CONNECTION(this.m_parent, this.m_sheet);
          member.SetPrefix(netPrefix);
          member.SetGraph(this.m_graph);
          member.ConfigureFromLabel(group_member);
          this.m_members.push(member);
        }
      }
    } else {
      this.m_type = CONNECTION_TYPE.NET;
    }

    this.recacheName();
  }

  /**
   * Clears connectivity information
   */
  Reset(): void {
    this.m_type = CONNECTION_TYPE.NONE;
    this.m_name = '';
    this.m_local_name = '';
    this.m_local_prefix = '';
    this.m_cached_name = '';
    this.m_cached_name_with_path = '';
    this.m_prefix = '';
    this.m_bus_prefix = '';
    this.m_suffix = '';
    this.m_lastDriver = this.m_driver;
    this.m_driver = null;
    this.m_members = [];
    this.m_dirty = true;
    this.m_net_code = 0;
    this.m_bus_code = 0;
    this.m_subgraph_code = 0;
    this.m_vector_start = 0;
    this.m_vector_end = 0;
    this.m_vector_index = 0;
    this.m_vector_prefix = '';
  }

  /**
   * Copies connectivity information (but not parent) from another connection
   *
   * @param aOther is the connection to clone
   */
  Clone(aOther: SCH_CONNECTION): void {
    this.m_graph = aOther.m_graph;

    // Note: m_lastDriver is not cloned as it needs to be the last driver of *this* connection
    this.m_driver = aOther.Driver();
    this.m_sheet = aOther.Sheet();

    // Note: m_local_sheet is not cloned
    this.m_name = aOther.m_name;

    const origType = this.m_type;
    this.m_type = aOther.m_type;

    // Note: m_local_name is not cloned if not set yet
    if (this.m_local_name.length === 0) {
      this.m_local_name = aOther.LocalName();
      this.m_local_prefix = aOther.Prefix();
    }

    this.m_prefix = aOther.Prefix();

    // m_bus_prefix is not cloned; only used for local names
    this.m_suffix = aOther.Suffix();
    this.m_net_code = aOther.NetCode();
    this.m_bus_code = aOther.BusCode();
    this.m_vector_start = aOther.VectorStart();
    this.m_vector_end = aOther.VectorEnd();

    // Note: m_vector_index is not cloned
    this.m_vector_prefix = aOther.VectorPrefix();

    // Note: subgraph code isn't cloned, it should remain with the original object

    // Handle vector bus members: make sure local names are preserved where possible
    const otherMembers = aOther.Members();

    const cloneMember = (aSrc: SCH_CONNECTION): SCH_CONNECTION => {
      const copy = new SCH_CONNECTION(this.m_parent, this.m_sheet);
      copy.SetGraph(this.m_graph);
      copy.Clone(aSrc);

      copy.m_vector_index = aSrc.m_vector_index;

      return copy;
    };

    if (origType === CONNECTION_TYPE.BUS && aOther.Type() === CONNECTION_TYPE.BUS) {
      if (this.m_members.length === 0) {
        for (const src of otherMembers) this.m_members.push(cloneMember(src));
      } else {
        const cloneLimit = Math.min(this.m_members.length, otherMembers.length);

        for (let i = 0; i < cloneLimit; ++i) this.m_members[i]!.Clone(otherMembers[i]!);
      }
    } else if (
      origType === CONNECTION_TYPE.BUS_GROUP &&
      aOther.Type() === CONNECTION_TYPE.BUS_GROUP
    ) {
      if (this.m_members.length === 0) {
        for (const src of otherMembers) this.m_members.push(cloneMember(src));
      } else {
        // TODO: refactor this once we support deep nesting
        for (const member of this.m_members) {
          const it = otherMembers.find((aTest) => aTest.LocalName() === member.LocalName());

          if (it) member.Clone(it);
        }
      }
    } else if (aOther.IsBus()) {
      this.m_members = [];

      for (const src of otherMembers) this.m_members.push(cloneMember(src));
    }

    this.m_type = aOther.Type();

    this.recacheName();
  }

  Parent(): SCH_ITEM | null {
    return this.m_parent;
  }

  Driver(): SCH_ITEM | null {
    return this.m_driver;
  }

  SetDriver(aItem: SCH_ITEM | null): void {
    this.m_driver = aItem;

    this.recacheName();

    for (const member of this.m_members) member.SetDriver(aItem);
  }

  Sheet(): SCH_SHEET_PATH {
    return this.m_sheet.Clone();
  }

  SetSheet(aSheet: SCH_SHEET_PATH): void {
    this.m_sheet = aSheet.Clone();
    this.m_local_sheet = aSheet.Clone();

    this.recacheName();

    for (const member of this.m_members) member.SetSheet(aSheet);
  }

  LocalSheet(): SCH_SHEET_PATH {
    return this.m_local_sheet.Clone();
  }

  /**
   * Checks if the SCH_ITEM this connection is attached to can drive connections
   * Drivers can be labels, sheet pins, or symbol pins.
   *
   * @return true if the attached items is a driver
   */
  IsDriver(): boolean {
    const parent = this.Parent()!;
    console.assert(parent !== null);

    switch (parent.Type()) {
      case KICAD_T.SCH_LABEL_T:
      case KICAD_T.SCH_GLOBAL_LABEL_T:
      case KICAD_T.SCH_HIER_LABEL_T:
      case KICAD_T.SCH_SHEET_PIN_T:
      case KICAD_T.SCH_SHEET_T:
        return true;

      case KICAD_T.SCH_PIN_T: {
        const pin = parent as SCH_PIN;
        const symbol = pin.GetParentSymbol();

        // dynamic_cast<const SCH_SYMBOL*>
        if (symbol && (symbol as unknown as SCH_ITEM).Type() === KICAD_T.SCH_SYMBOL_T) {
          // Only annotated symbols should drive nets.
          return pin.IsPower() || (symbol as unknown as SCH_SYMBOL).IsAnnotated(this.m_sheet);
        }

        return true;
      }

      default:
        return false;
    }
  }

  IsBus(): boolean {
    return this.m_type === CONNECTION_TYPE.BUS || this.m_type === CONNECTION_TYPE.BUS_GROUP;
  }

  IsNet(): boolean {
    return this.m_type === CONNECTION_TYPE.NET;
  }

  IsUnconnected(): boolean {
    return this.m_type === CONNECTION_TYPE.NONE;
  }

  IsDirty(): boolean {
    return this.m_dirty;
  }
  SetDirty(): void {
    this.m_dirty = true;
  }
  ClearDirty(): void {
    this.m_dirty = false;
  }

  HasDriverChanged(): boolean {
    return this.m_driver !== this.m_lastDriver;
  }

  ClearDriverChanged(): void {
    this.m_lastDriver = this.m_driver;
  }

  GetLastDriver(): SCH_ITEM | null {
    return this.m_lastDriver;
  }

  Name(aIgnoreSheet = false): string {
    console.assert(this.m_cached_name.length !== 0);
    return aIgnoreSheet ? this.m_cached_name : this.m_cached_name_with_path;
  }

  LocalName(): string {
    return this.m_local_name;
  }

  FullLocalName(): string {
    return this.m_local_prefix + this.m_local_name + this.m_suffix;
  }

  SetName(aName: string): void {
    this.m_name = aName;
    this.recacheName();
  }

  GetNetName(): string {
    let retv = '';

    if (this.m_graph) {
      const subgraph = this.m_graph.GetSubgraphForItem(this.m_parent);

      if (subgraph) retv = subgraph.GetNetName();
    }

    return retv;
  }

  Prefix(): string {
    return this.m_prefix;
  }

  SetPrefix(aPrefix: string): void {
    this.m_prefix = aPrefix;

    this.recacheName();

    for (const m of this.Members()) m.SetPrefix(aPrefix);
  }

  BusPrefix(): string {
    return this.m_bus_prefix;
  }

  Suffix(): string {
    return this.m_suffix;
  }

  /// Unlike SetPrefix, the suffix is not pushed onto bus members. Members are matched to their
  /// breakout labels by name, so a disambiguating suffix must stay on the bus itself (issue #21798).
  SetSuffix(aSuffix: string): void {
    this.m_suffix = aSuffix;

    this.recacheName();
  }

  Type(): CONNECTION_TYPE {
    return this.m_type;
  }

  SetType(aType: CONNECTION_TYPE): void {
    this.m_type = aType;
    this.recacheName();
  }

  NetCode(): number {
    return this.m_net_code;
  }
  SetNetCode(aCode: number): void {
    this.m_net_code = aCode;
  }

  BusCode(): number {
    return this.m_bus_code;
  }
  SetBusCode(aCode: number): void {
    this.m_bus_code = aCode;
  }

  SubgraphCode(): number {
    return this.m_subgraph_code;
  }
  SetSubgraphCode(aCode: number): void {
    this.m_subgraph_code = aCode;
  }

  VectorStart(): number {
    return this.m_vector_start;
  }
  VectorEnd(): number {
    return this.m_vector_end;
  }
  VectorIndex(): number {
    return this.m_vector_index;
  }
  VectorPrefix(): string {
    return this.m_vector_prefix;
  }

  Members(): readonly SCH_CONNECTION[] {
    return this.m_members;
  }

  AllMembers(): SCH_CONNECTION[] {
    const ret = [...this.m_members];

    for (const member of this.m_members) {
      if (member.IsBus()) ret.push(...member.Members());
    }

    return ret;
  }

  static PrintBusForUI(aGroup: string): string {
    // Net names are stored escaped (e.g. '/' is encoded as "{slash}") so that they round-trip
    // through the s-expression parser.  The unfold-from-bus menu and similar UI surfaces want
    // the human-readable form, so unescape before walking the formatting markup.  Otherwise
    // the "{slash}" sequence is mis-parsed as an opening overbar/sub/super group and the
    // trailing '}' is silently dropped.
    const unescaped = unescapeString(aGroup);

    const groupLen = unescaped.length;
    let i = 0;
    let ret = '';

    // Parse prefix
    //
    for (; i < groupLen; ++i) {
      if (isSuperSubOverbar(unescaped[i]!) && i + 1 < groupLen && unescaped[i + 1] === '{') {
        ret += unescaped[i];
        i++;
        continue;
      } else if (unescaped[i] === '}') {
        continue;
      }

      // Handle backslash-escaped spaces (display without the backslash)
      if (unescaped[i] === '\\' && i + 1 < groupLen && unescaped[i + 1] === ' ') {
        ret += ' ';
        i++;
        continue;
      }

      ret += unescaped[i];

      if (unescaped[i] === '{') break;
    }

    // Parse members
    //
    i++; // '{' character

    for (; i < groupLen; ++i) {
      if (isSuperSubOverbar(unescaped[i]!) && i + 1 < groupLen && unescaped[i + 1] === '{') {
        ret += unescaped[i];
        i++;
        continue;
      } else if (unescaped[i] === '}') {
        continue;
      }

      // Handle backslash-escaped spaces (display without the backslash)
      if (unescaped[i] === '\\' && i + 1 < groupLen && unescaped[i + 1] === ' ') {
        ret += ' ';
        i++;
        continue;
      }

      ret += unescaped[i];

      if (unescaped[i] === '}') break;
    }

    return ret;
  }

  /**
   * Returns true if this connection is contained within aOther (but not the same as aOther)
   * @return true if this connection is a member of aOther
   */
  IsSubsetOf(aOther: SCH_CONNECTION): boolean {
    if (!aOther.IsBus()) return false;

    if (!this.IsBus()) {
      for (const otherMember of aOther.Members()) {
        if (this.FullLocalName() === otherMember.FullLocalName()) return true;
      }

      return false;
    }

    // If both connections are buses, check if all members of this bus are in the other bus
    for (const member of this.m_members) {
      let found = false;

      for (const otherMember of aOther.Members()) {
        if (member.FullLocalName() === otherMember.FullLocalName()) {
          found = true;
          break;
        }
      }

      // If one of the members is not found in the other connection, this is not a subset
      if (!found) return false;
    }

    return true;
  }

  /**
   * Returns true if this connection is a member of bus connection aOther
   *
   * Will always return false if aOther is not a bus connection
   */
  IsMemberOfBus(aOther: SCH_CONNECTION): boolean {
    if (!aOther.IsBus()) return false;

    const me = this.Name(true);

    for (const m of aOther.Members()) {
      if (m.Name(true) === me) return true;
    }

    return false;
  }

  /**
   * Adds information about the connection object to aList
   */
  AppendInfoToMsgPanel(aList: MSG_PANEL_ITEM[]): void {
    aList.push(new MSG_PANEL_ITEM('Connection Name', unescapeString(this.Name())));

    if (this.IsBus()) {
      const alias = this.m_graph?.GetBusAlias(this.m_name) ?? null;
      const group_name: OutStr = { value: '' };
      const group_members: string[] = [];

      if (alias) {
        aList.push(
          new MSG_PANEL_ITEM(`Bus Alias ${this.m_name} Members`, alias.Members().join(' ')),
        );
      } else if (NET_SETTINGS.ParseBusGroup(this.m_name, group_name, group_members)) {
        for (const group_member of group_members) {
          const group_alias = this.m_graph?.GetBusAlias(group_member) ?? null;

          if (group_alias) {
            aList.push(
              new MSG_PANEL_ITEM(
                `Bus Alias ${group_alias.GetName()} Members`,
                group_alias.Members().join(' '),
              ),
            );
          }
        }
      }
    }
  }

  /**
   * Test if \a aLabel has a bus notation.
   *
   * @param aLabel A wxString object containing the label to test.
   * @return true if text is a bus notation format otherwise false is returned.
   */
  static IsBusLabel(aLabel: string): boolean {
    const unescaped = unescapeString(aLabel);

    return (
      NET_SETTINGS.ParseBusVector(unescaped, null, null) ||
      NET_SETTINGS.ParseBusGroup(unescaped, null, null)
    );
  }

  /**
   * Test if \a aLabel looks like a bus notation.
   * This check is much less expensive than IsBusLabel.
   *
   * @param aLabel A wxString object containing the label to test.
   * @return true if text might be a bus label
   */
  static MightBeBusLabel(aLabel: string): boolean {
    // Weak heuristic for performance reasons.  Stronger test will be used for connectivity
    const label = unescapeString(aLabel);

    return label.includes('[') || label.includes('{');
  }

  private recacheName(): void {
    this.m_cached_name =
      this.m_name.length === 0 ? '<NO NET>' : this.m_prefix + this.m_name + this.m_suffix;

    let prepend_path = true;

    if (!this.Parent() || this.m_type === CONNECTION_TYPE.NONE) prepend_path = false;

    if (this.m_driver) {
      switch (this.m_driver.Type()) {
        case KICAD_T.SCH_GLOBAL_LABEL_T:
          prepend_path = false;
          break;

        case KICAD_T.SCH_PIN_T: {
          // Normal pins and global power pins do not need a path.  But local power pins do
          const pin = this.m_driver as SCH_PIN;

          prepend_path = pin.IsLocalPower();
          break;
        }

        default:
          break;
      }
    }

    // Use aEscapeSheetNames=true so that sheets with '/' in their names have the slash
    // escaped to "{slash}". This ensures pattern matching for net classes works correctly
    // since '/' is used as the hierarchy separator.
    this.m_cached_name_with_path = prepend_path
      ? this.m_sheet.PathHumanReadable(true, false, true) + this.m_cached_name
      : this.m_cached_name;
  }
}

function isSuperSubOverbar(c: string): boolean {
  return c === '_' || c === '^' || c === '~';
}

SCH_ITEM.s_newConnection = (aParent: SCH_ITEM): SCH_CONNECTION => new SCH_CONNECTION(aParent);
