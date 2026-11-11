// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SYMBOL_VIEWER_FRAME` (`eeschema/symbol_viewer_frame.cpp`), the Symbol Library Browser: a library
 * list, a symbol list and a preview of the selected symbol on its own canvas. The window -
 * its panes, toolbar and menu bar - is `symbol_viewer_frame_ui.tsx`, which draws this frame's
 * widgets and hands their events back to it.
 */
import { EdaCombinedMatcher } from '@ziroeda/common';
import { schIUScale } from '@ziroeda/common/eda_units.js';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import type { KIWAY_MAIL_EVENT } from '@ziroeda/common/kiway_mail.js';
import { SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { LIB_ID } from '@ziroeda/common/lib_id.js';
import type { SearchTerm } from '@ziroeda/common/eda_pattern_match.js';
import { PINNING_SYMBOL } from '@ziroeda/common/lib_tree_model_adapter.js';
import { MAIL_T } from '@ziroeda/common/mail_type.js';
import { Pgm, PgmOrNull } from '@ziroeda/common/pgm_base.js';
import type { APP_SETTINGS_BASE, WINDOW_SETTINGS } from '@ziroeda/common/settings/app_settings.js';
import { ESCAPE_CONTEXT, EscapeString, unescapeString } from '@ziroeda/common/string_utils.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import { COMMON_CONTROL } from '@ziroeda/common/tool/common_control.js';
import { COMMON_TOOLS } from '@ziroeda/common/tool/common_tools.js';
import type { SELECTION } from '@ziroeda/common/tool/selection.js';
import { TOOL_DISPATCHER } from '@ziroeda/common/tool/tool_dispatcher.js';
import { TOOL_MANAGER } from '@ziroeda/common/tool/tool_manager.js';
import {
  ENVVARS_CHANGED,
  type TOOLS_HOLDER_INPUT_SETTINGS,
} from '@ziroeda/common/tool/tools_holder.js';
import { ZOOM_TOOL } from '@ziroeda/common/tool/zoom_tool.js';
import { VIEW_UPDATE_FLAGS } from '@ziroeda/common/view/view_item.js';
import { WX_LISTBOX } from '@ziroeda/common/widgets/wx_listbox.js';
import { BOX2D, BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import { wxChoice, wxNOT_FOUND } from '@ziroeda/wx/choice.js';
import { wxSearchCtrl } from '@ziroeda/wx/wx_search_ctrl.js';
import { DEFAULT_LINE_WIDTH_MILS } from './default_values.js';
import {
  currentEeschemaSettings,
  EESCHEMA_SETTINGS,
  eeschemaKifaceSettings,
  updateEeschemaSettings,
} from './eeschema_settings.js';
import { storeWindowSettings } from '@ziroeda/common/settings/app_settings.js';
import type { LIB_SYMBOL } from './lib_symbol.js';
import { SymbolLibAdapter } from './project_sch.js';
import { SCH_BASE_FRAME } from './sch_base_frame.js';
import { BODY_STYLE } from './sch_item.js';
import { SCH_SCREEN } from './sch_screen.js';
import { DEMORGAN_ALT, DEMORGAN_STD } from './symbol_editor/symbol_edit_frame.js';
import { SCH_ACTIONS } from './tools/sch_actions.js';
import { SCH_INSPECTION_TOOL } from './tools/sch_inspection_tool.js';
import { SCH_SELECTION_TOOL } from './tools/sch_selection_tool.js';
import { SYMBOL_EDITOR_CONTROL } from './tools/symbol_editor_control.js';
import { SYMBOL_TYPE } from './libraries/symbol_library_adapter.js';
import { _ } from '@ziroeda/wx/translation.js';

/**
 * What ReCreateSymbolList asks a symbol for: the `LIB_TREE_ITEM` face of LIB_SYMBOL. A LIB_SYMBOL is
 * one; so is a preloaded item (LIB_TREE_ITEM_SYMBOL, lib_tree_item.ts).
 */
export interface SYMBOL_VIEWER_ITEM {
  GetName(): string;
  GetSearchTerms(): SearchTerm[];
  GetPinCount(): number;
  GetLibId(): LIB_ID;
}

/** What the window answers for the frame. */
export interface SYMBOL_VIEWER_FRAME_HOOKS {
  /** `SetTitle( title )`. */
  setTitle?(aTitle: string): void;
  /** `Close()`. */
  close?(): void;
  /**
   * `adapter->GetLibraryNames()`, counting a library loaded the way the program loads it: a hosted
   * one is LOADED once its preload has its items, as the symbol chooser counts it. Without the hook,
   * the adapter's own.
   */
  getLibraryNames?(): string[];
  /**
   * `adapter->GetSymbols( aLib, aType )`, likewise: a hosted library's symbols as its preloaded
   * items, which carry every search term without the library being parsed. Undefined to ask the
   * adapter.
   */
  getSymbols?(aLib: string, aType: SYMBOL_TYPE): SYMBOL_VIEWER_ITEM[] | undefined;
  /**
   * The symbol's own file fetched, so `LoadSymbol` finds it: a hosted library keeps each symbol in
   * a file of its own, fetched on use. True when the symbol can now be loaded.
   */
  ensureSymbol?(aLibId: LIB_ID): Promise<boolean>;
  /** `aList->GetSize().x`: how wide the window drew the list, which SaveSettings records. */
  getListWidth?(aList: WX_LISTBOX): number;
}

/** `wxString::IsNumber()`: an optional sign, then digits only; empty is not a number. */
function wxIsNumber(aText: string): boolean {
  return aText !== '' && /^[-+]?[0-9]*$/.test(aText);
}

/** `wxAtoi( s )`: `atoi`, the leading integer or 0. */
function wxAtoi(aText: string): number {
  const m = /^\s*([-+]?[0-9]+)/.exec(aText);
  return m ? Number.parseInt(m[1]!, 10) : 0;
}

/**
 * The Symbol Library Browser: a library list, a symbol list and a preview of the selected symbol
 * on its own canvas (`eeschema/symbol_viewer_frame.cpp`).
 */
export class SYMBOL_VIEWER_FRAME extends SCH_BASE_FRAME {
  private readonly hooks: SYMBOL_VIEWER_FRAME_HOOKS;

  m_unitChoice = new wxChoice();
  m_bodyStyleChoice = new wxChoice();
  m_libFilter = new wxSearchCtrl();
  m_libList = new WX_LISTBOX(); ///< The list of libraries.
  m_libListWidth: number; ///< Last width of the window.
  m_symbolFilter = new wxSearchCtrl();
  m_symbolList = new WX_LISTBOX(); ///< The list of symbols.
  m_symbolListWidth: number; ///< Last width of the window.

  /// Filters to select libs (if m_listPowerOnly is true, only libs containing power symbols are
  /// listed, and only power symbols in the selected library).
  m_listPowerOnly: boolean;
  m_allowedLibs: string[] = [];

  // Shared across instances, as upstream's statics are: the browser reopens on the last symbol.
  static m_currentSymbol = new LIB_ID();
  static m_unit = 1;
  static m_bodyStyle = 1;

  /// Updated to `true` if a list rewrite on GUI activation resulted in the symbol selection
  /// changing, or if the user has changed the selection manually.
  m_selection_changed = false;

  m_previewItem: LIB_SYMBOL | null = null;

  /** The symbol whose file ensureSymbol is fetching, so a preview asks for it once. */
  private m_fetching: string | null = null;

  /** `adapter->GetLibraryNames()`, through the window's source when it has one. */
  private libraryNames(): string[] {
    return this.hooks.getLibraryNames?.() ?? SymbolLibAdapter(this.Prj()).GetLibraryNames();
  }

  /** `adapter->GetSymbols( aLib, aType )`, through the window's source when it has one. */
  private librarySymbols(aLib: string, aType = SYMBOL_TYPE.ALL_SYMBOLS): SYMBOL_VIEWER_ITEM[] {
    return (
      this.hooks.getSymbols?.(aLib, aType) ?? SymbolLibAdapter(this.Prj()).GetSymbols(aLib, aType)
    );
  }

  /**
   * The constructor's non-window half: the screen, the libraries and the filters. The window gives
   * the frame its canvas; LoadSettings and setupTools follow from it (createSchDrawPanel).
   */
  constructor(hooks: SYMBOL_VIEWER_FRAME_HOOKS = {}) {
    super(FRAME_T.FRAME_SCH_VIEWER);
    this.hooks = hooks;

    this.m_libListWidth = 200;
    this.m_symbolListWidth = 300;
    this.m_listPowerOnly = false;

    const screen = new SCH_SCREEN();
    screen.m_Center = true; // Axis origin centered on screen.
    this.SetScreen(screen);

    // Ensure axis are always drawn (initial default display was not drawn)
    const gal_opts = this.GetGalDisplayOptions();
    gal_opts.m_axesEnabled = true;
    gal_opts.m_gridMinSpacing = 10.0;
    gal_opts.NotifyChanged();

    this.m_libFilter.SetDescriptiveText(_('Filter'));
    this.m_libFilter.BindText(() => this.OnLibFilter());

    this.m_symbolFilter.SetDescriptiveText(_('Filter'));
    this.m_symbolFilter.SetToolTip(
      'Filter on symbol name, keywords, description and pin count.\n' +
        'Search terms are separated by spaces.  All search terms must match.\n' +
        'A term which is a number will also match against the pin count.',
    );
    this.m_symbolFilter.BindText(() => this.OnSymFilter());

    // Preload libraries
    this.ReCreateLibList();

    this.m_selection_changed = false;

    this.DisplayLibInfos();
  }

  /** `setupTools()` (:270-294). */
  setupTools(): void {
    const canvas = this.GetCanvas()!;

    // Create the manager and dispatcher & route draw panel events to the dispatcher
    this.m_toolManager = new TOOL_MANAGER();
    this.m_toolManager.SetEnvironment(
      this.GetScreen(),
      canvas.GetView(),
      canvas.GetViewControls(),
      this.config(),
      this,
    );
    this.m_toolDispatcher = new TOOL_DISPATCHER(this.m_toolManager);

    // Register tools
    this.m_toolManager.RegisterTool(new COMMON_TOOLS());
    this.m_toolManager.RegisterTool(new COMMON_CONTROL());
    this.m_toolManager.RegisterTool(new ZOOM_TOOL());
    this.m_toolManager.RegisterTool(new SCH_INSPECTION_TOOL()); // manage show datasheet
    this.m_toolManager.RegisterTool(new SCH_SELECTION_TOOL()); // manage context menu
    this.m_toolManager.RegisterTool(new SYMBOL_EDITOR_CONTROL()); // manage render settings

    this.m_toolManager.InitTools();

    // Run the selection tool, it is supposed to be always active
    // It also manages the mouse right click to show the context menu
    this.m_toolManager.InvokeTool('common.InteractiveSelection');

    canvas.SetEventDispatcher(this.m_toolDispatcher);

    // The constructor's canvas half: the colours, the axes, the pen, and the working area.
    const renderSettings = this.GetRenderSettings()!;
    renderSettings.LoadColors(this.GetColorSettings());
    canvas
      .GetGAL()
      .SetAxesColor(this.GetColorSettings().GetColor(SCH_LAYER_ID.LAYER_SCHEMATIC_GRID_AXES));
    renderSettings.SetDefaultPenWidth(DEFAULT_LINE_WIDTH_MILS * schIUScale.IU_PER_MILS);

    // Set the working/draw area size to display a symbol to a reasonable value:
    // A 450mm x 450mm with a origin at the area center looks like a large working area
    const max_size_x = schIUScale.mmToIU(450);
    const max_size_y = schIUScale.mmToIU(450);
    const bbox = new BOX2D(
      { x: -max_size_x / 2, y: -max_size_y / 2 },
      { x: max_size_x, y: max_size_y },
    );
    canvas.GetView().SetBoundary(bbox);
    this.m_toolManager.RunAction(ACTIONS.zoomFitScreen);

    // If a symbol was previously selected in m_symbolList from a previous run, show it
    const symbName = this.m_symbolList.GetStringSelection();

    if (symbName !== '') {
      this.SetSelectedSymbol(symbName);
      this.updatePreviewSymbol();
    }
  }

  /**
   * `setupUIConditions()` (:297-336), the three this frame adds: Show Datasheet live with a
   * datasheet, and the two render toggles checked by the render settings.
   */
  ConditionShowDatasheet(): boolean {
    const symbol = this.GetSelectedSymbol();
    return !!symbol && symbol.GetDatasheetField().GetText() !== '';
  }

  ConditionElectricalTypesShown(): boolean {
    return !!this.GetRenderSettings()?.m_ShowPinsElectricalType;
  }

  ConditionPinNumbersShown(): boolean {
    return !!this.GetRenderSettings()?.m_ShowPinNumbers;
  }

  /** `SetUnitAndBodyStyle( aUnit, aBodyStyle )` (:339). */
  SetUnitAndBodyStyle(aUnit: number, aBodyStyle: number): void {
    SYMBOL_VIEWER_FRAME.m_unit = aUnit > 0 ? aUnit : 1;
    SYMBOL_VIEWER_FRAME.m_bodyStyle = aBodyStyle > 0 ? aBodyStyle : BODY_STYLE.BASE;
    this.m_selection_changed = false;

    this.updatePreviewSymbol();
  }

  GetUnit(): number {
    return SYMBOL_VIEWER_FRAME.m_unit;
  }

  GetBodyStyle(): number {
    return SYMBOL_VIEWER_FRAME.m_bodyStyle;
  }

  /** `GetSelectedSymbol()` (:349): the current symbol, as the library adapter loads it. */
  GetSelectedSymbol(): LIB_SYMBOL | null {
    let symbol: LIB_SYMBOL | null = null;

    if (SYMBOL_VIEWER_FRAME.m_currentSymbol.IsValid())
      symbol = SymbolLibAdapter(this.Prj()).LoadSymbol(SYMBOL_VIEWER_FRAME.m_currentSymbol);

    return symbol;
  }

  /** `updatePreviewSymbol()` (:360). */
  updatePreviewSymbol(): void {
    const symbol = this.GetSelectedSymbol();
    const view = this.GetCanvas()?.GetView() ?? null;

    // Not loadable yet: a hosted symbol's file is fetched on use. The preview comes back here once
    // it is, and draws whatever symbol the browser is on by then.
    if (!symbol && SYMBOL_VIEWER_FRAME.m_currentSymbol.IsValid() && this.hooks.ensureSymbol) {
      const wanted = SYMBOL_VIEWER_FRAME.m_currentSymbol.Format();

      if (this.m_fetching !== wanted) {
        this.m_fetching = wanted;

        void this.hooks.ensureSymbol(SYMBOL_VIEWER_FRAME.m_currentSymbol).then((aLoaded) => {
          if (this.m_fetching === wanted) this.m_fetching = null;

          if (aLoaded) this.updatePreviewSymbol();
        });
      }
    }

    if (this.m_previewItem) {
      view?.Remove(this.m_previewItem);
      this.m_previewItem = null;
    }

    this.ClearMsgPanel();

    if (symbol) {
      const renderSettings = this.GetRenderSettings();

      if (renderSettings) {
        renderSettings.m_ShowUnit = SYMBOL_VIEWER_FRAME.m_unit;
        renderSettings.m_ShowBodyStyle = SYMBOL_VIEWER_FRAME.m_bodyStyle;
      }

      this.m_previewItem = symbol.Flatten();
      view?.Add(this.m_previewItem);

      const parentName = symbol.GetLibParent()?.GetName() ?? '';

      this.AppendMsgPanel(_('Name'), unescapeString(this.m_previewItem.GetName()));
      this.AppendMsgPanel(_('Parent'), unescapeString(parentName));
      this.AppendMsgPanel(_('Description'), this.m_previewItem.GetDescription());
      this.AppendMsgPanel(_('Keywords'), this.m_previewItem.GetKeyWords());
    }

    this.m_toolManager?.RunAction(ACTIONS.zoomFitScreen);
    this.GetCanvas()?.Refresh();

    this.updateUnitChoice();
    this.updateBodyStyleChoice();
  }

  /** `updateUnitChoice()` (:420). */
  updateUnitChoice(): void {
    const symbol = this.GetSelectedSymbol();

    let unit_count = 1;

    if (symbol) unit_count = Math.max(symbol.GetUnitCount(), 1);

    this.m_unitChoice.Enable(unit_count > 1);
    this.m_unitChoice.Clear();

    if (unit_count > 1) {
      // rebuild the unit list if it is not suitable (after a new selection for instance)
      if (unit_count !== this.m_unitChoice.GetCount()) {
        for (let ii = 0; ii < unit_count; ii++)
          this.m_unitChoice.Append(symbol!.GetUnitDisplayName(ii + 1, true));
      }

      if (this.m_unitChoice.GetSelection() !== Math.max(0, SYMBOL_VIEWER_FRAME.m_unit - 1))
        this.m_unitChoice.SetSelection(Math.max(0, SYMBOL_VIEWER_FRAME.m_unit - 1));
    }
  }

  /** `updateBodyStyleChoice()` (:447). */
  updateBodyStyleChoice(): void {
    const symbol = this.GetSelectedSymbol();

    let bodyStyle_count = 1;

    if (symbol) bodyStyle_count = Math.max(symbol.GetBodyStyleCount(), 1);

    this.m_bodyStyleChoice.Enable(bodyStyle_count > 1);
    this.m_bodyStyleChoice.Clear();

    if (bodyStyle_count > 1) {
      if (symbol?.HasDeMorganBodyStyles()) {
        this.m_bodyStyleChoice.Append(DEMORGAN_STD);
        this.m_bodyStyleChoice.Append(DEMORGAN_ALT);
      } else if (symbol) {
        for (let i = 0; i < symbol.GetBodyStyleCount(); i++)
          this.m_bodyStyleChoice.Append(symbol.GetBodyStyleNames()[i]!);
      }

      if (
        this.m_bodyStyleChoice.GetSelection() !== Math.max(0, SYMBOL_VIEWER_FRAME.m_bodyStyle - 1)
      )
        this.m_bodyStyleChoice.SetSelection(Math.max(0, SYMBOL_VIEWER_FRAME.m_bodyStyle - 1));
    }
  }

  /** `ReCreateLibList()` (:478): the libraries the filter admits, pinned first. */
  ReCreateLibList(): boolean {
    this.m_libList.Clear();

    const cfg = PgmOrNull()?.GetCommonSettings() ?? null;
    const project = this.Prj().GetProjectFile();
    const adapter = SymbolLibAdapter(this.Prj());
    const libNicknames = this.libraryNames();
    const pinnedMatches: string[] = [];
    const otherMatches: string[] = [];

    const doAddLib = (aLib: string): void => {
      if (
        project.m_PinnedSymbolLibs.includes(aLib) ||
        (cfg?.m_Session?.pinned_symbol_libs ?? []).includes(aLib)
      ) {
        pinnedMatches.push(aLib);
      } else {
        otherMatches.push(aLib);
      }
    };

    const process = (aLib: string): void => {
      // Remove not allowed libs, if the allowed lib list is not empty
      if (this.m_allowedLibs.length) {
        if (!this.m_allowedLibs.includes(aLib)) return;
      }

      // Remove libs which have no power symbols, if this filter is activated
      if (this.m_listPowerOnly) {
        // `adapter->GetSymbolNames( aLib, SYMBOL_TYPE::POWER_ONLY )`
        const symbolNames = this.librarySymbols(aLib, SYMBOL_TYPE.POWER_ONLY);

        if (symbolNames.length === 0) return;
      }

      const row = adapter.GetRow(aLib);

      // wxCHECK( row, /* void */ )
      if (!row) return;

      if (row.Hidden()) return;

      if (adapter.SupportsSubLibraries(aLib)) {
        for (const { nickname, description: _description } of adapter.GetSubLibraries(aLib)) {
          const suffix = nickname === '' ? '' : ` - ${nickname}`;
          const name = `${aLib}${suffix}`;

          doAddLib(name);
        }
      } else {
        doAddLib(aLib);
      }
    };

    if (this.m_libFilter.GetValue() === '') {
      for (const lib of libNicknames) process(lib);
    } else {
      // wxStringTokenizer( m_libFilter->GetValue(), " \t\r\n", wxTOKEN_STRTOK )
      for (const token of this.m_libFilter
        .GetValue()
        .split(/[ \t\r\n]+/)
        .filter(Boolean)) {
        const term = token.toLowerCase();
        const matcher = new EdaCombinedMatcher(term);

        for (const lib of libNicknames) {
          if (matcher.find(lib.toLowerCase()) >= 0) process(lib);
        }
      }
    }

    if (libNicknames.length === 0) return true;

    for (const name of pinnedMatches) this.m_libList.Append(PINNING_SYMBOL + unescapeString(name));

    for (const name of otherMatches) this.m_libList.Append(unescapeString(name));

    // Search for a previous selection:
    const index = this.m_libList.FindString(
      unescapeString(SYMBOL_VIEWER_FRAME.m_currentSymbol.GetUniStringLibNickname()),
    );

    if (index !== wxNOT_FOUND) {
      this.m_libList.SetSelection(index, true);
    } else {
      // If not found, clear current library selection because it can be deleted after a
      // config change.
      SYMBOL_VIEWER_FRAME.m_currentSymbol.SetLibNickname(
        this.m_libList.GetCount() > 0 ? this.m_libList.GetBaseString(0) : '',
      );
      SYMBOL_VIEWER_FRAME.m_currentSymbol.SetLibItemName('');
      SYMBOL_VIEWER_FRAME.m_unit = 1;
      SYMBOL_VIEWER_FRAME.m_bodyStyle = BODY_STYLE.BASE;
    }

    const cmp_changed = this.ReCreateSymbolList();
    this.DisplayLibInfos();
    this.GetCanvas()?.Refresh();

    return cmp_changed;
  }

  /** `ReCreateSymbolList()` (:606): the current library's symbols the filter admits. */
  ReCreateSymbolList(): boolean {
    this.m_symbolList.Clear();

    const libName = SYMBOL_VIEWER_FRAME.m_currentSymbol.GetUniStringLibNickname();

    if (libName === '') return false;

    const adapter = SymbolLibAdapter(this.Prj());
    const symbols = this.librarySymbols(libName);

    const excludes = new Set<string>();

    if (this.m_symbolFilter.GetValue() !== '') {
      for (const token of this.m_symbolFilter
        .GetValue()
        .split(/[ \t\r\n]+/)
        .filter(Boolean)) {
        const filterTerm = token.toLowerCase();
        const matcher = new EdaCombinedMatcher(filterTerm);

        for (const symbol of symbols) {
          let matched = matcher.scoreTerms(symbol.GetSearchTerms()).score;

          if (wxIsNumber(filterTerm) && wxAtoi(filterTerm) === symbol.GetPinCount()) matched++;

          if (!matched) excludes.add(symbol.GetName());
        }
      }
    }

    const subLib = SYMBOL_VIEWER_FRAME.m_currentSymbol.GetSubLibraryName();

    for (const symbol of symbols) {
      if (
        adapter.SupportsSubLibraries(libName) &&
        subLib !== symbol.GetLibId().GetSubLibraryName()
      ) {
        continue;
      }

      if (!excludes.has(symbol.GetName()))
        this.m_symbolList.Append(unescapeString(symbol.GetName()));
    }

    if (this.m_symbolList.IsEmpty()) {
      this.SetSelectedSymbol('');
      SYMBOL_VIEWER_FRAME.m_bodyStyle = BODY_STYLE.BASE;
      SYMBOL_VIEWER_FRAME.m_unit = 1;
      return true;
    }

    let index = this.m_symbolList.FindString(
      unescapeString(SYMBOL_VIEWER_FRAME.m_currentSymbol.GetUniStringLibItemName()),
    );
    let changed = false;

    if (index === wxNOT_FOUND) {
      // Select the first library entry when the previous entry name does not exist in
      // the current library.
      SYMBOL_VIEWER_FRAME.m_bodyStyle = BODY_STYLE.BASE;
      SYMBOL_VIEWER_FRAME.m_unit = 1;
      index = -1;
      changed = true;
      this.SetSelectedSymbol('');
    }

    this.m_symbolList.SetSelection(index, true);

    return changed;
  }

  /** `ClickOnLibList( event )` (:687). */
  ClickOnLibList(): void {
    const ii = this.m_libList.GetSelection();

    if (ii < 0) return;

    this.m_selection_changed = true;

    let selection = EscapeString(this.m_libList.GetBaseString(ii), ESCAPE_CONTEXT.CTX_LIBID);

    const adapter = SymbolLibAdapter(this.Prj());

    if (!adapter.HasLibrary(selection) && selection.includes('-')) {
      // Probably a sub-library: `selection.BeforeLast( '-', &sublib ).Trim()`, `sublib.Trim( false )`
      const cut = selection.lastIndexOf('-');
      const sublib = selection.slice(cut + 1).replace(/^[ \t\r\n]+/, '');
      selection = selection.slice(0, cut).replace(/[ \t\r\n]+$/, '');
      this.SetSelectedLibrary(selection, sublib);
    } else {
      this.SetSelectedLibrary(selection);
    }
  }

  /** `SetSelectedLibrary( aLibraryName, aSubLibName )` (:715). */
  SetSelectedLibrary(aLibraryName: string, aSubLibName = ''): void {
    if (
      SYMBOL_VIEWER_FRAME.m_currentSymbol.GetUniStringLibNickname() === aLibraryName &&
      SYMBOL_VIEWER_FRAME.m_currentSymbol.GetSubLibraryName() === aSubLibName
    ) {
      return;
    }

    SYMBOL_VIEWER_FRAME.m_currentSymbol.SetLibNickname(aLibraryName);
    SYMBOL_VIEWER_FRAME.m_currentSymbol.SetSubLibraryName(aSubLibName);
    this.ReCreateSymbolList();
    this.GetCanvas()?.Refresh();
    this.DisplayLibInfos();

    // Ensure the corresponding line in m_libList is selected
    // (which is not necessary the case if SetSelectedLibrary is called
    // by another caller than ClickOnLibList.
    this.m_libList.SetStringSelection(
      unescapeString(SYMBOL_VIEWER_FRAME.m_currentSymbol.GetFullLibraryName()),
      true,
    );

    // The m_libList has now the focus, in order to be able to use arrow keys
    // to navigate inside the list.
    // the gal canvas must not steal the focus to allow navigation
    this.GetCanvas()?.SetStealsFocus(false);
    this.m_libList.SetFocus();
  }

  /** `ClickOnSymbolList( event )` (:742). */
  ClickOnSymbolList(): void {
    const ii = this.m_symbolList.GetSelection();

    if (ii < 0) return;

    this.m_selection_changed = true;

    this.SetSelectedSymbol(
      EscapeString(this.m_symbolList.GetBaseString(ii), ESCAPE_CONTEXT.CTX_LIBID),
    );

    // The m_symbolList has now the focus, in order to be able to use arrow keys
    // to navigate inside the list.
    // the gal canvas must not steal the focus to allow navigation
    this.GetCanvas()?.SetStealsFocus(false);
    this.m_symbolList.SetFocus();
  }

  /** `SetSelectedSymbol( aSymbolName )` (:761). */
  SetSelectedSymbol(aSymbolName: string): void {
    if (SYMBOL_VIEWER_FRAME.m_currentSymbol.GetUniStringLibItemName() !== aSymbolName) {
      SYMBOL_VIEWER_FRAME.m_currentSymbol.SetLibItemName(aSymbolName);

      // Ensure the corresponding line in m_symbolList is selected
      // (which is not necessarily the case if SetSelectedSymbol is called
      // by another caller than ClickOnSymbolList.
      this.m_symbolList.SetStringSelection(unescapeString(aSymbolName), true);
      this.DisplayLibInfos();

      if (this.m_selection_changed) {
        SYMBOL_VIEWER_FRAME.m_unit = 1;
        SYMBOL_VIEWER_FRAME.m_bodyStyle = BODY_STYLE.BASE;
        this.m_selection_changed = false;
      }

      this.updatePreviewSymbol();
    }
  }

  /** `DClickOnSymbolList( event )` (:785). */
  DClickOnSymbolList(): void {
    this.m_toolManager?.RunAction(SCH_ACTIONS.addSymbolToSchematic);
  }

  /** `GetWindowSettings( aCfg )` (:841): the browser's own, `lib_view.window`. */
  override GetWindowSettings(aCfg: APP_SETTINGS_BASE): WINDOW_SETTINGS {
    if (aCfg instanceof EESCHEMA_SETTINGS) return aCfg.m_LibViewPanel.window;

    // wxFAIL_MSG( wxT( "SYMBOL_VIEWER not running with EESCHEMA_SETTINGS" ) )
    return aCfg.m_Window; // non-null fail-safe
  }

  /** `LoadSettings( aCfg )` (:791): EESCHEMA_SETTINGS' `lib_view` into the lists and the render. */
  override LoadSettings(_aCfg: APP_SETTINGS_BASE): void {
    const cfg = eeschemaKifaceSettings();
    super.LoadSettings(cfg);

    const libView = currentEeschemaSettings().lib_view;

    // Grid shape, etc.
    this.GetGalDisplayOptions().ReadWindowSettings(this.GetWindowSettings(cfg));

    this.m_libListWidth = libView.lib_list_width;
    this.m_symbolListWidth = libView.cmp_list_width;

    const renderSettings = this.GetRenderSettings();

    if (renderSettings) {
      renderSettings.m_ShowPinsElectricalType = libView.show_pin_electrical_type;
      renderSettings.m_ShowPinNumbers = cfg.m_LibViewPanel.show_pin_numbers;
    }

    // Set parameters to a reasonable value.
    const maxWidth = cfg.m_LibViewPanel.window.state.size_x - 80;

    if (this.m_libListWidth + this.m_symbolListWidth > maxWidth) {
      // All ints upstream: the ratio truncates to 0 (or 1), and `| 0` keeps C's 0, not JS's -0.
      this.m_libListWidth =
        (maxWidth *
          Math.trunc(this.m_libListWidth / (this.m_libListWidth + this.m_symbolListWidth))) |
        0;
      this.m_symbolListWidth = maxWidth - this.m_libListWidth;
    }
  }

  /** `SaveSettings( aCfg )` (:818). The list widths are measured by the window that drew them. */
  override SaveSettings(_aCfg: APP_SETTINGS_BASE): void {
    const cfg = eeschemaKifaceSettings();
    super.SaveSettings(cfg);

    const width = this.hooks.getListWidth;

    if (this.m_libListWidth && width) this.m_libListWidth = width(this.m_libList);

    if (width) this.m_symbolListWidth = width(this.m_symbolList);

    const renderSettings = this.GetRenderSettings();

    if (renderSettings) cfg.m_LibViewPanel.show_pin_numbers = renderSettings.m_ShowPinNumbers;

    updateEeschemaSettings((s) => {
      // The window block upstream writes with every other PARAM: what EDA_DRAW_FRAME::SaveSettings
      // just put into m_LibViewPanel.window.
      storeWindowSettings(cfg.m_LibViewPanel.window, s.lib_view.window);
      s.lib_view.lib_list_width = this.m_libListWidth;
      s.lib_view.cmp_list_width = this.m_symbolListWidth;

      if (renderSettings)
        s.lib_view.show_pin_electrical_type = renderSettings.m_ShowPinsElectricalType;
    });
  }

  /** `CommonSettingsChanged( aFlags )` (:851). */
  override CommonSettingsChanged(aFlags = 0, aInput?: TOOLS_HOLDER_INPUT_SETTINGS): void {
    super.CommonSettingsChanged(aFlags, aInput);

    const cfg = eeschemaKifaceSettings();
    this.GetGalDisplayOptions().ReadWindowSettings(this.GetWindowSettings(cfg));

    const canvas = this.GetCanvas();

    if (canvas) {
      canvas
        .GetGAL()
        .SetAxesColor(this.GetColorSettings().GetColor(SCH_LAYER_ID.LAYER_SCHEMATIC_GRID_AXES));
      canvas.GetGAL().DrawGrid();
      canvas.ForceRefresh();
    }

    // `if( aFlags && ENVVARS_CHANGED )`: a logical AND upstream, so any flag at all rebuilds.
    if (aFlags && ENVVARS_CHANGED) this.ReCreateLibList();
  }

  /** `OnActivate( event )` (:867), for an activation. */
  OnActivate(): void {
    const changed = this.ReCreateLibList();

    if (changed) this.m_selection_changed = true;

    this.updatePreviewSymbol();

    this.DisplayLibInfos();
  }

  /** `CloseLibraryViewer( event )` (:885). */
  CloseLibraryViewer(): void {
    this.hooks.close?.();
  }

  /** `GetDocumentExtents( aIncludeAllVisible )` (:891). */
  override GetDocumentExtents(_aIncludeAllVisible = true): BOX2I {
    const symbol = this.GetSelectedSymbol();

    if (symbol)
      return symbol.GetUnitBoundingBox(SYMBOL_VIEWER_FRAME.m_unit, SYMBOL_VIEWER_FRAME.m_bodyStyle);

    return new BOX2I({ x: -200, y: -200 }, { x: 400, y: 400 });
  }

  /** `OnLibFilter( aEvent )` (:900). */
  OnLibFilter(): void {
    this.ReCreateLibList();
  }

  /** `OnSymFilter( aEvent )` (:910). */
  OnSymFilter(): void {
    this.ReCreateSymbolList();
  }

  /**
   * `OnCharHook( aEvent )` (:920): Up and Down walk the library list from it or its filter and
   * the symbol list from anywhere else; Tab moves between the filters; Enter places the symbol.
   * @return false where upstream calls `aEvent.Skip()`.
   */
  OnCharHook(aKey: string, aShiftDown = false): boolean {
    if (aKey === 'ArrowUp') {
      if (this.m_libFilter.HasFocus() || this.m_libList.HasFocus()) {
        const prev = this.m_libList.GetSelection() - 1;

        if (prev >= 0) {
          this.m_libList.SetSelection(prev);
          this.m_libList.EnsureVisible(prev);

          this.ClickOnLibList();
        }
      } else {
        this.SelectPreviousSymbol();
      }
    } else if (aKey === 'ArrowDown') {
      if (this.m_libFilter.HasFocus() || this.m_libList.HasFocus()) {
        const next = this.m_libList.GetSelection() + 1;

        if (next < this.m_libList.GetCount()) {
          this.m_libList.SetSelection(next);
          this.m_libList.EnsureVisible(next);

          this.ClickOnLibList();
        }
      } else {
        this.SelectNextSymbol();
      }
    } else if (aKey === 'Tab' && this.m_libFilter.HasFocus()) {
      if (!aShiftDown) this.m_symbolFilter.SetFocus();
      else return false;
    } else if (aKey === 'Tab' && this.m_symbolFilter.HasFocus()) {
      if (aShiftDown) this.m_libFilter.SetFocus();
      else return false;
    } else if (aKey === 'Enter' && this.m_symbolList.GetSelection() >= 0) {
      this.DClickOnSymbolList();
    } else {
      return false;
    }

    return true;
  }

  /** `SelectNextSymbol()` (:989): the next symbol, or the last one stays. */
  SelectNextSymbol(): void {
    let ii = this.m_symbolList.GetSelection();

    // Select the next symbol or stop at the end of the list.
    if (ii !== wxNOT_FOUND && ii < this.m_symbolList.GetCount() - 1) ii += 1;

    this.m_symbolList.SetSelection(ii);
    // ProcessEvent( wxEVT_COMMAND_LISTBOX_SELECTED, ID_LIBVIEW_SYM_LIST )
    this.ClickOnSymbolList();
  }

  /** `SelectPreviousSymbol()` (:1003): the previous symbol, or the first one stays. */
  SelectPreviousSymbol(): void {
    let ii = this.m_symbolList.GetSelection();

    // Select the previous symbol or stop at the beginning of list.
    if (ii !== wxNOT_FOUND && ii !== 0) ii -= 1;

    this.m_symbolList.SetSelection(ii);
    // ProcessEvent( wxEVT_COMMAND_LISTBOX_SELECTED, ID_LIBVIEW_SYM_LIST )
    this.ClickOnSymbolList();
  }

  /** `onSelectSymbolUnit( aEvent )` (:1017). */
  onSelectSymbolUnit(): void {
    const ii = this.m_unitChoice.GetSelection();

    if (ii < 0) return;

    SYMBOL_VIEWER_FRAME.m_unit = ii + 1;

    this.updatePreviewSymbol();
  }

  /** `onSelectSymbolBodyStyle( aEvent )` (:1030). */
  onSelectSymbolBodyStyle(): void {
    const ii = this.m_bodyStyleChoice.GetSelection();

    if (ii < 0) return;

    SYMBOL_VIEWER_FRAME.m_bodyStyle = ii + 1;

    this.updatePreviewSymbol();
  }

  /** `DisplayLibInfos()` (:1043): the library's full path in the title. */
  DisplayLibInfos(): void {
    const libName = SYMBOL_VIEWER_FRAME.m_currentSymbol.GetUniStringLibNickname();

    if (!this.m_libList.IsEmpty() && libName !== '') {
      const adapter = SymbolLibAdapter(this.Prj());
      const row = adapter.GetRow(libName);

      let title = row
        ? Pgm().GetLibraryManager().GetFullURI(row, true)
        : _('[no library selected]');

      title += ' — Symbol Library Browser';
      this.hooks.setTitle?.(title);
    }
  }

  /** `GetCurrentSelection()` (:1061). */
  override GetCurrentSelection(): SELECTION {
    return this.m_toolManager!.GetTool(SCH_SELECTION_TOOL)!.GetSelection();
  }

  /** `KiwayMailIn( mail )` (:1067). */
  override KiwayMailIn(mail: KIWAY_MAIL_EVENT): void {
    switch (mail.Command()) {
      case MAIL_T.MAIL_RELOAD_LIB:
        this.ReCreateLibList();
        break;

      case MAIL_T.MAIL_REFRESH_SYMBOL: {
        const symbol = this.GetSelectedSymbol();

        // wxCHECK2( symbol, break )
        if (!symbol) break;

        const adapter = SymbolLibAdapter(this.Prj());
        const row = adapter.GetRow(symbol.GetLibId().GetLibNickname());

        if (!row) return;

        const libfullname = Pgm().GetLibraryManager().GetFullURI(row, true);

        const lib = mail.GetPayload();

        if (lib === libfullname) {
          this.updatePreviewSymbol();
          this.GetCanvas()?.GetView().UpdateAllItems(VIEW_UPDATE_FLAGS.ALL);
        }

        break;
      }

      default:
    }
  }
}
