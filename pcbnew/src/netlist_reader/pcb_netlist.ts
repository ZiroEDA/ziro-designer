/**
 * The netlist object model pcbnew consumes. Counterpart:
 * `pcbnew/netlist_reader/pcb_netlist.{h,cpp}` — COMPONENT_NET, NETLIST_GROUP,
 * COMPONENT and NETLIST.
 *
 * This is what the schematic hands the board: one COMPONENT per board-bound
 * symbol (reference, value, footprint id, symbol UUID path, fields, properties)
 * carrying a COMPONENT_NET per pad (pad number -> net name + pin function/type).
 * BOARD_NETLIST_UPDATER walks it and reconciles the board against it.
 *
 * Left out of this port, because the models behind them do not exist yet:
 * component classes, design variants and design-block layouts.
 */

import { strNumCmp } from '@ziroeda/common/src/string_utils.js';

/**
 * A pin-name -> net-name association (plus the pin's function and electrical
 * type) as it appears in the netlist. COMPONENT_NET.
 */
export class COMPONENT_NET {
  constructor(
    readonly pinName = '',
    readonly netName = '',
    readonly pinFunction = '',
    readonly pinType = '',
  ) {}

  /** COMPONENT_NET::IsValid — a net entry exists only for a named pin. */
  IsValid(): boolean {
    return this.pinName !== '';
  }
}

/** The empty net a missing pad lookup returns (COMPONENT::m_emptyNet). */
const EMPTY_NET = new COMPONENT_NET();

/**
 * A `(group …)` of the netlist: the symbol group whose members should become one
 * PCB group. Members are full instance paths (sheet path + symbol uuid).
 */
export interface NETLIST_GROUP {
  name: string;
  uuid: string;
  /** `(lib_id …)` — the design block this group came from, when any. */
  libId: string;
  members: string[];
}

/** COMPONENT::UNIT_INFO — a multi-unit symbol's unit name and its pin numbers. */
export interface UNIT_INFO {
  unitName: string;
  pins: string[];
}

/** Every piece of footprint information the netlist carries for one symbol. */
export class COMPONENT {
  private m_nets: COMPONENT_NET[] = [];
  private m_footprintFilters: string[] = [];
  private m_pinCount = 0;
  private m_name = '';
  private m_library = '';
  private m_humanReadablePath = '';
  private m_properties = new Map<string, string>();
  /** Insertion-ordered, like upstream's nlohmann::ordered_map. */
  private m_fields = new Map<string, string>();
  private m_units: UNIT_INFO[] = [];
  private m_group: NETLIST_GROUP | null = null;

  constructor(
    /** The footprint LIB_ID assigned to the symbol ("Library:Footprint"). */
    private m_fpid: string,
    private m_reference: string,
    private m_value: string,
    /**
     * The sheet path of the symbol — [ sheetUuid, … ] without the symbol itself,
     * formatted as KiCad's KIID_PATH string ("/" or "/uuid/uuid/").
     */
    readonly path: string,
    /** One UUID per placed unit of the symbol; the first is the primary. */
    readonly kiids: readonly string[],
  ) {}

  AddNet(pinName: string, netName: string, pinFunction: string, pinType: string): void {
    this.m_nets.push(new COMPONENT_NET(pinName, netName, pinFunction, pinType));
  }

  GetNetCount(): number {
    return this.m_nets.length;
  }

  /** COMPONENT::GetNet( index ). */
  GetNetAt(index: number): COMPONENT_NET {
    return this.m_nets[index] ?? EMPTY_NET;
  }

  /** COMPONENT::GetNet( pinName ) — the empty net when the pad has no pin. */
  GetNet(pinName: string): COMPONENT_NET {
    return this.m_nets.find((n) => n.pinName === pinName) ?? EMPTY_NET;
  }

  ClearNets(): void {
    this.m_nets = [];
  }

  /** COMPONENT::SortPins — COMPONENT_NET::operator< is by pin name. */
  SortPins(): void {
    this.m_nets.sort((a, b) => (a.pinName < b.pinName ? -1 : a.pinName > b.pinName ? 1 : 0));
  }

  SetName(name: string): void {
    this.m_name = name;
  }
  GetName(): string {
    return this.m_name;
  }

  SetLibrary(library: string): void {
    this.m_library = library;
  }
  GetLibrary(): string {
    return this.m_library;
  }

  SetReference(reference: string): void {
    this.m_reference = reference;
  }
  GetReference(): string {
    return this.m_reference;
  }

  SetValue(value: string): void {
    this.m_value = value;
  }
  GetValue(): string {
    return this.m_value;
  }

  SetFields(fields: Map<string, string>): void {
    this.m_fields = fields;
  }
  GetFields(): Map<string, string> {
    return this.m_fields;
  }

  SetProperties(props: Map<string, string>): void {
    this.m_properties = props;
  }
  GetProperties(): Map<string, string> {
    return this.m_properties;
  }

  SetFPID(fpid: string): void {
    this.m_fpid = fpid;
  }
  GetFPID(): string {
    return this.m_fpid;
  }

  SetFootprintFilters(filters: string[]): void {
    this.m_footprintFilters = filters;
  }
  GetFootprintFilters(): readonly string[] {
    return this.m_footprintFilters;
  }

  /** COMPONENT::IsLibSource — does this symbol come from `library:name`? */
  IsLibSource(library: string, name: string): boolean {
    return library === this.m_library && name === this.m_name;
  }

