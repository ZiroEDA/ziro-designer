// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/sch_rule_area.h` / `eeschema/sch_rule_area.cpp`: `SCH_RULE_AREA`, a polygon
 * whose directive labels apply to the items it contains, and which can exclude them from
 * simulation, the BOM, the board, or mark them DNP.
 *
 * Not here: `Plot`, `SCH_RULE_AREA_DESC`; `UpdateRuleAreasInScreens`
 * takes no view (the repaint of directive labels belongs to the painter port).
 */

import { RECURSE_MODE } from '@ziroeda/common/eda_item.js';
import { PROPERTY, TYPE_BOOL, TYPE_CAST } from '@ziroeda/common/properties/property.js';
import { PROPERTY_MANAGER, REGISTER_TYPE } from '@ziroeda/common/properties/property_mgr.js';
import { EDA_SHAPE } from '@ziroeda/common/eda_shape.js';
import { FILL_T, SHAPE_T } from '@ziroeda/common/eda_shape.js';
import type { KIID } from '@ziroeda/common/kiid.js';
import { SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import type { UNITS_PROVIDER } from '@ziroeda/common/units_provider.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { SHAPE } from '@ziroeda/kimath/src/geometry/shape.js';
import { SHAPE_RECT } from '@ziroeda/kimath/src/geometry/shape_rect.js';
import { SHAPE_SEGMENT } from '@ziroeda/kimath/src/geometry/shape_segment.js';
import { SHAPE_SIMPLE } from '@ziroeda/kimath/src/geometry/shape_simple.js';
import type { SCH_FIELD } from './sch_field.js';
import { SCH_ITEM } from './sch_item.js';
import type { SCH_DIRECTIVE_LABEL } from './sch_label.js';
import type { SCH_LINE } from './sch_line.js';
import type { SCH_SCREEN } from './sch_screen.js';
import { SCH_SHAPE } from './sch_shape.js';
import type { SCH_SHEET_PATH } from './sch_sheet_path.js';
import { MSG_PANEL_ITEM } from '@ziroeda/common/widgets/msgpanel.js';
import type { EDA_DRAW_FRAME_LIKE } from '@ziroeda/common/eda_item.js';

const sameSet = <T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean =>
  a.size === b.size && [...a].every((x) => b.has(x));

export class SCH_RULE_AREA extends SCH_SHAPE {
  protected m_excludedFromSim: boolean;
  protected m_excludedFromBOM: boolean;
  protected m_excludedFromBoard: boolean;
  protected m_DNP: boolean; ///< True if symbol is set to 'Do Not Populate'.

  /// All SCH_ITEMs currently contained or intersecting the rule area.
  m_items: Set<SCH_ITEM>;
  m_itemIDs: Set<KIID>;

  /// All SCH_DIRECTIVE_LABELs attached to the rule area border.
  m_directives: Set<SCH_DIRECTIVE_LABEL>;
  m_directiveIDs: Set<KIID>;

  /// All SCH_ITEM and SCH_DIRECTIVE_LABEL objectss from the previous cache refresh.
  m_prev_items: Set<KIID>;
  m_prev_directives: Set<KIID>;

  constructor() {
    super(
      SHAPE_T.POLY,
      SCH_LAYER_ID.LAYER_RULE_AREAS,
      0 /* line width */,
      FILL_T.NO_FILL,
      KICAD_T.SCH_RULE_AREA_T,
    );
    this.m_excludedFromSim = false;
    this.m_excludedFromBOM = false;
    this.m_excludedFromBoard = false;
    this.m_DNP = false;
    this.m_items = new Set();
    this.m_itemIDs = new Set();
    this.m_directives = new Set();
    this.m_directiveIDs = new Set();
    this.m_prev_items = new Set();
    this.m_prev_directives = new Set();

    this.SetLayer(SCH_LAYER_ID.LAYER_RULE_AREAS);
  }

  /** The compiler-generated copy: the caches are copied (no ownership). */
  static copyOf(aOther: SCH_RULE_AREA): SCH_RULE_AREA {
    const copy = SCH_SHAPE.copyShape(new SCH_RULE_AREA(), aOther);
    copy.m_excludedFromSim = aOther.m_excludedFromSim;
    copy.m_excludedFromBOM = aOther.m_excludedFromBOM;
    copy.m_excludedFromBoard = aOther.m_excludedFromBoard;
    copy.m_DNP = aOther.m_DNP;
    copy.m_items = new Set(aOther.m_items);
    copy.m_itemIDs = new Set(aOther.m_itemIDs);
    copy.m_directives = new Set(aOther.m_directives);
    copy.m_directiveIDs = new Set(aOther.m_directiveIDs);
    copy.m_prev_items = new Set(aOther.m_prev_items);
    copy.m_prev_directives = new Set(aOther.m_prev_directives);
    return copy;
  }

  /** `~SCH_RULE_AREA()`: drop this area from its items' and directives' caches. */
  override Destroy(): void {
    // Unregister this rule area from all contained items
    for (const item of this.m_items) item.RemoveRuleAreaFromCache(this);

    // Unregister this rule area from all directive labels
    for (const label of this.m_directives) label.RemoveConnectedRuleArea(this);

    super.Destroy();
  }

  override GetClass(): string {
    return 'SCH_RULE_AREA';
  }

  /** `GetMsgPanelInfo( aFrame, aList )` (sch_rule_area.cpp). */
  override GetMsgPanelInfo(aFrame: EDA_DRAW_FRAME_LIKE, aList: MSG_PANEL_ITEM[]): void {
    aList.push(new MSG_PANEL_ITEM('Rule Area', ''));

    aList.push(new MSG_PANEL_ITEM('Points', `${this.GetPolyShape().Outline(0).PointCount()}`));

    this.GetStroke().GetMsgPanelInfo(aFrame, aList);

    const netclasses = this.GetResolvedNetclasses(null);
    let resolvedNetclass = '<None>';

    if (netclasses.length > 0) resolvedNetclass = netclasses[0]![0];

    aList.push(new MSG_PANEL_ITEM('Resolved netclass', resolvedNetclass));
  }

  override GetFriendlyName(): string {
    return 'Rule Area';
  }

  override Clone(): SCH_RULE_AREA {
    return SCH_RULE_AREA.copyOf(this);
  }

  override SetExcludedFromSim(
    aExcludeFromSim: boolean,
    _aInstance: SCH_SHEET_PATH | null = null,
    _aVariantName = '',
  ): void {
    this.m_excludedFromSim = aExcludeFromSim;
  }
  override GetExcludedFromSim(
    _aInstance: SCH_SHEET_PATH | null = null,
    _aVariantName = '',
  ): boolean {
    return this.m_excludedFromSim;
  }
  GetExcludedFromSimProp(): boolean {
    return this.GetExcludedFromSim();
  }
  SetExcludedFromSimProp(aExcludeFromSim: boolean): void {
    this.SetExcludedFromSim(aExcludeFromSim);
  }

  override SetExcludedFromBOM(
    aExcludeFromBOM: boolean,
    _aInstance: SCH_SHEET_PATH | null = null,
    _aVariantName = '',
  ): void {
    this.m_excludedFromBOM = aExcludeFromBOM;
  }
  override GetExcludedFromBOM(
    _aInstance: SCH_SHEET_PATH | null = null,
    _aVariantName = '',
  ): boolean {
    return this.m_excludedFromBOM;
  }
  GetExcludedFromBOMProp(): boolean {
    return this.GetExcludedFromBOM();
  }
  SetExcludedFromBOMProp(aExcludeFromBOM: boolean): void {
    this.SetExcludedFromBOM(aExcludeFromBOM);
  }

  override SetExcludedFromBoard(
    aExclude: boolean,
    _aInstance: SCH_SHEET_PATH | null = null,
    _aVariantName = '',
  ): void {
    this.m_excludedFromBoard = aExclude;
  }
  override GetExcludedFromBoard(
    _aInstance: SCH_SHEET_PATH | null = null,
    _aVariantName = '',
  ): boolean {
    return this.m_excludedFromBoard;
  }
  GetExcludedFromBoardProp(): boolean {
    return this.GetExcludedFromBoard();
  }
  SetExcludedFromBoardProp(aExclude: boolean): void {
    this.SetExcludedFromBoard(aExclude);
  }

  override GetDNP(_aInstance: SCH_SHEET_PATH | null = null, _aVariantName = ''): boolean {
    return this.m_DNP;
  }
  override SetDNP(
    aDNP: boolean,
    _aInstance: SCH_SHEET_PATH | null = null,
    _aVariantName = '',
  ): void {
    this.m_DNP = aDNP;
  }
  GetDNPProp(): boolean {
    return this.GetDNP();
  }
  SetDNPProp(aDNP: boolean): void {
    this.SetDNP(aDNP);
  }

  override ViewGetLayers(): number[] {
    return [
      SCH_LAYER_ID.LAYER_RULE_AREAS,
      SCH_LAYER_ID.LAYER_NOTES_BACKGROUND,
      SCH_LAYER_ID.LAYER_SELECTION_SHADOWS,
    ];
  }

  override IsFilledForHitTesting(): boolean {
    return false;
  }

  override MakeEffectiveShapes(aEdgeOnly = false): SHAPE[] {
    const effectiveShapes: SHAPE[] = [];
    const width = this.GetEffectiveWidth();

    switch (this.m_shape) {
      case SHAPE_T.POLY: {
        if (this.GetPolyShape().OutlineCount() === 0)
          // malformed/empty polygon
          break;

        for (let ii = 0; ii < this.GetPolyShape().OutlineCount(); ++ii) {
          const l = this.GetPolyShape().COutline(ii);

          if (this.IsSolidFill() && !aEdgeOnly) effectiveShapes.push(new SHAPE_SIMPLE(l));

          if (width > 0 || !this.IsSolidFill() || aEdgeOnly) {
            const segCount = l.SegmentCount();

            for (let jj = 0; jj < segCount; jj++)
              effectiveShapes.push(new SHAPE_SEGMENT(l.CSegment(jj), width));
          }
        }

        break;
      }

      default:
        return super.MakeEffectiveShapes(aEdgeOnly);
    }

    return effectiveShapes;
  }

  override GetItemDescription(_aUnitsProvider: UNITS_PROVIDER | null, _aFull: boolean): string {
    return 'Schematic rule area';
  }

  /** Reset all item and directive caches, saving the current state first. */
  protected resetCaches(): void {
    // Save the current state
    this.m_prev_items = this.m_itemIDs;
    this.m_prev_directives = this.m_directiveIDs;

    // Reset the rule area
    this.m_items = new Set();
    this.m_itemIDs = new Set();
    this.m_directives = new Set();
    this.m_directiveIDs = new Set();
  }

  /** Refresh the list of items which this rule area affects. */
  RefreshContainedItemsAndDirectives(screen: SCH_SCREEN): void {
    const items = screen.Items();
    const boundingBox = this.GetBoundingBox();

    // Get any SCH_DIRECTIVE_LABELs which are attached to the rule area border
    for (const candidateDirective of items.Overlapping(
      KICAD_T.SCH_DIRECTIVE_LABEL_T,
      boundingBox,
    )) {
      const label = candidateDirective as SCH_DIRECTIVE_LABEL;
      const labelConnectionPoints = label.GetConnectionPoints();

      if (this.GetPolyShape().CollideEdge(labelConnectionPoints[0]!, undefined, 5))
        this.addDirective(label);
    }

    // If directives have changed, we need to force an update of the contained items connectivity
    for (const areaItem of items.Overlapping(null, boundingBox)) {
      if (areaItem.IsType([KICAD_T.SCH_ITEM_LOCATE_WIRE_T, KICAD_T.SCH_ITEM_LOCATE_BUS_T])) {
        const lineItem = areaItem as SCH_LINE;
        const lineSeg = new SHAPE_SEGMENT(
          lineItem.GetStartPoint(),
          lineItem.GetEndPoint(),
          lineItem.GetLineWidth(),
        );

        if (this.GetPolyShape().Collide(lineSeg)) this.addContainedItem(areaItem);
      } else if (
        areaItem.IsType([
          KICAD_T.SCH_PIN_T,
          KICAD_T.SCH_LABEL_T,
          KICAD_T.SCH_GLOBAL_LABEL_T,
          KICAD_T.SCH_HIER_LABEL_T,
        ])
      ) {
        const connectionPoints = areaItem.GetConnectionPoints();

        if (this.GetPolyShape().Collide(connectionPoints[0]!)) this.addContainedItem(areaItem);
      } else if (areaItem.IsType([KICAD_T.SCH_SYMBOL_T])) {
        const symbol = areaItem as SCH_ITEM & { GetPins(): SCH_ITEM[] };
        const symbolBb = symbol.GetBoundingBox();
        const rect = new SHAPE_RECT(symbolBb);

        if (this.GetPolyShape().Collide(rect)) {
          this.addContainedItem(areaItem);

          // Add pins which are within the rule area
          for (const pin of symbol.GetPins()) {
            if (this.GetPolyShape().Collide(pin.GetPosition())) this.addContainedItem(pin);
          }
        }
      } else if (areaItem.IsType([KICAD_T.SCH_SHEET_T])) {
        const sheetBb = areaItem.GetBoundingBox();
        const rect = new SHAPE_RECT(sheetBb);

        if (this.GetPolyShape().Collide(rect)) this.addContainedItem(areaItem);
      }
    }
  }

  /**
   * Update all rule area connectvity / caches in the given sheet paths.
   *
   * @return A map of all updated rule areas and their owning screen.
   */
  static UpdateRuleAreasInScreens(screens: Iterable<SCH_SCREEN>): [SCH_RULE_AREA, SCH_SCREEN][] {
    const forceUpdateRuleAreas: [SCH_RULE_AREA, SCH_SCREEN][] = [];

    for (const screen of screens) {
      // First reset all item caches - must be done first to ensure two rule areas
      // on the same item don't overwrite each other's caches
      for (const item of screen.Items()) {
        if (item.Type() === KICAD_T.SCH_RULE_AREA_T) (item as SCH_RULE_AREA).resetCaches();

        item.ClearRuleAreasCache();
      }

      // Secondly, refresh the rule areas
      for (const ruleAreaAsItem of screen.Items().OfType(KICAD_T.SCH_RULE_AREA_T)) {
        const ruleArea = ruleAreaAsItem as SCH_RULE_AREA;
        ruleArea.RefreshContainedItemsAndDirectives(screen);

        if (!sameSet(ruleArea.m_directiveIDs, ruleArea.m_prev_directives))
          forceUpdateRuleAreas.push([ruleArea, screen]);
      }
    }

    return forceUpdateRuleAreas;
  }

  /** @return All items contained within or intersecting this rule area. */
  GetContainedItems(): ReadonlySet<SCH_ITEM> {
    return this.m_items;
  }

  /** @return All item IDs contained within or intersecting this rule area before the last update. */
  GetPastContainedItems(): ReadonlySet<KIID> {
    return this.m_prev_items;
  }

  /** @return All directives attached to the rule area border. */
  GetDirectives(): ReadonlySet<SCH_DIRECTIVE_LABEL> {
    return this.m_directives;
  }

  /** Resolve the netclass of this rule area from connected directive labels. */
  GetResolvedNetclasses(aSheetPath: SCH_SHEET_PATH | null): [string, SCH_ITEM][] {
    const resolvedNetclasses: [string, SCH_ITEM][] = [];

    for (const directive of this.m_directives) {
      directive.RunOnChildren((aChild: SCH_ITEM) => {
        if (aChild.Type() === KICAD_T.SCH_FIELD_T) {
          const field = aChild as SCH_FIELD;

          if (field.GetCanonicalName() === 'Netclass') {
            const netclass = field.GetShownText(aSheetPath, false);

            if (netclass !== '') resolvedNetclasses.push([netclass, directive]);
          }
        }
      }, RECURSE_MODE.NO_RECURSE);
    }

    return resolvedNetclasses;
  }

  /** Add a directive label which applies to items within ths rule area. */
  protected addDirective(label: SCH_DIRECTIVE_LABEL): void {
    label.AddConnectedRuleArea(this);
    this.m_directives.add(label);
    this.m_directiveIDs.add(label.m_Uuid);
  }

  /** Add an item to the list of items which this rule area affects. */
  protected addContainedItem(item: SCH_ITEM): void {
    item.AddRuleAreaToCache(this);
    this.m_items.add(item);
    this.m_itemIDs.add(item.m_Uuid);
  }

  /** Remove an item from the cache of items inside the rule area. */
  RemoveItem(aItem: SCH_ITEM): void {
    this.m_items.delete(aItem);
    this.m_prev_items.delete(aItem.m_Uuid);
  }

  /** Remove a directive label from the cache of directives attached to the rule area. */
  RemoveDirective(aLabel: SCH_DIRECTIVE_LABEL): void {
    this.m_directives.delete(aLabel);
    this.m_prev_directives.delete(aLabel.m_Uuid);
  }
}

/**
 * `static struct SCH_RULE_AREA_DESC` (eeschema/sch_rule_area.cpp:439).
 */
(() => {
  const propMgr = PROPERTY_MANAGER.Instance();
  REGISTER_TYPE(SCH_RULE_AREA);
  propMgr.AddTypeCast(new TYPE_CAST(SCH_RULE_AREA, SCH_SHAPE));
  propMgr.AddTypeCast(new TYPE_CAST(SCH_RULE_AREA, SCH_ITEM));
  propMgr.AddTypeCast(new TYPE_CAST(SCH_RULE_AREA, EDA_SHAPE));
  propMgr.InheritsAfter(SCH_RULE_AREA, SCH_SHAPE);
  propMgr.InheritsAfter(SCH_RULE_AREA, SCH_ITEM);
  propMgr.InheritsAfter(SCH_RULE_AREA, EDA_SHAPE);

  const groupAttributes = 'Attributes';

  const flag = (
    aName: string,
    aSetter: keyof SCH_RULE_AREA & string,
    aGetter: keyof SCH_RULE_AREA & string,
  ) =>
    propMgr.AddProperty(
      new PROPERTY<SCH_RULE_AREA, boolean>(SCH_RULE_AREA, aName, aSetter, aGetter, TYPE_BOOL),
      groupAttributes,
    );

  flag('Exclude From Board', 'SetExcludedFromBoardProp', 'GetExcludedFromBoardProp');
  flag('Exclude From Simulation', 'SetExcludedFromSimProp', 'GetExcludedFromSimProp');
  flag('Exclude From Bill of Materials', 'SetExcludedFromBOMProp', 'GetExcludedFromBOMProp');
  flag('Do not Populate', 'SetDNPProp', 'GetDNPProp');
})();
