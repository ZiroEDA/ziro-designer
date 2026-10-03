// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/schematic.cpp`: `SCHEMATIC::ResolveTextVar`, the resolver a
 * schematic text's `GetShownText` hands `ResolveTextVars` - the sheet's own
 * tokens, then the sheet's `TITLE_BLOCK`, then the `PROJECT`. The SCHEMATIC
 * and SCH_SHEET_PATH classes are not ported; the caller gives what this reads
 * of them as a {@link TextVarContext}.
 */
import type { OutStr } from '@ziroeda/common/eda_item.js';
import { PROJECT } from '@ziroeda/common/project.js';
import { PROJECT_FILE } from '@ziroeda/common/project/project_file.js';
import { TITLE_BLOCK } from '@ziroeda/common/title_block.js';
import type { TextVarResolverFn } from '@ziroeda/common/common.js';

/** What `SCHEMATIC::ResolveTextVar` reads of the schematic, the sheet path and the project. */
export interface TextVarContext {
  /** The project's `text_variables` (Schematic Setup > Text Variables). */
  textVars?: Readonly<Record<string, string>>;
  /** The sheet's title block (`aSheetPath->LastScreen()->GetTitleBlock()`). */
  titleBlock?: {
    title?: string;
    date?: string;
    rev?: string;
    company?: string;
    comments?: readonly string[];
  };
  /** `aSheetPath->Last()->GetName()`. */
  sheetName?: string;
  /** `aSheetPath->PathHumanReadable()`. */
  sheetPath?: string;
  /** `wxFileName( GetFileName() ).GetFullName()`. */
  fileName?: string;
  /** `m_project->GetProjectName()`. */
  projectName?: string;
  /** `aSheetPath->GetPageNumber()`. */
  pageNumber?: string;
  /** `Root().CountSheets()`. */
  pageCount?: number;
}

/**
 * `SCHEMATIC::ResolveTextVar( aSheetPath, token, aDepth )` over a context.
 * `FILEPATH` and the variant tokens are not answered: the context carries no
 * full path and there are no variants yet.
 */
export function schematicTextVarResolver(ctx: TextVarContext): TextVarResolverFn {
  const titleBlock = new TITLE_BLOCK();
  const tb = ctx.titleBlock ?? {};
  titleBlock.SetTitle(tb.title ?? '');
  titleBlock.SetDate(tb.date ?? '');
  titleBlock.SetRevision(tb.rev ?? '');
  titleBlock.SetCompany(tb.company ?? '');
  (tb.comments ?? []).forEach((c, i) => {
    titleBlock.SetComment(i, c);
  });

  const project = new PROJECT();
  project.setProjectFullName(ctx.projectName ? `${ctx.projectName}.kicad_pro` : '');
  const projectFile = new PROJECT_FILE();
  projectFile.m_TextVars = new Map(Object.entries(ctx.textVars ?? {}));
  project.setProjectFile(projectFile);

  return (token: OutStr): boolean => {
    switch (token.value) {
      case '#':
        token.value = ctx.pageNumber ?? '1';
        return true;
      case '##':
        token.value = String(ctx.pageCount ?? 1);
        return true;
      case 'SHEETPATH':
        token.value = ctx.sheetPath ?? '/';
        return true;
      case 'SHEETNAME':
        token.value = ctx.sheetName ?? '';
        return true;
      case 'FILENAME':
        token.value = ctx.fileName ?? '';
        return true;
      case 'PROJECTNAME':
        token.value = ctx.projectName ?? '';
        return true;
    }

    if (titleBlock.TextVarResolver(token, project)) return true;

    if (project.TextVarResolver(token)) return true;

    return false;
  };
}

// ---------------------------------------------------------------------------
// `SCHEMATIC`, the live-model class (eeschema stage E3): the virtual root sheet above
// the top-level sheets, the current sheet, the hierarchy, bus aliases, variants and the
// schematic's embedded files. Everything above is the record model's resolver, untouched.
//
// Pending, marked in place: RecalculateConnections' incremental path (the connection graph
// is always rebuilt whole; see RecalculateConnections), the PROPERTY_MANAGER listener that syncs other units' fields, SCH_REFERENCE_LIST
// uses (CacheExistingAnnotation, Contains, the refdes fallback of ResolveCrossReference,
// ConvertRefsToKIIDs), fonts (GetFonts, EmbedFonts), SPICE_VALUE formatting of operating
// points, RecomputeIntersheetRefs' field autoplacement, SaveToHistory.
// ---------------------------------------------------------------------------

