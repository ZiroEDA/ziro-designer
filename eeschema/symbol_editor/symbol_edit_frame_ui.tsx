// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Symbol Editor's window: the chrome SYMBOL_EDIT_FRAME's constructor builds
 * (`eeschema/symbol_editor/symbol_edit_frame.cpp`) - the menu bar (`menubar_symbol_editor.cpp`),
 * the three toolbars with the unit and body-style selectors, the Libraries pane
 * (`symbol_tree_pane.cpp`), the Properties and Selection Filter panes, the SCH_DRAW_PANEL, the
 * message panel and the status bar - around the frame itself, which holds the LIB_SYMBOL, the
 * tools, the undo list and the library buffers.
 *
 * The window draws; the frame decides. A menu row or a toolbar button runs its TOOL_ACTION on
 * the frame's TOOL_MANAGER, the canvas's mouse and keys go to the frame's TOOL_DISPATCHER, the
 * frame writes the status bar and the message panel through its sinks, and each dialog it asks
 * for (`ShowModalDialog`) is drawn here.
 *
 * The libraries are the program's LIBRARY_MANAGER tables, as upstream: the hosted set as the
 * global table, the project's sym-lib-table as the project one, its files on a filesystem at the
 * project's folder whose writes go back to the project. A hosted library lists its symbols from
 * the index until a symbol of it is opened, which fetches that symbol's file.
 *
 * What it reaches into `designer/` for arrives as {@link SYMBOL_EDIT_FRAME_APP}.
 */
