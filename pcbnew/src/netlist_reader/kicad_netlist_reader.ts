/**
 * Reader for the KiCad (s-expression) netlist. Counterpart:
 * `pcbnew/netlist_reader/kicad_netlist_reader.cpp`
 * (KICAD_NETLIST_READER / KICAD_NETLIST_PARSER).
 *
 * This is the board side of the eeschema -> pcbnew handoff: eeschema formats its
 * connection graph with NETLIST_EXPORTER_KICAD and pcbnew parses it back into a
 * {@link NETLIST} here, so both ends agree through a file format rather than a
 * shared in-memory model. Sections mirror Parse()'s switch one for one:
 *
 *   (export (version E)
 *     (design …)                 skipped — comments only
 *     (components (comp …) …)     parseComponent
 *     (groups (group …) …)        parseGroup
 *     (libparts (libpart …) …)    parseLibPartList — footprint filters + pin count
 *     (libraries …)               skipped
 *     (nets (net …) …)            parseNet
 *
 * `(variants …)` and `(net_chains …)` are parsed past for now: the board model
 * carries neither design variants nor net-chain assignments yet.
 */

import { kiidFromName } from '@ziroeda/common/src/kiid.js';
import { parse } from '@ziroeda/sexpr/src/parser.js';
import { head, isList, type SList } from '@ziroeda/sexpr/src/types.js';
import { arg, args, childNamed, childrenNamed } from '@ziroeda/sexpr/src/query.js';
import { COMPONENT, NETLIST, type NETLIST_GROUP, type UNIT_INFO } from './pcb_netlist.js';

/** The child lists of a node (the netlist has no bare atoms below the leaves). */
const lists = (node: SList): SList[] => node.items.filter((it): it is SList => isList(it));

/** A `(name "value")` leaf's value, empty when the leaf is absent. */
const field = (node: SList, name: string): string => {
  const child = childNamed(node, name);
  return child ? (arg(child, 0) ?? '') : '';
};

/**
 * KICAD_NETLIST_PARSER::parseComponent — a `(comp …)` section into a COMPONENT.
 * Absent data is simply not set, so a partial netlist still loads.
 */
function parseComponent(netlist: NETLIST, node: SList): void {
  const ref = field(node, 'ref');
  const value = field(node, 'value');
  const footprint = field(node, 'footprint');

  const properties = new Map<string, string>();
  const fields = new Map<string, string>();
  const units: UNIT_INFO[] = [];
  let library = '';
  let name = '';
  let humanSheetPath = '';
  let path = '';
  let uuids: string[] = [];

  for (const child of lists(node)) {
    switch (head(child)) {
      case 'libsource':
        library = field(child, 'lib');
        name = field(child, 'part');
        break;

      case 'property': {
        // `(property (name "dnp"))` — a valueless property is a flag.
        const propName = field(child, 'name');
        if (propName) properties.set(propName, field(child, 'value'));
        break;
      }

      case 'fields':
        for (const f of childrenNamed(child, 'field')) {
          const fieldName = field(f, 'name');
          // The value is the element's text, which follows the (name …) attribute.
          if (fieldName) fields.set(fieldName, args(f)[0] ?? '');
        }
        break;

      case 'sheetpath':
        humanSheetPath = field(child, 'names');
        path = field(child, 'tstamps');
        break;

      case 'tstamps':
        uuids = args(child);
        break;

      case 'units':
        for (const unit of childrenNamed(child, 'unit')) {
          const pins = childNamed(unit, 'pins');
          units.push({
            unitName: field(unit, 'name'),
            pins: pins
              ? childrenNamed(pins, 'pin')
                  .map((p) => field(p, 'num'))
                  .filter(Boolean)
              : [],
          });
        }
        break;

      default:
        // Skip data this port does not use (component_classes, variants,
        // jumper_pin_groups, duplicate_pin_numbers_are_jumpers, …).
        break;
    }
  }

  const component = new COMPONENT(footprint, ref, value, path || '/', uuids);
  component.SetName(name);
  component.SetLibrary(library);
  component.SetProperties(properties);
  component.SetFields(fields);
  component.SetHumanReadablePath(humanSheetPath);
  component.SetUnitInfo(units);
  netlist.AddComponent(component);
}

/**
 * KICAD_NETLIST_PARSER::parseNet — a `(net (code N) (name …) (node …) …)` section,
 * adding one COMPONENT_NET per node to the component the node's ref names.
 *
 * A node whose component is missing is skipped: the symbol may be excluded from
 * the board or marked DNP. An unnamed net with a valid code gets KiCad's dummy
 * `N-00000<code>` name.
 */