import { EDA_ITEM as EDA_ITEM_E3 } from '@ziroeda/common/eda_item.js';
import type { OutStr as OutStrE3 } from '@ziroeda/common/eda_item.js';
import { EMBEDDED_FILES } from '@ziroeda/common/embedded_files.js';
import { type KIID, KIID_PATH, niluuid } from '@ziroeda/common/kiid.js';
import { KICAD_T as KICAD_T_E3 } from '@ziroeda/core/typeinfo.js';
import { applyMixins } from '@ziroeda/core/mixins.js';
import { BUS_ALIAS } from './bus_alias.js';
import { CONNECTION_GRAPH, CONNECTION_SUBGRAPH } from './connection_graph.js';
import { ERC_SETTINGS, sortedExclusions } from './erc/erc_settings.js';
import { SCH_MARKER } from './sch_marker.js';
import type { SCH_GLOBALLABEL } from './sch_label.js';
import type { SCHEMATIC_HOLDER } from './schematic_holder.js';
import { AUTOPLACE_ALGO, type SCH_ITEM } from './sch_item.js';
import { SCH_COMMIT } from './sch_commit.js';
import type { SCH_JUNCTION } from './sch_junction.js';
import type { SCH_LINE } from './sch_line.js';
import type { SCH_NO_CONNECT } from './sch_no_connect.js';
import { SELECTED_BY_DRAG, STRUCT_DELETED } from '@ziroeda/common/eda_item_flags.js';
import { TOOL_MANAGER } from '@ziroeda/common/tool/tool_manager.js';
import { SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { SCH_RULE_AREA } from './sch_rule_area.js';
import { SCH_SCREEN, SCH_SCREENS } from './sch_screen.js';
import { SCH_SHEET } from './sch_sheet.js';
import { SCH_SHEET_LIST, SCH_SHEET_PATH } from './sch_sheet_path.js';
import type { SCH_SYMBOL } from './sch_symbol.js';
import { SCHEMATIC_SETTINGS } from './schematic_settings.js';

/** The `SCHEMATIC_SETTINGS` the items read: the class itself now. */
export type SCHEMATIC_SETTINGS_LIKE = SCHEMATIC_SETTINGS;

/** `SCHEMATIC_LISTENER`: observers of item and sheet changes. */
export interface SCHEMATIC_LISTENER {
  OnSchItemsAdded?(aSch: SCHEMATIC, aSchItem: SCH_ITEM[]): void;
  OnSchItemsRemoved?(aSch: SCHEMATIC, aSchItem: SCH_ITEM[]): void;
  OnSchItemsChanged?(aSch: SCHEMATIC, aSchItem: SCH_ITEM[]): void;
  OnSchSheetChanged?(aSch: SCHEMATIC): void;
  OnSchCurrentVariantChanged?(aSch: SCHEMATIC): void;
}

export enum SCH_CLEANUP_FLAGS {
  NO_CLEANUP,
  LOCAL_CLEANUP,
  GLOBAL_CLEANUP,
}

/** `GetDefaultVariantName()` (common/variants.cpp). */
export const DEFAULT_VARIANT_NAME = '< Default >';

const cpCmpE3 = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: KiCad's multiple inheritance (EDA_ITEM + EMBEDDED_FILES), applied with applyMixins
export interface SCHEMATIC extends EMBEDDED_FILES {}

/**
 * Holds all the data relating to one schematic.
 *
 * A schematic may consist of one or more sheets (and one root sheet)
 * Right now, eeschema can have only one schematic open at a time, but this could change.
 * Please keep this possibility in mind when adding to this object.
 */
// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: see the interface above
export class SCHEMATIC extends EDA_ITEM_E3 {
  static m_IsSchematicExists = false;

  private m_project: PROJECT | null;

  /// The virtual root sheet (nil uuid); the top-level sheets are on its screen.
  private m_rootSheet: SCH_SHEET | null;

  /// The top-level sheets, the children of the virtual root.
  private m_topLevelSheets: SCH_SHEET[];

  /**
   * The sheet path of the sheet currently being edited or displayed.
   * Note that this was moved here from SCH_EDIT_FRAME because currently many places in
   * the code want to know the current sheet.  Potentially this can be moved back to the
   * UI code once the only places that want to know it are UI-related.
   */
  private m_currentSheet: SCH_SHEET_PATH;

  /**
   * Holds a map of labels to the page sequence (virtual page number) that they appear on.
   * It is used for updating global label intersheet references.
   */
  private m_labelToPageRefsMap: Map<string, Set<number>>;

  /// Properties for text variable substitution (and weak references to other symbols).
  private m_properties: Map<string, string>;

  /// Simulation operating points for text variable substitution.
  private m_operatingPoints: Map<string, number>;

  /// Cache of the hierarchy, built by RefreshHierarchy().
  private m_hierarchy: SCH_SHEET_LIST;

  private m_listeners: SCHEMATIC_LISTENER[];

  private m_busAliases: BUS_ALIAS[];

  private m_currentVariant: string;
  private m_variantNames: Set<string>;

  private m_settingTopLevelSheets: boolean;

  /// The settings a schematic with no project (or a project with no file) answers with:
  /// upstream dereferences the project file and has no such case.
  private m_settings: SCHEMATIC_SETTINGS | null = null;
  private m_ercSettings: ERC_SETTINGS | null = null;

  /// `m_schematicHolder`: the editor the schematic calls back through (null headless).
  private m_schematicHolder: SCHEMATIC_HOLDER | null = null;

  /// Holds and calculates connectivity information of this schematic.
  private m_connectionGraph: CONNECTION_GRAPH;

  constructor(aPrj: PROJECT | null) {
    super(null, KICAD_T_E3.SCHEMATIC_T);
    this.initEmbeddedFiles();

    this.m_project = null;
    this.m_rootSheet = null;
    this.m_topLevelSheets = [];
    this.m_currentSheet = new SCH_SHEET_PATH();
    this.m_labelToPageRefsMap = new Map();
    this.m_properties = new Map();
    this.m_operatingPoints = new Map();
    this.m_hierarchy = new SCH_SHEET_LIST();
    this.m_listeners = [];
    this.m_busAliases = [];
    this.m_currentVariant = '';
    this.m_variantNames = new Set();
    this.m_settingTopLevelSheets = false;
    this.m_connectionGraph = new CONNECTION_GRAPH(this);

    SCHEMATIC.m_IsSchematicExists = true;

    this.SetProject(aPrj);

    this.Reset();
  }

  override GetClass(): string {
    return 'SCHEMATIC';
  }

  /**
   * Initialize this schematic to a blank one, unloading anything existing.
   */
  Reset(): void {
    if (this.m_rootSheet) this.m_rootSheet.Destroy();

    this.m_rootSheet = null;
    this.m_topLevelSheets = [];
    this.m_hierarchy = new SCH_SHEET_LIST();

    this.m_connectionGraph.Reset();
    this.m_currentSheet.clear();

    this.m_busAliases = [];

    this.ensureVirtualRoot();
    this.ensureDefaultTopLevelSheet();
    this.loadBusAliasesFromProject();
  }

  /** Return a reference to the project this schematic is part of. */
  Project(): PROJECT {
    return this.m_project!;
  }

  /** `SetProject` (schematic.cpp:180). */
  SetProject(aPrj: PROJECT | null): void {
    const oldFile = this.m_project?.GetProjectFile() as PROJECT_FILE | null | undefined;

    if (oldFile) {
      // d'tor will save settings to file
      if (oldFile.m_ErcSettings) oldFile.ReleaseNestedSettings(oldFile.m_ErcSettings);
      oldFile.m_ErcSettings = null;

      // d'tor will save settings to file
      if (oldFile.m_SchematicSettings) oldFile.ReleaseNestedSettings(oldFile.m_SchematicSettings);
      oldFile.m_SchematicSettings = null;
    }

    this.m_project = aPrj;

    const project = this.m_project?.GetProjectFile() as PROJECT_FILE | null | undefined;

    if (project) {
      project.m_ErcSettings = new ERC_SETTINGS(project, 'erc');
      project.m_SchematicSettings = new SCHEMATIC_SETTINGS(project, 'schematic');

      project.m_SchematicSettings.LoadFromFile();
      // m_NgspiceSettings: no simulator here.
      project.m_ErcSettings.LoadFromFile();
    }

    if (this.m_project) this.loadBusAliasesFromProject();
  }

  /** `loadBusAliasesFromProject`: the project file's `schematic.bus_aliases`. */
  private loadBusAliasesFromProject(): void {
    this.m_busAliases = [];

    if (!this.m_project) return;

    // A PROJECT with no file (a bare `new PROJECT()`) has no aliases to give.
    const projectFile = this.m_project.GetProjectFile() as PROJECT_FILE | null;

    if (!projectFile) return;

    for (const [name, members] of projectFile.m_BusAliases) {
      const busAlias = new BUS_ALIAS();

      busAlias.SetName(name);
      busAlias.SetMembers(members);

      this.m_busAliases.push(busAlias);
    }
  }

  GetProperties(): Map<string, string> {
    return this.m_properties;
  }

  /** Build the sheet list of every top-level sheet, sorted by page number. */
  BuildSheetListSortedByPageNumbers(): SCH_SHEET_LIST {
    const hierarchy = new SCH_SHEET_LIST();

    if (this.m_topLevelSheets.length === 0) return hierarchy;

    for (const sheet of this.m_topLevelSheets) {
      if (sheet) {
        const sheetList = new SCH_SHEET_LIST();
        sheetList.BuildSheetList(sheet, false);

        for (const path of sheetList) hierarchy.push(path);
      }
    }

    hierarchy.SortByPageNumbers();

    return hierarchy;
  }

  BuildUnorderedSheetList(): SCH_SHEET_LIST {
    const sheets = new SCH_SHEET_LIST();

    for (const sheet of this.m_topLevelSheets) {
      if (sheet) {
        const sheetList = new SCH_SHEET_LIST();
        sheetList.BuildSheetList(sheet, false);

        for (const path of sheetList) sheets.push(path);
      }
    }

    return sheets;
  }

  /** Return the full schematic flattened hierarchical sheet list. */
  Hierarchy(): SCH_SHEET_LIST {
    return this.m_hierarchy; // wxCHECK: an empty hierarchy is returned as is
  }

  HasHierarchy(): boolean {
    return this.m_hierarchy.length > 0;
  }

  RefreshHierarchy(): void {
    this.ensureDefaultTopLevelSheet();
    this.m_hierarchy = this.BuildSheetListSortedByPageNumbers();
  }

  ResolveItem(
    aID: KIID,
    aPathOut: SCH_SHEET_PATH | null = null,
    aAllowNullptrReturn = false,
  ): SCH_ITEM | null {
    return this.m_hierarchy.ResolveItem(aID, aPathOut, aAllowNullptrReturn);
  }

  /**
   * The virtual root sheet: the sheet above the top-level sheets, with the nil uuid.
   */
  Root(): SCH_SHEET {
    return this.m_rootSheet!;
  }

  /** Get the list of top-level sheets. */
  GetTopLevelSheets(): SCH_SHEET[] {
    return [...this.m_topLevelSheets];
  }

  GetTopLevelSheet(aIndex = 0): SCH_SHEET | null {
    if (aIndex < 0) return null;

    if (aIndex >= this.m_topLevelSheets.length) return null;

    return this.m_topLevelSheets[aIndex]!;
  }

  /**
   * Set the top-level sheets: every existing child of the virtual root that is not one of
   * them is deleted, and each becomes a child of the virtual root.
   */
  SetTopLevelSheets(aSheets: readonly SCH_SHEET[]): void {
    if (aSheets.length === 0) return; // wxCHECK_RET: "Cannot set empty top-level sheets!"

    const wasAlreadySetting = this.m_settingTopLevelSheets;
    this.m_settingTopLevelSheets = true;

    const validSheets: SCH_SHEET[] = [];

    for (const sheet of aSheets) {
      // Skip null sheets and virtual roots (which have niluuid)
      if (sheet && sheet.m_Uuid !== niluuid) validSheets.push(sheet);
    }

    if (validSheets.length === 0) {
      if (!wasAlreadySetting) this.ensureDefaultTopLevelSheet();

      this.m_settingTopLevelSheets = wasAlreadySetting;
      return;
    }

    this.ensureVirtualRoot();

    const desiredSheets = new Set(validSheets);
    const rootScreen = this.m_rootSheet!.GetScreen();

    if (rootScreen) {
      for (const item of rootScreen.Items()) {
        if (item instanceof SCH_SHEET && !desiredSheets.has(item)) item.Destroy();
      }

      rootScreen.Clear(false);
    }

    this.m_currentSheet.clear();
    this.m_topLevelSheets = [];

    for (const sheet of validSheets) {
      sheet.SetParent(this.m_rootSheet);

      if (rootScreen) rootScreen.Append(sheet);

      this.m_topLevelSheets.push(sheet);
    }

    this.ensureCurrentSheetIsTopLevel();
    this.rebuildHierarchyState(true);

    this.m_settingTopLevelSheets = wasAlreadySetting;
  }

  /** Add a new top-level sheet to the schematic. */
  AddTopLevelSheet(aSheet: SCH_SHEET): void {
    if (!aSheet) return; // wxCHECK_RET: "Cannot add null sheet!"

    if (!aSheet.GetScreen()) return; // wxCHECK_RET: "Cannot add virtual root as top-level sheet!"

    this.ensureVirtualRoot();

    aSheet.SetParent(this.m_rootSheet);

    const rootScreen = this.m_rootSheet!.GetScreen();

    if (rootScreen) rootScreen.Append(aSheet);

    this.m_topLevelSheets.push(aSheet);
    this.ensureCurrentSheetIsTopLevel();
    this.rebuildHierarchyState(true);
  }

  /**
   * Remove a top-level sheet from the schematic (never the last one).
   *
   * @return true if the sheet was removed.
   */
  RemoveTopLevelSheet(aSheet: SCH_SHEET): boolean {
    const i = this.m_topLevelSheets.indexOf(aSheet);

    if (i < 0) return false;

    if (this.m_topLevelSheets.length === 1) return false;

    this.m_topLevelSheets.splice(i, 1);

    if (this.m_rootSheet && this.m_rootSheet.GetScreen())
      this.m_rootSheet.GetScreen()!.Items().remove(aSheet);

    if (!this.m_currentSheet.empty() && this.m_currentSheet.at(0) === aSheet) {
      this.m_currentSheet.clear();

      if (this.m_topLevelSheets.length > 0)
        this.m_currentSheet.push_back(this.m_topLevelSheets[0]!);
    }

    this.rebuildHierarchyState(true);
    return true;
  }

  /** Check if a sheet is a top-level sheet (direct child of virtual root). */
  IsTopLevelSheet(aSheet: SCH_SHEET): boolean {
    return this.m_topLevelSheets.includes(aSheet);
  }

  /** A simple test if the schematic is loaded, not a complete one. */
  IsValid(): boolean {
    return !!this.m_project && this.m_rootSheet !== null;
  }

  /** Helper to retrieve the screen of the root sheet (the first top-level sheet's). */
  RootScreen(): SCH_SCREEN | null {
    if (this.m_topLevelSheets.length > 0 && this.m_topLevelSheets[0])
      return this.m_topLevelSheets[0].GetScreen();

    return null;
  }

  GetContextualTextVars(aVars: string[]): void {
    const add = (aVar: string): void => {
      if (!aVars.includes(aVar)) aVars.push(aVar);
    };

    add('#');
    add('##');
    add('SHEETPATH');
    add('SHEETNAME');
    add('FILENAME');
    add('FILEPATH');
    add('PROJECTNAME');
    add('VARIANT');
    add('VARIANT_DESC');

    if (!this.CurrentSheet().empty()) TITLE_BLOCK.GetContextualTextVars(aVars);

    if (this.m_project) {
      for (const name of this.m_project.GetTextVars().keys()) add(name);
    }
  }

  ResolveTextVar(aSheetPath: SCH_SHEET_PATH | null, token: OutStrE3, _aDepth: number): boolean {
    if (!aSheetPath) return false; // wxCHECK

    if (token.value === '#') {
      token.value = aSheetPath.GetPageNumber();
      return true;
    } else if (token.value === '##') {
      token.value = String(this.Root().CountSheets());
      return true;
    } else if (token.value === 'SHEETPATH') {
      token.value = aSheetPath.PathHumanReadable();
      return true;
    } else if (token.value === 'SHEETNAME') {
      token.value = aSheetPath.Last()!.GetName();
      return true;
    } else if (token.value === 'FILENAME') {
      // wxFileName::GetFullName: the name after the last separator
      token.value = this.GetFileName().replace(/^.*[\\/]/, '');
      return true;
    } else if (token.value === 'FILEPATH') {
      token.value = this.GetFileName();
      return true;
    } else if (token.value === 'PROJECTNAME') {
      token.value = this.m_project?.GetProjectName() ?? '';
      return true;
    } else if (token.value === 'VARIANTNAME' || token.value === 'VARIANT') {
      token.value = this.m_currentVariant;
      return true;
    } else if (token.value === 'VARIANT_DESC') {
      token.value = this.GetVariantDescription(this.m_currentVariant);
      return true;
    }

    // aSheetPath->LastScreen() can be null during schematic loading
    const screen = aSheetPath.LastScreen();

    if (screen && screen.GetTitleBlock().TextVarResolver(token, this.m_project)) return true;

    if (this.m_project?.TextVarResolver(token)) return true;

    return false;
  }

  /**
   * Helper to retrieve the filename from the root sheet screen.
   */
  GetFileName(): string {
    if (!this.IsValid()) return '';

    if (this.m_topLevelSheets.length > 0 && this.m_topLevelSheets[0]!.GetScreen())
      return this.m_topLevelSheets[0]!.GetScreen()!.GetFileName();

    return '';
  }

  CurrentSheet(): SCH_SHEET_PATH {
    return this.m_currentSheet;
  }

  SetCurrentSheet(aPath: SCH_SHEET_PATH): void {
    this.m_currentSheet.assign(aPath);
  }

  GetCurrentScreen(): SCH_SCREEN | null {
    return this.CurrentSheet().LastScreen();
  }

  Settings(): SCHEMATIC_SETTINGS {
    const project = this.m_project?.GetProjectFile() as PROJECT_FILE | null | undefined;

    if (project?.m_SchematicSettings) return project.m_SchematicSettings as SCHEMATIC_SETTINGS;

    if (!this.m_settings) this.m_settings = new SCHEMATIC_SETTINGS();

    return this.m_settings;
  }

  ConnectionGraph(): CONNECTION_GRAPH {
    return this.m_connectionGraph;
  }

  /**
   * Return the set of netname candidates for netclass assignment.  The list will include
   * a netname for each subgraph which is not a bus and has a pin or better driver.
   */
  GetNetClassAssignmentCandidates(): Set<string> {
    const names = new Set<string>();

    for (const [key, subgraphList] of this.m_connectionGraph.GetNetMap()) {
      const firstSubgraph = subgraphList[0]!;

      if (
        !firstSubgraph.GetDriverConnection()!.IsBus() &&
        firstSubgraph.GetOwnDriverPriority() >= CONNECTION_SUBGRAPH.PRIORITY.PIN
      ) {
        names.add(key.Name);
      }
    }

    return names;
  }

  /**
   * `SCHEMATIC::CleanUp` (schematic.cpp:1525): on one screen, drop junctions that are no
   * longer needed and duplicate junctions and no-connects, then repeatedly remove null and
   * identical wires/buses and merge overlapping or colinear touching ones, recording every
   * change in \a aCommit (and through the holder, on the screen and its view).
   */
  CleanUp(aCommit: SCH_COMMIT, aScreen: SCH_SCREEN | null = null): void {
    const lines: SCH_LINE[] = [];
    const junctions: SCH_JUNCTION[] = [];
    const ncs: SCH_NO_CONNECT[] = [];
    const items_to_remove: SCH_ITEM[] = [];
    let changed = true;

    const screen = aScreen ?? this.GetCurrentScreen()!;

    // No SCH_SELECTION_TOOL on the live model yet (GetSelectionTool() is null), so the
    // upstream selection bookkeeping in remove_item and the merge has nothing to update.
    const remove_item = (aItem: SCH_ITEM): void => {
      changed = true;

      if (!(aItem.GetFlags() & STRUCT_DELETED)) {
        aItem.SetFlags(STRUCT_DELETED);

        if (this.m_schematicHolder) this.m_schematicHolder.RemoveFromScreen(aItem, screen);

        aCommit.Removed(aItem, screen);
      }
    };

    for (const item of screen.Items().OfType(KICAD_T_E3.SCH_JUNCTION_T)) {
      if (!screen.IsExplicitJunction(item.GetPosition())) {
        if (item.IsSelected() || item.HasFlag(SELECTED_BY_DRAG)) continue;

        items_to_remove.push(item);
      } else junctions.push(item as unknown as SCH_JUNCTION);
    }

    for (const item of items_to_remove) remove_item(item);

    for (const item of screen.Items().OfType(KICAD_T_E3.SCH_NO_CONNECT_T))
      ncs.push(item as unknown as SCH_NO_CONNECT);

    // alg::for_all_pairs: each unordered pair once, first before second.
    const samePos = (a: SCH_ITEM, b: SCH_ITEM) => {
      const pa = a.GetPosition();
      const pb = b.GetPosition();
      return pa.x === pb.x && pa.y === pb.y;
    };

    for (let i = 0; i < junctions.length; i++)
      for (let j = i + 1; j < junctions.length; j++) {
        const aFirst = junctions[i]!;
        const aSecond = junctions[j]!;

        if (aFirst.GetEditFlags() & STRUCT_DELETED || aSecond.GetEditFlags() & STRUCT_DELETED)
          continue;

        if (samePos(aFirst, aSecond)) remove_item(aSecond);
      }

    for (let i = 0; i < ncs.length; i++)
      for (let j = i + 1; j < ncs.length; j++) {
        const aFirst = ncs[i]!;
        const aSecond = ncs[j]!;

        if (aFirst.GetEditFlags() & STRUCT_DELETED || aSecond.GetEditFlags() & STRUCT_DELETED)
          continue;

        if (samePos(aFirst, aSecond)) remove_item(aSecond);
      }

    const minX = (l: SCH_LINE) => Math.min(l.GetStartPoint().x, l.GetEndPoint().x);
    const maxX = (l: SCH_LINE) => Math.max(l.GetStartPoint().x, l.GetEndPoint().x);
    const minY = (l: SCH_LINE) => Math.min(l.GetStartPoint().y, l.GetEndPoint().y);
    const maxY = (l: SCH_LINE) => Math.max(l.GetStartPoint().y, l.GetEndPoint().y);

    // Would be nice to put lines in a canonical form here by swapping
    //  start <-> end as needed but I don't know what swapping breaks.
    while (changed) {
      changed = false;
      lines.length = 0;

      for (const item of screen.Items().OfType(KICAD_T_E3.SCH_LINE_T)) {
        if (
          item.GetLayer() === SCH_LAYER_ID.LAYER_WIRE ||
          item.GetLayer() === SCH_LAYER_ID.LAYER_BUS
        )
          lines.push(item as unknown as SCH_LINE);
      }

      // Sort by minimum X position. (std::sort is not stable; JS's sort is, so lines with
      // the same left edge keep their screen order - one of the orders upstream allows.)
      lines.sort((a, b) => minX(a) - minX(b));

      outer: for (let it1 = 0; it1 < lines.length; it1++) {
        const firstLine = lines[it1]!;

        if (firstLine.GetEditFlags() & STRUCT_DELETED) continue;

        if (firstLine.IsNull()) {
          remove_item(firstLine);
          continue;
        }

        const firstRightXEdge = maxX(firstLine);

        for (let it2 = it1 + 1; it2 < lines.length; it2++) {
          const secondLine = lines[it2]!;
          const secondLeftXEdge = minX(secondLine);

          // impossible to overlap remaining lines
          if (secondLeftXEdge > firstRightXEdge) break;

          // No Y axis overlap
          if (
            !(
              Math.max(minY(firstLine), minY(secondLine)) <=
              Math.min(maxY(firstLine), maxY(secondLine))
            )
          )
            continue;

          if (secondLine.GetFlags() & STRUCT_DELETED) continue;

          if (
            !secondLine.IsParallel(firstLine) ||
            !secondLine.IsStrokeEquivalent(firstLine) ||
            secondLine.GetLayer() !== firstLine.GetLayer()
          )
            continue;

          // Remove identical lines
          if (
            firstLine.IsEndPoint(secondLine.GetStartPoint()) &&
            firstLine.IsEndPoint(secondLine.GetEndPoint())
          ) {
            remove_item(secondLine);
            continue;
          }

          // See if we can merge an overlap (or two colinear touching segments with
          // no junction where they meet).
          const mergedLine = secondLine.MergeOverlap(screen, firstLine, true);

          if (mergedLine !== null) {
            remove_item(firstLine);
            remove_item(secondLine);

            if (this.m_schematicHolder) this.m_schematicHolder.AddToScreen(mergedLine, screen);

            aCommit.Added(mergedLine, screen);

            continue outer; // upstream's `break` out of the inner loop
          }
        }
      }
    }
  }

  /**
   * `SCHEMATIC::RecalculateConnections`: generate the connection data for the entire
   * schematic hierarchy, after the `CleanUp` the flags ask for. When
   * `ADVANCED_CFG::m_IncrementalConnectivity` is set and the change list is small,
   * upstream recalculates only the damaged part of the graph; here the graph is always
   * rebuilt whole - upstream's GLOBAL_CLEANUP arm, the same answer, more slowly. `aProgressReporter`, `aSchView` and `aLastChangeList` serve the incremental
   * arm and the view, neither of which is here.
   */
  RecalculateConnections(
    aCommit: SCH_COMMIT | null,
    aCleanupFlags: SCH_CLEANUP_FLAGS,
    aToolManager: TOOL_MANAGER | null = null,
    _aProgressReporter: unknown = null,
    _aSchView: unknown = null,
    aChangedItemHandler: ((aItem: SCH_ITEM) => void) | null = null,
  ): void {
    this.RefreshHierarchy();
    const list = this.Hierarchy();

    // SCH_COMMIT localCommit( aToolManager ): a headless caller passes no manager.
    const commit = aCommit ?? new SCH_COMMIT(aToolManager ?? new TOOL_MANAGER());

    // Ensure schematic graph is accurate
    if (aCleanupFlags === SCH_CLEANUP_FLAGS.LOCAL_CLEANUP) {
      this.CleanUp(commit, this.GetCurrentScreen());
    } else if (aCleanupFlags === SCH_CLEANUP_FLAGS.GLOBAL_CLEANUP) {
      for (const sheet of list) this.CleanUp(commit, sheet.LastScreen());
    }

    if (this.Settings().m_IntersheetRefsShow) this.RecomputeIntersheetRefs();

    // Clear all resolved netclass caches in case labels have changed
    this.m_project?.GetProjectFile().NetSettings().ClearAllCaches();

    // Update all rule areas so we can cascade implied connectivity changes
    const all_screens = new Set<SCH_SCREEN>();

    for (const path of list) all_screens.add(path.LastScreen()!);

    SCH_RULE_AREA.UpdateRuleAreasInScreens(all_screens);

    // Recalculate all connectivity
    this.m_connectionGraph.Recalculate(list, true, aChangedItemHandler);
  }

  /** `ErcSettings()`: the project file's `m_ErcSettings`. */
  ErcSettings(): ERC_SETTINGS {
    const project = this.m_project?.GetProjectFile() as PROJECT_FILE | null | undefined;

    if (project?.m_ErcSettings) return project.m_ErcSettings as ERC_SETTINGS;

    if (!this.m_ercSettings) this.m_ercSettings = new ERC_SETTINGS();

    return this.m_ercSettings;
  }

  /**
   * `SCHEMATIC::ResolveERCExclusions` (schematic.cpp:557): match the recorded exclusions
   * against the markers on the screens, and make markers for the ones that no longer have
   * one (returned for the caller to place).
   */
  ResolveERCExclusions(): SCH_MARKER[] {
    const sheetList = this.Hierarchy();
    const settings = this.ErcSettings();

    // Migrate legacy marker exclusions to new format to ensure exclusion matching functions across
    // file versions. Silently drops any legacy exclusions which can not be mapped to the new format
    // without risking an incorrect exclusion - this is preferable to silently dropping
    // new ERC errors / warnings due to an incorrect match between a legacy and new
    // marker serialization format
    const migratedExclusions = new Set<string>();

    for (const it of sortedExclusions(settings)) {
      const testMarker = SCH_MARKER.DeserializeFromString(sheetList, it);

      if (!testMarker) {
        settings.m_ErcExclusions.delete(it);
        continue;
      }

      if (testMarker.IsLegacyMarker()) {
        const settingsKey = testMarker.GetRCItem()!.GetSettingsKey();

        if (
          settingsKey !== 'pin_to_pin' &&
          settingsKey !== 'hier_label_mismatch' &&
          settingsKey !== 'different_unit_net'
        ) {
          migratedExclusions.add(testMarker.SerializeToString());
        }

        settings.m_ErcExclusions.delete(it);
      }
    }

    for (const m of migratedExclusions) settings.m_ErcExclusions.add(m);

    // End of legacy exclusion removal / migrations

    for (const sheet of sheetList) {
      for (const item of sheet.LastScreen()!.Items().OfType(KICAD_T_E3.SCH_MARKER_T)) {
        const marker = item as unknown as SCH_MARKER;
        const serialized = marker.SerializeToString();

        if (settings.m_ErcExclusions.has(serialized)) {
          marker.SetExcluded(true, settings.m_ErcExclusionComments.get(serialized) ?? '');
          settings.m_ErcExclusions.delete(serialized);
        }
      }
    }

    const newMarkers: SCH_MARKER[] = [];

    for (const serialized of sortedExclusions(settings)) {
      const marker = SCH_MARKER.DeserializeFromString(sheetList, serialized);

      if (marker) {
        marker.SetExcluded(true, settings.m_ErcExclusionComments.get(serialized) ?? '');
        newMarkers.push(marker);
      }
    }

    settings.m_ErcExclusions.clear();

    return newMarkers;
  }

  /**
   * `SCHEMATIC::RecordERCExclusions` (schematic.cpp:1349): every excluded marker on the
   * screens, serialized with its comment, into the settings.
   */
  RecordERCExclusions(): void {
    // Use a sorted sheetList to reduce file churn
    const sheetList = this.Hierarchy();
    const ercSettings = this.ErcSettings();

    ercSettings.m_ErcExclusions.clear();
    ercSettings.m_ErcExclusionComments.clear();

    for (const sheet of sheetList) {
      for (const item of sheet.LastScreen()!.Items().OfType(KICAD_T_E3.SCH_MARKER_T)) {
        const marker = item as unknown as SCH_MARKER;

        if (marker.IsExcluded()) {
          const serialized = marker.SerializeToString();
          ercSettings.m_ErcExclusions.add(serialized);
          ercSettings.m_ErcExclusionComments.set(serialized, marker.GetComment());
        }
      }
    }
  }

  /**
   * `SCHEMATIC::ResolveERCExclusionsPostUpdate` (schematic.cpp:1375): place the markers
   * the exclusions still need on the screen of the item they name, then record them so
   * they are retained even before the schematic is saved.
   */
  ResolveERCExclusionsPostUpdate(): void {
    const sheetList = this.Hierarchy();

    for (const marker of this.ResolveERCExclusions()) {
      const errorPath = new SCH_SHEET_PATH();
      sheetList.ResolveItem(marker.GetRCItem()!.GetMainItemID(), errorPath);

      if (errorPath.LastScreen()) errorPath.LastScreen()!.Append(marker);
      else this.RootScreen()!.Append(marker);
    }

    // Once we have the ERC Exclusions, record them in the project file so that
    // they are retained even before the schematic is saved (PCB Editor can also save the project)
    this.RecordERCExclusions();
  }

  override GetEmbeddedFiles(): EMBEDDED_FILES {
    return this as unknown as EMBEDDED_FILES;
  }

  /**
   * Return a pointer to a bus alias object for the given label, or null if one
   * doesn't exist.
   */
  GetBusAlias(aLabel: string): BUS_ALIAS | null {
    for (const alias of this.m_busAliases) {
      if (alias && alias.GetName() === aLabel) return alias;
    }

    return null;
  }

  AddBusAlias(aAlias: BUS_ALIAS | null): void {
    if (!aAlias) return;

    const sameDefinition = (candidate: BUS_ALIAS): boolean =>
      !!candidate &&
      candidate.GetName() === aAlias.GetName() &&
      sameMembers(candidate.Members(), aAlias.Members());

    if (this.m_busAliases.some(sameDefinition)) return;

    this.m_busAliases.push(aAlias);
  }

  SetBusAliases(aAliases: readonly BUS_ALIAS[]): void {
    this.m_busAliases = [];

    for (const alias of aAliases) {
      if (!alias) continue;

      const clone = alias.Clone();

      const sameDefinition = (candidate: BUS_ALIAS): boolean =>
        !!candidate &&
        candidate.GetName() === clone.GetName() &&
        sameMembers(candidate.Members(), clone.Members());

      if (this.m_busAliases.some(sameDefinition)) continue;

      this.m_busAliases.push(clone);
    }
  }

  GetAllBusAliases(): readonly BUS_ALIAS[] {
    return this.m_busAliases;
  }

  /**
   * Resolve text vars that refer to other items.
   * Note that the actual resolve is delegated to the symbol/sheet in question.  This
   * routine just does the look-up and delegation.
   *
   * The refdes fallback (a reference rather than a KIID path) needs SCH_REFERENCE_LIST
   * on the live model: pending, it answers `<Unresolved: ref>` as KiCad does for a
   * reference it cannot find.
   */
  ResolveCrossReference(token: OutStrE3, aDepth: number): boolean {
    const colon = token.value.indexOf(':');
    const ref = colon < 0 ? token.value : token.value.substring(0, colon);
    const remainder = colon < 0 ? '' : token.value.substring(colon + 1);

    const path = new KIID_PATH(ref);
    const uuid = path.at(path.size() - 1);
    let sheetPath = new SCH_SHEET_PATH();
    const refItem = uuid ? this.ResolveItem(uuid, sheetPath, true) : null;

    if (path.size() > 1) {
      path.pop_back();
      sheetPath = this.Hierarchy().GetSheetPathByKIIDPath(path) ?? sheetPath;
    }

    let variantName = '';
    let fieldName = remainder;
    const colonPos = remainder.indexOf(':');

    if (colonPos >= 0) {
      fieldName = remainder.substring(0, colonPos);
      variantName = remainder.substring(colonPos + 1);
    }

    if (refItem && refItem.Type() === KICAD_T_E3.SCH_SYMBOL_T) {
      const refSymbol = refItem as SCH_SYMBOL;
      const field = { value: fieldName };

      if (refSymbol.ResolveTextVar(sheetPath, field, variantName, aDepth + 1)) {
        token.value = field.value;
      } else {
        token.value = `<Unresolved: ${refSymbol.GetRef(sheetPath, false)}:${field.value}>`;
      }

      return true;
    } else if (refItem && refItem.Type() === KICAD_T_E3.SCH_SHEET_T) {
      const refSheet = refItem as SCH_SHEET;

      sheetPath.push_back(refSheet);

      const remainderBefore = remainder;
      const rem = { value: remainder };

      if (refSheet.ResolveTextVar(sheetPath, rem, aDepth + 1)) token.value = rem.value;

      // If the remainder still contains unresolved variables, return false so that
      // ExpandTextVars will recurse and resolve them.
      if (remainderBefore.includes('${') || remainderBefore.includes('@{')) return false;

      return true; // Cross-reference is resolved
    }

    if (!refItem) {
      token.value = `<Unresolved: ${ref}>`;
      return true;
    }

    token.value = `<Unknown reference: ${ref}>`;
    return true;
  }

  GetPageRefsMap(): Map<string, Set<number>> {
    return this.m_labelToPageRefsMap;
  }

  /** `SetSchematicHolder()`. */
  SetSchematicHolder(aHolder: SCHEMATIC_HOLDER | null): void {
    this.m_schematicHolder = aHolder;
  }

  /** `GetSchematicHolder()`. */
  GetSchematicHolder(): SCHEMATIC_HOLDER | null {
    return this.m_schematicHolder;
  }

  /**
   * `SCHEMATIC::RecomputeIntersheetRefs` (schematic.cpp:1196): rebuild the label-to-pages
   * map from every global label in the hierarchy, then show or hide the current sheet's
   * inter-sheet reference fields as the settings say.
   */
  RecomputeIntersheetRefs(): void {
    const pageRefsMap = this.GetPageRefsMap();

    pageRefsMap.clear();

    for (const sheet of this.Hierarchy()) {
      for (const item of sheet.LastScreen()!.Items().OfType(KICAD_T_E3.SCH_GLOBAL_LABEL_T)) {
        const global = item as unknown as SCH_GLOBALLABEL;
        const resolvedLabel = global.GetShownText(sheet, false);

        const pages = pageRefsMap.get(resolvedLabel) ?? new Set<number>();
        pages.add(sheet.GetVirtualPageNumber());
        pageRefsMap.set(resolvedLabel, pages);
      }
    }

    const show = this.Settings().m_IntersheetRefsShow;

    // Refresh all visible global labels.  Note that we have to collect them first as the
    // SCH_SCREEN::Update() call is going to invalidate the RTree iterator.
    const currentSheetGlobalLabels = this.CurrentSheet()
      .LastScreen()!
      .Items()
      .OfType(KICAD_T_E3.SCH_GLOBAL_LABEL_T)
      .map((item) => item as unknown as SCH_GLOBALLABEL);

    for (const globalLabel of currentSheetGlobalLabels) {
      const fields = globalLabel.GetFields();

      fields[0]?.SetVisible(show);

      if (show) {
        const pos = fields[0]?.GetTextPos();
        const at = globalLabel.GetPosition();

        if (fields.length === 1 && pos && pos.x === at.x && pos.y === at.y)
          globalLabel.AutoplaceFields(
            this.CurrentSheet().LastScreen(),
            AUTOPLACE_ALGO.AUTOPLACE_AUTO,
          );

        this.CurrentSheet().LastScreen()!.Update(globalLabel);

        for (const field of globalLabel.GetFields()) field.ClearBoundingBoxCache();

        globalLabel.ClearBoundingBoxCache();

        this.m_schematicHolder?.IntersheetRefUpdate?.(globalLabel);
      }
    }
  }

  /** The virtual page number of each sheet, to its name. */
  GetVirtualPageToSheetNamesMap(): Map<number, string> {
    const namesMap = new Map<number, string>();

    for (const sheet of this.Hierarchy()) {
      if (sheet.size() === 1) namesMap.set(sheet.GetVirtualPageNumber(), '<root sheet>');
      else namesMap.set(sheet.GetVirtualPageNumber(), sheet.Last()!.GetName());
    }

    return namesMap;
  }

  /** The virtual page number of each sheet, to its page number. */
  GetVirtualPageToSheetPagesMap(): Map<number, string> {
    const pagesMap = new Map<number, string>();

    for (const sheet of this.Hierarchy())
      pagesMap.set(sheet.GetVirtualPageNumber(), sheet.GetPageNumber());

    return pagesMap;
  }

  /**
   * Convert cross-references back and forth between ${refDes:field} and ${kiid:field}:
   * the KIID -> reference direction.
   */
  ConvertKIIDsToRefs(aSource: string): string {
    let newbuf = '';
    const sourceLen = aSource.length;

    for (let i = 0; i < sourceLen; ++i) {
      // Check for escaped expressions: \${ or \@{
      // These should be copied verbatim without any ref→KIID conversion
      if (
        aSource[i] === '\\' &&
        i + 2 < sourceLen &&
        aSource[i + 2] === '{' &&
        (aSource[i + 1] === '$' || aSource[i + 1] === '@')
      ) {
        newbuf += aSource[i]! + aSource[i + 1]! + aSource[i + 2]!;
        i += 2;

        // Copy everything until the matching closing brace
        let braceDepth = 1;

        for (i = i + 1; i < sourceLen && braceDepth > 0; ++i) {
          if (aSource[i] === '{') braceDepth++;
          else if (aSource[i] === '}') braceDepth--;

          newbuf += aSource[i];
        }

        i--; // Back up one since the for loop will increment
        continue;
      }

      if (aSource[i] === '$' && i + 1 < sourceLen && aSource[i + 1] === '{') {
        let token = '';
        let isCrossRef = false;

        for (i = i + 2; i < sourceLen; ++i) {
          if (aSource[i] === '}') break;

          if (aSource[i] === ':') isCrossRef = true;

          token += aSource[i];
        }

        if (isCrossRef) {
          const colon = token.indexOf(':');
          const ref = token.substring(0, colon);
          const remainder = token.substring(colon + 1);
          const path = new KIID_PATH(ref);
          const uuid = path.at(path.size() - 1);
          let sheetPath = new SCH_SHEET_PATH();
          const refItem = uuid ? this.ResolveItem(uuid, sheetPath, true) : null;

          if (path.size() > 1) {
            path.pop_back();
            sheetPath = this.Hierarchy().GetSheetPathByKIIDPath(path) ?? sheetPath;
          }

          if (refItem && refItem.Type() === KICAD_T_E3.SCH_SYMBOL_T) {
            const refSymbol = refItem as SCH_SYMBOL;
            token = `${refSymbol.GetRef(sheetPath, true)}:${remainder}`;
          }
        }

        newbuf += `\${${token}}`;
      } else {
        newbuf += aSource[i];
      }
    }

    return newbuf;
  }

  /**
   * Update the symbol references for the legacy (version 4 and earlier) schematic file
   * formats.
   */
  SetLegacySymbolInstanceData(): void {
    const screens = new SCH_SCREENS(this.m_rootSheet);

    screens.SetLegacySymbolInstanceData();
  }

  /**
   * @return a filename that can be used in plot and print functions for the current
   *         screen and sheet path.
   */
  GetUniqueFilenameForCurrentSheet(): string {
    // Skip the virtual root sheet if present
    let startIdx = 0;
    const current = this.CurrentSheet();

    if (current.size() > 0 && current.at(0)!.IsVirtualRootSheet()) startIdx = 1;

    // Handle the case where we only have a virtual root
    if (startIdx >= current.size()) return '';

    // wxFileName::GetName: the name without directories or extension
    let filename = current
      .at(startIdx)!
      .GetFileName()
      .replace(/^.*[\\/]/, '')
      .replace(/\.[^.]*$/, '');

    for (let i = startIdx + 1; i < current.size(); i++) filename += `-${current.at(i)!.GetName()}`;

    return filename;
  }

  /**
   * Set the m_ScreenNumber and m_NumberOfScreens members for screens.
   *
   * @note This must be called after deleting or adding a sheet and when entering a sheet.
   */
  SetSheetNumberAndCount(): void {
    const s_list = new SCH_SCREENS(this.Root());
    let sheet_count: number;

    // Handle virtual root case
    if (this.Root().m_Uuid === niluuid) {
      // Virtual root: count sheets from top-level sheets
      sheet_count = 0;

      for (const topSheet of this.m_topLevelSheets) {
        if (topSheet) sheet_count += topSheet.CountSheets();
      }
    } else {
      // Traditional single root
      sheet_count = this.Root().CountSheets();
    }

    let sheet_number = 1;

    if (this.m_hierarchy.length === 0) {
      for (let screen = s_list.GetFirst(); screen !== null; screen = s_list.GetNext())
        screen.SetPageCount(sheet_count);

      this.CurrentSheet().SetVirtualPageNumber(sheet_number);

      const screen = this.CurrentSheet().LastScreen();

      if (screen) screen.SetVirtualPageNumber(sheet_number);

      return;
    }

    const current_sheetpath = this.CurrentSheet().Path();

    // @todo Remove all pseudo page number system is left over from prior to real page
    //       number implementation.
    for (const sheet of this.Hierarchy()) {
      if (sheet.Path().equals(current_sheetpath)) break; // Current sheet path found

      sheet_number++; // Not found, increment before this current path
    }

    for (let screen = s_list.GetFirst(); screen !== null; screen = s_list.GetNext())
      screen.SetPageCount(sheet_count);

    this.CurrentSheet().SetVirtualPageNumber(sheet_number);
    this.CurrentSheet().LastScreen()!.SetVirtualPageNumber(sheet_number);
    this.CurrentSheet().LastScreen()!.SetPageNumber(this.CurrentSheet().GetPageNumber());
  }

  ClearOperatingPoints(): void {
    this.m_operatingPoints.clear();
  }

  SetOperatingPoint(aSignal: string, aValue: number): void {
    this.m_operatingPoints.set(aSignal, aValue);
  }

  /**
   * The operating point of a net, formatted.  SPICE_VALUE formatting and the SPICE
   * markup conversion of the net name are pending: a stored value is printed plainly.
   */
  GetOperatingPoint(aNetName: string, _aPrecision: number, _aRange: string): string {
    const spiceNetName = aNetName.toLowerCase();

    if (spiceNetName === 'gnd' || spiceNetName === '0') return '';

    const it = this.m_operatingPoints.get(spiceNetName);

    if (it !== undefined) return String(it);
    else if (this.m_operatingPoints.size === 0) return '--';
    else return '?';
  }

  OnItemsAdded(aNewItems: SCH_ITEM[]): void {
    for (const l of this.m_listeners) l.OnSchItemsAdded?.(this, aNewItems);
  }

  OnItemsRemoved(aRemovedItems: SCH_ITEM[]): void {
    for (const l of this.m_listeners) l.OnSchItemsRemoved?.(this, aRemovedItems);
  }

  OnItemsChanged(aItems: SCH_ITEM[]): void {
    for (const l of this.m_listeners) l.OnSchItemsChanged?.(this, aItems);
  }

  OnSchSheetChanged(): void {
    for (const l of this.m_listeners) l.OnSchSheetChanged?.(this);
  }

  AddListener(aListener: SCHEMATIC_LISTENER): void {
    if (!this.m_listeners.includes(aListener)) this.m_listeners.push(aListener);
  }

  RemoveListener(aListener: SCHEMATIC_LISTENER): void {
    const i = this.m_listeners.indexOf(aListener);

    if (i >= 0) {
      // swap with the last and pop, as upstream does
      this.m_listeners[i] = this.m_listeners[this.m_listeners.length - 1]!;
      this.m_listeners.pop();
    }
  }

  RemoveAllListeners(): void {
    this.m_listeners = [];
  }

  /** Run \a aFunction over every library symbol's embedded files. */
  RunOnNestedEmbeddedFiles(aFunction: (aFiles: EMBEDDED_FILES) => void): void {
    const screens = new SCH_SCREENS(this.Root());

    for (let screen = screens.GetFirst(); screen; screen = screens.GetNext()) {
      for (const libSym of screen.GetLibSymbols().values()) aFunction(libSym.GetEmbeddedFiles());
    }
  }

  /**
   * Return a set of schematic files that are shared by multiple projects: a screen whose
   * symbols have instances outside this hierarchy.
   */
  GetSchematicsSharedByMultipleProjects(): Set<SCH_SCREEN> {
    const retv = new Set<SCH_SCREEN>();

    if (!this.m_rootSheet) return retv; // wxCHECK

    const hierarchy = SCH_SHEET_LIST.build(this.m_rootSheet);
    const screens = new SCH_SCREENS(this.m_rootSheet);

    for (let screen = screens.GetFirst(); screen; screen = screens.GetNext()) {
      for (const item of screen.Items().OfType(KICAD_T_E3.SCH_SYMBOL_T)) {
        const symbol = item as SCH_SYMBOL;

        for (const instance of symbol.GetInstances()) {
          if (!hierarchy.HasPath(instance.m_Path)) {
            retv.add(screen);
            break;
          }
        }

        if (retv.has(screen)) break;
      }
    }

    return retv;
  }

  /**
   * Test if the schematic is a complex hierarchy: a screen used by more than one sheet.
   */
  IsComplexHierarchy(): boolean {
    if (!this.m_rootSheet) return false; // wxCHECK

    const screens = new SCH_SCREENS(this.m_rootSheet);

    for (let screen = screens.GetFirst(); screen; screen = screens.GetNext()) {
      if (screen.GetRefCount() > 1) return true;
    }

    return false;
  }

  /**
   * Create a blank schematic: the virtual root and one top-level sheet on page 1 with an
   * `untitled.kicad_sch` screen.
   */
  CreateDefaultScreens(): void {
    // Reset to clean state
    this.Reset();

    // Create the virtual root and a default top-level sheet
    this.ensureVirtualRoot();

    const rootSheet = new SCH_SHEET(this);
    const rootScreen = new SCH_SCREEN(this);

    (rootSheet as { m_Uuid: KIID }).m_Uuid = rootScreen.GetUuid();
    rootSheet.SetScreen(rootScreen);
    rootScreen.SetFileName('untitled.kicad_sch'); // Set default filename to avoid conflicts
    rootScreen.SetPageNumber('1');

    // Set the sheet page number (the root sheet path has the virtual root first)
    const rootSheetPath = new SCH_SHEET_PATH();
    rootSheetPath.push_back(this.m_rootSheet!);
    rootSheetPath.push_back(rootSheet);
    rootSheetPath.SetPageNumber('1');

    this.SetTopLevelSheets([rootSheet]);
  }

  /** The variant names for a chooser: the default first, then the rest sorted. */
  GetVariantNamesForUI(): string[] {
    const names = [...this.m_variantNames];

    // SortVariantNames: the default variant sorts first, the rest by name
    names.sort(cpCmpE3);
    return [DEFAULT_VARIANT_NAME, ...names];
  }

  /**
   * Return the current variant being edited, empty for the default.
   */
  GetCurrentVariant(): string {
    if (this.m_currentVariant === '' || this.m_currentVariant === DEFAULT_VARIANT_NAME) return '';

    return this.m_currentVariant;
  }

  SetCurrentVariant(aVariantName: string): void {
    let newVariant = '';

    // Internally an empty string is the default variant.  Set to default if the variant
    // name doesn't exist.
    if (aVariantName !== DEFAULT_VARIANT_NAME && this.m_variantNames.has(aVariantName))
      newVariant = aVariantName;

    if (this.m_currentVariant === newVariant) return;

    this.m_currentVariant = newVariant;

    // Variant-dependent text caches are cleared on every item.
    if (this.m_rootSheet) {
      const allScreens = new SCH_SCREENS(this.m_rootSheet);

      for (let screen = allScreens.GetFirst(); screen; screen = allScreens.GetNext()) {
        for (const item of screen.Items()) item.ClearCaches();
      }
    }

    for (const l of this.m_listeners) l.OnSchCurrentVariantChanged?.(this);
  }

  /** `DeleteVariant`: an SCH_COMMIT is pending; the edit is made directly. */
  DeleteVariant(aVariantName: string): void {
    if (!this.m_rootSheet) return; // wxCHECK

    const allScreens = new SCH_SCREENS(this.m_rootSheet);

    allScreens.DeleteVariant(aVariantName);

    this.m_variantNames.delete(aVariantName);
    this.Settings().m_VariantDescriptions.delete(aVariantName);
  }

  AddVariant(aVariantName: string): void {
    this.m_variantNames.add(aVariantName);

    // Ensure the variant is saved to the project file
    const descriptions = this.Settings().m_VariantDescriptions;

    if (!descriptions.has(aVariantName)) descriptions.set(aVariantName, '');
  }

  /** `RenameVariant`: an SCH_COMMIT is pending; the edit is made directly. */
  RenameVariant(aOldName: string, aNewName: string): void {
    if (!this.m_rootSheet) return; // wxCHECK

    if (aOldName === '' || aNewName === '') return; // wxCHECK

    if (!this.m_variantNames.has(aOldName)) return; // wxCHECK

    this.m_variantNames.delete(aOldName);
    this.m_variantNames.add(aNewName);

    const descriptions = this.Settings().m_VariantDescriptions;

    if (descriptions.has(aOldName)) {
      descriptions.set(aNewName, descriptions.get(aOldName)!);
      descriptions.delete(aOldName);
    }

    if (this.m_currentVariant === aOldName) this.m_currentVariant = aNewName;

    const allScreens = new SCH_SCREENS(this.m_rootSheet);
    allScreens.RenameVariant(aOldName, aNewName);
  }

  /** `CopyVariant`: an SCH_COMMIT is pending; the edit is made directly. */
  CopyVariant(aSourceVariant: string, aNewVariant: string): void {
    if (!this.m_rootSheet) return; // wxCHECK

    if (aSourceVariant === '' || aNewVariant === '') return; // wxCHECK

    if (!this.m_variantNames.has(aSourceVariant)) return; // wxCHECK

    if (this.m_variantNames.has(aNewVariant)) return; // wxCHECK

    this.AddVariant(aNewVariant);

    const descriptions = this.Settings().m_VariantDescriptions;

    if (descriptions.has(aSourceVariant))
      descriptions.set(aNewVariant, descriptions.get(aSourceVariant)!);

    const allScreens = new SCH_SCREENS(this.m_rootSheet);
    allScreens.CopyVariant(aSourceVariant, aNewVariant);
  }

  /** The variant names, in code-point order (a std::set<wxString>). */
  GetVariantNames(): string[] {
    return [...this.m_variantNames].sort(cpCmpE3);
  }

  GetVariantDescription(aVariantName: string): string {
    return this.Settings().m_VariantDescriptions.get(aVariantName) ?? '';
  }

  SetVariantDescription(aVariantName: string, aDescription: string): void {
    const descriptions = this.Settings().m_VariantDescriptions;

    if (aDescription === '') descriptions.delete(aVariantName);
    else descriptions.set(aVariantName, aDescription);
  }

  /** Collect the variant names used in the schematic and the project's descriptions. */
  LoadVariants(): void {
    if (this.m_rootSheet && this.m_rootSheet.GetScreen()) {
      const screens = new SCH_SCREENS(this.m_rootSheet);
      const variantNames = screens.GetVariantNames();

      for (const name of variantNames) this.m_variantNames.add(name);

      // Also include variants from the project file that may not have any
      // diffs in the schematic.
      const descriptions = this.Settings().m_VariantDescriptions;

      for (const name of variantNames) {
        if (!descriptions.has(name)) descriptions.set(name, '');
      }

      for (const name of descriptions.keys()) this.m_variantNames.add(name);
    }
  }

  /**
   * Ensure the virtual root sheet exists, with a screen: an older root (a real sheet)
   * becomes its only top-level child.
   */
  private ensureVirtualRoot(): void {
    if (this.m_rootSheet && this.m_rootSheet.m_Uuid === niluuid) {
      if (!this.m_rootSheet.GetScreen()) this.m_rootSheet.SetScreen(new SCH_SCREEN(this));

      return;
    }

    const previousRoot = this.m_rootSheet;

    this.m_rootSheet = new SCH_SHEET(this);
    (this.m_rootSheet as { m_Uuid: KIID }).m_Uuid = niluuid;
    this.m_rootSheet.SetScreen(new SCH_SCREEN(this));

    if (previousRoot) {
      previousRoot.SetParent(this.m_rootSheet);

      if (this.m_rootSheet.GetScreen()) this.m_rootSheet.GetScreen()!.Append(previousRoot);

      this.m_topLevelSheets = [previousRoot];
    }
  }

  private ensureDefaultTopLevelSheet(): void {
    if (this.m_settingTopLevelSheets) return;

    this.ensureVirtualRoot();

    if (this.m_topLevelSheets.length > 0) return;

    const rootSheet = new SCH_SHEET(this);
    const rootScreen = new SCH_SCREEN(this);

    (rootSheet as { m_Uuid: KIID }).m_Uuid = rootScreen.GetUuid();
    rootSheet.SetScreen(rootScreen);

    this.SetTopLevelSheets([rootSheet]);

    const rootSheetPath = new SCH_SHEET_PATH();
    rootSheetPath.push_back(this.m_rootSheet!);
    rootSheetPath.push_back(rootSheet);
    rootSheetPath.SetPageNumber('1');
  }

  private ensureCurrentSheetIsTopLevel(): void {
    if (this.m_topLevelSheets.length === 0) return;

    if (this.m_currentSheet.empty() || !this.IsTopLevelSheet(this.m_currentSheet.at(0)!)) {
      this.m_currentSheet.clear();
      this.m_currentSheet.push_back(this.m_topLevelSheets[0]!);
    }
  }

  private rebuildHierarchyState(aResetConnectionGraph: boolean): void {
    this.RefreshHierarchy();

    if (aResetConnectionGraph && this.m_project) this.m_connectionGraph.Reset();

    this.m_variantNames.clear();

    if (this.m_rootSheet && this.m_rootSheet.GetScreen()) {
      const screens = new SCH_SCREENS(this.m_rootSheet);

      for (const name of screens.GetVariantNames()) this.m_variantNames.add(name);
    }

    if (this.m_project) {
      for (const name of this.Settings().m_VariantDescriptions.keys())
        this.m_variantNames.add(name);
    }
  }
}

applyMixins(SCHEMATIC, [EMBEDDED_FILES]);

/** `std::vector<wxString> == std::vector<wxString>`. */
function sameMembers(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((m, i) => m === b[i]);
}