import type { ToolEntry } from '@ziroeda/common/tool/action_toolbar_types.js';
import {
  type JSX,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { ShowAboutDialog } from '@ziroeda/common/dialog_about/AboutDialog_main.js';
import {
  DisplayErrorMessage,
  type KICAD_MESSAGE_DIALOG_ARG,
  ShowKicadMessageDialog,
  type UnsavedChangesResult,
} from '@ziroeda/common/confirm.js';
import { HtmlMessageBox } from '@ziroeda/common/dialogs/html_message_box.js';
import { UnsavedChangesDialog } from '@ziroeda/common/dialogs/dialog_unsaved_changes.js';
import { ABOUT_TITLES } from '@ziroeda/common/eda_base_frame_about_titles.js';
import { GetAssociatedDocument } from '@ziroeda/common/eda_doc.js';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import { loadBitmapFontImage } from '@ziroeda/common/gal/gal_window.js';
import { showHotkeyList } from '@ziroeda/common/hotkeys_basic.js';
import { useKiDialog } from '@ziroeda/common/kidialog.js';
import type { KIWAY } from '@ziroeda/common/kiway.js';
import { LIB_ID } from '@ziroeda/common/lib_id.js';
import {
  LIBRARY_TABLE,
  LIBRARY_TABLE_SCOPE,
  LIBRARY_TABLE_TYPE,
} from '@ziroeda/common/libraries/library_table.js';
import { type LibTreeNode, LibTreeNodeType } from '@ziroeda/common/lib_tree_model.js';
import { Pgm } from '@ziroeda/common/pgm_base.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import { dispatchMenuHotkey, focusBlocksHotkey } from '@ziroeda/common/tool/action_menu_hotkeys.js';
import { Toolbar } from '@ziroeda/common/tool/action_toolbar.js';
import type { TOOL_ACTION } from '@ziroeda/common/tool/tool_action.js';
import { formatTitle, useDocumentTitle } from '@ziroeda/common/use_document_title.js';
import { useUnsavedGuard } from '@ziroeda/common/use_unsaved_guard.js';
import { type FocusLike, wasBrowserSuppressed } from '@ziroeda/common/browser_hotkeys.js';
import { Infobar } from '@ziroeda/common/widgets/wx_infobar.js';
import { KiStatusBar } from '@ziroeda/common/widgets/kistatusbar.js';
import type { StatusUnits } from '@ziroeda/common/widgets/kistatusbar_format.js';
import { LibTree } from '@ziroeda/common/widgets/lib_tree.js';
import { MsgPanel, type MsgPanelItem } from '@ziroeda/common/widgets/msgpanel_ui.js';
import { ProgressDialog } from '@ziroeda/common/widgets/wx_progress_reporters.js';
import type { GRID_TEXT_BUTTON_HOST } from '@ziroeda/common/widgets/grid_text_button_helpers.js';
import { Combo } from '@ziroeda/wx/combobox.js';
import { wxFD_FILE_MUST_EXIST, wxFD_OPEN, wxFD_SAVE } from '@ziroeda/wx/defs.js';
import {
  type ChooserFilter,
  WxFileDialog,
  wxFileDialogGetPath,
  WxSaveFileDialog,
} from '@ziroeda/wx/filedlg.js';
import {
  type FILEDLG_HOOK_NEW_LIBRARY,
  FileDlgHookNewLibraryControls,
  type wxFileDialogCustomizeHook,
} from '@ziroeda/common/widgets/filedlg_hook_new_library.js';
import {
  SYMBOL_LIBRARY_SAVE_AS_FILEDLG_HOOK,
  SymbolLibrarySaveAsControls,
} from '../widgets/symbol_library_save_as_filedlg_hook.js';
import {
  MEMORY_FILESYSTEM,
  wxFileExists,
  wxMountFileSystem,
  wxWriteFileSync,
} from '@ziroeda/wx/filefn.js';
import { type Menu, MenuBar } from '@ziroeda/wx/menu_ui.js';
import { wxID_CANCEL, wxID_OK } from '@ziroeda/wx/menu.js';
import { createSchDrawPanel } from '../browser/sch_canvas.js';
import {
  DIALOG_FIELD_PROPERTIES,
  DialogFieldProperties,
} from '../dialogs/dialog_field_properties.js';
import { DialogImportSymbolSelect } from '../dialogs/dialog_import_symbol_select.js';
import type { MessageDialogIcon } from '@ziroeda/common/confirm_types.js';
import type { WX_INFOBAR_HYPERLINK } from '@ziroeda/common/eda_base_frame.js';
import { SchFindDialogHost } from '../dialogs/dialog_sch_find.js';
import type { DIALOG_IMPORT_SYMBOL_SELECT_ARG } from './symbol_editor_import_export.js';
import {
  DIALOG_LIB_EDIT_PIN_TABLE,
  DialogLibEditPinTable,
} from '../dialogs/dialog_lib_edit_pin_table.js';
import {
  DIALOG_LIB_FIELDS_TABLE,
  DialogLibFieldsTable,
  type SCOPE,
} from '../dialogs/dialog_lib_fields_table.js';
import {
  type DIALOG_LIB_NEW_SYMBOL_ARG,
  DialogLibNewSymbol,
} from '../dialogs/dialog_lib_new_symbol.js';
import {
  DIALOG_LIB_SYMBOL_PROPERTIES,
  DialogLibSymbolProperties,
} from '../dialogs/dialog_lib_symbol_properties.js';
import { DialogPinProperties } from '../dialogs/dialog_pin_properties.js';
import {
  DIALOG_SHAPE_PROPERTIES,
  DialogShapeProperties,
} from '../dialogs/dialog_shape_properties.js';
import { DIALOG_TEXT_PROPERTIES, DialogTextProperties } from '../dialogs/dialog_text_properties.js';
import {
  DIALOG_UPDATE_SYMBOL_FIELDS,
  DialogUpdateSymbolFields,
} from '../dialogs/dialog_update_symbol_fields.js';
import { DialogImportGfx } from '../import_gfx/dialog_import_gfx_sch.js';
import { GRAPHICS_IMPORTER_LIB_SYMBOL } from '../import_gfx/graphics_importer_lib_symbol.js';
import type { LIB_SYMBOL } from '../lib_symbol.js';
import { fetchHostedSymbolFile } from '../libraries/symbol_library_adapter.js';
import { SymbolLibAdapter } from '../project_sch.js';
import { projectSymLibTablePath } from '../project_sym_lib_table.js';
import type { EDA_LIST_DIALOG_ARG } from '../sch_base_frame.js';
import { SelectLibraryDialog } from '../sch_base_frame_ui.js';
import type { SCH_COMMIT } from '../sch_commit.js';
import type { SCH_DRAW_PANEL } from '../sch_draw_panel.js';
import type { SCH_FIELD } from '../sch_field.js';
import type { SCH_PIN } from '../sch_pin.js';
import type { SCH_SHAPE } from '../sch_shape.js';
import type { SCH_SYMBOL } from '../sch_symbol.js';
import type { SCH_TEXT } from '../sch_text.js';
import type { SCH_TEXTBOX } from '../sch_textbox.js';
import { SymbolTreeSynchronizingAdapter } from '../symbol_tree_synchronizing_adapter.js';
import {
  defaultSelectionFilter,
  type SelectionFilterOptions,
} from '../tools/sch_selection_filter.js';
import { SCH_SELECTION_TOOL } from '../tools/sch_selection_tool.js';
import type { IMPORT_GFX_RESULT } from '../import_gfx/dialog_import_gfx_sch.js';
import { symSelectionFilterShown } from '../widgets/panel_sch_selection_filter.js';
import { SelectionFilterPanel } from '../widgets/panel_sch_selection_filter_ui.js';
import { LiveSchPropertiesPanel } from '../widgets/sch_properties_panel_ui.js';
import { symbolEditorMenus } from './menubar_symbol_editor.js';
import { DEMORGAN_ALT, DEMORGAN_STD, SYMBOL_EDIT_FRAME } from './symbol_edit_frame.js';
import type { SYMBOL_EDIT_FRAME_APP } from './symbol_edit_frame_app.js';
import { type SAVE_SYMBOL_AS_DIALOG, SYM_FRAME_NAME, symFrameTitle } from './symbol_editor.js';
import {
  symbolEditorKifaceSettingsAreCurrent,
  updateSymbolEditorSettings,
} from './symbol_editor_settings.js';
import { SaveSymbolAsDialog } from './symbol_editor_ui.js';
import { applyToggle, crosshairToggleId, persistSymbolToggle } from './toggles.js';
import {
  actionForId,
  LISTBOX_WIDTH,
  SYM_CONTROL,
  SYM_DEFAULT_TOOLBARS,
  SYM_LEFT_TOOLBAR,
  SYM_RIGHT_TOOLBAR,
  SYM_TOP_TOOLBAR,
  symbolEditorCheckedIds,
  symbolEditorDisabledIds,
  symbolEditorIdChecked,
  symbolEditorIdEnabled,
} from './toolbars_symbol_editor.js';
import '@ziroeda/common/widgets/shell.css';

export interface SymbolEditorFile {
  name: string;
  text: string;
}

/** `.MinSize( FromDIP( 250 ), … )` for the Libraries pane (symbol_edit_frame.cpp). [data] */
const LIBRARY_TREE_WIDTH = 250;

/** `dlg.SetCustomizeHook( hook )`: the hook's own controls, by the hook it is. */
function customizeHookControls(aHook: wxFileDialogCustomizeHook): JSX.Element | undefined {
  if (aHook instanceof SYMBOL_LIBRARY_SAVE_AS_FILEDLG_HOOK)
    return <SymbolLibrarySaveAsControls hook={aHook} />;

  if ((aHook as Partial<FILEDLG_HOOK_NEW_LIBRARY>).kind === 'new_library')
    return <FileDlgHookNewLibraryControls hook={aHook as FILEDLG_HOOK_NEW_LIBRARY} />;

  return undefined;
}

/**
 * The toggles the live actions change in the frame but the browser has to write itself: the
 * units, and the electrical types, a render setting - both of which upstream's SaveSettings
 * writes on close, `m_settings->m_ShowPinElectricalType = GetRenderSettings()->...`. The grid
 * pair and the crosshairs are not here: COMMON_TOOLS writes them into the settings object and the
 * frame's idle pass stores them, so persisting them here too would flip the grid pair straight
 * back. The hidden pins / fields and alternate-pin icons write themselves.
 */
const WINDOW_PERSISTED_TOGGLES: ReadonlySet<string> = new Set([
  'showElectricalTypes',
  'unitsMm',
  'unitsInches',
  'unitsMils',
]);

/** The panes are the window's (wxAUI); every other left-toolbar id is an action. */
const PANE_TOGGLES: ReadonlySet<string> = new Set(['showLibraryTree', 'showProperties']);

/** EDA_DRAW_FRAME's eight status fields, by index (`eda_draw_frame.cpp`). */
const STATUS_FIELDS = [
  'message',
  'zoom',
  'coords',
  'deltas',
  'grid',
  'units',
  'tool',
  'constraint',
];

/** A dialog the frame asked for: what draws it while it is up. */
interface MODAL {
  key: number;
  render: () => ReactNode;
}

/** A symbol handed over from the schematic (Edit with Symbol Editor), re-sent with a nonce. */
export interface SYMBOL_EDITOR_REQUEST {
  /** `LoadSymbolFromSchematic( symbol )`: the placement's own copy. */
  fromSchematic?: SCH_SYMBOL;
  /** `LoadSymbol( libId, unit, bodyStyle )`: the library part. */
  library?: { libId: string; unit: number; bodyStyle: number };
  nonce: number;
}

export function SymbolEditor({
  app,
  onExitToHome,
  projectName,
  initialProject,
  kiway,
  request,
  readOnlyNotice,
  onWriteProjectFiles,
  onOutputFile,
}: {
  /** What the program gives this window (`symbol_edit_frame_app.ts`). */
  app: SYMBOL_EDIT_FRAME_APP;
  onExitToHome: () => void;
  /** The open project's folder name: where its files are mounted. */
  projectName?: string;
  initialProject?: SymbolEditorFile[] | null;
  /** The program's KIWAY: the frame registers as FRAME_SCH_SYMBOL_EDITOR's player on it. */
  kiway?: KIWAY;
  /** Edit with Symbol Editor / Edit Library Symbol, from the schematic. */
  request?: SYMBOL_EDITOR_REQUEST | null;
  /**
   * The WX_INFOBAR strip above the canvas when the project cannot be written
   * (`SYMBOL_EDIT_FRAME::ShowInfoBarMessages`): the caller owns the project, so it owns the bar.
   */
  readOnlyNotice?: ReactNode;
  /** Write files into the open project: a `.kicad_sym` and the `sym-lib-table`. */
  onWriteProjectFiles?: ((files: { name: string; text: string }[]) => void) | undefined;
  /** A generated output (Export > Symbol as SVG): the program downloads it. */
  onOutputFile?: ((name: string, bytes: Uint8Array, mime: string) => void) | undefined;
}): JSX.Element {
  const projectRef = useRef(initialProject);
  projectRef.current = initialProject;
  const writeRef = useRef(onWriteProjectFiles);
  writeRef.current = onWriteProjectFiles;
  const outputRef = useRef(onOutputFile);
  outputRef.current = onOutputFile;
  const symCfg = app.useSymbolEditorSettings();
  const common = app.useCommonSettings();
  // `GetColorSettings()` follows the theme; a change re-reads it (UpdateColors).
  const theme = app.useSymbolEditorTheme();

  const symTopBar = app.useToolbarEntries('symbol_editor', 'TOP_MAIN', SYM_DEFAULT_TOOLBARS);
  const symLeftBar = app.useToolbarEntries('symbol_editor', 'LEFT', SYM_DEFAULT_TOOLBARS);
  const symRightBar = app.useToolbarEntries('symbol_editor', 'RIGHT', SYM_DEFAULT_TOOLBARS);

  /** Anything the frame changed: re-read it. */
  const [, repaint] = useReducer((n: number) => n + 1, 0);

  // ----- window state -----------------------------------------------------------
  const [session, setSession] = useState<ReadonlySet<string>>(
    () => new Set(['showLibraryTree', 'showProperties']),
  );
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const [panelWidth, setPanelWidth] = useState(LIBRARY_TREE_WIDTH);
  const [treeSel, setTreeSel] = useState<{ lib: string; name: string | null } | null>(null);
  const treeSelRef = useRef(treeSel);
  treeSelRef.current = treeSel;
  const [selectLibId, setSelectLibId] = useState('');
  const [unselectNonce, setUnselectNonce] = useState(0);
  const [expandLibId, setExpandLibId] = useState('');
  const [centerLibId, setCenterLibId] = useState('');
  const [aboutOpen, setAboutOpen] = useState(false);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [selFilter, setSelFilter] = useState<SelectionFilterOptions>(defaultSelectionFilter);
  const [selFilterClosed, setSelFilterClosed] = useState(false);
  /** The frame's WX_INFOBAR: what it shows, and its hyperlink buttons. */
  const [infoBar, setInfoBar] = useState<{
    message: string;
    icon: MessageDialogIcon;
    buttons: WX_INFOBAR_HYPERLINK[];
  } | null>(null);
  const [msgItems, setMsgItems] = useState<MsgPanelItem[]>([]);
  const [modals, setModals] = useState<MODAL[]>([]);
  const modalKey = useRef(0);
  const [unsaved, setUnsaved] = useState<{
    message: string;
    done: (r: UnsavedChangesResult) => void;
  } | null>(null);
  const [fpChooser, setFpChooser] = useState<{
    current: string;
    fpFilters: string[];
    pinCount: number;
    done: (aFpid: string | null) => void;
  } | null>(null);
  /** `wxFileDialog( this, ... )`, until it closes; `save` for wxFD_SAVE. */
  const [fileDialogRequest, setFileDialogRequest] = useState<{
    title: string;
    defaultDir: string;
    filters: readonly ChooserFilter[];
    save?: { defaultFile: string; hook?: wxFileDialogCustomizeHook };
    resolve: (aPath: string | null) => void;
  } | null>(null);
  const [treeRevision, bumpTree] = useReducer((n: number) => n + 1, 0);
  /** The hosted libraries' symbol names, from the index, until a library is read. */
  const hostedIndex = useRef(new Map<string, { symbols: string[]; descr: string }>());

  const { ask: askKiDialog, node: kiDialogNode } = useKiDialog();
  const askKiDialogRef = useRef(askKiDialog);
  askKiDialogRef.current = askKiDialog;

  /** Put a dialog up; its result settles the frame's ShowModalDialog. */
  const pushModal = useCallback(
    (aRender: (aClose: (aResult: number) => void) => ReactNode): Promise<number> =>
      new Promise<number>((resolve) => {
        const key = ++modalKey.current;
        const close = (aResult: number): void => {
          setModals((m) => m.filter((x) => x.key !== key));
          resolve(aResult);
          repaint();
        };
        setModals((m) => [...m, { key, render: () => aRender(close) }]);
      }),
    [],
  );

  // ----- the frame ---------------------------------------------------------------
  const frameRef = useRef<SYMBOL_EDIT_FRAME | null>(null);
  const unitsOf = (): StatusUnits => {
    const u = frameRef.current?.GetUserUnits();
    return u === 'in' || u === 'mils' || u === 'mm' ? u : 'mils';
  };

  /** The footprint chooser and document opener the grid cell editors use. */
  const hostRef = useRef<GRID_TEXT_BUTTON_HOST | null>(null);
  hostRef.current = {
    ChooseFootprint: (aPreselect, aNetlist) =>
      new Promise((resolve) => {
        const [pinLine = '', filterLine = ''] = aNetlist.split('\r');
        const pinNames = new Set(
          pinLine === '' ? [] : pinLine.split('\t').map((pin) => pin.split(' ')[0]!),
        );
        setFpChooser({
          current: aPreselect,
          fpFilters: filterLine === '' ? [] : filterLine.split(' '),
          pinCount: pinNames.size,
          done: resolve,
        });
      }),
    OpenFile: (aTitle, aDefaultDir, aWildcard) =>
      frameRef.current!.ShowFileDialog(
        aTitle,
        aDefaultDir,
        '',
        aWildcard,
        wxFD_OPEN | wxFD_FILE_MUST_EXIST,
      ),
    OpenDocument: (aUrl) =>
      GetAssociatedDocument(aUrl, (aToken) => frameRef.current!.Prj().TextVarResolver(aToken)),
  };
  const host: GRID_TEXT_BUTTON_HOST = {
    ChooseFootprint: (a, b) => hostRef.current!.ChooseFootprint(a, b),
    OpenFile: (a, b, c) => hostRef.current!.OpenFile(a, b, c),
    OpenDocument: (a) => hostRef.current!.OpenDocument(a),
  };

  /**
   * `ShowModalDialog( name, items, arg )`: each dialog the frame and its tools name, by its C++
   * class, drawn over the window until it closes.
   */
  const showModal = (
    aDialog: string,
    aItems: readonly unknown[],
    aArg?: unknown,
  ): Promise<number> => {
    const frame = frameRef.current!;
    const units = unitsOf();

    switch (aDialog) {
      case 'wxMessageBox':
      case 'KICAD_MESSAGE_DIALOG':
        return ShowKicadMessageDialog(aArg as KICAD_MESSAGE_DIALOG_ARG);

      case 'HTML_MESSAGE_BOX': {
        const { caption, html } = aArg as { caption: string; html: string };
        return pushModal((close) => (
          <HtmlMessageBox caption={caption} html={html} onClose={() => close(wxID_OK)} />
        ));
      }

      case 'DIALOG_LIB_NEW_SYMBOL':
        return pushModal((close) => (
          <DialogLibNewSymbol
            frame={frame.GetUnitsProvider()}
            arg={aArg as DIALOG_LIB_NEW_SYMBOL_ARG}
            units={units}
            onClose={close}
          />
        ));

      case 'DIALOG_PIN_PROPERTIES': {
        const { focusPinNumber } = (aArg as { focusPinNumber?: boolean } | undefined) ?? {};
        return pushModal((close) => (
          <DialogPinProperties
            frame={frame}
            pin={aItems[0] as SCH_PIN}
            focusPinNumber={!!focusPinNumber}
            units={units}
            onClose={close}
          />
        ));
      }

      case 'DIALOG_LIB_SYMBOL_PROPERTIES': {
        const dlg = new DIALOG_LIB_SYMBOL_PROPERTIES(frame, aItems[0] as LIB_SYMBOL, host);
        return pushModal((close) => (
          <DialogLibSymbolProperties dlg={dlg} units={units} onClose={close} />
        ));
      }

      case 'DIALOG_LIB_EDIT_PIN_TABLE': {
        const [symbol, ...pins] = aItems as [LIB_SYMBOL, ...SCH_PIN[]];
        const dlg = new DIALOG_LIB_EDIT_PIN_TABLE(frame, symbol, pins);
        return pushModal((close) => (
          <DialogLibEditPinTable
            dlg={dlg}
            onClose={close}
            askUnsaved={(aMessage) =>
              new Promise((resolve) => setUnsaved({ message: aMessage, done: resolve }))
            }
            showErrors={(aMessage) =>
              ShowKicadMessageDialog({ message: aMessage, caption: 'Errors', style: 0 }).then(
                (r) => r === wxID_OK,
              )
            }
            showMenu={async () => 0}
          />
        ));
      }

      case 'DIALOG_LIB_FIELDS_TABLE': {
        const { scope } = aArg as { scope: SCOPE };
        const dialog = new DIALOG_LIB_FIELDS_TABLE(frame, scope, {
          textEntry: async (aMessage, _aCaption, aValue) => window.prompt(aMessage, aValue),
          handleUnsavedChanges: (aMessage, aSave) =>
            new Promise((resolve) =>
              setUnsaved({
                message: aMessage,
                done: (r) => resolve(r === 'save' ? aSave() : r === 'discard'),
              }),
            ),
          messageBox: (aMessage) =>
            void ShowKicadMessageDialog({ message: aMessage, caption: 'Message', style: 0 }),
          newSymbol: async () => null,
          host,
        });
        dialog.TransferDataToWindow();
        return pushModal((close) => <DialogLibFieldsTable dialog={dialog} onClose={close} />);
      }

      case 'DIALOG_UPDATE_SYMBOL_FIELDS': {
        const dialog = new DIALOG_UPDATE_SYMBOL_FIELDS(frame, aItems[0] as LIB_SYMBOL);
        return pushModal((close) => <DialogUpdateSymbolFields dialog={dialog} onClose={close} />);
      }

      case 'DIALOG_IMPORT_SYMBOL_SELECT':
        return pushModal((close) => (
          <DialogImportSymbolSelect
            frame={frame}
            arg={aArg as DIALOG_IMPORT_SYMBOL_SELECT_ARG}
            onClose={close}
          />
        ));

      case 'SAVE_SYMBOL_AS_DIALOG':
        return pushModal((close) => (
          <SaveSymbolAsDialog dlg={aArg as SAVE_SYMBOL_AS_DIALOG} onClose={close} />
        ));

      case 'EDA_LIST_DIALOG':
        return pushModal((close) => (
          <SelectLibraryDialog arg={aArg as EDA_LIST_DIALOG_ARG} onClose={close} />
        ));

      case 'DIALOG_SHAPE_PROPERTIES': {
        const dlg = new DIALOG_SHAPE_PROPERTIES(frame, aItems[0] as SCH_SHAPE);
        const shown = dlg.TransferDataToWindow();
        return pushModal((close) => (
          <DialogShapeProperties
            dlg={dlg}
            initial={shown}
            units={units}
            onOk={(values) => {
              dlg.TransferDataFromWindow(values);
              close(wxID_OK);
            }}
            onCancel={() => close(wxID_CANCEL)}
          />
        ));
      }

      case 'DIALOG_TEXT_PROPERTIES': {
        const dlg = new DIALOG_TEXT_PROPERTIES(frame, aItems[0] as SCH_TEXT | SCH_TEXTBOX);
        const shown = dlg.TransferDataToWindow();
        return pushModal((close) => (
          <DialogTextProperties
            dlg={dlg}
            units={units}
            initial={shown}
            onOk={(values) => {
              if (!dlg.TransferDataFromWindow(values)) return;
              close(wxID_OK);
            }}
            onCancel={() => close(wxID_CANCEL)}
          />
        ));
      }

      case 'DIALOG_FIELD_PROPERTIES': {
        const { caption, commit } = aArg as { caption: string; commit: SCH_COMMIT };
        const field = aItems[0] as SCH_FIELD;
        const dlg = new DIALOG_FIELD_PROPERTIES(frame, caption, field, host);
        const shown = dlg.TransferDataToWindow();
        return pushModal((close) => (
          <DialogFieldProperties
            dlg={dlg}
            initial={shown}
            units={units}
            onOk={(values) => {
              if (!dlg.TransferDataFromWindow(values)) return;
              // `commit.Modify( aField, GetScreen() ); dlg.UpdateField( aField )`, on the commit
              // the tool pushes.
              commit.Modify(field, frame.GetScreen());
              dlg.UpdateField(field);
              close(wxID_OK);
            }}
            onCancel={() => close(wxID_CANCEL)}
          />
        ));
      }

      case 'DIALOG_IMPORT_GFX_SCH': {
        const result = aArg as IMPORT_GFX_RESULT;
        const symbol = frame.GetCurSymbol()!;
        return pushModal((close) => (
          <DialogImportGfx
            importer={() => new GRAPHICS_IMPORTER_LIB_SYMBOL(symbol, frame.GetUnit())}
            onCancel={() => close(wxID_CANCEL)}
            onOk={(items, interactive) => {
              result.items = items;
              result.interactive = interactive;
              close(wxID_OK);
            }}
          />
        ));
      }

      default:
        console.warn(`${aDialog} is not available here yet.`);
        return Promise.resolve(wxID_CANCEL);
    }
  };
  const showModalRef = useRef(showModal);
  showModalRef.current = showModal;

  const [frame] = useState(
    () =>
      new SYMBOL_EDIT_FRAME({
        showLibraryTreePane: (aShow) =>
          setSession((s) => {
            const next = new Set(s);
            if (aShow) next.add('showLibraryTree');
            else next.delete('showLibraryTree');
            return next;
          }),
        fileDialog: (aTitle, aDefaultDir, aDefaultFile, aWildcard, aStyle, aCustomizeHook) =>
          new Promise((resolve) =>
            setFileDialogRequest({
              title: aTitle,
              defaultDir: aDefaultDir,
              filters: Array.isArray(aWildcard) ? aWildcard : [aWildcard as ChooserFilter],
              ...(aStyle & wxFD_SAVE
                ? {
                    save: {
                      defaultFile: aDefaultFile,
                      ...(aCustomizeHook ? { hook: aCustomizeHook } : {}),
                    },
                  }
                : {}),
              resolve,
            }),
          ),
        unsavedChangesDialog: (aMessage) =>
          new Promise((resolve) => setUnsaved({ message: aMessage, done: resolve })),
        syncLibraries: () => bumpTree(),
        refreshLibTree: () => repaint(),
        toolStackChanged: () => repaint(),
        getSelectedLibIds: () => {
          const sel = treeSelRef.current;
          return sel ? [new LIB_ID(sel.lib, sel.name ?? '')] : [];
        },
        reCreateMenuBar: () => repaint(),
        recreateToolbars: () => repaint(),
        isLibraryTreeShown: () => sessionRef.current.has('showLibraryTree'),
        isPropertiesShown: () => sessionRef.current.has('showProperties'),
        toggleLibraryTree: () => setSession((s) => applyToggle(s, 'showLibraryTree')),
        focusOnLibId: (aLibId) => {
          setSelectLibId(aLibId.Format());
          setTreeSel({ lib: aLibId.GetLibNickname(), name: aLibId.GetLibItemName() || null });
        },
        libTreeSelectLibId: (aLibId) => {
          setSelectLibId(aLibId.Format());
          setTreeSel({ lib: aLibId.GetLibNickname(), name: aLibId.GetLibItemName() || null });
        },
        libTreeExpandLibId: (aLibId) => setExpandLibId(aLibId.Format()),
        libTreeCenterLibId: (aLibId) => setCenterLibId(aLibId.Format()),
        libTreeUnselect: () => {
          setSelectLibId('');
          setUnselectNonce((n) => n + 1);
          setTreeSel(null);
        },
        rebuildSymbolUnitAndBodyStyleLists: () => repaint(),
        updateTitle: () => repaint(),
        showModal: (aDialog, aItems, aArg) => showModalRef.current(aDialog, aItems, aArg),
        askKiDialog: (aRequest) => askKiDialogRef.current(aRequest),
        getTreeLibId: () => {
          const sel = treeSelRef.current;
          return sel ? new LIB_ID(sel.lib, sel.name ?? '') : null;
        },
        updateLibraryTree: () => bumpTree(),
        toggleProperties: () => setSession((s) => applyToggle(s, 'showProperties')),
        writeOutputFile: (aPath, aBytes, aMime) => outputRef.current?.(aPath, aBytes, aMime),
      }),
  );
  frameRef.current = frame;

  // `WX_INFOBAR`: the frame and its tools post into it (SetCurSymbol's notices, ShowInfoBarMsg).
  useEffect(() => {
    let buttons: WX_INFOBAR_HYPERLINK[] = [];
    let timer: ReturnType<typeof setTimeout> | null = null;
    const clear = (): void => {
      if (timer) clearTimeout(timer);
      timer = null;
    };
    const show = (aMessage: string, aFlags: MessageDialogIcon = 'information'): void => {
      clear();
      setInfoBar({ message: aMessage, icon: aFlags, buttons: [...buttons] });
    };
    frame.SetInfoBar({
      IsLocked: () => false,
      AddButton: (aButton) => {
        buttons.push(aButton);
      },
      RemoveAllButtons: () => {
        buttons = [];
      },
      ShowMessage: show,
      ShowMessageFor: (aMessage, aTime, aFlags) => {
        show(aMessage, aFlags);
        timer = setTimeout(() => setInfoBar(null), aTime);
      },
      Dismiss: () => {
        clear();
        setInfoBar(null);
      },
    });
    return () => {
      clear();
      frame.SetInfoBar(null);
    };
  }, [frame]);

  // The frame's status bar, message panel and toolbar selection.
  const statusRefs = useRef<Record<string, HTMLSpanElement | null>>({});
  useEffect(() => {
    frame.SetStatusTextSink((aText, aField) => {
      const name = STATUS_FIELDS[aField];
      const el = name ? statusRefs.current[name] : null;
      if (el) el.textContent = aText;
    });
    frame.SetMsgPanelSink((aItems) =>
      setMsgItems(aItems.map((i) => ({ upper: i.GetUpperText(), lower: i.GetLowerText() }))),
    );
    return () => {
      frame.SetStatusTextSink(null);
      frame.SetMsgPanelSink(null);
    };
  }, [frame]);

  // ----- the project and the libraries -------------------------------------------
  // `ProjectChanged`'s trigger: another project, or its library table moved - the files' names
  // and the table's rows, never the text an autosave rewrites, which would re-read every library.
  const projectKey = useMemo(() => {
    const files = initialProject ?? [];
    const table = files.find((f) => f.name === projectSymLibTablePath(files))?.text ?? '';
    return `${files
      .map((f) => f.name)
      .sort()
      .join('\n')}\u0000${table}`;
  }, [initialProject]);

  /**
   * The project's files at its folder, with their writes going back to the project, and the
   * project's sym-lib-table as the program's project table (SETTINGS_MANAGER::LoadProject and
   * PGM_BASE's table load upstream).
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: the key is the project's content; the files are read through projectRef
  useEffect(() => {
    const files = projectRef.current ?? [];
    const name = projectName ?? '';
    const manager = Pgm().GetLibraryManager();
    let unmount: (() => void) | null = null;

    if (name !== '') {
      const enc = new TextEncoder();
      const dec = new TextDecoder();
      const fs = new MEMORY_FILESYSTEM();

      for (const f of files) fs.Write(f.name, enc.encode(f.text));

      fs.SetWriteListener((aRel, aData) =>
        writeRef.current?.([{ name: aRel, text: dec.decode(aData) }]),
      );
      unmount = wxMountFileSystem(`/${name}`, fs);

      const pro = files.find((f) => /\.kicad_pro$/i.test(f.name));
      const settings = Pgm().GetSettingsManager();
      const proPath = `/${name}/${pro?.name ?? `${name}.kicad_pro`}`;

      if (settings.Prj().GetProjectFullName() !== proPath) {
        let json = null;
        try {
          json = pro ? JSON.parse(pro.text) : null;
        } catch {
          json = null;
        }
        settings.LoadProject(proPath, json);
      }
    }

    const tablePath = projectSymLibTablePath(files);
    const tableFile = files.find((f) => f.name === tablePath);

    manager.SetTable(
      LIBRARY_TABLE_TYPE.SYMBOL,
      LIBRARY_TABLE_SCOPE.PROJECT,
      tableFile && name !== ''
        ? LIBRARY_TABLE.FromFile(
            `/${name}/${tablePath}`,
            tableFile.text,
            LIBRARY_TABLE_SCOPE.PROJECT,
            LIBRARY_TABLE_TYPE.SYMBOL,
          )
        : LIBRARY_TABLE.Empty(LIBRARY_TABLE_SCOPE.PROJECT, LIBRARY_TABLE_TYPE.SYMBOL),
    );

    // `SYMBOL_EDIT_FRAME::ProjectChanged` -> SyncLibraries: each project row read.
    const adapter = SymbolLibAdapter(frame.Prj());

    for (const row of manager.Rows(LIBRARY_TABLE_TYPE.SYMBOL)) {
      if (row.Scope() === LIBRARY_TABLE_SCOPE.PROJECT) adapter.LoadOne(row.Nickname());
    }

    frame.SyncLibraries(false);

    return () => unmount?.();
  }, [projectKey, projectName, frame]);

  // `KIWAY::Player()` stores the frame as FRAME_SCH_SYMBOL_EDITOR's player. After the project's
  // table is installed, above: Player() hands back a frame that is built, and the mail KIWAY held
  // for it while it mounted (MAIL_LIB_EDIT from the project manager) is delivered here.
  useEffect(() => {
    if (!kiway) return;
    frame.SetKiway(kiway);
    kiway.SetPlayerFrame(FRAME_T.FRAME_SCH_SYMBOL_EDITOR, frame);
    return () => {
      kiway.PlayerDidClose(FRAME_T.FRAME_SCH_SYMBOL_EDITOR, frame);
      frame.SetKiway(null);
    };
  }, [kiway, frame]);

  // The hosted index, once it is in - loading it installs the global tables (loadIndex).
  // biome-ignore lint/correctness/useExhaustiveDependencies: the index loader is the trigger
  useEffect(() => {
    let cancelled = false;

    app
      .loadIndex()
      .then((idx) => {
        if (cancelled) return;

        for (const lib of idx)
          hostedIndex.current.set(lib.name, { symbols: lib.symbols, descr: lib.descr ?? '' });

        frame.SyncLibraries(false);
      })
      .catch(() => bumpTree());

    return () => {
      cancelled = true;
    };
  }, [app.loadIndex]);

  /**
   * A hosted library is a folder of per-symbol files fetched on use: the file of \a aName
   * fetched, then the library read again.
   */
  const ensureSymbolFile = useCallback(
    async (aLib: string, aName: string): Promise<void> => {
      if (!hostedIndex.current.has(aLib)) return;
      if (frame.GetLibManager().SymbolExists(aName, aLib)) return;

      await fetchHostedSymbolFile(new LIB_ID(aLib, aName));
      SymbolLibAdapter(frame.Prj()).LoadOne(aLib);
    },
    [frame],
  );

  /** `SYMBOL_TREE_PANE::onSymbolSelected` -> `LoadSymbol( libId, unit, bodyStyle )`. */
  const loadSymbol = useCallback(
    async (aLib: string, aName: string, aUnit = 1, aBodyStyle = 1): Promise<void> => {
      // The hosted file's fetch is the library read upstream's SymbolLibAdapter does inside
      // LoadSymbolFromCurrentLib's try, so its failure is that catch's report (:238-246).
      try {
        await ensureSymbolFile(aLib, aName);
      } catch (e) {
        DisplayErrorMessage(
          `Error loading symbol ${aName} from library '${aLib}'.`,
          e instanceof Error ? e.message : String(e),
        );
        return;
      }

      // LoadSymbol -> SetCurSymbol( symbol, true ): the zoom and the tree selection are the frame's.
      await frame.LoadSymbol(new LIB_ID(aLib, aName), aUnit, aBodyStyle);
      repaint();
    },
    [frame, ensureSymbolFile],
  );

  /**
   * `OnDropFiles`, with what a page is handed: a dropped file's bytes and name, never a path. A file
   * the frame takes is put in the account's Symbols folder first - the folder a library in the
   * account lives in - and the frame adds it from there. One whose name is already there is
   * refused rather than written over a library in use.
   */
  const dropFiles = useCallback(
    async (aFiles: readonly File[]): Promise<void> => {
      const paths: string[] = [];

      for (const file of aFiles) {
        if (!frame.IsDropAccepted(file.name)) continue;

        const path = `${app.userSymbolsPath()}/${file.name}`;

        // A library of that name already in the tables: the frame says so (DdAddLibrary), and
        // nothing is copied for a library it will not add.
        if (SymbolLibAdapter(frame.Prj()).HasLibrary(file.name.replace(/\.[^.]*$/, ''))) {
          paths.push(path);
          continue;
        }

        if (wxFileExists(path)) {
          DisplayErrorMessage(`Library '${file.name.replace(/\.[^.]*$/, '')}' already exists.`);
          continue;
        }

        if (!wxWriteFileSync(path, new Uint8Array(await file.arrayBuffer()))) {
          DisplayErrorMessage('Could not open the library file.');
          continue;
        }

        paths.push(path);
      }

      frame.OnDropFiles(paths);
    },
    [frame, app],
  );

  // ----- the canvas ----------------------------------------------------------------
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [fontImage, setFontImage] = useState<ImageBitmap | null>(null);
  const [panel, setPanel] = useState<SCH_DRAW_PANEL | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadBitmapFontImage().then(
      (img) => {
        if (!cancelled) setFontImage(img);
      },
      (err: unknown) => console.warn(`Could not use OpenGL: ${(err as Error).message}`),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas || !fontImage) return;

    const built = createSchDrawPanel(frame, canvas, fontImage);

    if (!built) return;

    frame.ActivateGalCanvas();
    frame.RebuildView();
    setPanel(built);
    repaint();

    return () => {
      built.Destroy();
      frame.SetCanvas(null);
      setPanel(null);
    };
  }, [frame, fontImage]);

  // Edit with Symbol Editor / Edit Library Symbol, from the schematic. Upstream's frame has its
  // canvas and tools from the constructor on, before any mail reaches it; here they come with the
  // font atlas, so a request waits for the panel.
  const requestNonce = useRef<number | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the request (its nonce) and the panel are the triggers
  useEffect(() => {
    if (!panel || !request || requestNonce.current === request.nonce) return;

    requestNonce.current = request.nonce;

    if (request.fromSchematic) {
      frame.LoadSymbolFromSchematic(request.fromSchematic);
      frame.GetToolManager()?.RunAction(ACTIONS.zoomFitScreen);
      repaint();
    } else if (request.library) {
      const id = new LIB_ID();
      id.Parse(request.library.libId);
      void loadSymbol(
        id.GetLibNickname(),
        id.GetLibItemName(),
        request.library.unit,
        request.library.bodyStyle,
      ).then(() => {
        if (!frame.IsLibraryTreeShown()) frame.ToggleLibraryTree();
      });
    }
  }, [request, panel]);

  // `CommonSettingsChanged`: the theme and the settings' display options into the view - when they
  // changed, and not when the slice moved because the frame's own idle pass stored what a tool
  // wrote (the grid), which upstream never answers with a rebuild that resets the tools.
  const appliedTheme = useRef<unknown>(null);
  const appliedPanel = useRef<unknown>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the theme and the settings are the triggers; the panel is read live
  useEffect(() => {
    if (!panel || frame.GetCanvas() !== panel) return;

    if (
      appliedPanel.current === panel &&
      appliedTheme.current === theme &&
      symbolEditorKifaceSettingsAreCurrent()
    )
      return;

    // The constructor's `LoadSettings( m_settings )`, once per canvas; every change after it is
    // `CommonSettingsChanged`, as the settings manager raises it on each open frame.
    if (appliedPanel.current !== panel) {
      const cfg = frame.config();
      if (cfg) frame.LoadSettings(cfg);
    }

    appliedPanel.current = panel;
    appliedTheme.current = theme;

    frame.CommonSettingsChanged();
  }, [panel, theme, symCfg]);

  // The selection filter pane drives SCH_SELECTION_TOOL's filter.
  useEffect(() => {
    const filter = frame.GetToolManager()?.GetTool(SCH_SELECTION_TOOL)?.GetFilter();
    if (filter && panel) Object.assign(filter, selFilter);
  }, [frame, selFilter, panel]);

  /** `TOOL_MANAGER::RunAction`, as a menu row or a toolbar button runs it. */
  const runAction = useCallback(
    (aAction: TOOL_ACTION) => {
      frame.GetToolManager()?.RunAction(aAction);
      // wxEVT_IDLE follows a menu command as it follows a canvas event.
      frame.OnIdle();
      repaint();
    },
    [frame],
  );

  // ----- the Libraries pane (LIB_TREE) --------------------------------------------
  const curLibIdRef = useRef('');
  curLibIdRef.current = frame.GetCurSymbol()?.GetLibId().Format() ?? '';

  const treeAdapter = useMemo(
    () =>
      new SymbolTreeSynchronizingAdapter({
        isLibraryModified: (lib) => frame.GetLibManager().IsLibraryModified(lib),
        isSymbolModified: (lib, sym) => frame.GetLibManager().IsSymbolModified(sym, lib),
        isLibraryLoaded: (lib) => frame.GetLibManager().LibraryExists(lib),
        currentLibId: () => curLibIdRef.current,
      }),
    [frame],
  );

  const [treeNonce, setTreeNonce] = useState(0);
  /** `SYMBOL_TREE_SYNCHRONIZING_ADAPTER::Sync` over the library manager. */
  // biome-ignore lint/correctness/useExhaustiveDependencies: treeRevision is the Sync trigger
  useEffect(() => {
    const mgr = frame.GetLibManager();
    const rows = Pgm().GetLibraryManager().Rows(LIBRARY_TABLE_TYPE.SYMBOL);

    treeAdapter.Sync({
      libraryNames: () => mgr.GetLibraryNames(),
      row: (lib) => rows.find((r) => r.Nickname() === lib),
      hosted: (lib) => hostedIndex.current.get(lib),
      symbolNames: (lib) => {
        const loaded: string[] = [];
        mgr.GetSymbolNames(lib, loaded);
        return loaded;
      },
      symbol: (lib, name) => (mgr.SymbolExists(name, lib) ? mgr.GetSymbol(name, lib) : null),
    });
    setTreeNonce((n) => n + 1);
  }, [treeRevision, treeAdapter, frame]);

  /** `EVT_LIBITEM_SELECTED`: the tree's selection, GetTargetLibId's first source. */
  const onTreeSelect = useCallback((node: LibTreeNode | null) => {
    if (!node) setTreeSel(null);
    else if (node.type === LibTreeNodeType.LIBRARY) setTreeSel({ lib: node.name, name: null });
    else setTreeSel({ lib: node.libNickname, name: node.libItemName });
  }, []);

  /** `EVT_LIBITEM_CHOSEN`: a double-click or Enter loads the symbol. */
  const onTreeChoose = useCallback(
    (node: LibTreeNode) => {
      if (node.type === LibTreeNodeType.LIBRARY) return;
      void loadSymbol(node.libNickname, node.libItemName);
    },
    [loadSymbol],
  );

  const startResize = (e: React.MouseEvent): void => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = panelWidth;
    const onMove = (ev: MouseEvent): void =>
      setPanelWidth(Math.min(600, Math.max(160, startW + ev.clientX - startX)));
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
  };

  // ----- toolbars and menus ----------------------------------------------------------
  // `cond.CurrentTool( aAction )` is `IsCurrentTool( aAction )`: the button of the action on top of
  // the tool stack, on whichever bar it sits; the selection tool when the stack is empty.
  const activeTool =
    [...symTopBar, ...symRightBar]
      .map((e) => (typeof e === 'object' && 'id' in e ? e.id : null))
      .find((id): id is string => {
        const action = id ? actionForId(id) : null;
        return !!action && frame.IsCurrentTool(action);
      }) ?? 'select';
  const symbol = frame.GetCurSymbol();
  // `HandleUpdateUIEvent` for every button on the two bars that draw a lit state: the frame's CHECK
  // conditions, asked on each render as wx asks them on each idle - the settings-backed toggles,
  // the units, the panes and synced pins alike. The crosshair group is the exception: upstream
  // gives its members no CHECK condition, so the group shows the mode last picked, which here is
  // the stored one.
  const toggles = symbolEditorCheckedIds(frame, [...symTopBar, ...symLeftBar]);
  toggles.add(crosshairToggleId(symCfg.window.cursor.crosshair));

  /**
   * A left-toolbar button or a View-menu check: the panes are the window's, everything else is
   * its action, and the toggles the frame cannot write it persists here.
   */
  const onToggle = useCallback(
    (id: string) => {
      if (PANE_TOGGLES.has(id)) {
        setSession((s) => applyToggle(s, id));
        // `updateSelectionFilterVisbility`: showing a pane brings the filter back.
        setSelFilterClosed(false);
        return;
      }

      if (id === 'gridProperties') {
        setPrefsOpen(true);
        return;
      }

      const action = actionForId(id);
      if (action) runAction(action);

      if (WINDOW_PERSISTED_TOGGLES.has(id))
        updateSymbolEditorSettings((cfg) => {
          persistSymbolToggle(cfg, id);
        });
    },
    [runAction],
  );

  /** A top-toolbar or right-toolbar button, or a menu row: its action or the window's own. */
  const onAction = useCallback(
    (id: string) => {
      switch (id) {
        case 'openPreferences':
          setPrefsOpen(true);
          return;
        case 'showSymbolLibTable':
          // `COMMON_CONTROL::ShowLibraryTable`: the program puts the dialog up.
          kiway?.CreateKiWindow(FRAME_T.DIALOG_SCH_LIBRARY_TABLE);
          return;
        case 'close':
          onExitToHome();
          return;
      }

      const action = actionForId(id);
      if (action) runAction(action);
    },
    [kiway, onExitToHome, runAction],
  );

  const libManager = frame.GetLibManager();

  // `wxEVT_UPDATE_UI` for each row and button: the frame's setupUIConditions decides.
  const isEnabled = (aId: string): boolean => symbolEditorIdEnabled(frame, aId);
  const disabledIds = (aEntries: readonly ToolEntry[]): Set<string> =>
    symbolEditorDisabledIds(frame, aEntries);

  const topDisabled = disabledIds(SYM_TOP_TOOLBAR);
  const leftDisabled = disabledIds(SYM_LEFT_TOOLBAR);
  const rightDisabled = disabledIds(SYM_RIGHT_TOOLBAR);

  const menus: Menu[] = symbolEditorMenus(
    {
      action: onAction,
      tool: onAction,
      toggle: onToggle,
      language: common.system.language,
      isSymbolFromSchematic: frame.IsSymbolFromSchematic(),
      onSelectLanguage: () => {},
      showHotkeys: showHotkeyList,
      showAbout: () => setAboutOpen(true),
    },
    (aId) => symbolEditorIdChecked(frame, aId),
    isEnabled,
  );
  const menusRef = useRef<Menu[]>(menus);
  menusRef.current = menus;

  // The menu accelerators; the canvas's own keys go to the dispatcher.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((document.body.dataset.activeView ?? 'symbols') !== 'symbols') return;
      if (e.defaultPrevented && !wasBrowserSuppressed(e)) return;
      const target = e.target as (FocusLike & { readOnly?: boolean; disabled?: boolean }) | null;
      if (focusBlocksHotkey(target, e)) return;
      if (dispatchMenuHotkey(menusRef.current, e, { target })) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ----- title -----------------------------------------------------------------------
  const modified = frame.GetScreen()?.IsContentModified() === true;
  const symTitle = symFrameTitle(
    {
      hasSymbol: symbol !== null,
      fromSchematic: frame.IsSymbolFromSchematic(),
      reference: frame.m_reference,
      libId: symbol?.GetLibId().Format() ?? '',
      readOnlyLibrary:
        !!symbol &&
        !frame.IsSymbolFromSchematic() &&
        libManager.IsLibraryReadOnly(symbol.GetLibId().GetLibNickname()),
      modified,
    },
    (s) => s,
  );
  const title = `${symTitle.modified}${symTitle.document}`;
  useDocumentTitle('symbols', formatTitle(SYM_FRAME_NAME, symTitle.document, modified));
  useUnsavedGuard(frame.HasLibModifications());

  // ----- the unit and body style -----------------------------------------------------
  const unitCount = symbol?.GetUnitCount() ?? 0;
  const multiBody = !!symbol?.IsMultiBodyStyle();

  const statusSpan = (name: string): JSX.Element => (
    <span
      ref={(el) => {
        statusRefs.current[name] = el;
      }}
    />
  );

  const units = unitsOf();
  const leftDockShown = session.has('showLibraryTree') || session.has('showProperties');

  return (
    <div
      className="ze-app"
      // `DragAcceptFiles( true )`: a file dragged from the desktop may be dropped on the frame.
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) e.preventDefault();
      }}
      onDrop={(e) => {
        if (e.dataTransfer.files.length === 0) return;

        e.preventDefault();
        void dropFiles([...e.dataTransfer.files]);
      }}
    >
      <MenuBar
        menus={menus}
        leftSlot={app.HomeLink({ onClick: onExitToHome })}
        title={<b>{title}</b>}
      />

      <Toolbar
        entries={symTopBar}
        orientation="horizontal"
        toggled={toggles}
        activeTool={activeTool}
        onActivate={onAction}
        disabledIds={topDisabled}
        controls={{
          /**
           * `RebuildSymbolUnitAndBodyStyleLists` (symbol_edit_frame.cpp:760-787): one empty row
           * for a single body style, else "Standard" / "Alternate".
           */
          [SYM_CONTROL.bodyStyleSelector]: (
            <Combo
              title="Select body style"
              style={{ width: LISTBOX_WIDTH }}
              disabled={!multiBody}
              value={String(frame.GetBodyStyle())}
              options={
                !symbol || !multiBody
                  ? [{ value: '1', label: '' }]
                  : (symbol.HasDeMorganBodyStyles()
                      ? [DEMORGAN_STD, DEMORGAN_ALT]
                      : symbol.GetBodyStyleNames()
                    ).map((label, i) => ({ value: String(i + 1), label }))
              }
              onChange={(v) => {
                frame.SetBodyStyle(Number(v));
                repaint();
              }}
            />
          ),
          /** The same function's first half (:737-758). */
          [SYM_CONTROL.unitSelector]: (
            <Combo
              title="Select unit to edit"
              style={{ width: LISTBOX_WIDTH }}
              disabled={unitCount < 2}
              value={String(frame.GetUnit())}
              options={
                unitCount < 2
                  ? [{ value: '1', label: '' }]
                  : Array.from({ length: unitCount }, (_, k) => ({
                      value: String(k + 1),
                      label: symbol!.GetUnitDisplayName(k + 1, true),
                    }))
              }
              onChange={(v) => {
                frame.SetUnit(Number(v));
                repaint();
              }}
            />
          ),
        }}
      />

      <div className="ze-body">
        {leftDockShown && (
          <>
            <div className="ze-leftdock" style={{ width: panelWidth, minWidth: panelWidth }}>
              {session.has('showLibraryTree') && (
                <div className="ze-panel grow">
                  <div className="ze-panel-header">Libraries</div>
                  {treeAdapter.tree.children.length === 0 &&
                    app.LibraryLoadingPanel({
                      kind: 'symbols',
                      fallback: <div className="ze-muted">No libraries</div>,
                      label: 'Loading symbol libraries...',
                    })}
                  {/* SYMBOL_TREE_PANE: one LIB_TREE, SEARCH | MULTISELECT, no DETAILS. */}
                  <LibTree
                    adapter={treeAdapter}
                    recentSearchesKey="symbols"
                    regenerateNonce={treeNonce}
                    selectLibId={selectLibId}
                    unselectNonce={unselectNonce}
                    expandLibId={expandLibId}
                    centerLibId={centerLibId}
                    onSelect={onTreeSelect}
                    onChoose={onTreeChoose}
                    hasExternalDetails
                  />
                </div>
              )}
              {session.has('showProperties') && (
                <div className="ze-panel">
                  <div className="ze-panel-header">
                    <span>Properties</span>
                    <button
                      type="button"
                      className="ze-pane-close"
                      onClick={() => onToggle('showProperties')}
                      title="Close"
                    >
                      ⊠
                    </button>
                  </div>
                  <div className="ze-panel-body">
                    {panel && <LiveSchPropertiesPanel frame={frame} units={units} />}
                  </div>
                </div>
              )}
              {!selFilterClosed &&
                symSelectionFilterShown({
                  libraryTree: session.has('showLibraryTree'),
                  properties: session.has('showProperties'),
                }) && (
                  <SelectionFilterPanel
                    frame="FRAME_SCH_SYMBOL_EDITOR"
                    filter={selFilter}
                    onChange={setSelFilter}
                    onClose={() => setSelFilterClosed(true)}
                  />
                )}
            </div>
            <div className="ze-splitter" onMouseDown={startResize} title="Drag to resize" />
          </>
        )}

        <Toolbar
          entries={symLeftBar}
          app="symbol_editor"
          orientation="vertical"
          side="left"
          toggled={toggles}
          onActivate={onToggle}
          disabledIds={leftDisabled}
        />

        {/* The info bar spans the canvas, docked `.Top().Layer( 1 )` beside the panes. */}
        <div
          style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}
        >
          {readOnlyNotice}
          {infoBar && (
            <Infobar
              message={infoBar.message}
              icon={infoBar.icon === 'information' ? 'information' : 'warning'}
              actions={infoBar.buttons.map((b) => ({ label: b.label, onAction: b.onClick }))}
              closable
            />
          )}
          <div className="ze-canvas-wrap" style={{ position: 'relative', flex: 1, minHeight: 0 }}>
            {/* SCH_DRAW_PANEL: it takes the canvas's events itself, through WX_VIEW_CONTROLS
                and the frame's TOOL_DISPATCHER. */}
            <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, outline: 'none' }} />
          </div>
        </div>

        <Toolbar
          entries={symRightBar}
          orientation="vertical"
          side="right"
          activeTool={activeTool}
          onActivate={onAction}
          disabledIds={rightDisabled}
        />
      </div>

      <MsgPanel items={msgItems} testId="sym-message-panel" />

      {/* EDA_DRAW_FRAME's eight panes, written by the frame through its sink. */}
      <KiStatusBar
        testIds={{ message: 'sym-status-msg', coords: 'sym-coords', tool: 'sym-tool-msg' }}
        fields={{
          message: statusSpan('message'),
          zoom: statusSpan('zoom'),
          coords: statusSpan('coords'),
          deltas: statusSpan('deltas'),
          grid: statusSpan('grid'),
          units: statusSpan('units'),
          tool: statusSpan('tool'),
          constraint: statusSpan('constraint'),
        }}
      />

      {modals.map((m) => (
        <div key={m.key}>{m.render()}</div>
      ))}

      {/* DIALOG_SCH_FIND, modeless: SCH_BASE_FRAME::ShowFindReplaceDialog builds it. */}
      <SchFindDialogHost frame={frame} frameType="FRAME_SCH_SYMBOL_EDITOR" />

      {/* The symbols kind is PATHS::GetDefaultUserSymbolsPath()'s folder, where a library goes. */}
      {fileDialogRequest?.save && (
        // wxFD_SAVE: a library to write, in the account's Symbols folder unless the frame names one.
        <WxSaveFileDialog
          title={fileDialogRequest.title}
          initialName={fileDialogRequest.save.defaultFile}
          filters={fileDialogRequest.filters}
          {...(fileDialogRequest.defaultDir
            ? { initialPath: fileDialogRequest.defaultDir }
            : { initialPlace: 'symbols' })}
          kind="symbols"
          projectDir={projectName ? `/${projectName}` : null}
          {...(fileDialogRequest.save.hook
            ? { extra: customizeHookControls(fileDialogRequest.save.hook) }
            : {})}
          onDone={(path) => {
            setFileDialogRequest(null);
            fileDialogRequest.resolve(path);
          }}
        />
      )}
      {fileDialogRequest && !fileDialogRequest.save && (
        <WxFileDialog
          title={fileDialogRequest.title}
          filters={fileDialogRequest.filters}
          initialPath={fileDialogRequest.defaultDir || undefined}
          kind="symbols"
          projectDir={projectName ? `/${projectName}` : null}
          onDone={(file) => {
            setFileDialogRequest(null);
            fileDialogRequest.resolve(file ? wxFileDialogGetPath(file) : null);
          }}
        />
      )}

      {fpChooser &&
        app.FootprintChooserFrame({
          preselect: fpChooser.current,
          fpFilters: fpChooser.fpFilters,
          pinCount: fpChooser.pinCount,
          onOk: (libId) => {
            fpChooser.done(libId);
            setFpChooser(null);
          },
          onCancel: () => {
            fpChooser.done(null);
            setFpChooser(null);
          },
        })}

      {unsaved && (
        <UnsavedChangesDialog
          message={unsaved.message}
          onResult={(r) => {
            unsaved.done(r);
            setUnsaved(null);
          }}
        />
      )}

      {kiDialogNode}
      {aboutOpen && (
        <ShowAboutDialog title={ABOUT_TITLES.symbol} onClose={() => setAboutOpen(false)} />
      )}
      {prefsOpen &&
        app.PreferencesDialog({ onClose: () => setPrefsOpen(false), frameOwner: 'symbol' })}
      <ProgressDialog title="Load Symbol Libraries" label={null} />
    </div>
  );
}