function parseNet(netlist: NETLIST, node: SList): void {
  const code = field(node, 'code');
  let name = field(node, 'name');

  for (const nodeItem of childrenNamed(node, 'node')) {
    const reference = field(nodeItem, 'ref');
    const pinNumber = field(nodeItem, 'pin');
    const pinFunction = field(nodeItem, 'pinfunction');
    const pinType = field(nodeItem, 'pintype');

    const component = netlist.GetComponentByReference(reference);
    if (!component) continue;
    if (Number.parseInt(code, 10) >= 1) {
      if (name === '') name = `N-00000${code}`;
      component.AddNet(pinNumber, name, pinFunction, pinType);
    }
  }
}

/**
 * KICAD_NETLIST_PARSER::parseGroup — a `(group …)` section. Group and member
 * UUIDs are full instance paths; an instance path collapses to a deterministic
 * UUID (KIID::FromName) so re-reading the same netlist finds the same board group.
 */
function parseGroup(netlist: NETLIST, node: SList): void {
  const uuidStr = field(node, 'uuid');
  const membersNode = childNamed(node, 'members');
  const group: NETLIST_GROUP = {
    name: field(node, 'name'),
    uuid: uuidStr.startsWith('/') ? kiidFromName(uuidStr) : uuidStr,
    libId: field(node, 'lib_id'),
    members: membersNode
      ? childrenNamed(membersNode, 'member')
          .map((m) => field(m, 'uuid'))
          .filter(Boolean)
      : [],
  };
  netlist.AddGroup(group);
}

/**
 * KICAD_NETLIST_PARSER::parseLibPartList — the footprint filters and pin count of
 * one library part, copied onto every component sourced from it (directly or
 * through an alias). Pcbnew itself only needs this for the footprint chooser's
 * filtering; the updater does not read it.
 */
function parseLibPartList(netlist: NETLIST, node: SList): void {
  const libName = field(node, 'lib');
  const libPartName = field(node, 'part');
  const footprintsNode = childNamed(node, 'footprints');
  const aliasesNode = childNamed(node, 'aliases');
  const pinsNode = childNamed(node, 'pins');

  const footprintFilters = footprintsNode
    ? childrenNamed(footprintsNode, 'fp')
        .map((fp) => arg(fp, 0) ?? '')
        .filter(Boolean)
    : [];
  const aliases = aliasesNode
    ? childrenNamed(aliasesNode, 'alias')
        .map((a) => arg(a, 0) ?? '')
        .filter(Boolean)
    : [];
  const pinCount = pinsNode ? childrenNamed(pinsNode, 'pin').length : 0;

  for (const component of netlist.Components()) {
    const matches =
      component.IsLibSource(libName, libPartName) ||
      aliases.some((alias) => component.IsLibSource(libName, alias));
    if (matches) {
      component.SetFootprintFilters(footprintFilters);
      component.SetPinCount(pinCount);
    }
  }
}

/**
 * KICAD_NETLIST_PARSER::Parse — walk the netlist's sections in file order.
 * Components must be read before nets (a net's nodes look their component up by
 * reference) and before libparts, which is the order the exporter writes.
 */
export function parseKicadNetlist(root: SList, netlist: NETLIST): void {
  if (head(root) !== 'export') return;

  for (const section of lists(root)) {
    switch (head(section)) {
      case 'components':
        for (const comp of childrenNamed(section, 'comp')) parseComponent(netlist, comp);
        break;
      case 'groups':
        for (const group of childrenNamed(section, 'group')) parseGroup(netlist, group);
        break;
      case 'nets':
        for (const net of childrenNamed(section, 'net')) parseNet(netlist, net);
        break;
      case 'libparts':
        for (const libpart of childrenNamed(section, 'libpart')) parseLibPartList(netlist, libpart);
        break;
      default:
        // version / design / libraries / variants / net_chains: nothing to do.
        break;
    }
  }

  // Go back and apply group information to the components.
  netlist.ApplyGroupMembership();
}

/** KICAD_NETLIST_READER::LoadNetlist — parse netlist text into a fresh NETLIST. */
export function loadKicadNetlist(text: string): NETLIST {
  const netlist = new NETLIST();
  parseKicadNetlist(parse(text), netlist);
  return netlist;
}
