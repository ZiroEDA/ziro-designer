// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/sch_screen.h` / `sch_screen.cpp`: `SCH_SCREEN`, one schematic file's items,
 * library symbol cache, page and title block; and `SCH_SCREENS`, the unique screens of a
 * hierarchy (eeschema stage E3).
 *
 * Pending, marked in place: Plot (the plotters), MigrateSimModels (SIM_MODEL), the font half of FixupEmbeddedData
 * (EDA_TEXT::ResolveFont), InProjectPath
 * (wxFileName on a disk), Show (debug), and SCH_SCREENS' marker deletion (SCH_MARKER,
 * RC_ITEM) and connection-graph recalculation.
 */

import type { SCH_COMMIT } from './sch_commit.js';
import { BASE_SCREEN } from '@ziroeda/common/base_screen.js';
import { IO_ERROR } from '@ziroeda/common/exceptions.js';
import {
  RPT_SEVERITY_ERROR,
  RPT_SEVERITY_INFO,
  RPT_SEVERITY_WARNING,
  type Reporter,
} from '@ziroeda/common/reporter.js';
import { SymbolLibAdapter } from './project_sch.js';
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import { RECURSE_MODE } from '@ziroeda/common/eda_item.js';
import {
  CANDIDATE,
  IS_DELETED,
  IS_MOVING,
  STRUCT_DELETED,
} from '@ziroeda/common/eda_item_flags.js';
import { SHAPE_T } from '@ziroeda/common/eda_shape.js';
import type { SCH_SHAPE } from './sch_shape.js';
import { schIUScale } from '@ziroeda/common/eda_units.js';
import { type KIID_PATH, newKiid, type KIID } from '@ziroeda/common/kiid.js';
import { SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import type { LIB_ID } from '@ziroeda/common/lib_id.js';
import { PAGE_INFO, PAGE_SIZE_TYPE } from '@ziroeda/common/page_info.js';
import { FIELD_T } from '@ziroeda/common/template_fieldnames.js';
import { unescapeString } from '@ziroeda/common/string_utils.js';
import { TITLE_BLOCK } from '@ziroeda/common/title_block.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { IsPointOnSegment } from '@ziroeda/kimath/src/trigo.js';
import { AnalyzePoint } from './junction_helpers.js';
import { LIB_SYMBOL } from './lib_symbol.js';
import { DANGLING_END_ITEM_HELPER, type DANGLING_END_ITEM, type SCH_ITEM } from './sch_item.js';
import type { SCH_MARKER } from './sch_marker.js';
import type { BUS_ALIAS } from './bus_alias.js';
import { type SCH_LABEL_BASE, SPIN_STYLE } from './sch_label.js';
import type { SCH_BUS_WIRE_ENTRY } from './sch_bus_entry.js';
import { GetPinSpinStyle } from './symb_transforms_utils.js';
import type { SCH_LINE } from './sch_line.js';
import type { SCH_PIN } from './sch_pin.js';
import { EE_RTREE } from './sch_rtree.js';
import type { SCH_SHEET } from './sch_sheet.js';
import type { SCH_SHEET_PIN } from './sch_sheet_pin.js';
import type {
  SCH_SHEET_INSTANCE,
  SCH_SHEET_LIST,
  SCH_SHEET_PATH,
  SCH_SYMBOL_INSTANCE,
} from './sch_sheet_path.js';
import type { SCH_SYMBOL } from './sch_symbol.js';
import type { SCHEMATIC } from './schematic.js';

export { EE_RTREE, type EE_RTREE_LIKE } from './sch_rtree.js';

/** Search types for SCH_SCREEN::GetLine. */
export enum SCH_LINE_TEST_T {
  ENTIRE_LENGTH_T,
  END_POINTS_ONLY_T,
  EXCLUDE_END_POINTS_T,
}

/** `PICKED_SYMBOL`: a symbol the chooser returned, with the fields it changed. */
export interface PICKED_SYMBOL {
  LibId: LIB_ID;
  Unit: number;
  Convert: number;
  KeepSymbol?: boolean;
  PlaceAllUnits?: boolean;
  Fields: readonly (readonly [FIELD_T, string])[];
}

export class SCH_SCREEN extends BASE_SCREEN {
  m_LastZoomLevel: number;

  private m_fileName: string; // File used to load the screen.
  private m_fileFormatVersionAtLoad: number;
  private m_refCount: number; // Number of sheets referencing this screen.
  // Delete when it goes to zero.

  /**
   * The list of sheet paths sharing this screen.  Used in some annotation calculations to
   * update alternate references.
   *
   * Note: a screen having a m_refCount = 1 (only one sheet path using it) can have many
   * sheet paths sharing this screen if it is shared by more than one sheet.
   */
  private m_clientSheetPathList: SCH_SHEET_PATH[];

  private m_paper: PAGE_INFO; // The size of the paper to print or plot on.
  private m_titles: TITLE_BLOCK;
  private m_aux_origin: VECTOR2I; // Origin used for drill & place files by Pcbnew.
  private m_rtree: EE_RTREE;

  private m_modification_sync: number; // Inequality with SYMBOL_LIBS::GetModificationHash()
  // allows resynchronization.
  m_zoomInitialized: boolean; // Set to true once the zoom value is initialized with
  // `InitZoom()`.

  private m_isReadOnly: boolean; ///< Read only status of the screen file.

  /// Flag to indicate the file associated with this screen has been created.
  private m_fileExists: boolean;

  /// Library symbols required for this schematic.
  private m_libSymbols: Map<string, LIB_SYMBOL>;

  /**
   * The list of symbol instances loaded from the schematic file.
   *
   * This list is only used to as temporary storage when the schematic file is loaded.
   * If the screen is the root sheet, then this information is used to update the
   * #SCH_SYMBOL instance reference and unit information after the entire schematic
   * is loaded and is never used again.  If this screen is not the root sheet, then the
   * schematic file is the root sheet of another project and this information is saved
   * unchanged back to the schematic file.
   *
   * @warning Under no circumstances is this information to be modified or used after the
   *          schematic file is loaded.  It is read only and it is only written to non-root
   *          schematic files.
   */
  m_symbolInstances: SCH_SYMBOL_INSTANCE[];
  m_sheetInstances: SCH_SHEET_INSTANCE[];

  /**
   * A unique identifier for each schematic file.
   *
   * As of right now, this only has meaning for the root schematic.  In the future, it may
   * be useful to have unique file identifiers for each schematic file.
   */
  m_uuid: KIID;

  constructor(aParent: EDA_ITEM | null = null) {
    super(aParent, KICAD_T.SCH_SCREEN_T);
    this.m_fileName = '';
    this.m_fileFormatVersionAtLoad = 0;
    this.m_paper = new PAGE_INFO(PAGE_SIZE_TYPE.A4);
    this.m_titles = new TITLE_BLOCK();
    this.m_aux_origin = { x: 0, y: 0 };
    this.m_rtree = new EE_RTREE();
    this.m_isReadOnly = false;
    this.m_fileExists = false;
    this.m_clientSheetPathList = [];
    this.m_libSymbols = new Map();
    this.m_symbolInstances = [];
    this.m_sheetInstances = [];
    this.m_uuid = newKiid();

    this.m_modification_sync = 0;
    this.m_refCount = 0;
    this.m_zoomInitialized = false;
    this.m_LastZoomLevel = 1.0;

    // Suitable for schematic only. For symbol_editor and viewlib, must be set to true
    this.m_Center = false;

    const size = this.m_paper.GetSizeIU(schIUScale.IU_PER_MILS);
    this.InitDataPoints({ x: size.x, y: size.y });
  }

  /** `~SCH_SCREEN()`. */
  Destroy(): void {
    this.clearLibSymbols();
    this.FreeDrawList();
  }

  Schematic(): SCHEMATIC | null {
    const parent = this.GetParent();

    if (!parent || parent.Type() !== KICAD_T.SCHEMATIC_T) return null; // wxCHECK_MSG

    return parent as unknown as SCHEMATIC;
  }

  /**
   * Get the full RTree, usually for iterating.
   *
   * N.B. The iteration order of the RTree is not readily apparent and will change
   * if/when you add or move items and the RTree is re-balanced.  Any exporter
   * writing a user-visible file needs to sort the items for repeatable behavior.
   */
  Items(): EE_RTREE {
    return this.m_rtree;
  }

  IsEmpty(): boolean {
    return this.m_rtree.empty();
  }

  HasItems(aItemType: KICAD_T): boolean {
    return this.m_rtree.OfType(aItemType).length > 0;
  }

  HasSheets(): boolean {
    return this.HasItems(KICAD_T.SCH_SHEET_T);
  }

  static ClassOf(aItem: EDA_ITEM | null): boolean {
    return !!aItem && KICAD_T.SCH_SCREEN_T === aItem.Type();
  }

  override GetClass(): string {
    return 'SCH_SCREEN';
  }

  SetFileFormatVersionAtLoad(aVersion: number): void {
    this.m_fileFormatVersionAtLoad = aVersion;
  }

  GetFileFormatVersionAtLoad(): number {
    return this.m_fileFormatVersionAtLoad;
  }

  GetPageSettings(): PAGE_INFO {
    return this.m_paper;
  }

  SetPageSettings(aPageSettings: PAGE_INFO): void {
    this.m_paper = aPageSettings;
  }

  /**
   * Set the file name for this screen to \a aFileName.
   *
   * @param[in] aFileName is the absolute file name and path of the screen.
   */
  SetFileName(aFileName: string): void {
    this.m_fileName = aFileName;
  }

  GetFileName(): string {
    return this.m_fileName;
  }

  SetFileReadOnly(aIsReadOnly: boolean): void {
    this.m_isReadOnly = aIsReadOnly;
  }

  IsReadOnly(): boolean {
    return this.m_isReadOnly;
  }

  SetFileExists(aFileExists: boolean): void {
    this.m_fileExists = aFileExists;
  }

  FileExists(): boolean {
    return this.m_fileExists;
  }

  GetAuxOrigin(): VECTOR2I {
    return this.m_aux_origin;
  }

  SetAuxOrigin(aPosition: VECTOR2I): void {
    this.m_aux_origin = { ...aPosition };
  }

  GetTitleBlock(): TITLE_BLOCK {
    return this.m_titles;
  }

  SetTitleBlock(aTitleBlock: TITLE_BLOCK): void {
    this.m_titles = aTitleBlock;
  }

  DecRefCount(): void {
    if (this.m_refCount === 0) return; // wxCHECK_RET: "Screen reference count already zero."

    this.m_refCount--;
  }

  IncRefCount(): void {
    this.m_refCount++;
  }

  GetRefCount(): number {
    return this.m_refCount;
  }

  SetConnectivityDirty(): void {
    for (const item of this.Items()) item.SetConnectivityDirty(true);
  }

  /**
   * Return the number of times this screen is used.
   *
   * In the legacy file formats: if this screen is used only once (not a complex
   * hierarchy) the reference field can be used to store the component reference.  If
   * this screen is used more than once (a complex hierarchy), then symbols must have a
   * full alternate (hierarchical) reference.
   */
  GetClientSheetPaths(): SCH_SHEET_PATH[] {
    return this.m_clientSheetPathList;
  }

  /**
   * `Append( SCH_ITEM* aItem, bool aUpdateLibSymbol )` adds an item (and caches its
   * library symbol, renaming a clash to `name_N`); `Append( SCH_SCREEN* aScreen )` moves
   * another screen's items here.
   */
  Append(aItem: SCH_ITEM | SCH_SCREEN, aUpdateLibSymbol = true): void {
    if (aItem instanceof SCH_SCREEN) {
      for (const item of aItem.m_rtree) this.Append(item);

      aItem.Clear(false);
      return;
    }

    if (aItem.Type() !== KICAD_T.SCH_SHEET_PIN_T && aItem.Type() !== KICAD_T.SCH_FIELD_T) {
      // Ensure the item can reach the SCHEMATIC through this screen
      aItem.SetParent(this);

      if (aItem.Type() === KICAD_T.SCH_SYMBOL_T && aUpdateLibSymbol) {
        const symbol = aItem as SCH_SYMBOL;
        const libSymbolRef = symbol.GetLibSymbolRef();

        if (libSymbolRef) {
          sortDrawItems(libSymbolRef);

          const found = this.m_libSymbols.get(symbol.GetSchSymbolLibraryName());

          if (!found) {
            this.m_libSymbols.set(
              symbol.GetSchSymbolLibraryName(),
              LIB_SYMBOL.copyOf(libSymbolRef),
            );
          } else {
            // The original library symbol may have changed since the last time it was
            // added to the schematic.  If it has changed, then a new name must be created
            // for the library symbol list to prevent all of the other schematic symbols
            // referencing that library symbol from changing.
            let foundSymbol: LIB_SYMBOL | null = found;

            sortDrawItems(foundSymbol);

            if (!foundSymbol.equals(libSymbolRef)) {
              let newName = '';
              const matches: string[] = [];

              this.getLibSymbolNameMatches(symbol, matches);
              foundSymbol = null;

              for (const libSymbolName of matches) {
                const it = this.m_libSymbols.get(libSymbolName);

                if (!it) continue;

                foundSymbol = it;

                const tmp = libSymbolRef.GetName();

                // Temporarily update the new symbol library symbol name so it
                // doesn't fail on the name comparison below.
                libSymbolRef.SetName(foundSymbol.GetName());

                if (foundSymbol.equals(libSymbolRef)) {
                  newName = libSymbolName;
                  libSymbolRef.SetName(tmp);
                  break;
                }

                libSymbolRef.SetName(tmp);
                foundSymbol = null;
              }

              if (!foundSymbol) {
                let cnt = 1;

                newName = `${symbol.GetLibId().GetUniStringLibItemName()}_${cnt}`;

                while (this.m_libSymbols.has(newName)) {
                  cnt += 1;
                  newName = `${symbol.GetLibId().GetUniStringLibItemName()}_${cnt}`;
                }
              }

              // Update the schematic symbol library link as this symbol does not exist
              // in any symbol library.
              symbol.SetSchSymbolLibraryName(newName);

              if (!foundSymbol) {
                const newLibSymbol = LIB_SYMBOL.copyOf(libSymbolRef);
                const newLibId = newLibSymbol.GetLibId().clone();

                newLibId.SetLibNickname('');
                newLibId.SetLibItemName(newName);
                newLibSymbol.SetLibId(newLibId);
                newLibSymbol.SetName(newName);
                symbol.SetLibSymbol(newLibSymbol.Flatten());
                this.m_libSymbols.set(newName, newLibSymbol);
              }
            } else {
              foundSymbol.GetEmbeddedFiles().assignEmbeddedFiles(libSymbolRef.GetEmbeddedFiles());
            }
          }
        }
      }

      this.m_rtree.insert(aItem);
      --this.m_modification_sync;
    }
  }

  /**
   * Delete all draw items and clears the project settings for this screen.
   *
   * If the screen is shared by more than one sheet, the items are only released when the
   * last sheet using the screen deletes it.
   *
   * @param aFree true deletes the items, false only removes them from the list.
   */
  Clear(aFree = true): void {
    if (aFree) {
      this.FreeDrawList();
      this.clearLibSymbols();
    } else {
      this.m_rtree.clear();
    }

    // Clear the project settings
    this.m_virtualPageNumber = this.m_pageCount = 1;

    this.m_titles.Clear();
  }

  /** Free all the items from the schematic associated with the screen. */
  FreeDrawList(): void {
    // We don't know which order we will encounter dependent items (e.g. pins or fields),
    // so we store the items to be deleted until we've fully cleared the tree before
    // deleting.
    const delete_list = [...this.m_rtree].filter(
      (aItem) => aItem.Type() !== KICAD_T.SCH_SHEET_PIN_T && aItem.Type() !== KICAD_T.SCH_FIELD_T,
    );

    this.m_rtree.clear();

    for (const item of delete_list) item.Destroy();
  }

  /**
   * Check \a aPosition within a distance of \a aAccuracy for items of type \a aFilter.
   *
   * @return The item found that meets the search criteria or NULL if none found.
   */
  GetItem(
    aPosition: VECTOR2I,
    aAccuracy = 0,
    aType: KICAD_T = KICAD_T.SCH_LOCATE_ANY_T,
  ): SCH_ITEM | null {
    const bbox = new BOX2I();
    bbox.SetOrigin(aPosition);
    bbox.Inflate(aAccuracy);

    for (const item of this.Items().Overlapping(
      aType === KICAD_T.SCH_LOCATE_ANY_T ? null : aType,
      bbox,
    )) {
      if (item.HitTest(aPosition, aAccuracy)) return item;
    }

    return null;
  }

  /**
   * `UpdateSymbolLinks( aReporter )` (sch_screen.cpp): relink every symbol to its library symbol -
   * this screen's cache when it has one, else the symbol library adapter - and rebuild the cache.
   *
   * The legacy `<project>-cache.lib` fallback (`PROJECT_SCH::LegacySchLibs`) is not reached: that
   * is a PROJECT element upstream and the project here does not hold one, so `legacyLibs` is the
   * null an s-expression schematic gets.
   */
  UpdateSymbolLinks(aReporter: Reporter | null = null): void {
    const schematic = this.Schematic();

    if (!schematic) return; // wxCHECK_RET: "Cannot call SCH_SCREEN::UpdateSymbolLinks with no SCHEMATIC"

    let msg: string;
    const libs = SymbolLibAdapter(schematic.Project());
    const legacyLibs = null;
    const symbols = [...this.Items().OfType(KICAD_T.SCH_SYMBOL_T)] as SCH_SYMBOL[];

    // Remove them from the R tree.  Their bounding box size may change.
    for (const symbol of symbols) this.Remove(symbol);

    // Clear all existing symbol links.
    this.clearLibSymbols();

    const describe = (aSymbol: SCH_SYMBOL) =>
      `${aSymbol.GetField(FIELD_T.REFERENCE)!.GetText()} ${aSymbol.GetField(FIELD_T.VALUE)!.GetText()}`;

    for (const symbol of symbols) {
      let tmp: LIB_SYMBOL | null = null;

      // If the symbol is already in the internal library, map the symbol to it.
      const it = this.m_libSymbols.get(symbol.GetSchSymbolLibraryName());

      if (it) {
        if (aReporter) {
          msg = `Setting schematic symbol '${describe(symbol)}' library identifier to '${unescapeString(symbol.GetLibId().Format())}'.`;
          aReporter.ReportTail(msg, RPT_SEVERITY_INFO);
        }

        // Internal library symbols are already flattened so just make a copy.
        symbol.SetLibSymbol(LIB_SYMBOL.copyOf(it));
        continue;
      }

      if (!symbol.GetLibId().IsValid()) {
        if (aReporter) {
          msg = `Schematic symbol reference '${unescapeString(symbol.GetLibId().Format())}' library identifier is not valid. Unable to link library symbol.`;
          aReporter.ReportTail(msg, RPT_SEVERITY_WARNING);
        }

        continue;
      }

      // LIB_TABLE_BASE::LoadSymbol() throws an IO_ERROR if the library nickname is not found in
      // the table so check if the library still exists in the table before attempting to load
      // the symbol.
      const nickname = symbol.GetLibId().GetLibNickname();
      const hasLibraryRow = libs.GetRow(nickname) !== null;
      let hasLoadedLibrary = libs.HasLibrary(nickname);

      if (!hasLibraryRow && !legacyLibs) {
        if (aReporter) {
          msg = `Symbol library '${nickname}' not found and no fallback cache library available.  Unable to link library symbol.`;
          aReporter.ReportTail(msg, RPT_SEVERITY_WARNING);
        }

        continue;
      }

      if (hasLibraryRow && !hasLoadedLibrary) {
        libs.LoadOne(nickname);
        hasLoadedLibrary = libs.HasLibrary(nickname);
      }

      if (hasLoadedLibrary) {
        try {
          tmp = libs.LoadSymbol(symbol.GetLibId());
        } catch (ioe) {
          if (!(ioe instanceof IO_ERROR)) throw ioe;

          if (aReporter) {
            msg = `I/O error ${ioe.message} resolving library symbol ${unescapeString(symbol.GetLibId().Format())}`;
            aReporter.ReportTail(msg, RPT_SEVERITY_ERROR);
          }
        }
      }

      if (tmp) {
        // We want a full symbol not just the top level child symbol.
        const libSymbol = tmp.Flatten();
        libSymbol.SetLibParent();

        this.m_libSymbols.set(symbol.GetSchSymbolLibraryName(), LIB_SYMBOL.copyOf(libSymbol));

        if (aReporter) {
          msg = `Setting schematic symbol '${describe(symbol)}' library identifier to '${unescapeString(symbol.GetLibId().Format())}'.`;
          aReporter.ReportTail(msg, RPT_SEVERITY_INFO);
        }

        symbol.SetLibSymbol(libSymbol);
      } else if (aReporter) {
        msg = `No library symbol found for schematic symbol '${describe(symbol)}'.`;
        aReporter.ReportTail(msg, RPT_SEVERITY_ERROR);
      }
    }

    // Changing the symbol may adjust the bbox of the symbol.  This re-inserts the item with the
    // new bbox
    for (const symbol of symbols) this.Append(symbol);
  }

  /**
   * Initialize the #LIB_SYMBOL reference for each #SCH_SYMBOL found in this schematic
   * with the local project library symbols.
   */
  UpdateLocalLibSymbolLinks(): void {
    // Remove them from the R tree.  Bitmap symbols may change.
    const symbols = this.Items().OfType(KICAD_T.SCH_SYMBOL_T) as SCH_SYMBOL[];

    for (const symbol of symbols) {
      this.m_rtree.remove(symbol);

      const it = this.m_libSymbols.get(symbol.GetSchSymbolLibraryName());

      if (it) symbol.SetLibSymbol(LIB_SYMBOL.copyOf(it));
      else symbol.SetLibSymbol(null);

      this.m_rtree.insert(symbol);
    }
  }

  /**
   * Remove \a aItem from the schematic associated with this screen.
   *
   * @note The removed item is not deleted.  It is only unlinked from the item list.
   * @param[in] aItem Item to be removed from schematic.
   * @param aUpdateLibSymbol removes the library symbol as required when true.
   * @return True if we successfully removed the item.
   */
  Remove(aItem: SCH_ITEM, aUpdateLibSymbol = true): boolean {
    const retv = this.m_rtree.remove(aItem);

    // Check if the library symbol for the removed schematic symbol is still required.
    if (retv && aItem.Type() === KICAD_T.SCH_SYMBOL_T && aUpdateLibSymbol) {
      const removedSymbol = aItem as SCH_SYMBOL;

      let removeUnusedLibSymbol = true;

      for (const item of this.Items().OfType(KICAD_T.SCH_SYMBOL_T)) {
        const symbol = item as SCH_SYMBOL;

        if (removedSymbol.GetSchSymbolLibraryName() === symbol.GetSchSymbolLibraryName()) {
          removeUnusedLibSymbol = false;
          break;
        }
      }

      if (removeUnusedLibSymbol) {
        const name = removedSymbol.GetSchSymbolLibraryName();
        const it = this.m_libSymbols.get(name);

        if (it) {
          it.Destroy();
          this.m_libSymbols.delete(name);
        }
      }
    }

    return retv;
  }

  /**
   * Update \a aItem's bounding box in the tree.
   *
   * @param aItem Item that needs to be updated.
   * @param aUpdateLibSymbol removes the library symbol as required when true.
   */
  Update(aItem: SCH_ITEM, aUpdateLibSymbol = true): void {
    if (this.Remove(aItem, aUpdateLibSymbol)) this.Append(aItem, aUpdateLibSymbol);
  }

  /**
   * Remove \a aItem from the linked list and deletes the object.
   *
   * If \a aItem is a schematic sheet label, it is removed from the screen associated with
   * the sheet that contains the label to be deleted.
   *
   * @param aItem The schematic object to be deleted from the screen.
   */
  DeleteItem(aItem: SCH_ITEM): void {
    // Markers are not saved in the file, no need to flag as modified.
    // TODO: Maybe we should have a listing somewhere of items that aren't saved?
    if (aItem.Type() !== KICAD_T.SCH_MARKER_T) this.SetContentModified();

    this.Remove(aItem);

    if (aItem.Type() === KICAD_T.SCH_SHEET_PIN_T) {
      // This structure is attached to a sheet, get the parent sheet object.
      const sheetPin = aItem as SCH_SHEET_PIN;
      const sheet = sheetPin.GetParent();

      if (!sheet) return; // wxCHECK_RET: "Sheet pin parent not properly set, bad programmer!"

      sheet.RemovePin(sheetPin);
      return;
    }

    aItem.Destroy();
  }

  CheckIfOnDrawList(aItem: SCH_ITEM): boolean {
    return this.m_rtree.contains(aItem, true);
  }

  /**
   * Test all of the connectable objects in the schematic for unused connection points.
   *
   * @param aPath is a sheet path to pass to UpdateDanglingState if desired.
   * @param aChangedHandler an optional callback to make on each changed item.
   */
  TestDanglingEnds(
    aPath: SCH_SHEET_PATH | null = null,
    aChangedHandler: ((aItem: SCH_ITEM) => void) | null = null,
  ): void {
    const endPointsByType: DANGLING_END_ITEM[] = [];

    const get_ends = (item: SCH_ITEM): void => {
      if (item.IsConnectable()) item.GetEndPoints(endPointsByType);
    };

    const update_state = (item: SCH_ITEM): void => {
      if (item.UpdateDanglingState(endPointsByType, endPointsByPos, aPath)) {
        if (aChangedHandler) aChangedHandler(item);
      }
    };

    for (const item of this.Items()) {
      get_ends(item);
      item.RunOnChildren(get_ends, RECURSE_MODE.NO_RECURSE);
    }

    const endPointsByPos = [...endPointsByType];
    DANGLING_END_ITEM_HELPER.sort_dangling_end_items(endPointsByType, endPointsByPos);

    for (const item of this.Items()) {
      update_state(item);
      item.RunOnChildren(update_state, RECURSE_MODE.NO_RECURSE);
    }
  }

  /**
   * Return all wires and junctions connected to \a aItem which are not connected any
   * symbol pin, or all graphic lines connected to \a aItem.
   *
   * `MarkConnections` (sch_screen.cpp:426): \a aSecondPass also takes the junctions on the
   * connected ends.
   */
  MarkConnections(aItem: SCH_ITEM, aSecondPass: boolean): Set<SCH_ITEM> {
    // PROCESSED: CANDIDATE. Don't use SKIP_STRUCT; IsConnected() returns false if it's set.
    const PROCESSED = CANDIDATE;

    const retval = new Set<SCH_ITEM>();
    const toSearch: SCH_ITEM[] = [];

    const getItemEndpoints = (aCandidate: SCH_ITEM | null): VECTOR2I[] => {
      if (!aCandidate) return [];

      if (aCandidate.Type() === KICAD_T.SCH_LINE_T) {
        const line = aCandidate as SCH_LINE;
        return [line.GetStartPoint(), line.GetEndPoint()];
      }

      if (aCandidate.Type() === KICAD_T.SCH_SHAPE_T) {
        const shape = aCandidate as SCH_SHAPE;

        if (shape.GetShape() === SHAPE_T.ARC || shape.GetShape() === SHAPE_T.BEZIER)
          return [shape.GetStart(), shape.GetEnd()];
        else if (shape.GetShape() === SHAPE_T.RECTANGLE) return shape.GetRectCorners();
        else if (shape.GetShape() === SHAPE_T.SEGMENT) return [shape.GetStart(), shape.GetEnd()];
        else if (shape.GetShape() === SHAPE_T.POLY) return shape.GetPolyPoints();
      }

      return [];
    };

    if (!aItem || getItemEndpoints(aItem).length === 0) return retval;

    toSearch.push(aItem);

    while (toSearch.length > 0) {
      const item = toSearch.pop()!;

      if (item.HasFlag(PROCESSED)) continue;

      item.SetFlags(PROCESSED);

      const bbox = item.GetBoundingBox();

      for (const type of [KICAD_T.SCH_LINE_T, KICAD_T.SCH_SHAPE_T]) {
        for (const candidate of this.Items().Overlapping(type, bbox)) {
          if (candidate.HasFlag(PROCESSED)) continue;

          const endpoints = getItemEndpoints(candidate);

          if (endpoints.length === 0) continue;

          // Skip connecting items on different layers (e.g. buses)
          if (item.GetLayer() !== candidate.GetLayer()) continue;

          let sharesEndpoint = false;

          for (const pt of endpoints) {
            if (item.IsEndPoint(pt)) {
              sharesEndpoint = true;

              if (aSecondPass && item.IsConnected(pt)) {
                const junction = this.GetItem(pt, 0, KICAD_T.SCH_JUNCTION_T);

                if (junction) retval.add(junction);
              }
            }
          }

          if (!sharesEndpoint) continue;

          toSearch.push(candidate);
          retval.add(candidate);
        }
      }
    }

    for (const item of this.Items()) item.ClearTempFlags();

    return retval;
  }

  /** Clear the state flags of all the items in the screen. */
  ClearDrawingState(): void {
    for (const item of this.Items()) item.ClearTempFlags();
  }

  CountConnectedItems(aPos: VECTOR2I, aTestJunctions: boolean): number {
    let count = 0;

    for (const item of this.Items().Overlapping(aPos)) {
      if ((item.Type() !== KICAD_T.SCH_JUNCTION_T || aTestJunctions) && item.IsConnected(aPos))
        count++;
    }

    return count;
  }

  /**
   * Test if a junction is required for the items at \a aPosition on the screen.
   *
   * A junction is required at \a aPosition if one of the following criteria is satisfied:
   *  - One wire midpoint and one or more wire endpoints;
   *  - Three or more wire endpoints;
   *  - One wire midpoint and a symbol pin;
   *  - Two or more wire endpoints and a symbol pin.
   */
  IsJunction(aPosition: VECTOR2I): boolean {
    return AnalyzePoint(this.Items(), aPosition, false).isJunction;
  }

  /** Indicate that a junction dot is necessary at the given location. */
  IsExplicitJunction(aPosition: VECTOR2I): boolean {
    const info = AnalyzePoint(this.Items(), aPosition, false);

    return info.isJunction && (!info.hasBusEntry || info.hasBusEntryToMultipleWires);
  }

  /** Indicate that a junction dot is necessary at the given location, and does not yet exist. */
  IsExplicitJunctionNeeded(aPosition: VECTOR2I): boolean {
    const info = AnalyzePoint(this.Items(), aPosition, false);

    return (
      info.isJunction &&
      (!info.hasBusEntry || info.hasBusEntryToMultipleWires) &&
      !info.hasExplicitJunctionDot
    );
  }

  /** Indicate that a junction dot may be placed at the given location. */
  IsExplicitJunctionAllowed(aPosition: VECTOR2I): boolean {
    const info = AnalyzePoint(this.Items(), aPosition, true);

    return info.isJunction && (!info.hasBusEntry || info.hasBusEntryToMultipleWires);
  }

  /**
   * `GetLabelOrientationForPoint` (sch_screen.cpp:563): the spin a label at \a aPosition takes
   * from what it lands on - away from a pin, along a wire's end, beside a bus entry's bus.
   */
  GetLabelOrientationForPoint(
    aPosition: VECTOR2I,
    aDefaultOrientation: SPIN_STYLE,
    aSheet: SCH_SHEET_PATH | null,
  ): SPIN_STYLE {
    let ret = aDefaultOrientation;

    for (const item of this.Items().Overlapping(aPosition)) {
      if (item.GetEditFlags() & STRUCT_DELETED) continue;

      switch (item.Type()) {
        case KICAD_T.SCH_BUS_WIRE_ENTRY_T: {
          const busEntry = item as SCH_BUS_WIRE_ENTRY;

          if (busEntry.m_connected_bus_item) {
            // bus connected, take the bus direction into consideration only if it is
            // vertical or horizontal
            const bus = busEntry.m_connected_bus_item as SCH_LINE;

            if (bus.Angle().AsDegrees() === 90.0) {
              // bus is vertical -> label shall be horizontal and
              // shall be placed to the side where the bus entry is
              if (aPosition.x < bus.GetPosition().x) ret = new SPIN_STYLE(SPIN_STYLE.LEFT);
              else if (aPosition.x > bus.GetPosition().x) ret = new SPIN_STYLE(SPIN_STYLE.RIGHT);
            } else if (bus.Angle().AsDegrees() === 0.0) {
              // bus is horizontal -> label shall be vertical and
              // shall be placed to the side where the bus entry is
              if (aPosition.y < bus.GetPosition().y) ret = new SPIN_STYLE(SPIN_STYLE.UP);
              else if (aPosition.y > bus.GetPosition().y) ret = new SPIN_STYLE(SPIN_STYLE.BOTTOM);
            }
          }

          break;
        }

        case KICAD_T.SCH_LINE_T: {
          const line = item as SCH_LINE;
          // line angles goes between -90 and 90 degrees, but normalize
          const angle = line.Angle().Normalize90().AsDegrees();
          const atEnd =
            line.GetEndPoint().x === aPosition.x && line.GetEndPoint().y === aPosition.y;

          if (-45 < angle && angle <= 45) {
            if (line.GetStartPoint().x <= line.GetEndPoint().x)
              ret = new SPIN_STYLE(atEnd ? SPIN_STYLE.RIGHT : SPIN_STYLE.LEFT);
            else ret = new SPIN_STYLE(atEnd ? SPIN_STYLE.LEFT : SPIN_STYLE.RIGHT);
          } else {
            if (line.GetStartPoint().y <= line.GetEndPoint().y)
              ret = new SPIN_STYLE(atEnd ? SPIN_STYLE.BOTTOM : SPIN_STYLE.UP);
            else ret = new SPIN_STYLE(atEnd ? SPIN_STYLE.UP : SPIN_STYLE.BOTTOM);
          }

          break;
        }

        case KICAD_T.SCH_SYMBOL_T: {
          const symbol = item as SCH_SYMBOL;

          for (const pin of symbol.GetPins(aSheet)) {
            if (pin.GetPosition().x === aPosition.x && pin.GetPosition().y === aPosition.y) {
              ret = GetPinSpinStyle(pin, symbol);
              break;
            }
          }

          break;
        }

        default:
          break;
      }
    }

    return ret;
  }

  /**
   * Test if \a aPosition is a connection point on \a aLayer.
   *
   * @param aPosition Position to test.
   * @param aLayer The layer type to test against.  Valid layer types are #LAYER_NOTES,
   *               #LAYER_BUS, and #LAYER_WIRE.
   * @return True if \a Position is a connection point on \a aLayer.
   */
  IsTerminalPoint(aPosition: VECTOR2I, aLayer: number): boolean {
    if (
      aLayer !== SCH_LAYER_ID.LAYER_NOTES &&
      aLayer !== SCH_LAYER_ID.LAYER_BUS &&
      aLayer !== SCH_LAYER_ID.LAYER_WIRE
    )
      return false; // wxCHECK_MSG

    let sheetPin: SCH_SHEET_PIN | null;
    let label: SCH_LABEL_BASE | null;

    switch (aLayer) {
      case SCH_LAYER_ID.LAYER_BUS:
        if (this.GetBus(aPosition)) return true;

        sheetPin = this.GetSheetPin(aPosition);

        if (sheetPin && sheetPin.IsConnected(aPosition)) return true;

        label = this.GetLabel(aPosition);

        if (label && !label.IsNew() && label.IsConnected(aPosition)) return true;

        break;

      case SCH_LAYER_ID.LAYER_NOTES:
        if (this.GetLine(aPosition)) return true;

        break;

      case SCH_LAYER_ID.LAYER_WIRE:
        if (this.GetItem(aPosition, 1, KICAD_T.SCH_BUS_WIRE_ENTRY_T)) return true;

        if (this.GetItem(aPosition, 1, KICAD_T.SCH_JUNCTION_T)) return true;

        if (this.GetPin(aPosition, null, true)) return true;

        if (this.GetWire(aPosition)) return true;

        label = this.GetLabel(aPosition, 1);

        if (label && !label.IsNew() && label.IsConnected(aPosition)) return true;

        sheetPin = this.GetSheetPin(aPosition);

        if (sheetPin && sheetPin.IsConnected(aPosition)) return true;

        break;

      default:
        break;
    }

    return false;
  }

  /**
   * Test the screen for a symbol pin item at \a aPosition.
   *
   * @param aPosition Position to test.
   * @param aSymbol The symbol if a pin was found, otherwise NULL.
   * @param aEndPointOnly Set to true to test if \a aPosition is the connection
   *                      point of the pin.
   * @return The pin item if found, otherwise NULL.
   */
  GetPin(
    aPosition: VECTOR2I,
    aSymbol: { value: SCH_SYMBOL | null } | null = null,
    aEndPointOnly = false,
  ): SCH_PIN | null {
    let candidate: SCH_SYMBOL | null = null;
    let pin: SCH_PIN | null = null;

    for (const item of this.Items().Overlapping(KICAD_T.SCH_SYMBOL_T, aPosition)) {
      candidate = item as SCH_SYMBOL;

      if (aEndPointOnly) {
        pin = null;

        if (!candidate.GetLibSymbolRef()) continue;

        for (const test_pin of candidate.GetLibPins()) {
          const p = candidate.GetPinPhysicalPosition(test_pin);

          if (p.x === aPosition.x && p.y === aPosition.y) {
            pin = test_pin;
            break;
          }
        }

        if (pin) break;
      } else {
        pin = candidate.GetDrawItem(aPosition, KICAD_T.SCH_PIN_T) as SCH_PIN | null;

        if (pin) break;
      }
    }

    if (pin && aSymbol) aSymbol.value = candidate;

    return pin;
  }

  /**
   * Test the screen if \a aPosition is a sheet label object.
   *
   * @param aPosition The position to test.
   * @return The sheet label object if found otherwise NULL.
   */
  GetSheetPin(aPosition: VECTOR2I): SCH_SHEET_PIN | null {
    let sheetPin: SCH_SHEET_PIN | null = null;

    for (const item of this.Items().Overlapping(KICAD_T.SCH_SHEET_T, aPosition)) {
      const sheet = item as SCH_SHEET;

      sheetPin = sheet.GetPin(aPosition);

      if (sheetPin) break;
    }

    return sheetPin;
  }

  /**
   * Clear the annotation for the symbols in \a aSheetPath on the screen.
   *
   * @param aSheetPath The sheet path of the symbol annotation to clear.  If NULL then
   *                   the entire hierarchy is cleared.
   * @param aResetPrefix The annotation prefix ('R', 'U', etc.) should be reset to the
   *                     symbol library prefix.
   */
  ClearAnnotation(aSheetPath: SCH_SHEET_PATH | null, aResetPrefix: boolean): void {
    for (const item of this.Items().OfType(KICAD_T.SCH_SYMBOL_T)) {
      const symbol = item as SCH_SYMBOL;

      symbol.ClearAnnotation(aSheetPath, aResetPrefix);
    }
  }

  /**
   * For screens shared by many sheetpaths (complex hierarchies):
   * to be able to clear or modify any reference related `sharedSheetPaths`, it is
   * necessary to ensure an alternate reference exists for each sheet path.
   */
  EnsureAlternateReferencesExist(): void {
    if (this.GetClientSheetPaths().length <= 1) return; // No need for alternate reference

    for (const item of this.Items().OfType(KICAD_T.SCH_SYMBOL_T)) {
      const symbol = item as SCH_SYMBOL;

      // Add (when not existing) all sheet path entries
      for (const sheet of this.GetClientSheetPaths())
        symbol.AddSheetPathReferenceEntryIfMissing(sheet.Path());
    }
  }

  /** Add all schematic sheet and symbol objects in the screen to \a aItems. */
  GetHierarchicalItems(aItems: SCH_ITEM[]): void {
    const hierarchicalTypes = [
      KICAD_T.SCH_SYMBOL_T,
      KICAD_T.SCH_SHEET_T,
      KICAD_T.SCH_LABEL_LOCATE_ANY_T,
    ];

    for (const item of this.Items()) {
      if (item.IsType(hierarchicalTypes)) aItems.push(item);
    }
  }

  /**
   * Similar to Items().OfType( SCH_SHEET_T ), but return the sheets in a
   * deterministic order (L-R, T-B) for things like hierarchy navigation.
   */
  GetSheets(aItems: SCH_ITEM[]): void {
    for (const item of this.Items().OfType(KICAD_T.SCH_SHEET_T)) aItems.push(item);

    aItems.sort((a, b) => {
      const pa = a.GetPosition();
      const pb = b.GetPosition();

      if (pa.x === pb.x) {
        // Ensure deterministic sort
        if (pa.y === pb.y) return a.m_Uuid < b.m_Uuid ? -1 : a.m_Uuid > b.m_Uuid ? 1 : 0;

        return pa.y - pb.y;
      } else {
        return pa.x - pb.x;
      }
    });
  }

  /**
   * Return a line item located at \a aPosition.
   *
   * @param[in] aPosition The position to test for a line item.
   * @param aAccuracy Amount to inflate the item hit test bounding box.
   * @param aLayer The layer the line is drawn upon.
   * @param aSearchType Additional line test criteria.
   * @return The SCH_LINE* of the wire item found at \a aPosition or NULL if item not
   *         found.
   */
  GetLine(
    aPosition: VECTOR2I,
    aAccuracy = 0,
    aLayer: number = SCH_LAYER_ID.LAYER_NOTES,
    aSearchType: SCH_LINE_TEST_T = SCH_LINE_TEST_T.ENTIRE_LENGTH_T,
  ): SCH_LINE | null {
    // an accuracy of 0 had problems with rounding errors; use at least 1
    aAccuracy = Math.max(aAccuracy, 1);

    // Upstream walks Overlapping( aPosition ) and skips non-lines; asking the tree for lines
    // only is the same answer in the same order, without boxing every symbol per query.
    for (const item of this.Items().Overlapping(KICAD_T.SCH_LINE_T, aPosition, aAccuracy)) {
      if (item.Type() !== KICAD_T.SCH_LINE_T) continue;

      if (item.GetLayer() !== aLayer) continue;

      if (!item.HitTest(aPosition, aAccuracy)) continue;

      const line = item as SCH_LINE;

      switch (aSearchType) {
        case SCH_LINE_TEST_T.ENTIRE_LENGTH_T:
          return line;

        case SCH_LINE_TEST_T.EXCLUDE_END_POINTS_T:
          if (!line.IsEndPoint(aPosition)) return line;

          break;

        case SCH_LINE_TEST_T.END_POINTS_ONLY_T:
          if (line.IsEndPoint(aPosition)) return line;
      }
    }

    return null;
  }

  GetWire(
    aPosition: VECTOR2I,
    aAccuracy = 0,
    aSearchType: SCH_LINE_TEST_T = SCH_LINE_TEST_T.ENTIRE_LENGTH_T,
  ): SCH_LINE | null {
    return this.GetLine(aPosition, aAccuracy, SCH_LAYER_ID.LAYER_WIRE, aSearchType);
  }

  GetBus(
    aPosition: VECTOR2I,
    aAccuracy = 0,
    aSearchType: SCH_LINE_TEST_T = SCH_LINE_TEST_T.ENTIRE_LENGTH_T,
  ): SCH_LINE | null {
    return this.GetLine(aPosition, aAccuracy, SCH_LAYER_ID.LAYER_BUS, aSearchType);
  }

  /**
   * Return buses and wires passing through aPosition.
   *
   * @param aPosition Position to search for.
   * @param aIgnoreEndpoints If true, ignore wires/buses with end points matching aPosition.
   * @return Buses and wires.
   */
  GetBusesAndWires(aPosition: VECTOR2I, aIgnoreEndpoints = false): SCH_LINE[] {
    const retVal: SCH_LINE[] = [];

    for (const item of this.Items().Overlapping(KICAD_T.SCH_LINE_T, aPosition)) {
      if (item.IsType([KICAD_T.SCH_ITEM_LOCATE_WIRE_T, KICAD_T.SCH_ITEM_LOCATE_BUS_T])) {
        const wire = item as SCH_LINE;

        if (aIgnoreEndpoints && wire.IsEndPoint(aPosition)) continue;

        if (IsPointOnSegment(wire.GetStartPoint(), wire.GetEndPoint(), aPosition))
          retVal.push(wire);
      }
    }

    return retVal;
  }

  /** Collect a unique list of all possible connection points in the schematic. */
  GetConnections(): VECTOR2I[] {
    let retval: VECTOR2I[] = [];

    for (const item of this.Items()) {
      // Avoid items that are changing
      if (!(item.GetEditFlags() & (IS_MOVING | IS_DELETED)))
        retval.push(...item.GetConnectionPoints());
    }

    // We always have some overlapping connection points.  Drop duplicates here
    sortUniquePoints((r) => (retval = r), retval);

    return retval;
  }

  /**
   * Return the unique set of points belonging to aItems where a junction is needed.
   *
   * @param aItems List of objects to check.
   * @return Points where a junction is needed.
   */
  GetNeededJunctions(aItems: readonly EDA_ITEM[]): VECTOR2I[] {
    let pts: VECTOR2I[] = [];
    const connections = this.GetConnections();

    for (const edaItem of aItems) {
      const item = edaItem as SCH_ITEM;

      if (!item || typeof item.IsConnectable !== 'function' || !item.IsConnectable()) continue;

      pts.push(...item.GetConnectionPoints());

      // If the item is a line, we also add any connection points from the rest of the
      // schematic that terminate on the line after it is moved.
      if (item.Type() === KICAD_T.SCH_LINE_T) {
        const line = item as SCH_LINE;

        for (const pt of connections) {
          if (IsPointOnSegment(line.GetStartPoint(), line.GetEndPoint(), pt)) pts.push(pt);
        }
      }
    }

    // We always have some overlapping connection points.  Drop duplicates here
    sortUniquePoints((r) => (pts = r), pts);

    // We only want the needed junction points, remove all the others
    return pts.filter((a) => this.IsExplicitJunctionNeeded(a));
  }

  /**
   * Return a label item located at \a aPosition.
   *
   * @param aPosition The x,y coordinate of the label.
   * @param aAccuracy The accuracy of the hit test.
   * @return The label item if found, otherwise NULL.
   */
  GetLabel(aPosition: VECTOR2I, aAccuracy = 0): SCH_LABEL_BASE | null {
    for (const item of this.Items().Overlapping(aPosition, aAccuracy)) {
      switch (item.Type()) {
        case KICAD_T.SCH_LABEL_T:
        case KICAD_T.SCH_GLOBAL_LABEL_T:
        case KICAD_T.SCH_HIER_LABEL_T:
        case KICAD_T.SCH_DIRECTIVE_LABEL_T:
          if (item.HitTest(aPosition, aAccuracy)) return item as SCH_LABEL_BASE;

          break;

        default:
          break;
      }
    }

    return null;
  }

  /**
   * Fetch a list of unique #LIB_SYMBOL object pointers required to properly render each
   * #SCH_SYMBOL in this schematic.
   *
   * @return The list of unique #LIB_SYMBOL object pointers.
   */
  GetLibSymbols(): ReadonlyMap<string, LIB_SYMBOL> {
    return this.m_libSymbols;
  }

  /**
   * Add \a aLibSymbol to the library symbol map.
   *
   * The symbol is mapped to the result of #LIB_ID::Format().  If a symbol is already
   * mapped, the existing symbol is replaced with \a aLibSymbol.  The screen object takes
   * ownership of the pointer.
   *
   * @param aLibSymbol A pointer the #LIB_SYMBOL to be added to the symbol map.
   */
  AddLibSymbol(aLibSymbol: LIB_SYMBOL): void {
    const libSymbolName = aLibSymbol.GetLibId().Format();
    const it = this.m_libSymbols.get(libSymbolName);

    if (it) {
      it.Destroy();
      this.m_libSymbols.delete(libSymbolName);
    }

    this.m_libSymbols.set(libSymbolName, aLibSymbol);
  }

  /**
   * After loading a file from disk, the library symbols do not yet contain the full
   * data for their embedded files, only a reference.  This iterates over all lib
   * symbols in the schematic and updates the library symbols with the full data.
   *
   * The fontconfig cache is not ported: `UpdateFontFiles()` answers no embedded fonts,
   * and `ResolveFont` resolves each face by name.
   */
  FixupEmbeddedData(): void {
    const schematic = this.Schematic();

    if (!schematic) return;

    const embeddedFonts: readonly string[] | null = null;

    for (const libSym of this.m_libSymbols.values()) {
      for (const [filename, embeddedFile] of libSym.EmbeddedFileMap()) {
        const file = schematic.GetEmbeddedFiles().GetEmbeddedFile(filename);

        if (file) {
          embeddedFile.compressedEncodedData = file.compressedEncodedData;
          embeddedFile.decompressedData = file.decompressedData;
          embeddedFile.data_hash = file.data_hash;
          embeddedFile.is_valid = file.is_valid;
        }
      }

      libSym.RunOnChildren((aChild) => {
        resolveFontOf(aChild, embeddedFonts);
      }, RECURSE_MODE.NO_RECURSE);
    }

    const items_to_update: SCH_ITEM[] = [];

    for (const item of this.Items()) {
      let update = resolveFontOf(item, embeddedFonts);

      item.RunOnChildren((aChild) => {
        if (resolveFontOf(aChild, embeddedFonts)) update = true;
      }, RECURSE_MODE.NO_RECURSE);

      if (update) items_to_update.push(item);
    }

    for (const item of items_to_update) this.Update(item);
  }

  /**
   * Add a bus alias definition.
   *
   * @param aAlias is a pointer to the bus alias object to store.
   */
  AddBusAlias(aAlias: BUS_ALIAS): void {
    const schematic = this.Schematic();

    if (schematic) schematic.AddBusAlias(aAlias);
  }

  GetSymbolInstances(): readonly SCH_SYMBOL_INSTANCE[] {
    return this.m_symbolInstances;
  }

  GetSheetInstances(): readonly SCH_SHEET_INSTANCE[] {
    return this.m_sheetInstances;
  }

  GetUuid(): KIID {
    return this.m_uuid;
  }

  AssignNewUuid(): void {
    this.m_uuid = newKiid();
  }

  /**
   * Update the symbol references for the legacy (version 4 and earlier) schematic file
   * formats.
   *
   * Prior to schematic file version 5, symbol instance references were stored in the
   * symbol's reference and unit fields; they are converted into instance data here.
   */
  SetLegacySymbolInstanceData(): void {
    for (const item of this.Items().OfType(KICAD_T.SCH_SYMBOL_T)) {
      const symbol = item as SCH_SYMBOL;

      // Add missing value and footprint instance data for legacy schematics.
      for (const instance of [...symbol.GetInstances()])
        symbol.AddHierarchicalReference(instance.m_Path, instance.m_Reference, instance.m_Unit);
    }
  }

  /**
   * Fix legacy power symbols that have mismatched value text fields and invisible power
   * pin names.
   */
  FixLegacyPowerSymbolMismatches(): void {
    for (const item of this.Items().OfType(KICAD_T.SCH_SYMBOL_T)) {
      const symbol = item as SCH_SYMBOL;
      const pins = symbol.GetAllLibPins();

      // Fix pre-8.0 legacy power symbols with invisible pins
      // that have mismatched pin names and value fields
      if (
        symbol.GetLibSymbolRef()?.IsGlobalPower() &&
        pins.length > 0 &&
        pins[0]!.IsGlobalPower() &&
        !pins[0]!.IsVisible()
      ) {
        symbol.SetValueFieldText(pins[0]!.GetName());
      }
    }
  }

  /**
   * Check all symbol default instance to see if they are not set yet.
   *
   * Declared upstream with no definition in 10.0.5; kept for the header's shape.
   */

  /** Check symbols for field names with leading or trailing white space. */
  HasSymbolFieldNamesWithWhiteSpace(): boolean {
    for (const item of this.Items().OfType(KICAD_T.SCH_SYMBOL_T)) {
      const symbol = item as SCH_SYMBOL;

      for (const field of symbol.GetFields()) {
        const trimmedFieldName = field.GetName().replace(/^[ \t\r\n\f\v]+|[ \t\r\n\f\v]+$/g, '');

        if (field.GetName() !== trimmedFieldName) return true;
      }
    }

    return false;
  }

  /**
   * Remove all invalid symbol instance data in this screen object for the project
   * defined by \a aProjectName.
   */
  PruneOrphanedSymbolInstances(aProjectName: string, aValidSheetPaths: SCH_SHEET_LIST): void {
    // The project name cannot be empty.  Projects older than 7.0 did not save project names
    // when saving instance data.  Running this algorithm with an empty project name would
    // clobber all instance data for projects other than the current one when a schematic
    // file is shared across multiple projects.  Because running the schematic editor in
    // stand alone mode can result in an empty project name, do not assert here.
    if (aProjectName === '') return;

    for (const item of this.Items().OfType(KICAD_T.SCH_SYMBOL_T)) {
      const symbol = item as SCH_SYMBOL;
      const pathsToPrune = new Map<string, KIID_PATH>();

      for (const instance of [...symbol.GetInstances()]) {
        // Ignore instance paths from other projects.
        if (aProjectName !== instance.m_ProjectName) continue;

        const pathFound = aValidSheetPaths.GetSheetPathByKIIDPath(instance.m_Path);

        // Check for paths that do not exist in the current project and paths that do
        // not contain the current symbol.
        if (!pathFound) pathsToPrune.set(instance.m_Path.AsString(), instance.m_Path);
        else if (pathFound.LastScreen() !== this)
          pathsToPrune.set(pathFound.Path().AsString(), pathFound.Path());
      }

      // std::set<KIID_PATH> walks in KIID_PATH order
      for (const sheetPath of [...pathsToPrune.values()].sort(kiidPathOrder))
        symbol.RemoveInstance(sheetPath);
    }
  }

  /**
   * Remove all invalid sheet instance data in this screen object for the project
   * defined by \a aProjectName.
   */
  PruneOrphanedSheetInstances(aProjectName: string, aValidSheetPaths: SCH_SHEET_LIST): void {
    // The project name cannot be empty.  See PruneOrphanedSymbolInstances.
    if (aProjectName === '') return;

    for (const item of this.Items().OfType(KICAD_T.SCH_SHEET_T)) {
      const sheet = item as SCH_SHEET;
      const pathsToPrune = new Map<string, KIID_PATH>();

      for (const instance of [...sheet.GetInstances()]) {
        // Ignore instance paths from other projects.
        if (aProjectName !== instance.m_ProjectName) continue;

        const pathFound = aValidSheetPaths.GetSheetPathByKIIDPath(instance.m_Path);

        // Check for paths that do not exist in the current project and paths that do
        // not contain the current symbol.
        if (!pathFound) pathsToPrune.set(instance.m_Path.AsString(), instance.m_Path);
        else if (pathFound.LastScreen() !== this)
          pathsToPrune.set(pathFound.Path().AsString(), pathFound.Path());
      }

      for (const sheetPath of [...pathsToPrune.values()].sort(kiidPathOrder))
        sheet.RemoveInstance(sheetPath);
    }
  }

  /** The sheet names on this screen, in code-point order (a std::set<wxString>). */
  GetSheetNames(): string[] {
    const retv = new Set<string>();

    for (const item of this.Items().OfType(KICAD_T.SCH_SHEET_T))
      retv.add((item as SCH_SHEET).GetName());

    return [...retv].sort(cpCmp);
  }

  /**
   * Check symbols for instance data from other projects.
   *
   * @return true if any symbol has an instance path that is not in this hierarchy.
   */
  HasInstanceDataFromOtherProjects(): boolean {
    const schematic = this.Schematic();

    if (!schematic) return false; // wxCHECK

    const hierarchy = schematic.Hierarchy();

    for (const item of this.Items().OfType(KICAD_T.SCH_SYMBOL_T)) {
      const symbol = item as SCH_SYMBOL;

      for (const instance of symbol.GetInstances()) {
        if (!hierarchy.HasPath(instance.m_Path)) return true;
      }
    }

    return false;
  }

  /**
   * Consistency check of internal m_groups structure.
   *
   * @param repair if true, modify groups structure until it passes the sanity check.
   * @return empty string on success.  Or error description if there's a problem.
   */
  GroupsSanityCheck(repair = false): string {
    if (repair) {
      while (this.GroupsSanityCheckInternal(repair) !== '') {
        // repeat until clean
      }

      return '';
    }

    return this.GroupsSanityCheckInternal(repair);
  }

  /** @param repair if true, make one modification to groups structure that brings it
   *                closer to passing the sanity check.
   *  @return empty string on success.  Or error description if there's a problem. */
  GroupsSanityCheckInternal(repair: boolean): string {
    // Cycle detection
    //
    // Each group has at most one parent group.
    // So we start at group 0 and traverse the parent chain, marking groups seen along the
    // way.  If we ever see a group that we've already marked, that's a cycle.  If we reach
    // the end of the chain, we know all groups in that chain are not part of any cycle.
    const knownCycleFreeGroups = new Set<EDA_ITEM>();
    const currentChainGroups = new Set<EDA_ITEM>();
    const toCheckGroups = new Set<EDA_ITEM>();

    // Initialize set of groups and generators to check that could participate in a cycle.
    for (const item of this.Items().OfType(KICAD_T.SCH_GROUP_T)) toCheckGroups.add(item);

    while (toCheckGroups.size > 0) {
      currentChainGroups.clear();
      let group: EDA_ITEM | null = toCheckGroups.values().next().value!;

      while (true) {
        if (currentChainGroups.has(group)) {
          if (repair) this.Remove(group as SCH_ITEM);

          return 'Cycle detected in group membership';
        } else if (knownCycleFreeGroups.has(group)) {
          // Parent is a group we know does not lead to a cycle
          break;
        }

        currentChainGroups.add(group);
        // We haven't visited currIdx yet, so it must be in toCheckGroups
        toCheckGroups.delete(group);

        const parent = group.GetParentGroup();
        group = parent ? parent.AsEdaItem() : null;

        if (!group) {
          // end of chain and no cycles found in this chain
          break;
        }
      }

      // No cycles found in chain, so add it to set of groups we know don't participate
      // in a cycle.
      for (const g of currentChainGroups) knownCycleFreeGroups.add(g);
    }

    // Success
    return '';
  }

  /** The variant names used by any symbol or sheet instance on this screen, sorted. */
  GetVariantNames(): string[] {
    const variantNames = new Set<string>();

    for (const item of this.Items().OfType(KICAD_T.SCH_SYMBOL_T)) {
      for (const instance of (item as SCH_SYMBOL).GetInstances()) {
        for (const name of instance.m_Variants.keys()) variantNames.add(name);
      }
    }

    for (const item of this.Items().OfType(KICAD_T.SCH_SHEET_T)) {
      for (const instance of (item as SCH_SHEET).GetInstances()) {
        for (const name of instance.m_Variants.keys()) variantNames.add(name);
      }
    }

    return [...variantNames].sort(cpCmp);
  }

  /** `DeleteVariant`. */
  DeleteVariant(aVariantName: string, aCommit: SCH_COMMIT | null = null): void {
    if (aVariantName === '') return; // wxCHECK

    for (const item of this.Items().OfType(KICAD_T.SCH_SYMBOL_T)) {
      const symbol = item as SCH_SYMBOL;

      for (const instance of [...symbol.GetInstances()]) {
        if (instance.m_Variants.has(aVariantName)) {
          if (aCommit) aCommit.Modify(item, this);

          symbol.DeleteVariant(instance.m_Path, aVariantName);
        }
      }
    }

    for (const item of this.Items().OfType(KICAD_T.SCH_SHEET_T)) {
      const sheet = item as SCH_SHEET;

      for (const instance of [...sheet.GetInstances()]) {
        if (instance.m_Variants.has(aVariantName)) {
          if (aCommit) aCommit.Modify(item, this);

          sheet.DeleteVariant(instance.m_Path, aVariantName);
        }
      }
    }
  }

  /** `RenameVariant`. */
  RenameVariant(aOldName: string, aNewName: string, aCommit: SCH_COMMIT | null = null): void {
    if (aOldName === '' || aNewName === '') return; // wxCHECK

    for (const item of this.Items().OfType(KICAD_T.SCH_SYMBOL_T)) {
      const symbol = item as SCH_SYMBOL;

      for (const instance of [...symbol.GetInstances()]) {
        if (instance.m_Variants.has(aOldName)) {
          if (aCommit) aCommit.Modify(item, this);

          symbol.RenameVariant(instance.m_Path, aOldName, aNewName);
        }
      }
    }

    for (const item of this.Items().OfType(KICAD_T.SCH_SHEET_T)) {
      const sheet = item as SCH_SHEET;

      for (const instance of [...sheet.GetInstances()]) {
        if (instance.m_Variants.has(aOldName)) {
          if (aCommit) aCommit.Modify(item, this);

          sheet.RenameVariant(instance.m_Path, aOldName, aNewName);
        }
      }
    }
  }

  /** `CopyVariant`. */
  CopyVariant(
    aSourceVariant: string,
    aNewVariant: string,
    aCommit: SCH_COMMIT | null = null,
  ): void {
    if (aSourceVariant === '' || aNewVariant === '') return; // wxCHECK

    for (const item of this.Items().OfType(KICAD_T.SCH_SYMBOL_T)) {
      const symbol = item as SCH_SYMBOL;

      for (const instance of [...symbol.GetInstances()]) {
        if (instance.m_Variants.has(aSourceVariant)) {
          if (aCommit) aCommit.Modify(item, this);

          symbol.CopyVariant(instance.m_Path, aSourceVariant, aNewVariant);
        }
      }
    }

    for (const item of this.Items().OfType(KICAD_T.SCH_SHEET_T)) {
      const sheet = item as SCH_SHEET;

      for (const instance of [...sheet.GetInstances()]) {
        if (instance.m_Variants.has(aSourceVariant)) {
          if (aCommit) aCommit.Modify(item, this);

          sheet.CopyVariant(instance.m_Path, aSourceVariant, aNewVariant);
        }
      }
    }
  }

  IsZoomInitialized(): boolean {
    return this.m_zoomInitialized;
  }

  private clearLibSymbols(): void {
    for (const libSymbol of this.m_libSymbols.values()) libSymbol.Destroy();

    this.m_libSymbols.clear();
  }

  /**
   * Return a list of potential library symbol matches for \a aSymbol.
   *
   * When a new library symbol is added to the schematic, it may already exist in the
   * library symbol list under a (`name_N`) alias; the matches are the ones to test.
   *
   * @param[in] aSymbol is the schematic symbol to search for potential library symbol
   *            matches.
   * @param[out] aMatches contains a list of potential library symbol matches.
   * @return the number of potential matches found.
   */
  private getLibSymbolNameMatches(aSymbol: SCH_SYMBOL, aMatches: string[]): number {
    let searchName = aSymbol.GetLibId().GetUniStringLibId();

    if (this.m_libSymbols.has(searchName)) aMatches.push(searchName);

    searchName = `${aSymbol.GetLibId().GetUniStringLibItemName()}_`;

    // std::map walks in key order
    for (const name of [...this.m_libSymbols.keys()].sort(cpCmp)) {
      if (name.startsWith(searchName) && isWxLong(name.substring(searchName.length)))
        aMatches.push(name);
    }

    return aMatches.length;
  }
}

/** `dynamic_cast<EDA_TEXT*>( aItem )->ResolveFont( aEmbeddedFonts )`, false for a non-text. */
function resolveFontOf(aItem: SCH_ITEM, aEmbeddedFonts: readonly string[] | null): boolean {
  const textItem = aItem as unknown as {
    ResolveFont?: (aFonts: readonly string[] | null) => boolean;
  };

  return typeof textItem.ResolveFont === 'function' ? textItem.ResolveFont(aEmbeddedFonts) : false;
}

/** `GetDrawItems().sort()`: each bucket by the items' `operator<`. */
function sortDrawItems(aSymbol: LIB_SYMBOL): void {
  aSymbol.GetDrawItems().sort((a, b) => a.lessThan(b));
}

/** `wxString::ToLong` accepted the whole suffix. */
function isWxLong(s: string): boolean {
  return /^[ \t\n\r\f\v]*[+-]?[0-9]+$/.test(s);
}

const cpCmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const kiidPathOrder = (a: KIID_PATH, b: KIID_PATH): number =>
  a.lessThan(b) ? -1 : b.lessThan(a) ? 1 : 0;

/** Sort points by (x, y) and drop the duplicates, as `std::sort` + `std::unique`. */
function sortUniquePoints(aSet: (r: VECTOR2I[]) => void, aPoints: VECTOR2I[]): void {
  const sorted = [...aPoints].sort((a, b) => (a.x !== b.x ? a.x - b.x : a.y - b.y));

  aSet(sorted.filter((p, i) => i === 0 || p.x !== sorted[i - 1]!.x || p.y !== sorted[i - 1]!.y));
}

/**
 * Container class that holds multiple #SCH_SCREEN objects in a hierarchy.
 *
 * Individual #SCH_SCREEN objects are unique and correspond to .sch files.
 *
 * NOTE: It may be desirable to fold the functionality of SCH_SCREENS into
 * the new SCHEMATIC class at some point, since SCHEMATIC can also track
 * the root sheet and is responsible for some of the same things.
 */
export class SCH_SCREENS {
  private m_screens: SCH_SCREEN[] = [];
  private m_sheets: SCH_SHEET[] = [];
  private m_index = 0;

  constructor(aSheet: SCH_SHEET | null) {
    this.m_index = 0;
    this.buildScreenList(aSheet);
  }

  GetCount(): number {
    return this.m_screens.length;
  }

  GetFirst(): SCH_SCREEN | null {
    this.m_index = 0;

    if (this.m_screens.length > 0) return this.m_screens[0]!;

    return null;
  }

  GetNext(): SCH_SCREEN | null {
    if (this.m_index < this.m_screens.length) this.m_index++;

    return this.GetScreen(this.m_index);
  }

  /** Delete a specific marker. */
  DeleteMarker(aMarker: SCH_MARKER): void {
    for (let screen = this.GetFirst(); screen; screen = this.GetNext()) {
      for (const item of screen.Items().OfType(KICAD_T.SCH_MARKER_T)) {
        if (item === (aMarker as unknown as SCH_ITEM)) {
          screen.DeleteItem(item);
          return;
        }
      }
    }
  }

  GetScreen(aIndex: number): SCH_SCREEN | null {
    if (aIndex < this.m_screens.length) return this.m_screens[aIndex]!;

    return null;
  }

  GetSheet(aIndex: number): SCH_SHEET | null {
    if (aIndex < this.m_sheets.length) return this.m_sheets[aIndex]!;

    return null;
  }

  /**
   * Clear the annotation for the symbols inside new sheetpaths when a complex hierarchy
   * is modified and new sheetpaths added.
   *
   * @param aInitialSheetPathList is the initial sheet paths list of hierarchy before
   *                              changes.
   */
  ClearAnnotationOfNewSheetPaths(aInitialSheetPathList: SCH_SHEET_LIST): void {
    const first = this.GetFirst();

    if (!first) return;

    const sch = first.Schematic();

    if (!sch) return; // wxCHECK_RET

    const screensList = new SCH_SCREENS(sch.Root()); // The list of screens, shared by sheet paths
    screensList.BuildClientSheetPathList(); // build the shared by sheet paths, by screen

    // Search for new sheet paths, not existing in aInitialSheetPathList
    // and existing in sheetpathList
    for (const sheetpath of sch.Hierarchy()) {
      let path_exists = false;

      for (const existing_sheetpath of aInitialSheetPathList) {
        if (existing_sheetpath.Path().equals(sheetpath.Path())) {
          path_exists = true;
          break;
        }
      }

      if (!path_exists) {
        // A new sheet path is found: clear the annotation corresponding to this new path:
        const curr_screen = sheetpath.LastScreen()!;

        // Clear annotation and create the AR for this path, if not exists,
        // when the screen is shared by sheet paths.
        // Otherwise ClearAnnotation do nothing, because the F1 field is used as
        // reference default value and takes the latest displayed value
        curr_screen.EnsureAlternateReferencesExist();
        curr_screen.ClearAnnotation(sheetpath, false);
      }
    }
  }

  /**
   * Test all sheet and symbol objects in the schematic for duplicate time stamps and
   * replaces them as necessary.
   *
   * Time stamps must be unique in order for complex hierarchies know which symbols go
   * to which sheets.
   *
   * @return The number of duplicate time stamps replaced.
   */
  ReplaceDuplicateTimeStamps(): number {
    const items: SCH_ITEM[] = [];
    let count = 0;

    const unique_stamps = new Set<string>();

    for (const screen of this.m_screens) {
      for (const item of screen.Items()) items.push(item);
    }

    if (items.length < 2) return 0;

    for (const item of items) {
      if (unique_stamps.has(item.m_Uuid)) {
        (item as { m_Uuid: KIID }).m_Uuid = newKiid();
        count++;
      } else {
        unique_stamps.add(item.m_Uuid);
      }
    }

    return count;
  }

  /** Clear the edit flags of every item of every screen. */
  ClearEditFlags(): void {
    for (let screen = this.GetFirst(); screen; screen = this.GetNext()) {
      for (const item of screen.Items()) item.ClearEditFlags();
    }
  }

  /**
   * Test all of the #SCH_SYMBOL objects in the schematic to see if they use a library
   * with no nickname; true when every symbol does (and there is at least one).
   */
  /** `UpdateSymbolLinks( aReporter )`: every screen's links, then the connection graph rebuilt. */
  UpdateSymbolLinks(aReporter: Reporter | null = null): void {
    for (let screen = this.GetFirst(); screen; screen = this.GetNext())
      screen.UpdateSymbolLinks(aReporter);

    const first = this.GetFirst();

    if (!first) return;

    const sch = first.Schematic();

    if (!sch) return; // wxCHECK_RET: "Null schematic in SCH_SCREENS::UpdateSymbolLinks"

    const sheets = sch.Hierarchy();

    // All of the library symbols have been replaced with copies so the connection graph
    // pointers are stale.
    sch.ConnectionGraph()?.Recalculate(sheets, true);
  }

  HasNoFullyDefinedLibIds(): boolean {
    let has_symbols = false;

    for (let screen = this.GetFirst(); screen; screen = this.GetNext()) {
      for (const item of screen.Items().OfType(KICAD_T.SCH_SYMBOL_T)) {
        const symbol = item as SCH_SYMBOL;

        has_symbols = true;

        if (symbol.GetLibId().GetLibNickname() !== '') return false;
      }
    }

    // return true (i.e. has no fully defined symbol) only if at least one symbol is found
    return has_symbols;
  }

  /**
   * Fetch all of the symbol library nicknames into \a aLibNicknames.
   *
   * @return the number of symbol library nicknames found.
   */
  GetLibNicknames(aLibNicknames: string[]): number {
    for (let screen = this.GetFirst(); screen; screen = this.GetNext()) {
      for (const item of screen.Items().OfType(KICAD_T.SCH_SYMBOL_T)) {
        const nickname = (item as SCH_SYMBOL).GetLibId().GetLibNickname();

        if (nickname !== '' && !aLibNicknames.includes(nickname)) aLibNicknames.push(nickname);
      }
    }

    return aLibNicknames.length;
  }

  /**
   * Change all of the symbol library nicknames.
   *
   * @return the number of symbols whose library nickname changed.
   */
  ChangeSymbolLibNickname(aFrom: string, aTo: string): number {
    let cnt = 0;

    for (let screen = this.GetFirst(); screen; screen = this.GetNext()) {
      for (const item of screen.Items().OfType(KICAD_T.SCH_SYMBOL_T)) {
        const symbol = item as SCH_SYMBOL;

        if (symbol.GetLibId().GetLibNickname() !== aFrom) continue;

        const id = symbol.GetLibId().clone();
        id.SetLibNickname(aTo);
        symbol.SetLibId(id);
        cnt++;
      }
    }

    return cnt;
  }

  /**
   * Check if one of the schematics in the list of screens is \a aSchematicFileName.
   *
   * Schematic file names in SCH_SCREEN object are stored with the absolute path to
   * the schematic file.
   *
   * @param aSchematicFileName is the schematic file name to search.
   * @return true if the a schematic matching the file name has been found.
   */
  HasSchematic(aSchematicFileName: string): boolean {
    for (let screen = this.GetFirst(); screen; screen = this.GetNext()) {
      if (screen.GetFileName() === aSchematicFileName) return true;
    }

    return false;
  }

  /**
   * Build the list of sheet paths sharing a screen for each screen in use.
   */
  BuildClientSheetPathList(): void {
    const first = this.GetFirst();

    if (!first) return;

    const sch = first.Schematic();

    if (!sch) return; // wxCHECK_RET

    // Don't try to build the list if the hierarchy isn't set up
    if (!sch.HasHierarchy()) return;

    for (let curr_screen = this.GetFirst(); curr_screen; curr_screen = this.GetNext())
      curr_screen.GetClientSheetPaths().length = 0;

    for (const sheetpath of sch.Hierarchy()) {
      const used_screen = sheetpath.LastScreen();

      // Search for the used_screen in list and add this unique sheet path:
      for (let curr_screen = this.GetFirst(); curr_screen; curr_screen = this.GetNext()) {
        if (used_screen === curr_screen) {
          curr_screen.GetClientSheetPaths().push(sheetpath);
          break;
        }
      }
    }
  }

  /**
   * Update the symbol value and footprint instance data for legacy designs.
   */
  SetLegacySymbolInstanceData(): void {
    for (let screen = this.GetFirst(); screen; screen = this.GetNext())
      screen.SetLegacySymbolInstanceData();
  }

  /**
   * Fix legacy power symbols that have mismatched value text fields and invisible power
   * pin names.
   */
  FixLegacyPowerSymbolMismatches(): void {
    for (let screen = this.GetFirst(); screen; screen = this.GetNext())
      screen.FixLegacyPowerSymbolMismatches();
  }

  PruneOrphanedSymbolInstances(aProjectName: string, aValidSheetPaths: SCH_SHEET_LIST): void {
    if (aProjectName === '') return;

    for (let screen = this.GetFirst(); screen; screen = this.GetNext())
      screen.PruneOrphanedSymbolInstances(aProjectName, aValidSheetPaths);
  }

  PruneOrphanedSheetInstances(aProjectName: string, aValidSheetPaths: SCH_SHEET_LIST): void {
    if (aProjectName === '') return;

    for (let screen = this.GetFirst(); screen; screen = this.GetNext())
      screen.PruneOrphanedSheetInstances(aProjectName, aValidSheetPaths);
  }

  HasSymbolFieldNamesWithWhiteSpace(): boolean {
    for (const screen of this.m_screens) {
      if (screen.HasSymbolFieldNamesWithWhiteSpace()) return true;
    }

    return false;
  }

  GetVariantNames(): string[] {
    const variantNames = new Set<string>();

    for (const screen of this.m_screens) {
      for (const variantName of screen.GetVariantNames()) variantNames.add(variantName);
    }

    return [...variantNames].sort(cpCmp);
  }

  DeleteVariant(aVariantName: string, aCommit: SCH_COMMIT | null = null): void {
    if (aVariantName === '') return; // wxCHECK

    for (const screen of this.m_screens) screen.DeleteVariant(aVariantName, aCommit);
  }

  RenameVariant(aOldName: string, aNewName: string, aCommit: SCH_COMMIT | null = null): void {
    if (aOldName === '' || aNewName === '') return; // wxCHECK

    for (const screen of this.m_screens) screen.RenameVariant(aOldName, aNewName, aCommit);
  }

  CopyVariant(
    aSourceVariant: string,
    aNewVariant: string,
    aCommit: SCH_COMMIT | null = null,
  ): void {
    if (aSourceVariant === '' || aNewVariant === '') return; // wxCHECK

    for (const screen of this.m_screens) screen.CopyVariant(aSourceVariant, aNewVariant, aCommit);
  }

  private addScreenToList(aScreen: SCH_SCREEN | null, aSheet: SCH_SHEET): void {
    if (aScreen === null) return;

    for (const screen of this.m_screens) {
      if (screen === aScreen) return;
    }

    this.m_screens.push(aScreen);
    this.m_sheets.push(aSheet);
  }

  private buildScreenList(aSheet: SCH_SHEET | null): void {
    if (aSheet && aSheet.Type() === KICAD_T.SCH_SHEET_T) {
      const screen = aSheet.GetScreen();

      if (!screen) return;

      this.addScreenToList(screen, aSheet);

      for (const item of screen.Items().OfType(KICAD_T.SCH_SHEET_T))
        this.buildScreenList(item as SCH_SHEET);
    }
  }
}
