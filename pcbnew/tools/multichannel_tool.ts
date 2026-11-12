// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `MULTICHANNEL_TOOL` (pcbnew/tools/multichannel_tool.cpp): Tools > Multi-Channel. Generate
 * Placement Rule Areas draws a placement rule area around each sheet, component class or group;
 * Repeat Layout copies the placement, routing and other items of one such area onto every area
 * whose components match it by connection topology (connectivity/topo_match.ts).
 *
 * The compatibility check runs on this thread; KiCad runs it on its thread pool behind a
 * progress dialog that appears after one second.
 */
import { AccumulateDescription } from '@ziroeda/common/string_utils.js';
import type { EDA_GROUP } from '@ziroeda/common/eda_group.js';
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import { RECURSE_MODE } from '@ziroeda/common/eda_item.js';
import { LSET } from '@ziroeda/common/lset.js';
import type { TOOL_EVENT } from '@ziroeda/common/tool/tool_event.js';
import { SYNC_HANDLER } from '@ziroeda/common/tool/tool_interactive.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { ERROR_LOC } from '@ziroeda/kimath/src/convert_basic_shapes_to_polygon.js';
import { buildConvexHull } from '@ziroeda/kimath/src/geometry/convex_hull.js';
import { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import { SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import {
  KIGEOM_CollectBoxCorners,
  KIGEOM_RectifyPolygon,
} from '@ziroeda/kimath/src/geometry/shape_utils.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { BOARD_COMMIT } from '../board_commit.js';
import type { BOARD } from '../board.js';
import type { BOARD_CONNECTED_ITEM } from '../board_connected_item.js';
import type { BOARD_ITEM } from '../board_item.js';
import type { COMMIT } from '@ziroeda/common/commit.js';
import {
  CONNECTION_GRAPH,
  type COMPONENT_MATCHES,
  type ISOMORPHISM_PARAMS,
  type TOPOLOGY_MISMATCH_REASON,
} from '../connectivity/topo_match.js';
import type { FOOTPRINT } from '../footprint.js';
import { NETINFO_ITEM } from '../netinfo_item.js';
import type { PCB_EDIT_FRAME } from '../pcb_edit_frame.js';
import type { PCB_GENERATOR } from '../pcb_generator.js';
import { PCB_GROUP } from '../pcb_group.js';
import type { PCB_TEXT } from '../pcb_text.js';
import type { PCB_TRACK } from '../pcb_track.js';
import {
  PCBEXPR_COMPILER,
  PCBEXPR_CONTEXT,
  PCBEXPR_UCODE,
  PCBEXPR_UNIT_RESOLVER,
} from '../pcbexpr_evaluator.js';
import { ZONE } from '../zone.js';
import { PLACEMENT_SOURCE_T, ZONE_BORDER_DISPLAY_STYLE } from '../zone_settings.js';
import { PCB_ACTIONS } from './pcb_actions.js';
import { PCB_TOOL_BASE } from './pcb_tool_base.js';
import { _ } from '@ziroeda/wx/translation.js';
import { wxFormat } from '@ziroeda/wx/wxstring.js';

/** `REPEAT_LAYOUT_OPTIONS`. */
export interface REPEAT_LAYOUT_OPTIONS {
  m_copyRouting: boolean;
  m_connectedRoutingOnly: boolean;
  m_copyPlacement: boolean;
  m_copyOtherItems: boolean;
  m_groupItems: boolean;
  m_includeLockedItems: boolean;
  m_anchorFp: FOOTPRINT | null;
}

export const DefaultRepeatLayoutOptions = (): REPEAT_LAYOUT_OPTIONS => ({
  m_copyRouting: true,
  m_connectedRoutingOnly: false,
  m_copyPlacement: true,
  m_copyOtherItems: true,
  m_groupItems: false,
  m_includeLockedItems: true,
  m_anchorFp: null,
});

/** `RULE_AREA_COMPAT_DATA`. */
export class RULE_AREA_COMPAT_DATA {
  m_isOk = false;
  m_doCopy = false;
  m_errorMsg = '';
  m_matchingComponents: COMPONENT_MATCHES = new Map();
  m_mismatchReasons: string[] = [];
  /** Filled in by copyRuleAreaContents with items that were affected by the copy operation. */
  m_affectedItems = new Set<BOARD_ITEM>();
  /** Filled in by copyRuleAreaContents with affected items that can be grouped together. */
  m_groupableItems = new Set<BOARD_ITEM>();
}

/** `RULE_AREA`. */
export class RULE_AREA {
  m_sourceType: PLACEMENT_SOURCE_T = PLACEMENT_SOURCE_T.SHEETNAME;
  m_oldZone: ZONE | null = null;
  m_zone: ZONE | null = null;
  m_components = new Set<FOOTPRINT>();
  m_designBlockItems = new Set<EDA_ITEM>();
  m_group: PCB_GROUP | null = null;
  m_existsAlready = false;
  m_generateEnabled = false;
  m_sheetPath = '';
  m_sheetName = '';
  m_ruleName = '';
  m_componentClass = '';
  m_groupName = '';
  m_center: VECTOR2I = { x: 0, y: 0 };
}

/** `RULE_AREAS_DATA`. */
export class RULE_AREAS_DATA {
  m_replaceExisting = false;
  m_refRA: RULE_AREA | null = null;
  m_options: REPEAT_LAYOUT_OPTIONS = DefaultRepeatLayoutOptions();
  m_areas: RULE_AREA[] = [];
  m_compatMap = new Map<RULE_AREA, RULE_AREA_COMPAT_DATA>();
}

/** wxString::CmpNoCase. */
const cmpNoCase = (a: string, b: string): number => {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
};

/** `FormatComponentList`: the references, ten to a line. */
export function FormatComponentList(aComponents: Iterable<FOOTPRINT>): string {
  const refs = [...aComponents].map((fp) => fp.GetReferenceAsString()).sort(cmpNoCase);

  if (refs.length === 0) return '(none)';

  let result = '';
  let line = '';
  let componentsOnLine = 0;

  for (const ref of refs) {
    if (componentsOnLine === 10) {
      if (result !== '') result += '\n';

      result += line;
      line = '';
      componentsOnLine = 0;
    }

    line = AccumulateDescription(line, ref);
    componentsOnLine++;
  }

  if (line !== '') {
    if (result !== '') result += '\n';

    result += line;
  }

  return result;
}

const setsEqual = <T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean =>
  a.size === b.size && [...a].every((x) => b.has(x));

/** The parent sheet paths above `aSheetName`: "/A/B/C/" -> { "/A/", "/A/B/" }. */
export function getParentSheetPaths(aSheetName: string): string[] {
  const segments = aSheetName.split('/').filter((s) => s !== '');
  const rv: string[] = [];
  let prefix = '/';

  for (let i = 0; i + 1 < segments.length; ++i) {
    prefix += `${segments[i]}/`;
    rv.push(prefix);
  }

  return rv;
}

function collectGroupFootprints(aGroup: EDA_GROUP, aOut: Set<FOOTPRINT>): void {
  for (const item of aGroup.GetItems()) {
    if (item.Type() === KICAD_T.PCB_FOOTPRINT_T) aOut.add(item as FOOTPRINT);
    else if (item.Type() === KICAD_T.PCB_GROUP_T) collectGroupFootprints(item as PCB_GROUP, aOut);
  }
}

function collectGroupBoardItems(aGroup: EDA_GROUP, aOut: Set<BOARD_ITEM>): void {
  for (const item of aGroup.GetItems()) {
    // A generator's own bounding box already covers its children (meander arcs).
    if (item.Type() === KICAD_T.PCB_GROUP_T) collectGroupBoardItems(item as PCB_GROUP, aOut);
    else if (item.IsBOARD_ITEM()) aOut.add(item as BOARD_ITEM);
  }
}

/** `matchBySymbolInstancePath`: the one-to-one link a placed sheet or block stamps. */
function matchBySymbolInstancePath(
  aRef: ReadonlySet<FOOTPRINT>,
  aTarget: ReadonlySet<FOOTPRINT>,
  aResult: COMPONENT_MATCHES,
): boolean {
  if (aRef.size === 0 || aRef.size !== aTarget.size) return false;

  const symbolUuid = (aFp: FOOTPRINT): string => {
    const path = aFp.GetPath();
    return path.length === 0 ? '' : path[path.length - 1]!;
  };
  const nil = '00000000-0000-0000-0000-000000000000';
  const targetByUuid = new Map<string, FOOTPRINT>();

  for (const fp of aTarget) {
    const uuid = symbolUuid(fp);

    // A missing or duplicated UUID (copy paste, hand built group) is not a clean instance link
    if (uuid === '' || uuid === nil || targetByUuid.has(uuid)) return false;

    targetByUuid.set(uuid, fp);
  }

  const result: COMPONENT_MATCHES = new Map();
  const used = new Set<FOOTPRINT>();

  for (const refFp of aRef) {
    const uuid = symbolUuid(refFp);

    if (uuid === '' || uuid === nil) return false;

    const targetFp = targetByUuid.get(uuid);

    if (!targetFp) return false;

    // Routing and placement copy only makes sense between pad compatible footprints
    if (
      refFp.GetFPID().Format() !== targetFp.GetFPID().Format() ||
      refFp.Pads().length !== targetFp.Pads().length
    )
      return false;

    if (used.has(targetFp)) return false;

    used.add(targetFp);
    result.set(refFp, targetFp);
  }

  aResult.clear();
  for (const [k, v] of result) aResult.set(k, v);

  return true;
}

/** What the tool asks of its frame: the two dialogs and the mismatch details. */
export interface MULTICHANNEL_TOOL_FRAME {
  ShowRepeatLayoutDialog(aTool: MULTICHANNEL_TOOL): Promise<boolean>;
  ShowGenerateRuleAreasDialog(aTool: MULTICHANNEL_TOOL): Promise<boolean>;
  /** `wxRichMessageDialog( summary, "Topology mismatch", wxICON_ERROR )` with the details. */
  ShowTopologyMismatch(aSummary: string, aDetails: string): void;
}

export class MULTICHANNEL_TOOL extends PCB_TOOL_BASE {
  private m_areas = new RULE_AREAS_DATA();

  constructor() {
    super('pcbnew.Multichannel');
  }

  /** The frame, or null on a tool manager with none: KiCad's `Pgm().IsGUI()` guard. */
  private guiFrame(): PCB_EDIT_FRAME | null {
    return (this.frame<PCB_EDIT_FRAME | null>() ?? null) as PCB_EDIT_FRAME | null;
  }

  private mcFrame(): PCB_EDIT_FRAME & MULTICHANNEL_TOOL_FRAME {
    return this.frame<PCB_EDIT_FRAME & MULTICHANNEL_TOOL_FRAME>();
  }

  GetData(): RULE_AREAS_DATA {
    return this.m_areas;
  }

  /** `ShowMismatchDetails` / `ShowTopologyMismatchReasons`. */
  ShowMismatchDetails(aSummary: string, aReasons: readonly string[]): void {
    if (aReasons.length === 0) return;

    (this.guiFrame() as (PCB_EDIT_FRAME & MULTICHANNEL_TOOL_FRAME) | null)?.ShowTopologyMismatch(
      aSummary,
      aReasons.join('\n'),
    );
  }

  protected override setTransitions(): void {
    const S = SYNC_HANDLER;
    this.Go(S(this.AutogenerateRuleAreas), PCB_ACTIONS.generatePlacementRuleAreas.MakeEvent());
    this.Go(S(this.repeatLayout), PCB_ACTIONS.repeatLayout.MakeEvent());
  }

  /** One compiled `A.<func>('<arg>')` condition, run over items. */
  private compileCondition(aRuleText: string): ((aItem: BOARD_ITEM) => boolean) | null {
    const compiler = new PCBEXPR_COMPILER(new PCBEXPR_UNIT_RESOLVER());
    const ucode = new PCBEXPR_UCODE();
    const ctx = new PCBEXPR_CONTEXT();
    const preflightCtx = new PCBEXPR_CONTEXT();

    if (!compiler.Compile(aRuleText, ucode, preflightCtx)) return null;

    return (aItem) => {
      ctx.SetItems(aItem, aItem);
      return ucode.Run(ctx).AsDouble() !== 0.0;
    };
  }

  private findComponentsInRuleArea(aRuleArea: RULE_AREA, aComponents: Set<FOOTPRINT>): boolean {
    if (!aRuleArea.m_zone) return false;

    // When we're copying the layout of a design block, we are provided an exact list of items
    // rather than querying the board for items that are inside the area.
    if (aRuleArea.m_sourceType === PLACEMENT_SOURCE_T.DESIGN_BLOCK) {
      for (const item of aRuleArea.m_designBlockItems) {
        if (item.Type() === KICAD_T.PCB_FOOTPRINT_T) aComponents.add(item as FOOTPRINT);
      }

      return aComponents.size > 0;
    }

    const source = aRuleArea.m_zone.GetPlacementAreaSource();
    let ruleText = '';

    switch (aRuleArea.m_zone.GetPlacementAreaSourceType()) {
      case PLACEMENT_SOURCE_T.SHEETNAME:
        ruleText = `A.memberOfSheetOrChildren('${source}')`;
        break;
      case PLACEMENT_SOURCE_T.COMPONENT_CLASS:
        ruleText = `A.hasComponentClass('${source}')`;
        break;
      case PLACEMENT_SOURCE_T.GROUP_PLACEMENT:
        ruleText = `A.memberOfGroup('${source}')`;
        break;
      case PLACEMENT_SOURCE_T.DESIGN_BLOCK:
        // For design blocks, handled above outside the rules system
        break;
    }

    const test = this.compileCondition(ruleText);

    if (!test) return false;

    for (const fp of this.board().Footprints()) {
      if (test(fp)) aComponents.add(fp);
    }

    return true;
  }

  private zoneOnBoard(aZone: ZONE | null): boolean {
    return !!aZone && this.board().Zones().includes(aZone);
  }

  private findOtherItemsInRuleArea(aRuleArea: RULE_AREA, aItems: Set<BOARD_ITEM>): boolean {
    if (!aRuleArea.m_zone) return false;

    const skipType = (t: KICAD_T): boolean =>
      t === KICAD_T.PCB_FOOTPRINT_T ||
      t === KICAD_T.PCB_GROUP_T ||
      t === KICAD_T.PCB_GENERATOR_T ||
      t === KICAD_T.PCB_TABLECELL_T;

    if (aRuleArea.m_sourceType === PLACEMENT_SOURCE_T.DESIGN_BLOCK) {
      for (const item of aRuleArea.m_designBlockItems) {
        if (skipType(item.Type())) continue;

        if (item.IsBOARD_ITEM()) {
          const boardItem = item as BOARD_ITEM;
          if (!boardItem.IsConnected() || boardItem.Type() === KICAD_T.PCB_ZONE_T)
            aItems.add(boardItem);
        }
      }

      return aItems.size > 0;
    }

    // The design-block apply target uses a scratch zone not on the board, so enclosedByArea()
    // below finds nothing. Resolve the group's items directly from the group.
    if (
      aRuleArea.m_sourceType === PLACEMENT_SOURCE_T.GROUP_PLACEMENT &&
      (aRuleArea.m_components.size > 0 || aRuleArea.m_group) &&
      !this.zoneOnBoard(aRuleArea.m_zone)
    ) {
      let group: EDA_GROUP | null = aRuleArea.m_group;

      if (!group && aRuleArea.m_components.size > 0)
        group = [...aRuleArea.m_components][0]!.GetParentGroup();

      if (group) {
        for (const member of group.GetItems()) {
          if (skipType(member.Type())) continue;

          if (member.IsBOARD_ITEM()) {
            const boardItem = member as BOARD_ITEM;
            if (!boardItem.IsConnected() || boardItem.Type() === KICAD_T.PCB_ZONE_T)
              aItems.add(boardItem);
          }
        }
      }

      return aItems.size > 0;
    }

    // Use the zone's UUID to identify it uniquely. Using the zone name could match other zones
    // with the same name (e.g., a copper fill zone with the same name as a rule area).
    const test = this.compileCondition(`A.enclosedByArea('${aRuleArea.m_zone.m_Uuid}')`);

    if (!test) return false;

    for (const zone of this.board().Zones()) {
      if (zone === aRuleArea.m_zone) continue;

      if (test(zone)) aItems.add(zone);
    }

    for (const drawing of this.board().Drawings()) {
      if (!drawing.IsConnected() && test(drawing)) aItems.add(drawing);
    }

    return true;
  }

  queryComponentsInSheet(aSheetName: string): Set<FOOTPRINT> {
    const rv = new Set<FOOTPRINT>();
    const sheet = aSheetName.endsWith('/') ? aSheetName.slice(0, -1) : aSheetName;
    const childPrefix = `${sheet}/`;

    for (const fp of this.board().Footprints()) {
      let sn = fp.GetSheetname();

      if (sn.endsWith('/')) sn = sn.slice(0, -1);

      if (sn === sheet || sn.startsWith(childPrefix)) rv.add(fp);
    }

    return rv;
  }

  queryComponentsInComponentClass(aComponentClassName: string): Set<FOOTPRINT> {
    const rv = new Set<FOOTPRINT>();

    for (const fp of this.board().Footprints()) {
      if (fp.GetComponentClass()?.ContainsClassName(aComponentClassName)) rv.add(fp);
    }

    return rv;
  }

  queryComponentsInGroup(aGroupName: string): Set<FOOTPRINT> {
    const rv = new Set<FOOTPRINT>();

    for (const group of this.board().Groups()) {
      if (group.GetName() === aGroupName) collectGroupFootprints(group, rv);
    }

    return rv;
  }

  queryBoardItemsInGroup(aGroupName: string): Set<BOARD_ITEM> {
    const rv = new Set<BOARD_ITEM>();

    for (const group of this.board().Groups()) {
      if (group.GetName() !== aGroupName) continue;

      for (const item of group.GetItems()) {
        if (item.IsBOARD_ITEM()) rv.add(item as BOARD_ITEM);
      }
    }

    return rv;
  }

  /** `buildRAOutline`: the rectified convex hull of the items' inflated boxes. */
  buildRAOutline(aItems: Iterable<BOARD_ITEM>, aMargin: number): SHAPE_LINE_CHAIN {
    const bbCorners: VECTOR2I[] = [];

    for (const item of aItems) {
      const bb =
        item.Type() === KICAD_T.PCB_FOOTPRINT_T
          ? (item as FOOTPRINT).GetBoundingBox(false)
          : item.GetBoundingBox();

      KIGEOM_CollectBoxCorners(bb.GetInflated(aMargin), bbCorners);
    }

    const hull = new SHAPE_LINE_CHAIN(buildConvexHull(bbCorners));
    hull.SetClosed(true);

    // Make the newly computed convex hull use only 90 degree segments
    return KIGEOM_RectifyPolygon(hull);
  }

  /** `GeneratePotentialRuleAreas`: one candidate per sheet, component class and named group. */
  GeneratePotentialRuleAreas(): void {
    // Sheet path -> sheet file. Container sheets that only hold subsheets have no file of
    // their own, so they map to an empty string.
    const uniqueSheets = new Map<string, string>();
    const uniqueComponentClasses = new Set<string>();
    const uniqueGroups = new Set<string>();

    this.m_areas.m_areas = [];

    for (const fp of this.board().Footprints()) {
      uniqueSheets.set(fp.GetSheetname(), fp.GetSheetfile());

      // Offer the parent sheets as channels too, not just the deepest one.
      for (const parent of getParentSheetPaths(fp.GetSheetname())) {
        if (!uniqueSheets.has(parent)) uniqueSheets.set(parent, '');
      }

      for (const singleClass of fp.GetComponentClass()?.GetConstituentClasses() ?? [])
        uniqueComponentClasses.add(singleClass.GetName());

      // Offer every named group up the chain, not just the immediate parent, so a
      // channel group wrapping several sub-groups can be picked too.
      for (let grp = fp.GetParentGroup(); grp; grp = grp.AsEdaItem().GetParentGroup()) {
        if (grp.GetName() !== '') uniqueGroups.add(grp.GetName());
      }
    }

    // std::map / std::set: sorted.
    const sorted = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

    for (const sheetPath of [...uniqueSheets.keys()].sort(sorted)) {
      const ent = new RULE_AREA();
      ent.m_sourceType = PLACEMENT_SOURCE_T.SHEETNAME;
      ent.m_sheetPath = sheetPath;
      ent.m_sheetName = uniqueSheets.get(sheetPath)!;
      ent.m_components = this.queryComponentsInSheet(ent.m_sheetPath);
      this.m_areas.m_areas.push(ent);
    }

    for (const compClass of [...uniqueComponentClasses].sort(sorted)) {
      const ent = new RULE_AREA();
      ent.m_sourceType = PLACEMENT_SOURCE_T.COMPONENT_CLASS;
      ent.m_componentClass = compClass;
      ent.m_components = this.queryComponentsInComponentClass(ent.m_componentClass);
      this.m_areas.m_areas.push(ent);
    }

    for (const groupName of [...uniqueGroups].sort(sorted)) {
      const ent = new RULE_AREA();
      ent.m_sourceType = PLACEMENT_SOURCE_T.GROUP_PLACEMENT;
      ent.m_groupName = groupName;
      ent.m_components = this.queryComponentsInGroup(ent.m_groupName);
      this.m_areas.m_areas.push(ent);
    }
  }

  /** `FindExistingRuleAreas`: every placement rule area on the board, with its components. */
  FindExistingRuleAreas(): void {
    this.m_areas.m_areas = [];

    for (const zone of this.board().Zones()) {
      if (!zone.GetIsRuleArea()) continue;

      if (!zone.GetPlacementAreaEnabled()) continue;

      const area = new RULE_AREA();
      area.m_existsAlready = true;
      area.m_zone = zone;
      area.m_ruleName = zone.GetZoneName();
      area.m_center = zone.Outline().COutline(0).Centre();
      this.findComponentsInRuleArea(area, area.m_components);
      this.m_areas.m_areas.push(area);
    }
  }

  /** PCB_PICKER_TOOL::RECEIVER: a picked reference area re-runs the action. */
  UpdatePickedItem(_aItem: EDA_ITEM | null): void {
    this.m_toolMgr!.RunAction(PCB_ACTIONS.repeatLayout);
  }

  private static isSelectedItemAnRA(aItem: EDA_ITEM | null): ZONE | null {
    if (!aItem || aItem.Type() !== KICAD_T.PCB_ZONE_T) return null;

    const zone = aItem as ZONE;

    if (!zone.GetIsRuleArea()) return null;

    if (!zone.GetPlacementAreaEnabled()) return null;

    return zone;
  }

  repeatLayout(aEvent: TOOL_EVENT): number {
    const refRAs: ZONE[] = [];

    for (const item of this.selection()) {
      const zone = MULTICHANNEL_TOOL.isSelectedItemAnRA(item);

      if (zone) {
        refRAs.push(zone);
      } else if (item.Type() === KICAD_T.PCB_GROUP_T) {
        for (const grpItem of (item as PCB_GROUP).GetItems()) {
          const grpZone = MULTICHANNEL_TOOL.isSelectedItemAnRA(grpItem);
          if (grpZone) refRAs.push(grpZone);
        }
      }
    }

    if (refRAs.length !== 1) {
      this.m_toolMgr!.RunAction(PCB_ACTIONS.selectItemInteractively, {
        m_Receiver: this,
        m_Prompt: _('Select a reference Rule Area to copy from...'),
        m_ItemFilter: (aItem: EDA_ITEM) => MULTICHANNEL_TOOL.isSelectedItemAnRA(aItem) !== null,
      });
      return 0;
    }

    this.FindExistingRuleAreas();

    const status = this.CheckRACompatibility(refRAs[0]!);

    if (status < 0) return status;

    if (this.m_areas.m_areas.length <= 1) {
      this.guiFrame()?.ShowInfoBarError(
        _('No Rule Areas to repeat layout to have been found.'),
        true,
      );
      return 0;
    }

    void this.mcFrame()
      .ShowRepeatLayoutDialog(this)
      .then((ok) => {
        if (ok) this.RepeatLayoutAll(aEvent, refRAs[0]!);
      });

    return 0;
  }

  /** `CheckRACompatibility`: resolve each target's topology against the reference. */
  CheckRACompatibility(aRefZone: ZONE): number {
    this.m_areas.m_refRA = this.m_areas.m_areas.find((ra) => ra.m_zone === aRefZone) ?? null;

    if (!this.m_areas.m_refRA) return -1;

    this.m_areas.m_compatMap.clear();

    const refRA = this.m_areas.m_refRA;

    for (const ra of this.m_areas.m_areas) {
      if (ra.m_zone === refRA.m_zone) continue;

      const compatData = new RULE_AREA_COMPAT_DATA();
      this.m_areas.m_compatMap.set(ra, compatData);
      this.resolveConnectionTopology(refRA, ra, compatData);
    }

    return 0;
  }

  /**
   * `RepeatLayout( aEvent, aRefArea, aTargetArea, aOptions, aExternalCommit, aErrorOut )`: one
   * reference onto one target, the entry Apply Design Block Layout uses.
   */
  RepeatLayout(
    _aEvent: TOOL_EVENT | null,
    aRefArea: RULE_AREA,
    aTargetArea: RULE_AREA,
    aOptions: REPEAT_LAYOUT_OPTIONS,
    aExternalCommit: BOARD_COMMIT | null = null,
    aErrorOut: { value: string } | null = null,
  ): number {
    if (!aRefArea.m_zone || !aTargetArea.m_zone) return -1;

    const silent = aErrorOut !== null;

    const reportError = (aMsg: string): void => {
      if (aErrorOut) aErrorOut.value = aMsg;
      else this.guiFrame()?.ShowInfoBarError(aMsg, true);
    };

    const compat = new RULE_AREA_COMPAT_DATA();

    if (!this.resolveConnectionTopology(aRefArea, aTargetArea, compat)) {
      if (silent) {
        aErrorOut!.value = compat.m_errorMsg;
      } else {
        this.ShowMismatchDetails(
          wxFormat(_('Rule Area topologies do not match: %s'), compat.m_errorMsg),
          compat.m_mismatchReasons,
        );
      }

      return -1;
    }

    const commit = aExternalCommit ?? new BOARD_COMMIT(this.GetManager()!, true, false);

    // If no anchor is provided, pick the first matched pair to avoid center-alignment shifting
    // the whole group.
    if (aTargetArea.m_sourceType === PLACEMENT_SOURCE_T.GROUP_PLACEMENT && !aOptions.m_anchorFp) {
      const first = compat.m_matchingComponents.keys().next();
      if (!first.done) aOptions.m_anchorFp = first.value;
    }

    if (!this.copyRuleAreaContents(aRefArea, aTargetArea, commit, aOptions, compat)) {
      const errMsg = wxFormat(
        _("Copy Rule Area contents failed between rule areas '%s' and '%s'."),
        aRefArea.m_zone.GetZoneName(),
        aTargetArea.m_zone.GetZoneName(),
      );

      if (!aExternalCommit) commit.Revert();

      reportError(errMsg);
      return -1;
    }

    if (aTargetArea.m_sourceType === PLACEMENT_SOURCE_T.GROUP_PLACEMENT) {
      let group: EDA_GROUP | null = aTargetArea.m_group;

      if (!group && aTargetArea.m_components.size > 0)
        group = [...aTargetArea.m_components][0]!.GetParentGroup();

      if (!group) {
        if (!aExternalCommit) commit.Revert();

        reportError(_('Target group does not have a group.'));
        return -1;
      }

      commit.Modify(group.AsEdaItem() as BOARD_ITEM, null, RECURSE_MODE.NO_RECURSE);

      for (const item of compat.m_groupableItems) {
        commit.Modify(item);
        group.AddItem(item);
      }
    }

    if (!aExternalCommit) commit.Push(_('Repeat layout'));

    return 0;
  }

  /** `RepeatLayout( aEvent, aRefZone )`: every target the dialog left ticked. */
  RepeatLayoutAll(_aEvent: TOOL_EVENT | null, _aRefZone: ZONE): number {
    let totalCopied = 0;
    const commit = new BOARD_COMMIT(this.GetManager()!, true, false);
    const refRA = this.m_areas.m_refRA!;

    for (const [targetArea, compatData] of this.m_areas.m_compatMap) {
      if (!compatData.m_doCopy) continue;

      if (!compatData.m_isOk) continue;

      if (
        !this.copyRuleAreaContents(refRA, targetArea, commit, this.m_areas.m_options, compatData)
      ) {
        const errMsg = wxFormat(
          _("Copy Rule Area contents failed between rule areas '%s' and '%s'."),
          refRA.m_zone!.GetZoneName(),
          targetArea.m_zone!.GetZoneName(),
        );

        commit.Revert();
        this.guiFrame()?.ShowInfoBarError(errMsg, true);
        return -1;
      }

      totalCopied++;
    }

    if (this.m_areas.m_options.m_groupItems) {
      for (const compatData of this.m_areas.m_compatMap.values()) {
        if (compatData.m_groupableItems.size < 2) continue;

        this.pruneExistingGroups(commit, compatData.m_affectedItems);

        const group = new PCB_GROUP(this.board());

        commit.Add(group);

        for (const item of compatData.m_groupableItems) {
          commit.Modify(item);
          group.AddItem(item);
        }
      }
    }

    commit.Push(_('Repeat layout'));

    this.guiFrame()?.ShowInfoBarMsg(wxFormat(_('Copied to %d Rule Areas.'), totalCopied));

    return 0;
  }

  /** `stripComponentIndex`: the reference's leading letters and underscores. */
  stripComponentIndex(aRef: string): string {
    return /^[A-Za-z_]*/.exec(aRef)![0];
  }

  private findRoutingInRuleArea(aRuleArea: RULE_AREA, aOutput: Set<BOARD_CONNECTED_ITEM>): number {
    if (!aRuleArea.m_zone) return 0;

    // The user also will consider tracks and vias that are inside the source area but
    // not connected to any of the source pads to count as "routing" (e.g. stitching vias)
    let count = 0;

    const inGenerator = (aItem: BOARD_ITEM): boolean =>
      aItem.GetParentGroup()?.AsEdaItem().Type() === KICAD_T.PCB_GENERATOR_T;

    if (aRuleArea.m_sourceType === PLACEMENT_SOURCE_T.DESIGN_BLOCK) {
      for (const item of aRuleArea.m_designBlockItems) {
        // Include any connected items except pads.
        if (item.Type() === KICAD_T.PCB_PAD_T) continue;

        if (!item.IsBOARD_ITEM() || !(item as BOARD_ITEM).IsConnected()) continue;

        const bci = item as BOARD_CONNECTED_ITEM;

        // Zones are handled by the "copy other items" path.
        if (bci.Type() === KICAD_T.PCB_ZONE_T) continue;

        // Tracks inside a generator (meander) are copied with the generator.
        if (inGenerator(bci)) continue;

        aOutput.add(bci);
      }

      return aOutput.size;
    }

    // The design-block apply target uses a scratch zone not on the board, so enclosedByArea()
    // below finds nothing. Match routing against the zone outline directly.
    if (
      aRuleArea.m_sourceType === PLACEMENT_SOURCE_T.GROUP_PLACEMENT &&
      !this.zoneOnBoard(aRuleArea.m_zone)
    ) {
      const zone = aRuleArea.m_zone;
      const areaOutline = zone.Outline();
      const maxError = this.board().GetDesignSettings().m_MaxError;

      const enclosedByZone = (aItem: BOARD_CONNECTED_ITEM): void => {
        if (aOutput.has(aItem)) return;

        if (inGenerator(aItem)) return;

        if (!zone.GetLayerSet().and(aItem.GetLayerSet()).any()) return;

        const itemShape = new SHAPE_POLY_SET();
        aItem.TransformShapeToPolygon(
          itemShape,
          aItem.GetLayer(),
          0,
          maxError,
          ERROR_LOC.ERROR_OUTSIDE,
        );

        if (itemShape.IsEmpty()) return;

        itemShape.BooleanSubtract(areaOutline);

        if (itemShape.IsEmpty()) {
          aOutput.add(aItem);
          count++;
        }
      };

      for (const track of this.board().Tracks()) enclosedByZone(track);

      for (const drawing of this.board().Drawings()) {
        if (drawing.IsConnected()) enclosedByZone(drawing as BOARD_CONNECTED_ITEM);
      }

      return count;
    }

    // Use the zone's UUID to identify it uniquely.
    const test = this.compileCondition(`A.enclosedByArea('${aRuleArea.m_zone.m_Uuid}')`);

    const testAndAdd = (aItem: BOARD_CONNECTED_ITEM): void => {
      if (aOutput.has(aItem)) return;

      if (inGenerator(aItem)) return;

      if (test!(aItem)) {
        aOutput.add(aItem);
        count++;
      }
    };

    if (test) {
      for (const track of this.board().Tracks()) testAndAdd(track);

      for (const drawing of this.board().Drawings()) {
        if (drawing.IsConnected()) testAndAdd(drawing as BOARD_CONNECTED_ITEM);
      }
    }

    return count;
  }

  /** `copyRuleAreaContents`. */
  private copyRuleAreaContents(
    aRefArea: RULE_AREA,
    aTargetArea: RULE_AREA,
    aCommit: BOARD_COMMIT,
    aOptsIn: REPEAT_LAYOUT_OPTIONS,
    aCompatData: RULE_AREA_COMPAT_DATA,
  ): boolean {
    // REPEAT_LAYOUT_OPTIONS is taken by value.
    const aOpts = { ...aOptsIn };
    const refZone = aRefArea.m_zone!;
    const targetZone = aTargetArea.m_zone!;
    const origin: VECTOR2I = { x: 0, y: 0 };

    // copy RA shapes first
    const refOutline = refZone.Outline().COutline(0);

    let targetAnchorFp: FOOTPRINT | null = null;
    let disp: VECTOR2I = {
      x: aTargetArea.m_center.x - aRefArea.m_center.x,
      y: aTargetArea.m_center.y - aRefArea.m_center.y,
    };
    let rot = new EDA_ANGLE(0);

    if (aOpts.m_anchorFp) {
      for (const [refFP, targetFP] of aCompatData.m_matchingComponents) {
        if (refFP.GetReference() === aOpts.m_anchorFp.GetReference()) targetAnchorFp = targetFP;
      }

      // If the dialog-selected anchor reference doesn't exist in the target area (e.g. refs
      // don't match), fall back to the first matched pair.
      if (!targetAnchorFp && aCompatData.m_matchingComponents.size > 0)
        targetAnchorFp = aCompatData.m_matchingComponents.values().next().value!;

      if (targetAnchorFp) {
        rot = new EDA_ANGLE(
          targetAnchorFp.GetOrientationDegrees() - aOpts.m_anchorFp.GetOrientationDegrees(),
        );
        aOpts.m_anchorFp.Rotate(origin, rot);
        const oldpos = aOpts.m_anchorFp.GetPosition();
        const newpos = targetAnchorFp.GetPosition();
        disp = { x: newpos.x - oldpos.x, y: newpos.y - oldpos.y };
        aOpts.m_anchorFp.Rotate(origin, rot.negate());
      }
    }

    const refPoly = new SHAPE_POLY_SET();
    refPoly.AddOutline(refOutline);

    const newTargetOutline = refOutline.Clone() as SHAPE_LINE_CHAIN;
    newTargetOutline.Rotate(rot, origin);
    newTargetOutline.Move(disp);

    // Group placement targets let RepeatLayout() reuse the existing target group, and
    // m_groupItems flat-groups every copy into one rule-area group. Reconstructing source groups
    // here in either case strands their members (issue 22316).
    const preserveGroups =
      aTargetArea.m_sourceType !== PLACEMENT_SOURCE_T.GROUP_PLACEMENT && !aOpts.m_groupItems;

    // Defer reconstruction until every copy is made (issue 22316).
    const groupFixupPairs: [BOARD_ITEM, BOARD_ITEM][] = [];
    const reproducedSourceItems = new Set<BOARD_ITEM>();

    const fixupParentGroup = (sourceItem: BOARD_ITEM, destItem: BOARD_ITEM): void => {
      // The copy inherits the source's parent-group pointer but is not a member of that
      // group; clear the dangling reference.
      destItem.SetParentGroup(null);

      if (!preserveGroups) return;

      if (sourceItem.GetParentGroup()) groupFixupPairs.push([sourceItem, destItem]);

      reproducedSourceItems.add(sourceItem);
    };

    // Only stage changes for a target Rule Area zone if it actually belongs to the board.
    const targetZoneOnBoard = this.zoneOnBoard(targetZone);

    if (targetZoneOnBoard) {
      aCommit.Modify(targetZone);
      aCompatData.m_affectedItems.add(targetZone);
      aCompatData.m_groupableItems.add(targetZone);

      // The source rule-area zone maps to the target zone; treat it as reproduced so a group
      // containing it can still be rebuilt.
      if (preserveGroups) {
        if (refZone.GetParentGroup()) groupFixupPairs.push([refZone, targetZone]);

        reproducedSourceItems.add(refZone);
      }
    }

    if (aOpts.m_copyRouting) {
      const refRouting = new Set<BOARD_CONNECTED_ITEM>();
      const targetRouting = new Set<BOARD_CONNECTED_ITEM>();
      const refc = new Set<number>();
      const targc = new Set<number>();

      for (const [refFP, targetFP] of aCompatData.m_matchingComponents) {
        for (const pad of refFP.Pads()) refc.add(pad.GetNetCode());

        for (const pad of targetFP.Pads()) targc.add(pad.GetNetCode());
      }

      this.findRoutingInRuleArea(aTargetArea, targetRouting);
      this.findRoutingInRuleArea(aRefArea, refRouting);

      // Nets used by the target group's own items, footprint pads included.
      const targetGroupNets = new Set<number>();

      if (aTargetArea.m_group) {
        for (const member of aTargetArea.m_group.GetItems()) {
          if (member.Type() === KICAD_T.PCB_FOOTPRINT_T) {
            for (const pad of (member as FOOTPRINT).Pads()) targetGroupNets.add(pad.GetNetCode());
          } else if (member.IsBOARD_ITEM() && (member as BOARD_ITEM).IsConnected()) {
            targetGroupNets.add((member as BOARD_CONNECTED_ITEM).GetNetCode());
          }
        }
      }

      for (const item of targetRouting) {
        // Never remove pads as part of routing copy.
        if (item.Type() === KICAD_T.PCB_PAD_T) continue;

        if (aRefArea.m_designBlockItems.has(item)) continue;

        // Design block apply: replace only the group's own routing and loose routing on the
        // group's nets (issues 24767, 24944).
        if (aTargetArea.m_group && item.GetParentGroup() !== aTargetArea.m_group) {
          if (item.GetParentGroup()) continue;

          if (item.IsLocked()) continue;

          if (item.GetNetCode() <= 0 || !targetGroupNets.has(item.GetNetCode())) continue;
        }

        if (item.IsLocked() && !aOpts.m_includeLockedItems) continue;

        if (aOpts.m_connectedRoutingOnly && !targc.has(item.GetNetCode())) continue;

        // item already removed
        if (aCommit.GetStatus(item) !== 0) continue;

        if (!targetZone.GetLayerSet().Contains(item.GetLayer())) continue;

        aCompatData.m_affectedItems.add(item);
        aCommit.Remove(item);
      }

      for (const item of refRouting) {
        // Never copy pads as part of routing copy.
        if (item.Type() === KICAD_T.PCB_PAD_T) continue;

        if (item.IsLocked() && !aOpts.m_includeLockedItems) continue;

        if (aOpts.m_connectedRoutingOnly && !refc.has(item.GetNetCode())) continue;

        if (!refZone.GetLayerSet().Contains(item.GetLayer())) continue;

        if (!targetZone.GetLayerSet().Contains(item.GetLayer())) continue;

        const copied = item.Duplicate(false) as BOARD_CONNECTED_ITEM;
        this.fixupNet(item, copied, aCompatData.m_matchingComponents);
        fixupParentGroup(item, copied);
        copied.Rotate(origin, rot);
        copied.Move(disp);
        aCompatData.m_groupableItems.add(copied);
        aCommit.Add(copied);
      }

      // Copy generators (meanders) whole so they are not flattened to loose tracks.
      const refGenerators: PCB_GENERATOR[] = [];
      const targetGenerators: PCB_GENERATOR[] = [];

      if (aRefArea.m_sourceType === PLACEMENT_SOURCE_T.DESIGN_BLOCK) {
        for (const item of aRefArea.m_designBlockItems) {
          if (item.Type() === KICAD_T.PCB_GENERATOR_T) refGenerators.push(item as PCB_GENERATOR);
        }

        let targetGroup: EDA_GROUP | null = aTargetArea.m_group;

        if (!targetGroup && aTargetArea.m_components.size > 0)
          targetGroup = [...aTargetArea.m_components][0]!.GetParentGroup();

        if (targetGroup) {
          for (const member of targetGroup.GetItems()) {
            if (member.Type() === KICAD_T.PCB_GENERATOR_T)
              targetGenerators.push(member as PCB_GENERATOR);
          }
        }
      } else {
        const refOut = refZone.Outline().COutline(0);
        const targetOut = targetZone.Outline().COutline(0);

        for (const gen of this.board().Generators()) {
          if (gen.GetGeneratorType() !== 'tuning_pattern') continue;

          if (gen.HitTest(refOut, false)) refGenerators.push(gen);
          else if (gen.HitTest(targetOut, false)) targetGenerators.push(gen);
        }
      }

      // Remove the target's existing generators so the copy replaces them.
      for (const gen of targetGenerators) {
        gen.RunOnChildren((child) => aCommit.Remove(child), RECURSE_MODE.RECURSE);
        aCommit.Remove(gen);
      }

      for (const gen of refGenerators) {
        const clone = gen.DeepClone();
        clone.ClearFlags();
        clone.Rotate(origin, rot);
        clone.Move(disp);
        aCommit.Add(clone);
        clone.RunOnChildren((child) => {
          child.ClearFlags();

          if (child.IsConnected()) {
            const bci = child as BOARD_CONNECTED_ITEM;
            this.fixupNet(bci, bci, aCompatData.m_matchingComponents);
          }

          aCommit.Add(child);
        }, RECURSE_MODE.RECURSE);
        aCompatData.m_groupableItems.add(clone);
      }
    }

    if (aOpts.m_copyOtherItems) {
      const sourceItems = new Set<BOARD_ITEM>();
      const targetItems = new Set<BOARD_ITEM>();

      this.findOtherItemsInRuleArea(aRefArea, sourceItems);
      this.findOtherItemsInRuleArea(aTargetArea, targetItems);

      // Apply Design Block Layout uses synthetic copper-only rule area zones; skip the layer
      // filter only when both halves are the synthetic design-block-to-group flow.
      const skipLayerFilter =
        aRefArea.m_sourceType === PLACEMENT_SOURCE_T.DESIGN_BLOCK &&
        aTargetArea.m_sourceType === PLACEMENT_SOURCE_T.GROUP_PLACEMENT;

      for (const item of targetItems) {
        if (item.GetParent()?.Type() === KICAD_T.PCB_FOOTPRINT_T) continue;

        // Don't remove the appended source items.
        if (aRefArea.m_designBlockItems.has(item)) continue;

        if (item.IsLocked() && !aOpts.m_includeLockedItems) continue;

        // item already removed
        if (aCommit.GetStatus(item) !== 0) continue;

        if (item.Type() === KICAD_T.PCB_ZONE_T) {
          const zone = item as ZONE;

          // Check all zone layers are included in the target rule area.
          if (skipLayerFilter || targetZone.GetLayerSet().ContainsAll(zone.GetLayerSet())) {
            aCompatData.m_affectedItems.add(zone);
            aCommit.Remove(zone);
          }
        } else if (skipLayerFilter || targetZone.GetLayerSet().Contains(item.GetLayer())) {
          aCompatData.m_affectedItems.add(item);
          aCommit.Remove(item);
        }
      }

      for (const item of sourceItems) {
        if (item.GetParent()?.Type() === KICAD_T.PCB_FOOTPRINT_T) continue;

        if (item.IsLocked() && !aOpts.m_includeLockedItems) continue;

        let copied: BOARD_ITEM | null = null;

        if (item.Type() === KICAD_T.PCB_ZONE_T) {
          const zone = item as ZONE;

          if (!skipLayerFilter) {
            const allowedLayers = refZone.GetLayerSet().and(targetZone.GetLayerSet());

            // Check all zone layers are included in both source and target rule areas.
            if (!allowedLayers.ContainsAll(zone.GetLayerSet())) continue;
          }

          const dup = item.Duplicate(false) as ZONE;
          this.fixupNet(zone, dup, aCompatData.m_matchingComponents);
          copied = dup;
        } else {
          if (!skipLayerFilter) {
            if (!refZone.GetLayerSet().Contains(item.GetLayer())) continue;

            if (!targetZone.GetLayerSet().Contains(item.GetLayer())) continue;
          }

          copied = item.Clone() as BOARD_ITEM;
        }

        fixupParentGroup(item, copied);
        copied.ClearFlags();
        copied.Rotate(origin, rot);
        copied.Move(disp);
        aCompatData.m_groupableItems.add(copied);
        aCommit.Add(copied);
      }
    }

    if (aOpts.m_copyPlacement) {
      for (const [refFP, targetFP] of aCompatData.m_matchingComponents) {
        if (!refZone.GetLayerSet().Contains(refFP.GetLayer())) continue;

        if (!targetZone.GetLayerSet().Contains(refFP.GetLayer())) continue;

        // For regular Rule Area repeat, ignore source footprints outside the reference area.
        if (
          aRefArea.m_sourceType !== PLACEMENT_SOURCE_T.DESIGN_BLOCK &&
          !refFP.GetEffectiveShape(refFP.GetLayer()).Collide(refPoly, 0)
        )
          continue;

        if (targetFP.IsLocked() && !aOpts.m_includeLockedItems) continue;

        aCommit.Modify(targetFP);

        targetFP.SetLayerAndFlip(refFP.GetLayer());
        targetFP.SetOrientation(refFP.GetOrientation());
        targetFP.SetPosition(refFP.GetPosition());
        targetFP.Rotate(origin, rot);
        targetFP.Move(disp);

        for (const refField of refFP.GetFields()) {
          const targetField = targetFP.GetField(refField.GetName());

          if (!targetField) continue;

          targetField.SetLayerSet(refField.GetLayerSet());
          targetField.SetVisible(refField.IsVisible());
          targetField.SetAttributes(refField.GetAttributes());
          targetField.SetPosition(refField.GetPosition());
          targetField.Rotate(origin, rot);
          targetField.Move(disp);
          targetField.SetIsKnockout(refField.IsKnockout());
        }

        // Copy non-field text items. Texts can share content, so match one-to-one and prefer
        // the same layer.
        const consumedTargets = new Set<PCB_TEXT>();

        for (const refItem of refFP.GraphicalItems()) {
          if (refItem.Type() !== KICAD_T.PCB_TEXT_T) continue;

          const refText = refItem as PCB_TEXT;
          let targetText: PCB_TEXT | null = null;

          for (const targetItem of targetFP.GraphicalItems()) {
            if (targetItem.Type() !== KICAD_T.PCB_TEXT_T) continue;

            const candidate = targetItem as PCB_TEXT;

            if (consumedTargets.has(candidate) || candidate.GetText() !== refText.GetText())
              continue;

            targetText = candidate;

            if (candidate.GetLayer() === refText.GetLayer()) break;
          }

          if (!targetText) continue;

          consumedTargets.add(targetText);
          targetText.SetLayer(refText.GetLayer());
          targetText.SetVisible(refText.IsVisible());
          targetText.SetAttributes(refText.GetAttributes());
          targetText.SetPosition(refText.GetPosition());
          targetText.Rotate(origin, rot);
          targetText.Move(disp);
          targetText.SetIsKnockout(refText.IsKnockout());
        }

        // Copy 3D model settings
        targetFP.Models().length = 0;
        targetFP.Models().push(...refFP.Models().map((m) => m.clone()));

        const consumedPads = new Set<unknown>();

        for (const refPad of refFP.Pads()) {
          for (const targetPad of targetFP.Pads()) {
            if (consumedPads.has(targetPad) || targetPad.GetNumber() !== refPad.GetNumber())
              continue;

            consumedPads.add(targetPad);
            targetPad.ImportSettingsFrom(refPad);
            break;
          }
        }

        aCompatData.m_affectedItems.add(targetFP);
        aCompatData.m_groupableItems.add(targetFP);

        // The matched footprint maps to its target; treat it as reproduced so a group
        // containing it can be rebuilt.
        if (preserveGroups && refFP.GetParentGroup()) groupFixupPairs.push([refFP, targetFP]);

        if (preserveGroups) reproducedSourceItems.add(refFP);
      }
    }

    // Rebuild a source group only when all of its members were reproduced (issue 22316).
    if (preserveGroups && groupFixupPairs.length > 0) {
      const groupMap = new Map<EDA_GROUP, EDA_GROUP>();
      const fullyReproducedCache = new Map<EDA_GROUP, boolean>();

      const groupFullyReproduced = (aGroup: EDA_GROUP): boolean => {
        const cached = fullyReproducedCache.get(aGroup);

        if (cached !== undefined) return cached;

        let reproduced = true;

        for (const member of aGroup.GetItems()) {
          // Nested groups are not reproduced, so a parent containing one can never
          // be fully reproduced.
          if (!member.IsBOARD_ITEM() || !reproducedSourceItems.has(member as BOARD_ITEM)) {
            reproduced = false;
            break;
          }
        }

        fullyReproducedCache.set(aGroup, reproduced);
        return reproduced;
      };

      for (const [sourceItem, destItem] of groupFixupPairs) {
        const parentGroup = sourceItem.GetParentGroup();

        if (!parentGroup || !groupFullyReproduced(parentGroup)) continue;

        if (!groupMap.has(parentGroup)) {
          const newGroup = (parentGroup.AsEdaItem() as PCB_GROUP).Duplicate(false) as PCB_GROUP;
          newGroup.GetItems().clear();
          newGroup.SetParentGroup(null);

          if (newGroup.Type() === KICAD_T.PCB_GENERATOR_T) {
            newGroup.Rotate(origin, rot);
            newGroup.Move(disp);
          }

          groupMap.set(parentGroup, newGroup);
          aCommit.Add(newGroup);
        }

        // AddItem reparents the footprint out of any group it already belongs to; stage that
        // group so the membership change is captured for undo.
        const oldGroup = destItem.GetParentGroup();

        if (oldGroup && oldGroup !== groupMap.get(parentGroup))
          aCommit.Modify(oldGroup.AsEdaItem() as BOARD_ITEM);

        groupMap.get(parentGroup)!.AddItem(destItem);
      }
    }

    targetZone.RemoveAllContours();
    targetZone.AddPolygon(newTargetOutline);
    targetZone.UnHatchBorder();
    targetZone.HatchBorder();

    return true;
  }

  /** `fixupNet`: give a copy the net of the matching pad in the target channel. */
  private fixupNet(
    aRef: BOARD_CONNECTED_ITEM,
    aTarget: BOARD_CONNECTED_ITEM,
    aComponentMatches: COMPONENT_MATCHES,
  ): void {
    // Copy as no-net.
    if (aComponentMatches.size === 0) {
      aTarget.SetNetCode(0);
      return;
    }

    const connectivity = this.board().GetConnectivity();
    const refConnectedPads = connectivity.GetNetItems(aRef.GetNetCode(), [KICAD_T.PCB_PAD_T]);

    for (const refConItem of refConnectedPads) {
      if (refConItem.Type() !== KICAD_T.PCB_PAD_T) continue;

      const refPad = refConItem as unknown as {
        GetParentFootprint(): FOOTPRINT | null;
        GetNumber(): string;
      };
      const sourceFootprint = refPad.GetParentFootprint();

      if (sourceFootprint && aComponentMatches.has(sourceFootprint)) {
        const targetFootprint = aComponentMatches.get(sourceFootprint)!;
        const targetFpPads = targetFootprint.GetPads(refPad.GetNumber());

        if (targetFpPads.length > 0) {
          aTarget.SetNetCode(targetFpPads[0]!.GetNet()!.GetNetCode());
          break;
        }
      }
    }
  }

  /**
   * `IsolateDesignBlockAutoNets`: remap a block's auto-named nets onto fresh private ones so
   * they cannot fuse by name with same-named nets of other parts (issue 24767).
   */
  static IsolateDesignBlockAutoNets(
    aBoard: BOARD,
    aFootprints: Iterable<FOOTPRINT>,
    aItems: Iterable<EDA_ITEM>,
  ): NETINFO_ITEM[] {
    const created: NETINFO_ITEM[] = [];
    const remap = new Map<number, NETINFO_ITEM>();
    let counter = 0;

    // Auto-generated names are tied to a reference designator. Named/power nets are
    // intentional and left alone.
    const isAutoName = (aName: string): boolean =>
      aName.startsWith('Net-(') || aName.startsWith('unconnected-');

    const remapItem = (aItem: BOARD_CONNECTED_ITEM): void => {
      const code = aItem.GetNetCode();

      if (code <= 0) return;

      const oldNet = aBoard.FindNet(code);

      if (!oldNet || !isAutoName(oldNet.GetNetname())) return;

      let net = remap.get(code);

      if (!net) {
        let name: string;

        do {
          name = `__dbapply_${code}_${counter++}`;
        } while (aBoard.FindNet(name));

        net = new NETINFO_ITEM(aBoard, name);
        aBoard.Add(net);
        created.push(net);
        remap.set(code, net);
      }

      aItem.SetNet(net);
    };

    for (const fp of aFootprints) {
      for (const pad of fp.Pads()) remapItem(pad);
    }

    for (const item of aItems) {
      if (item.IsBOARD_ITEM() && (item as BOARD_ITEM).IsConnected())
        remapItem(item as BOARD_CONNECTED_ITEM);
    }

    return created;
  }

  /** `resolveConnectionTopology`. */
  private resolveConnectionTopology(
    aRefArea: RULE_AREA,
    aTargetArea: RULE_AREA,
    aMatches: RULE_AREA_COMPAT_DATA,
    aParams: ISOMORPHISM_PARAMS = {},
  ): boolean {
    // Footprint-free design block has nothing to match to
    if (
      aRefArea.m_sourceType === PLACEMENT_SOURCE_T.DESIGN_BLOCK &&
      aRefArea.m_components.size === 0 &&
      aTargetArea.m_components.size === 0
    ) {
      aMatches.m_matchingComponents.clear();
      aMatches.m_isOk = true;
      aMatches.m_errorMsg = _('OK');
      aMatches.m_mismatchReasons = [];
      return true;
    }

    // Placement areas resolve their components from their source, so two areas sharing a
    // sheet, component class or group resolve to identical footprints.
    if (aRefArea.m_components.size > 0) {
      const shared = new Set(
        [...aRefArea.m_components].filter((fp) => aTargetArea.m_components.has(fp)),
      );

      if (shared.size > 0) {
        aMatches.m_matchingComponents.clear();
        aMatches.m_isOk = false;
        aMatches.m_errorMsg = _('Target Rule Area shares components with the reference area');
        aMatches.m_mismatchReasons = [
          _(
            'This target Rule Area selects the same components as the reference area. Repeat layout cannot copy a Rule Area onto itself. Give each placement Rule Area a distinct sheet, component class or group.',
          ),
          wxFormat(_('Shared components:\n%s'), FormatComponentList(shared)),
        ];
        return false;
      }
    }

    // A global rail connects >=2 pads in more than one channel; find them across all areas so
    // the exclusion is the same for every target.
    const netInternalAreas = new Map<number, RULE_AREA[]>();

    for (const area of this.m_areas.m_areas) {
      const areaNetPadCounts = new Map<number, number>();

      for (const fp of area.m_components) {
        for (const pad of fp.Pads()) {
          if (pad.GetNetCode() > 0)
            areaNetPadCounts.set(
              pad.GetNetCode(),
              (areaNetPadCounts.get(pad.GetNetCode()) ?? 0) + 1,
            );
        }
      }

      for (const [netCode, padCount] of areaNetPadCounts) {
        if (padCount >= 2)
          netInternalAreas.set(netCode, [...(netInternalAreas.get(netCode) ?? []), area]);
      }
    }

    // Require two component-disjoint areas so overlapping rule areas can't make a per-channel
    // net look global.
    const disjoint = (aA: RULE_AREA, aB: RULE_AREA): boolean =>
      ![...aA.m_components].some((fp) => aB.m_components.has(fp));

    const globalNets = new Set<number>();

    for (const [netCode, areas] of netInternalAreas) {
      for (let i = 0; i < areas.length && !globalNets.has(netCode); i++) {
        for (let j = i + 1; j < areas.length; j++) {
          if (disjoint(areas[i]!, areas[j]!)) {
            globalNets.add(netCode);
            break;
          }
        }
      }
    }

    const cgRef = CONNECTION_GRAPH.BuildFromFootprintSet(
      aRefArea.m_components,
      aTargetArea.m_components,
      globalNets,
    );
    const cgTarget = CONNECTION_GRAPH.BuildFromFootprintSet(
      aTargetArea.m_components,
      aRefArea.m_components,
      globalNets,
    );

    const mismatchReasons: TOPOLOGY_MISMATCH_REASON[] = [];
    let status = cgRef.FindIsomorphism(
      cgTarget,
      aMatches.m_matchingComponents,
      mismatchReasons,
      aParams,
    );

    // Net topology can legitimately differ between a design block and its placed instance once
    // the user edits connectivity on the board. Fall back to the symbol instance linkage.
    const cancelled = aParams.m_cancelled?.value ?? false;

    if (
      !status &&
      !cancelled &&
      matchBySymbolInstancePath(
        aRefArea.m_components,
        aTargetArea.m_components,
        aMatches.m_matchingComponents,
      )
    ) {
      status = true;
    }

    aMatches.m_isOk = status;

    if (status) {
      aMatches.m_errorMsg = _('OK');
      aMatches.m_mismatchReasons = [];
      return true;
    }

    aMatches.m_mismatchReasons = [];

    for (const reason of mismatchReasons) {
      if (reason.m_reason === '') continue;

      if (reason.m_reference !== '' && reason.m_candidate !== '') {
        aMatches.m_mismatchReasons.push(
          `${reason.m_reference} -> ${reason.m_candidate}: ${reason.m_reason}`,
        );
      } else if (reason.m_reference !== '') {
        aMatches.m_mismatchReasons.push(`${reason.m_reference}: ${reason.m_reason}`);
      } else {
        aMatches.m_mismatchReasons.push(reason.m_reason);
      }
    }

    if (aMatches.m_mismatchReasons.length === 0)
      aMatches.m_mismatchReasons.push(_('Topology mismatch'));

    // Component count mismatch
    if (aRefArea.m_components.size !== aTargetArea.m_components.size) {
      aMatches.m_mismatchReasons.push(
        wxFormat(_('Reference area total components: %d'), aRefArea.m_components.size),
        wxFormat(_('Reference area components:\n%s'), FormatComponentList(aRefArea.m_components)),
        wxFormat(_('Target area total components: %d'), aTargetArea.m_components.size),
        wxFormat(_('Target area components:\n%s'), FormatComponentList(aTargetArea.m_components)),
      );
    }

    aMatches.m_errorMsg = aMatches.m_mismatchReasons[0]!;
    return status;
  }

  /** `pruneExistingGroups`: take the items out of the groups that hold them. */
  private pruneExistingGroups(aCommit: COMMIT, aItemsToRemove: ReadonlySet<BOARD_ITEM>): boolean {
    // Note: groups are only collections, not "real" hierarchy.
    for (const group of [...this.board().Groups()]) {
      const pruneList: EDA_ITEM[] = [];

      for (const refItem of group.GetItems()) {
        for (const testItem of aItemsToRemove) {
          if (refItem.m_Uuid === testItem.m_Uuid) pruneList.push(refItem);
        }
      }

      if (pruneList.length > 0) {
        aCommit.Modify(group);

        for (const item of pruneList) group.RemoveItem(item);

        if (group.GetItems().size < 2) aCommit.Remove(group);
      }
    }

    return false;
  }

  /** `AutogenerateRuleAreas`: the dialog, then one placement rule area per ticked source. */
  AutogenerateRuleAreas(_aEvent: TOOL_EVENT): number {
    this.GeneratePotentialRuleAreas();

    if (this.m_areas.m_areas.length <= 1) {
      this.guiFrame()?.ShowInfoBarError(
        _(
          'Cannot auto-generate any placement areas because the schematic has only one or no hierarchical sheets, groups, or component classes.',
        ),
        true,
      );
      return 0;
    }

    void this.mcFrame()
      .ShowGenerateRuleAreasDialog(this)
      .then((ok) => {
        if (ok) this.generateRuleAreas();
      });

    return 0;
  }

  /** `AutogenerateRuleAreas` after wxID_OK. */
  generateRuleAreas(): void {
    for (const zone of this.board().Zones()) {
      if (!zone.GetIsRuleArea()) continue;

      if (!zone.GetPlacementAreaEnabled()) continue;

      const components = new Set<FOOTPRINT>();
      const zoneRA = new RULE_AREA();
      zoneRA.m_zone = zone;
      zoneRA.m_sourceType = zone.GetPlacementAreaSourceType();
      this.findComponentsInRuleArea(zoneRA, components);

      if (components.size === 0) continue;

      for (const ra of this.m_areas.m_areas) {
        if (setsEqual(components, ra.m_components)) {
          ra.m_oldZone = zone;
          ra.m_existsAlready = true;
        }
      }
    }

    const commit = new BOARD_COMMIT(this.GetManager()!, true, false);

    for (const ra of this.m_areas.m_areas) {
      if (!ra.m_generateEnabled) continue;

      if (ra.m_existsAlready && !this.m_areas.m_replaceExisting) continue;

      if (ra.m_components.size === 0) continue;

      let raOutline: SHAPE_LINE_CHAIN;

      // For group-based RAs, we build the RA outline based everything in the group, not just
      // components.
      if (ra.m_sourceType === PLACEMENT_SOURCE_T.GROUP_PLACEMENT) {
        const groupItems = this.queryBoardItemsInGroup(ra.m_groupName);

        if (groupItems.size === 0) continue;

        raOutline = this.buildRAOutline(groupItems, 100000);
      } else {
        // Start from the footprints, then also take everything in the design-block groups
        // they belong to (recursively), and the tracks on nets local to this channel.
        const outlineItems = new Set<BOARD_ITEM>();
        const groups = new Set<EDA_GROUP>();
        const channelNets = new Set<number>();

        for (const fp of ra.m_components) {
          outlineItems.add(fp);

          for (const pad of fp.Pads()) channelNets.add(pad.GetNetCode());

          for (let g = fp.GetParentGroup(); g; g = g.AsEdaItem().GetParentGroup()) groups.add(g);
        }

        for (const g of groups) collectGroupBoardItems(g, outlineItems);

        const foreignNets = new Set<number>();

        for (const fp of this.board().Footprints()) {
          if (ra.m_components.has(fp)) continue;

          for (const pad of fp.Pads()) foreignNets.add(pad.GetNetCode());
        }

        for (const track of this.board().Tracks() as PCB_TRACK[]) {
          const net = track.GetNetCode();

          if (net > 0 && channelNets.has(net) && !foreignNets.has(net)) outlineItems.add(track);
        }

        raOutline = this.buildRAOutline(outlineItems, 100000);
      }

      const newZone = new ZONE(this.board());

      if (ra.m_sourceType === PLACEMENT_SOURCE_T.SHEETNAME)
        newZone.SetZoneName(`auto-placement-area-${ra.m_sheetPath}`);
      else if (ra.m_sourceType === PLACEMENT_SOURCE_T.COMPONENT_CLASS)
        newZone.SetZoneName(`auto-placement-area-${ra.m_componentClass}`);
      else newZone.SetZoneName(`auto-placement-area-${ra.m_groupName}`);

      newZone.SetIsRuleArea(true);
      newZone.SetLayerSet(LSET.AllCuMask());
      newZone.SetPlacementAreaEnabled(true);
      newZone.SetDoNotAllowZoneFills(false);
      newZone.SetDoNotAllowVias(false);
      newZone.SetDoNotAllowTracks(false);
      newZone.SetDoNotAllowPads(false);
      newZone.SetDoNotAllowFootprints(false);

      if (ra.m_sourceType === PLACEMENT_SOURCE_T.SHEETNAME) {
        newZone.SetPlacementAreaSourceType(PLACEMENT_SOURCE_T.SHEETNAME);
        newZone.SetPlacementAreaSource(ra.m_sheetPath);
      } else if (ra.m_sourceType === PLACEMENT_SOURCE_T.COMPONENT_CLASS) {
        newZone.SetPlacementAreaSourceType(PLACEMENT_SOURCE_T.COMPONENT_CLASS);
        newZone.SetPlacementAreaSource(ra.m_componentClass);
      } else {
        newZone.SetPlacementAreaSourceType(PLACEMENT_SOURCE_T.GROUP_PLACEMENT);
        newZone.SetPlacementAreaSource(ra.m_groupName);
      }

      newZone.AddPolygon(raOutline);
      newZone.SetHatchStyle(ZONE_BORDER_DISPLAY_STYLE.NO_HATCH);

      if (ra.m_existsAlready && ra.m_oldZone) commit.Remove(ra.m_oldZone);

      ra.m_zone = newZone;
      commit.Add(ra.m_zone);
    }

    // fixme: handle corner cases where the items belonging to a Rule Area already
    // belong to other groups.
    if (this.m_areas.m_options.m_groupItems) {
      for (const ra of this.m_areas.m_areas) {
        if (!ra.m_generateEnabled) continue;

        if (ra.m_existsAlready && !this.m_areas.m_replaceExisting) continue;

        // A group needs at least 2 items (zone + at least 1 component)
        if (ra.m_components.size === 0) continue;

        const toPrune = new Set<BOARD_ITEM>(ra.m_components);

        if (ra.m_existsAlready && ra.m_zone) toPrune.add(ra.m_zone);

        this.pruneExistingGroups(commit, toPrune);

        const group = new PCB_GROUP(this.board());

        commit.Add(group);
        commit.Modify(ra.m_zone!);
        group.AddItem(ra.m_zone!);

        for (const fp of ra.m_components) {
          commit.Modify(fp);
          group.AddItem(fp);
        }
      }
    }

    commit.Push(_('Auto-generate placement rule areas'));
  }
}
