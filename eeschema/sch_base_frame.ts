// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SCH_BASE_FRAME` (eeschema/sch_base_frame.{h,cpp}): the base of the
 * schematic and symbol editors (and upstream the symbol viewer and chooser) —
 * the screen's page and title block, the item bookkeeping every edit goes
 * through (`AddToScreen`, `RemoveFromScreen`, `UpdateItem`), the colour theme
 * choice, and the free function `SchGetLibSymbol`.
 *
 * Every view call is made through `GetCanvas()?.GetView()`, as upstream's is
 * through `GetCanvas()->GetView()`: until a frame is given a canvas the calls
 * find none and the model half runs alone, which is what the live-model tests
 * exercise.
 *
 * Not ported, each for a stated reason:
 * - `m_watcher` / `setSymWatcher` / `OnSymChange` / `OnSymChangeDebounceTimer`:
 *   a `wxFileSystemWatcher` on the library file on disk. A browser tab has no
 *   file system to watch; the hosted library store pushes changes instead.
 * - `m_spaceMouse` and the activate/iconize handlers that only feed it: the
 *   3Dconnexion driver (`navlib/`, see pcbnew/STRUCTURE.md).
 * - `SelectLibrary`'s `EDA_LIST_DIALOG`: the list it shows is
 *   `GetLibraryItemsForListDialog`, ported below; the modal loop around it is
 *   the window's.
 */