  SetPinCount(count: number): void {
    this.m_pinCount = count;
  }
  GetPinCount(): number {
    return this.m_pinCount;
  }

  SetHumanReadablePath(path: string): void {
    this.m_humanReadablePath = path;
  }
  GetHumanReadablePath(): string {
    return this.m_humanReadablePath;
  }

  SetUnitInfo(units: UNIT_INFO[]): void {
    this.m_units = units;
  }
  GetUnitInfo(): readonly UNIT_INFO[] {
    return this.m_units;
  }

  SetGroup(group: NETLIST_GROUP | null): void {
    this.m_group = group;
  }
  GetGroup(): NETLIST_GROUP | null {
    return this.m_group;
  }
}

/**
 * A LIB_ID with no library nickname ("R_0805" rather than "Resistor_SMD:R_0805"),
 * which older schematics and hand-edited Footprint fields still carry. LIB_ID::
 * IsLegacy.
 */
export const fpidIsLegacy = (fpid: string): boolean => fpid !== '' && !fpid.includes(':');

/** LIB_ID::GetLibItemName — the part after the nickname. */
export const fpidItemName = (fpid: string): string => {
  const i = fpid.indexOf(':');
  return i === -1 ? fpid : fpid.slice(i + 1);
};

/** LIB_ID::GetLibNickname. */
export const fpidLibNickname = (fpid: string): string => {
  const i = fpid.indexOf(':');
  return i === -1 ? '' : fpid.slice(0, i);
};

/**
 * The netlist read from the schematic, plus the flags that steer how the board is
 * updated from it.
 */
export class NETLIST {
  private m_components: COMPONENT[] = [];
  private m_groups: NETLIST_GROUP[] = [];
  private m_findByTimeStamp = false;
  private m_replaceFootprints = false;

  IsEmpty(): boolean {
    return this.m_components.length === 0;
  }

  Clear(): void {
    this.m_components = [];
    this.m_groups = [];
  }

  GetCount(): number {
    return this.m_components.length;
  }

  GetComponent(index: number): COMPONENT | undefined {
    return this.m_components[index];
  }

  Components(): readonly COMPONENT[] {
    return this.m_components;
  }

  AddComponent(component: COMPONENT): void {
    this.m_components.push(component);
  }

  AddGroup(group: NETLIST_GROUP): void {
    this.m_groups.push(group);
  }

  Groups(): readonly NETLIST_GROUP[] {
    return this.m_groups;
  }

  GetGroupByUuid(uuid: string): NETLIST_GROUP | null {
    return this.m_groups.find((g) => g.uuid === uuid) ?? null;
  }

  GetComponentByReference(reference: string): COMPONENT | null {
    return this.m_components.find((c) => c.GetReference() === reference) ?? null;
  }

  /**
   * NETLIST::GetComponentByPath — `uuidPath` is [ sheetUuid, …, symbolUuid ]: the
   * sheet path must match and the last element must be one of the component's
   * unit UUIDs.
   */
  GetComponentByPath(uuidPath: string): COMPONENT | null {
    const parts = uuidPath.split('/').filter(Boolean);
    if (parts.length === 0) return null;
    const compUuid = parts[parts.length - 1]!;
    const base = parts.length > 1 ? `/${parts.slice(0, -1).join('/')}/` : '/';
    for (const component of this.m_components) {
      if (base !== component.path) continue;
      if (component.kiids.includes(compUuid)) return component;
    }
    return null;
  }

  GetComponentByUuid(uuid: string): COMPONENT | null {
    if (!uuid) return null;
    return this.m_components.find((c) => c.kiids.includes(uuid)) ?? null;
  }

  /** NETLIST::SortByFPID. */
  SortByFPID(): void {
    this.m_components.sort((a, b) => {
      const fa = a.GetFPID();
      const fb = b.GetFPID();
      return fa < fb ? -1 : fa > fb ? 1 : 0;
    });
  }

  /** NETLIST::SortByReference — operator< is StrNumCmp( ref, ref, true ). */
  SortByReference(): void {
    this.m_components.sort((a, b) => strNumCmp(a.GetReference(), b.GetReference(), true));
  }

  SetFindByTimeStamp(findByTimeStamp: boolean): void {
    this.m_findByTimeStamp = findByTimeStamp;
  }
  IsFindByTimeStamp(): boolean {
    return this.m_findByTimeStamp;
  }

  SetReplaceFootprints(replace: boolean): void {
    this.m_replaceFootprints = replace;
  }
  GetReplaceFootprints(): boolean {
    return this.m_replaceFootprints;
  }

  /** NETLIST::AnyFootprintsLinked — any component with a footprint assigned. */
  AnyFootprintsLinked(): boolean {
    return this.m_components.some((c) => c.GetFPID() !== '');
  }

  /**
   * NETLIST::ApplyGroupMembership — resolve each group's member paths to the
   * components they name, once all components and groups have been read. A member
   * with more than one path element is an instance path (the same symbol UUID
   * exists once per instance of a shared sheet); a bare UUID matches any instance.
   */
  ApplyGroupMembership(): void {
    for (const group of this.m_groups) {
      for (const member of group.members) {
        const parts = member.split('/').filter(Boolean);
        const component =
          parts.length > 1
            ? this.GetComponentByPath(member)
            : parts.length === 1
              ? this.GetComponentByUuid(parts[0]!)
              : null;
        if (component) component.SetGroup(group);
      }
    }
  }
}