import type { SCH_DRAW_PANEL } from './sch_draw_panel.js';
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import { EDA_DRAW_FRAME, SCH_EDIT_FRAME_NAME } from '@ziroeda/common/eda_draw_frame.js';
import { schIUScale, type EdaIuScale, type EdaUnits } from '@ziroeda/common/eda_units.js';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import type { Color4d } from '@ziroeda/common/gal/color4d.js';
import { SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { ORIGIN_TRANSFORMS } from '@ziroeda/common/origin_transforms.js';
import type { PAGE_INFO } from '@ziroeda/common/page_info.js';
import { GetColorSettings as PgmGetColorSettings } from '@ziroeda/common/pgm_base.js';
import type { COLOR_SETTINGS } from '@ziroeda/common/settings/color_settings.js';
import { strNumCmp } from '@ziroeda/common/string_utils.js';
import type { TITLE_BLOCK } from '@ziroeda/common/title_block.js';
import { RESET_REASON } from '@ziroeda/common/tool/tool_base.js';
import { VIEW_UPDATE_FLAGS } from '@ziroeda/common/view/view_item.js';
import { RECURSE_MODE } from '@ziroeda/common/eda_item.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { currentEeschemaSettings } from './eeschema_settings.js';
import type { SCH_GROUP } from './sch_group.js';
import type { SCH_ITEM } from './sch_item.js';
import type { SCH_SCREEN } from './sch_screen.js';
import { currentSymbolEditorSettings } from './symbol_editor/symbol_editor_settings.js';

/** `LIB_TREE_MODEL_ADAPTER::GetPinningSymbol()`: the star a pinned library is listed with. */
export const PINNING_SYMBOL = '☆ ';

/**
 * The symbol library layer `SchGetLibSymbol` asks (`SYMBOL_LIBRARY_ADAPTER::
 * LoadSymbol`), and the legacy cache library's `FindSymbol`. Asynchronous
 * here: the hosted libraries are fetched, not memory-mapped.
 */
export interface SCH_LIB_SYMBOL_SOURCE<S> {
  LoadSymbol(aLibId: string): Promise<S | null | undefined>;
}

/** `LEGACY_SYMBOL_LIB`, the `<project>-cache.lib` a V5 project carries: symbols by cache name. */
export interface SCH_LEGACY_CACHE_LIB<S> {
  IsCache(): boolean;
  FindSymbol(aName: string): S | null | undefined;
}

/**
 * `SchGetLibSymbol` (sch_base_frame.cpp:83-114): the symbol \a aLibId names,
 * from the library; failing that, from the legacy cache library under
 * `<nickname>_<item>`. A library that throws gives null, reported through
 * \a aShowError when one is given (upstream's `aShowErrorMsg`).
 */
export async function SchGetLibSymbol<S>(
  aLibId: string,
  aLibMgr: SCH_LIB_SYMBOL_SOURCE<S> | null,
  aCacheLib: SCH_LEGACY_CACHE_LIB<S> | null = null,
  aShowError: ((aMsg: string, aWhat: string) => void) | null = null,
): Promise<S | null> {
  // wxCHECK_MSG( aLibMgr, nullptr, "Invalid symbol library manager adapter." )
  if (!aLibMgr) return null;

  const colon = aLibId.indexOf(':');
  const nickname = colon >= 0 ? aLibId.slice(0, colon) : '';
  const itemName = colon >= 0 ? aLibId.slice(colon + 1) : aLibId;
  let symbol: S | null = null;

  try {
    symbol = (await aLibMgr.LoadSymbol(aLibId)) ?? null;

    if (!symbol && aCacheLib) {
      // wxCHECK_MSG( aCacheLib->IsCache(), nullptr, "Invalid cache library." )
      if (!aCacheLib.IsCache()) return null;

      symbol = aCacheLib.FindSymbol(`${nickname}_${itemName}`) ?? null;
    }
  } catch (ioe) {
    aShowError?.(
      `Error loading symbol ${itemName} from library '${nickname}'.`,
      ioe instanceof Error ? ioe.message : String(ioe),
    );
  }

  return symbol;
}

/**
 * The theme `SCH_BASE_FRAME::GetColorSettings` (sch_base_frame.cpp:620-640)
 * loads: eeschema's, unless this is the Symbol Editor and it is set not to use
 * eeschema's colours, in which case the Symbol Editor's own.
 */
export function SchColorThemeName(
  aFrameType: FRAME_T,
  aEeschemaColorTheme: string,
  aSymbolEditorCfg: {
    use_eeschema_color_settings: boolean;
    appearance: { color_theme: string };
  } | null,
): string {
  let colorTheme = aEeschemaColorTheme;

  if (aFrameType === FRAME_T.FRAME_SCH_SYMBOL_EDITOR && aSymbolEditorCfg) {
    if (!aSymbolEditorCfg.use_eeschema_color_settings)
      colorTheme = aSymbolEditorCfg.appearance.color_theme;
  }

  return colorTheme;
}

/** One row of `GetLibraryItemsForListDialog`: the name (star-prefixed when pinned) and description. */
export type LIBRARY_LIST_ITEM = [name: string, description: string];

/**
 * `SCH_BASE_FRAME::GetLibraryItemsForListDialog` (:667-712): the headers and
 * rows of a "choose a library" list — pinned libraries first, each group in
 * `StrNumCmp` order, a pinned name carrying the pinning symbol.
 */
export function GetLibraryItemsForListDialog(
  aLibraries: readonly { nickname: string; description: string }[],
  aPinned: readonly string[],
): { headers: string[]; items: LIBRARY_LIST_ITEM[] } {
  const headers = ['Library', 'Description'];
  const items: LIBRARY_LIST_ITEM[] = [];
  const unpinned: LIBRARY_LIST_ITEM[] = [];

  for (const { nickname, description } of aLibraries) {
    if (aPinned.includes(nickname)) items.push([PINNING_SYMBOL + nickname, description]);
    else unpinned.push([nickname, description]);
  }

  const byName = (a: LIBRARY_LIST_ITEM, b: LIBRARY_LIST_ITEM): number =>
    strNumCmp(a[0], b[0], true);

  items.sort(byName);
  unpinned.sort(byName);

  return { headers, items: [...items, ...unpinned] };
}

export abstract class SCH_BASE_FRAME extends EDA_DRAW_FRAME {
  /** `ORIGIN_TRANSFORMS`: the schematic has no user origin, so the identity. */
  private readonly m_originTransforms = new ORIGIN_TRANSFORMS();

  constructor(aFrameType: FRAME_T, aIuScale: EdaIuScale = schIUScale, aUnits: EdaUnits = 'mm') {
    super(aFrameType, aIuScale, aUnits);
  }

  override GetOriginTransforms(): ORIGIN_TRANSFORMS {
    return this.m_originTransforms;
  }

  /** The frame's wx name; each editor answers its own (`SCH_EDIT_FRAME_NAME` here). */
  override GetName(): string {
    return SCH_EDIT_FRAME_NAME;
  }

  /** `SCH_SCREEN* GetScreen() const override` (:185). */
  /** `SCH_DRAW_PANEL* GetCanvas() const override`: the frame's canvas is a schematic panel. */
  override GetCanvas(): SCH_DRAW_PANEL | null {
    return super.GetCanvas() as SCH_DRAW_PANEL | null;
  }

  override GetScreen(): SCH_SCREEN | null {
    return super.GetScreen() as SCH_SCREEN | null;
  }

  /** `SetPageSettings` (:219). */
  SetPageSettings(aPageSettings: PAGE_INFO): void {
    this.GetScreen()!.SetPageSettings(aPageSettings);
  }

  /** `GetPageSettings` (:225). */
  override GetPageSettings(): PAGE_INFO {
    return this.GetScreen()!.GetPageSettings();
  }

  /** `GetPageSizeIU` (:231): the page in schematic IU. */
  GetPageSizeIU(): VECTOR2I {
    return this.GetScreen()!.GetPageSettings().GetSizeIU(schIUScale.IU_PER_MILS);
  }

  /** `GetGridOrigin`: the schematic's grid origin is always (0, 0). */
  override GetGridOrigin(): VECTOR2I {
    return { x: 0, y: 0 };
  }

  /** `SetGridOrigin`: a no-op in the schematic. */
  override SetGridOrigin(_aPoint: VECTOR2I): void {}

  /** `GetTitleBlock` (:238). */
  override GetTitleBlock(): TITLE_BLOCK {
    return this.GetScreen()!.GetTitleBlock();
  }

  /** `SetTitleBlock` (:245). */
  SetTitleBlock(aTitleBlock: TITLE_BLOCK): void {
    this.GetScreen()!.SetTitleBlock(aTitleBlock);
  }

  /** `GetShowAllPins`: the base answers true; the symbol editor overrides it. */
  GetShowAllPins(): boolean {
    return true;
  }

  /** `RedrawScreen` (:293). */
  RedrawScreen(aCenterPoint: VECTOR2I, aWarpPointer: boolean): void {
    const canvas = this.GetCanvas();
    if (!canvas) return;

    canvas.GetView().SetCenter(aCenterPoint);

    if (aWarpPointer) canvas.GetViewControls().CenterOnCursor();

    canvas.Refresh();
  }

  /** `HardRedraw` (:304). */
  override HardRedraw(): void {
    const canvas = this.GetCanvas();

    if (canvas?.GetView()) {
      canvas.GetView().UpdateAllItems(VIEW_UPDATE_FLAGS.ALL);
      canvas.ForceRefresh();
    }
  }

  /** `AddToScreen` (:465-485). */
  AddToScreen(aItem: EDA_ITEM, aScreen: SCH_SCREEN | null = null): void {
    // wxCHECK( aItem, void ): there is no valid reason to pass a null item.
    if (!aItem) return;

    const screen = aScreen ?? this.GetScreen()!;

    if (aItem.Type() !== KICAD_T.SCH_TABLECELL_T) screen.Append(aItem as SCH_ITEM);

    if (screen === this.GetScreen()) {
      this.GetCanvas()?.GetView().Add(aItem);
      this.UpdateItem(aItem, true); // handle any additional parent semantics
    }
  }

  /** `RemoveFromScreen` (:488-503). */
  RemoveFromScreen(aItem: EDA_ITEM, aScreen: SCH_SCREEN | null = null): void {
    const screen = aScreen ?? this.GetScreen()!;

    if (screen === this.GetScreen()) this.GetCanvas()?.GetView().Remove(aItem);

    if (aItem.Type() !== KICAD_T.SCH_TABLECELL_T) screen.Remove(aItem as SCH_ITEM);

    if (screen === this.GetScreen()) this.UpdateItem(aItem, true); // handle any additional parent semantics
  }

  /**
   * `UpdateItem` (:372-428): repaint \a aItem (a sheet pin through its sheet,
   * and the parent of anything a symbol, sheet, label or table draws), and with
   * \a aUpdateRtree re-file it — and a group's children — in the screen's tree.
   *
   * Not ported: `SCH_SHAPE::UpdateHatching()`, which the live shape does not
   * carry (the hatch is the painter's).
   */
  UpdateItem(aItem: EDA_ITEM, isAddOrDelete = false, aUpdateRtree = false): void {
    const parent = aItem.GetParent();
    const view = this.GetCanvas()?.GetView() ?? null;

    if (aItem.Type() === KICAD_T.SCH_SHEET_PIN_T) {
      // Sheet pins aren't in the view.  Refresh their parent.
      if (parent) view?.Update(parent);
    } else {
      if (!isAddOrDelete) view?.Update(aItem);

      // Some children are drawn from their parents.  Mark them for re-paint.
      if (
        parent &&
        (parent.Type() === KICAD_T.SCH_SYMBOL_T ||
          parent.Type() === KICAD_T.SCH_SHEET_T ||
          parent.Type() === KICAD_T.SCH_LABEL_LOCATE_ANY_T ||
          parent.Type() === KICAD_T.SCH_TABLE_T)
      ) {
        view?.Update(parent, VIEW_UPDATE_FLAGS.REPAINT);
      }
    }

    // Be careful when calling this.  Update will invalidate RTree iterators.
    if (aUpdateRtree && isSchItem(aItem)) {
      const screen = this.GetScreen()!;
      screen.Update(aItem);

      // If we are updating the group, we also need to update all the children otherwise
      // their positions will remain stale in the RTree
      if (aItem.Type() === KICAD_T.SCH_GROUP_T) {
        (aItem as unknown as SCH_GROUP).RunOnChildren(
          (item) => screen.Update(item),
          RECURSE_MODE.RECURSE,
        );
      }
    }
  }

  /** `SyncView` (:506-513): let tools re-add what they own, then repaint everything. */
  SyncView(): void {
    // Let tools add things to the view if necessary
    this.m_toolManager?.ResetTools(RESET_REASON.MODEL_RELOAD);

    this.GetCanvas()?.GetView().UpdateAllItems(VIEW_UPDATE_FLAGS.ALL);
  }

  /** `GetLayerColor` (:516). */
  GetLayerColor(aLayer: SCH_LAYER_ID): Color4d {
    return this.GetColorSettings().GetColor(aLayer);
  }

  /**
   * `GetColorSettings` (:620-640): the theme `SchColorThemeName` picks, loaded
   * once and kept until a refresh is forced.
   */
  override GetColorSettings(aForceRefresh = false): COLOR_SETTINGS {
    if (!this.m_colorSettings || aForceRefresh) {
      const colorTheme = SchColorThemeName(
        this.GetFrameType(),
        currentEeschemaSettings().appearance.color_theme,
        currentSymbolEditorSettings(),
      );

      this.m_colorSettings = PgmGetColorSettings(colorTheme);
    }

    return this.m_colorSettings;
  }

  /** `GetDrawBgColor` (:643). */
  override GetDrawBgColor(): Color4d {
    return this.GetColorSettings().GetColor(SCH_LAYER_ID.LAYER_SCHEMATIC_BACKGROUND);
  }
}

/**
 * `dynamic_cast<SCH_ITEM*>( aItem )`: every concrete SCH_ITEM type sits between
 * `SCH_SHAPE_T` and `SCH_SHEET_T` (`include/core/typeinfo.h`).
 */
function isSchItem(aItem: EDA_ITEM): aItem is SCH_ITEM {
  const t = aItem.Type();
  return t >= KICAD_T.SCH_SHAPE_T && t <= KICAD_T.SCH_SHEET_T;
}
