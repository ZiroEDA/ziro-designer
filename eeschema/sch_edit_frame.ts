// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SCH_EDIT_FRAME` (eeschema/sch_edit_frame.h), on `SCH_BASE_FRAME`
 * (`sch_base_frame.ts`, which holds the screen bookkeeping) — its KIWAY half:
 * the mail it takes in (`KiwayMailIn`, `ExecuteRemoteCommand`) and the
 * cross-probe packets it sends (eeschema/cross-probing.cpp).
 * `SchematicEditor.tsx` is the window, and owns the state each command
 * changes, so the frame reaches it through {@link SCH_EDIT_FRAME_HOOKS}.
 *
 * Its live-model half (stage E3b) holds a `SCHEMATIC` and the undo/redo lists over the
 * live items: the frame methods `SCH_COMMIT` and `schematic_undo_redo.ts`
 * (`SCH_UNDO_REDO_MIXIN`, mixed in below) need.
 */
import { SCH_SHEET_MIXIN } from './sheet.js';
import { SCH_ANNOTATE_MIXIN } from './annotate.js';
import { SCH_NETLIST_GENERATOR_MIXIN } from './netlist_exporters/netlist_generator.js';
import { NETLIST_EXPORTER_KICAD } from './netlist_exporters/netlist_exporter_kicad.js';
import {
  GNL_ALL,
  GNL_T,
  type NETLIST_LIBRARY_URI,
} from './netlist_exporters/netlist_exporter_xml.js';
import { SCH_FILES_IO_MIXIN } from './files-io.js';
import { SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import type { SCH_GLOBALLABEL } from './sch_label.js';
import type { SCHEMATIC_HOLDER } from './schematic_holder.js';
import {
  frameTitle,
  type FrameTitleParts,
  READ_ONLY_SUFFIX,
} from '@ziroeda/common/use_document_title.js';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import type { KIWAY_MAIL_EVENT } from '@ziroeda/common/kiway_mail.js';
import { STRTOK, strncpyLine } from '@ziroeda/common/libc/string.js';
import { MAIL_T } from '@ziroeda/common/mail_type.js';
import type { CROSS_PROBING_SETTINGS } from '@ziroeda/common/settings/app_settings.js';
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import { SELECTION } from '@ziroeda/common/tool/selection.js';
import { TOOL_MANAGER } from '@ziroeda/common/tool/tool_manager.js';
import { applyMixins } from '@ziroeda/core/mixins.js';
import { SCH_BASE_FRAME } from './sch_base_frame.js';
import type { SCH_COMMIT } from './sch_commit.js';
import type { SCH_ITEM } from './sch_item.js';
import type { SCH_SCREEN } from './sch_screen.js';
import type { SCH_SHEET_PATH } from './sch_sheet_path.js';
import type { SCH_CLEANUP_FLAGS, SCHEMATIC } from './schematic.js';
import { SCH_UNDO_REDO_MIXIN } from './schematic_undo_redo.js';
import { SCH_DESIGN_BLOCK_UTILS_MIXIN } from './sch_design_block_utils.js';
import type { SCH_DESIGN_BLOCK_PANE } from './widgets/sch_design_block_pane.js';
import type { SCH_GROUP } from './sch_group.js';

export interface SCH_EDIT_FRAME_HOOKS {
  /** `eeconfig()->m_CrossProbing`, read on every probe so a changed preference is seen. */
  crossProbingSettings(): CROSS_PROBING_SETTINGS;
  /**
   * `m_highlightedConn = …` then `SCH_ACTIONS::updateNetHighlighting`: the
   * editor resolves the name against its connection graph
   * (`FindFirstSubgraphByName`) and relights; empty is no highlight.
   */
  highlightNet(aNetName: string): void;
  /**
   * `findItemsFromSyncSelection` then `SCH_SELECTION_TOOL::SyncSelection`:
   * the editor owns the selection, so it resolves the parts and applies them.
   * `on_selection` has been checked. Focusing the first item is not ported.
   */
  syncSelection(aParts: readonly string[], aFocusOnFirst: boolean): void;
  /**
   * `SCH_EDITOR_CONTROL::AssignFootprints( payload )`: apply CvPcb's
   * `cvpcb_netlist` as one undoable commit. Throws on a payload it cannot read.
   */
  assignFootprints(aChangedSetOfReferences: string): void;
  /** `SaveProject()`: write the schematic now; false when it could not be. */
  saveProject(): boolean;
  /**
   * `MAIL_SCH_GET_NETLIST`'s body: `ReadyToNetlist( aAnnotateMessage )`, then
   * `NETLIST_EXPORTER_KICAD::Format( GNL_ALL | GNL_OPT_KICAD )`. Null when the
   * schematic is not ready to netlist, which leaves the payload unchanged.
   */
  getNetlist?(aAnnotateMessage: string): string | null;
  /**
   * TRANSITIONAL (S2-5b, deleted at S7): bring this frame's live `Schematic()` up to the
   * window's records. When given, the netlist mail is answered from the live model.
   */
  syncLiveSchematic?(): boolean;
  /** `ModalAnnotate( aMessage )`: the Annotate dialog, opened to fix annotation. */
  modalAnnotate?(aMessage: string): void;
  /** `IsOK( this, aMessage )`: a yes/no confirmation. */
  isOK?(aMessage: string): boolean;
  /** `DisplayError( this, aMessage )`: the window shows it; with no hook it is only logged. */
  displayError?(aMessage: string): void;
  /** `wxFileExists`: whether the project has a file at this absolute path. */
  fileExists?(aPath: string): boolean;
  /**
   * `LIBRARY_MANAGER::GetFullURI( SYMBOL, nickname )`: the netlist's `(libraries …)` asks it.
   * Without it no library is listed.
   */
  symbolLibraryUri?: NETLIST_LIBRARY_URI;
  /**
   * `SCH_SELECTION_TOOL::GetSelection()` on the live model (the design block
   * commands read it). Optional: a frame with no selection tool has none.
   */
  currentSelection?(): readonly EDA_ITEM[];
  /**
   * `ACTIONS::selectionClear` then `ACTIONS::selectItem( aGroup )`, after a
   * saved selection was grouped as its design block.
   */
  selectGroup?(aGroup: SCH_GROUP): void;
}

// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: TS multiple inheritance (SCH_UNDO_REDO_MIXIN, see libs/core/mixins.ts)
export interface SCH_EDIT_FRAME
  extends SCH_UNDO_REDO_MIXIN,
    SCH_DESIGN_BLOCK_UTILS_MIXIN,
    SCH_FILES_IO_MIXIN,
    SCH_ANNOTATE_MIXIN,
    SCH_NETLIST_GENERATOR_MIXIN,
    SCH_SHEET_MIXIN {}

// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: TS multiple inheritance (SCH_UNDO_REDO_MIXIN, see libs/core/mixins.ts)
export class SCH_EDIT_FRAME extends SCH_BASE_FRAME implements SCHEMATIC_HOLDER {
  private readonly hooks: SCH_EDIT_FRAME_HOOKS;

  /// The live-model schematic this frame edits (null until one is set).
  private m_schematic: SCHEMATIC | null = null;

  /// `m_designBlocksPane`: the Design Blocks dock, set by the window that docks it.
  m_designBlocksPane: SCH_DESIGN_BLOCK_PANE | null = null;

  /** `GetDesignBlockPane()`. */
  GetDesignBlockPane(): SCH_DESIGN_BLOCK_PANE | null {
    return this.m_designBlocksPane;
  }

  /** `GetCurrentSelection()`: the selection tool's selection. */
  override GetCurrentSelection(): SELECTION {
    const selection = new SELECTION();

    for (const item of this.hooks.currentSelection?.() ?? []) selection.Add(item);

    return selection;
  }

  /** What `SaveSelectionAsDesignBlock` does with the group it made: select it. */
  OnDesignBlockGrouped(aGroup: SCH_GROUP): void {
    this.hooks.selectGroup?.(aGroup);
  }

  /// Set when an undo/redo or recalculation may have changed the highlighted net.
  m_highlightedConnChanged = false;

  /// The list of items for the repeat-last-item command.
  private m_items_to_repeat: SCH_ITEM[] = [];

  constructor(hooks: SCH_EDIT_FRAME_HOOKS) {
    super(FRAME_T.FRAME_SCH);
    this.hooks = hooks;
  }

  // -------------------------------------------------------------------------------------
  // The live-model half (eeschema stage E3b): what the undo/redo mixin and SCH_COMMIT ask
  // of the frame.  The window (SchematicEditor.tsx) still edits the record model; nothing
  // here is called by it yet.  The view calls upstream makes (`GetCanvas()->GetView()`)
  // have no live view to reach and are left out.
  // -------------------------------------------------------------------------------------

  /**
   * Point the frame at \a aSchematic, and give it the TOOL_MANAGER its commits go
   * through (upstream's frame builds one in its constructor).
   */
  SetSchematic(aSchematic: SCHEMATIC | null): void {
    this.m_schematic = aSchematic;

    if (!this.m_toolManager) this.m_toolManager = new TOOL_MANAGER();

    this.m_toolManager.SetEnvironment(aSchematic, null, null, null, this);

    // sch_edit_frame.cpp:179 / :3051: the schematic calls back through its editor.
    aSchematic?.SetSchematicHolder(this);
  }

  Schematic(): SCHEMATIC {
    return this.m_schematic!;
  }

  /**
   * The current sheet's screen. Upstream `SCH_BASE_FRAME::GetScreen` returns
   * `m_currentScreen`, which `SCH_EDIT_FRAME` keeps pointed at the current
   * sheet's; here it is read off the sheet path directly.
   */
  override GetScreen(): SCH_SCREEN | null {
    return this.m_schematic ? this.m_schematic.CurrentSheet().LastScreen() : null;
  }

  GetCurrentSheet(): SCH_SHEET_PATH {
    return this.m_schematic!.CurrentSheet();
  }

  /** `SCH_EDIT_FRAME::GetScreenDesc` (sch_edit_frame.cpp:1054): the current sheet's name. */
  override GetScreenDesc(): string {
    return this.GetCurrentSheet().Last()!.GetName();
  }

  /** `SCH_EDIT_FRAME::GetFullScreenDesc` (:1060): the current sheet's human-readable path. */
  override GetFullScreenDesc(): string {
    return this.GetCurrentSheet().PathHumanReadable();
  }

  /**
   * `SCH_EDIT_FRAME::RecalculateConnections`: the schematic's, with the change handler that
   * flags a changed highlighted net.  The view refresh upstream does after is left out.
   */
  RecalculateConnections(aCommit: SCH_COMMIT | null, aCleanupFlags: SCH_CLEANUP_FLAGS): void {
    this.m_schematic!.RecalculateConnections(
      aCommit,
      aCleanupFlags,
      this.m_toolManager,
      null,
      null,
      () => {
        this.m_highlightedConnChanged = true;
      },
    );
  }

  /** `RecomputeIntersheetRefs()` (sch_edit_frame.cpp:1966). */
  RecomputeIntersheetRefs(): void {
    this.Schematic().RecomputeIntersheetRefs();
  }

  /** `IntersheetRefUpdate()` (sch_edit_frame.cpp:1972): repaint the label's references. */
  IntersheetRefUpdate(aItem: SCH_GLOBALLABEL): void {
    this.GetCanvas()?.GetView().Update(aItem);
  }

  /** `ShowAllIntersheetRefs()` (sch_edit_frame.cpp:1978). */
  ShowAllIntersheetRefs(aShow: boolean): void {
    this.RecomputeIntersheetRefs();

    this.GetCanvas()?.GetView().SetLayerVisible(SCH_LAYER_ID.LAYER_INTERSHEET_REFS, aShow);
  }

  /** `ModalAnnotate( aMessage )` (dialog_annotate.cpp): the window's Annotate dialog. */
  ModalAnnotate(aMessage: string): void {
    this.hooks.modalAnnotate?.(aMessage);
  }

  /** `IsOK( this, aMessage )` (confirm.cpp): no window to ask is a no. */
  IsOK(aMessage: string): boolean {
    return this.hooks.isOK?.(aMessage) ?? false;
  }

  /** `DisplayError( this, aMessage )`. */
  DisplayError(aMessage: string): void {
    if (this.hooks.displayError) this.hooks.displayError(aMessage);
    else console.warn(aMessage);
  }

  /** `wxFileExists( aPath )` in the project the frame has open. */
  FileExists(aPath: string): boolean {
    return this.hooks.fileExists?.(aPath) ?? false;
  }

  SetSheetNumberAndCount(): void {
    this.m_schematic!.SetSheetNumberAndCount();
  }

  /** The window's hierarchy navigator: not on the live model. */
  UpdateHierarchyNavigator(): void {}

  /** The window's variant chooser: not on the live model. */
  UpdateVariantSelectionCtrl(_aVariantNames: readonly string[]): void {}

  /** `SCH_EDIT_FRAME::UpdateHopOveredWires`: the hop-over shapes are view-side, not here. */
  UpdateHopOveredWires(_aItem: SCH_ITEM): void {}

  /** Return the items which are to be repeated with the insert key. */
  GetRepeatItems(): readonly SCH_ITEM[] {
    return this.m_items_to_repeat;
  }

  /** Clear the list of items which are to be repeated with the insert key. */
  ClearRepeatItemsList(): void {
    this.m_items_to_repeat = [];
  }

  /** Clone \a aItem and add it to the list of repeatable items. */
  AddCopyForRepeatItem(aItem: SCH_ITEM | null): void {
    // we cannot store a pointer to an item in the display list here since
    // that item may be deleted, such as part of a line concatenation or other.
    // So simply always keep a copy of the object which is to be repeated.

    if (aItem) {
      const repeatItem = aItem.Duplicate(false /* IGNORE_PARENT_GROUP */) as SCH_ITEM;

      // Clone() preserves the flags & parent, we want 'em cleared.
      repeatItem.ClearFlags();
      repeatItem.SetParent(null);

      this.m_items_to_repeat.push(repeatItem);
    }
  }

  /** `SCH_EDIT_FRAME::KiwayMailIn` (eeschema/cross-probing.cpp). */
  override KiwayMailIn(mail: KIWAY_MAIL_EVENT): void {
    const payload = mail.GetPayload();

    switch (mail.Command()) {
      case MAIL_T.MAIL_CROSS_PROBE:
        this.ExecuteRemoteCommand(payload);
        break;

      // biome-ignore lint/suspicious/noFallthroughSwitchClause: KI_FALLTHROUGH, as upstream
      case MAIL_T.MAIL_SELECTION:
        if (!this.hooks.crossProbingSettings().on_selection) break;

      // KI_FALLTHROUGH;

      case MAIL_T.MAIL_SELECTION_FORCE: {
        // $SELECT: 0,<spec1>,<spec2>,<spec3>
        // Try to select specified items.

        // $SELECT: 1,<spec1>,<spec2>,<spec3>
        // Select and focus on <spec1> item, select other specified items that are on the
        // same sheet.

        const prefix = '$SELECT: ';

        const paramStr = payload.substring(prefix.length);

        // Empty/broken command: we need at least 2 chars for sync string.
        if (paramStr.length < 2) break;

        const syncStr = paramStr.substring(2);

        const focusOnFirst = paramStr[0] === '1';

        this.hooks.syncSelection(syncStr.split(','), focusOnFirst);
        break;
      }

      case MAIL_T.MAIL_ASSIGN_FOOTPRINTS:
        try {
          this.hooks.assignFootprints(payload);
        } catch {
          // IO_ERROR: an unreadable payload assigns nothing.
        }

        break;

      case MAIL_T.MAIL_SCH_SAVE:
        if (this.hooks.saveProject()) mail.SetPayload('success');

        break;

      case MAIL_T.MAIL_SCH_GET_NETLIST: {
        if (!this.hooks.syncLiveSchematic) {
          // TRANSITIONAL: the record model's netlist, until the window keeps a live schematic.
          const netlist = this.hooks.getNetlist?.(payload) ?? null;

          if (netlist !== null) mail.SetPayload(netlist);

          break;
        }

        if (!this.hooks.syncLiveSchematic()) break;

        if (payload !== '') {
          // Ensure schematic is OK for netlist creation (especially that it is fully annotated):
          if (!this.ReadyToNetlist(payload)) break;
        }

        // (ADVANCED_CFG::m_IncrementalConnectivity is off by default: no recalculation here.)
        const exporter = new NETLIST_EXPORTER_KICAD(this.Schematic());

        if (this.hooks.symbolLibraryUri) exporter.m_libraryUri = this.hooks.symbolLibraryUri;

        mail.SetPayload(exporter.Format(GNL_ALL | GNL_T.GNL_OPT_KICAD));

        break;
      }

      default:
        break;
    }
  }

  /**
   * `SCH_EDIT_FRAME::ExecuteRemoteCommand` (eeschema/cross-probing.cpp:202):
   * a cross-probe packet from the board. The `$NET:` and `$CLEAR:` arms are
   * here; `$CONFIG`, `$ERC` and the `$PART:` probe are not yet.
   */
  ExecuteRemoteCommand(cmdline: string): void {
    const tok = new STRTOK(strncpyLine(cmdline));
    const idcmd = tok.Next(' \n\r');
    const text = tok.Next('"\n\r');

    if (idcmd === null) return;

    const crossProbingSettings = this.hooks.crossProbingSettings();

    if (idcmd === '$NET:') {
      if (!crossProbingSettings.auto_highlight) return;

      this.hooks.highlightNet(text ?? '');
      return;
    } else if (idcmd === '$CLEAR:') {
      // Cross-probing is now done through selection so we no longer need a clear command
      return;
    }
  }

  /**
   * `SCH_EDIT_FRAME::OnUpdatePCB` (eeschema/sch_edit_frame.cpp:1354): bring
   * the board up and mail it `MAIL_PCB_UPDATE`, which runs its Update PCB
   * from Schematic. Upstream opens the project's board when pcbnew is not
   * running, creating it if it does not exist; the editor here only offers
   * the command when the project has a board.
   */
  OnUpdatePCB(): void {
    const kiway = this.Kiway();

    if (!kiway) return;

    kiway.Player(FRAME_T.FRAME_PCB_EDITOR);

    const payload = { value: '' };
    kiway.ExpressMail(FRAME_T.FRAME_PCB_EDITOR, MAIL_T.MAIL_PCB_UPDATE, payload, this);
  }

  /**
   * `SCH_EDIT_FRAME::SendSelectItemsToPcb` (eeschema/cross-probing.cpp:312),
   * over the parts `syncSelectionParts` gives, in selection order. Nothing is
   * sent for no parts, as upstream.
   */
  SendSelectItemsToPcb(aParts: readonly string[], aForce: boolean): void {
    if (aParts.length === 0) return;

    let command = '$SELECT: 0,';

    for (const part of aParts) {
      command += part;
      command += ',';
    }

    command = command.slice(0, -1);

    this.Kiway()?.ExpressMail(
      FRAME_T.FRAME_PCB_EDITOR,
      aForce ? MAIL_T.MAIL_SELECTION_FORCE : MAIL_T.MAIL_SELECTION,
      { value: command },
      this,
    );
  }

  /** `SCH_EDIT_FRAME::SendCrossProbeNetName` (eeschema/cross-probing.cpp:383). */
  SendCrossProbeNetName(aNetName: string): void {
    // The command is a keyword followed by a quoted string.
    const packet = `$NET: "${aNetName}"`;

    this.Kiway()?.ExpressMail(
      FRAME_T.FRAME_PCB_EDITOR,
      MAIL_T.MAIL_CROSS_PROBE,
      { value: packet },
      this,
    );
  }

  /** `SCH_EDIT_FRAME::SendCrossProbeClearHighlight` (eeschema/cross-probing.cpp:457). */
  SendCrossProbeClearHighlight(): void {
    const packet = '$CLEAR\n';

    this.Kiway()?.ExpressMail(
      FRAME_T.FRAME_PCB_EDITOR,
      MAIL_T.MAIL_CROSS_PROBE,
      { value: packet },
      this,
    );
  }
}

/**
 * The order of the docked panes in the Schematic Editor's left column.
 *
 * eeschema sets each pane's `Position()` in two places — the pane infos in
 * `eeschema/eeschema_settings.cpp` and the one inline `AddPane` in
 * `eeschema/sch_edit_frame.cpp` — kept together here, rather than split across
 * `eeschema_settings.ts`/`sch_edit_frame.ts` by data source, because
 * {@link schLeftDockLayout} and the tables below read both as one dock; see
 * the per-symbol doc comments for exactly which upstream file each number
 * comes from:
 *
 *   | pane                | Position | AddPane | where                     |
 *   |---------------------|----------|---------|---------------------------|
 *   | Net Navigator       |    0     |    4th  | eeschema_settings.cpp:74  |
 *   | Schematic Hierarchy |    1     |    1st  | sch_edit_frame.cpp:262    |
 *   | Properties          |    2     |    2nd  | eeschema_settings.cpp:95  |
 *   | Selection Filter    |    4     |    3rd  | eeschema_settings.cpp:117 |
 *
 * All four are `.Left().Layer( 3 )`, so this is one column. Position 3 is
 * deliberately unused upstream — the numbers are sparse, which is why this
 * table mirrors them rather than renumbering 0..3.
 *
 * **`Position()` is not the order.** It is only the STARTING `dock_pos`, and
 * wxAuiManager rewrites `dock_pos` on every `Update()`. `qa/probes/aui_dock_pos_probe.cpp`
 * builds these four panes with wx 3.2.4 and toggles them the way
 * `SCH_EDIT_FRAME::ToggleSchematicHierarchy` (sch_edit_frame.cpp:2910) and
 * `ToggleProperties` (:2886) do — both of which only call `.Show()` and never
 * touch Position — and measures each pane's on-screen y. Two rules explain
 * every line of its output:
 *
 *   1. Each `Update()` renumbers the SHOWN panes of the dock: it sorts them by
 *      their current `dock_pos` and writes back 0, 1, 2 ... in that order. A
 *      HIDDEN pane is not touched and keeps the number it had.
 *   2. Ties are broken by `AddPane` order, the third column above.
 *
 * So the pane opened FIRST is alone in the dock and is compacted to 0, while
 * the one opened next still carries its original `Position()` — 1, 2 or 4,
 * all greater — and lands BELOW it. Open the hierarchy first and it is on
 * top; open Properties first and IT is on top. That is what the user sees,
 * and it is why a fixed order table was the wrong model, not merely a wrong
 * pair of numbers. The table still decides one case: panes that become
 * visible in the SAME `Update()`, which is a frame restoring its layout.
 *
 * {@link schLeftDockLayout} is those two rules; the editor keeps the resulting
 * `dock_pos` and feeds it back in, exactly as the pane infos do upstream.
 *
 * This is a data module and not a comment in the JSX because a JSX block's
 * order cannot be asserted from a Node test, and the order is exactly the
 * thing that was wrong: ours rendered Properties above the hierarchy, and
 * then — after that was "fixed" — rigidly the other way round.
 *
 * The Search pane is NOT in this list. Upstream docks it at the BOTTOM —
 * `EDA_PANE().Name( SearchPaneName() ).Bottom()` (sch_edit_frame.cpp:290-292)
 * — under the canvas rather than in this column. See {@link SCH_BOTTOM_DOCK}.
 */

/** A docked pane of the left column, named as `wxAuiPaneInfo::Name()` names it. */
export type SchLeftPane = 'netNavigator' | 'hierarchy' | 'properties' | 'selectionFilter';

/**
 * `Position()` for each pane of the left dock, verbatim from the two files
 * above. Sparse on purpose: upstream skips 3.
 *
 * This is the value `AddPane` leaves in `dock_pos`, i.e. the state the column
 * starts in — not the order it stays in. See {@link schLeftDockLayout}.
 */
export const SCH_LEFT_PANE_POSITION: Readonly<Record<SchLeftPane, number>> = {
  netNavigator: 0,
  hierarchy: 1,
  properties: 2,
  selectionFilter: 4,
};

/**
 * The order the four `AddPane` calls run in: the hierarchy inline at
 * `sch_edit_frame.cpp:260`, then Properties (:272), the Selection Filter
 * (:273) and the Net Navigator (:279). Note the Net Navigator is added LAST
 * despite being `Position( 0 )`.
 *
 * It is here because it breaks ties: two panes can hold the same `dock_pos`
 * once one of them has been compacted, and then this decides. Measured in the
 * probe's "re-open Properties" scenario, where Properties ties the hierarchy
 * at 0 and the hierarchy — added first — keeps the top slot.
 */
export const SCH_LEFT_PANE_ADD_ORDER: readonly SchLeftPane[] = [
  'hierarchy',
  'properties',
  'selectionFilter',
  'netNavigator',
];

/** `dock_pos` for every pane of the column, the state wxAUI carries forward. */
export type SchDockPos = Readonly<Record<SchLeftPane, number>>;

/**
 * The column's starting `dock_pos`, from a stored perspective or from
 * `AddPane`.
 *
 * `RestoreAuiLayout()` (sch_edit_frame.cpp:304) loads `window.perspective`
 * before a single pane is shown, so the numbers a previous session was left
 * with — not {@link SCH_LEFT_PANE_POSITION} — are what the next one starts
 * from. That matters because wxAUI's renumbering pass is not reversible: it
 * compacts whatever was shown, and a pane hidden at that moment keeps the
 * number it had. Measured with `qa/probes/aui_dock_pos_probe.cpp` on this
 * machine's own saved perspective (Properties `pos=0`, hierarchy `pos=1`),
 * closing both palettes and re-opening Properties and then the hierarchy leaves
 * **Properties on top**; run from `AddPane`'s numbers the very same sequence
 * leaves the **hierarchy** on top, because the two tie at 0 and `AddPane` order
 * breaks the tie. So an editor that forgets the numbers between sessions
 * answers a question KiCad answers from memory.
 *
 * A missing or non-numeric entry falls back to `AddPane`'s value, which is what
 * a pane absent from the perspective string gets upstream.
 */
export function schDockPosFrom(stored: Readonly<Record<string, number>> | undefined): SchDockPos {
  const out = { ...SCH_LEFT_PANE_POSITION } as Record<SchLeftPane, number>;
  for (const pane of SCH_LEFT_PANE_ADD_ORDER) {
    const v = stored?.[pane];
    if (typeof v === 'number' && Number.isFinite(v)) out[pane] = v;
  }
  return out;
}

/** What one `wxAuiManager::Update()` leaves behind. */
export interface SchLeftDockLayout {
  /** The panes on screen, TOP TO BOTTOM. */
  readonly order: readonly SchLeftPane[];
  /** `dock_pos` after the renumbering pass, to be fed into the next Update. */
  readonly dockPos: SchDockPos;
}

/**
 * One `Update()` of the left dock: sort, draw, renumber.
 *
 * Both rules are the probe's, measured rather than read (there is no wx source
 * on this machine): the shown panes are ordered by `dock_pos` with `AddPane`
 * order breaking ties, and then the shown ones — only those — are renumbered
 * 0, 1, 2 ... A hidden pane keeps its number, which is what makes closing and
 * re-opening a pane put it back where it was instead of at the bottom.
 *
 * Idempotent: running it again with the same `shown` set returns the same
 * order and the same numbers, because compacting an already-compacted dock
 * changes nothing. That is what lets the editor call it once per render.
 */
export function schLeftDockLayout(
  dockPos: SchDockPos,
  shown: Readonly<Record<SchLeftPane, boolean>>,
): SchLeftDockLayout {
  // The comparator states the tie-break instead of leaning on Array.sort being
  // stable over an array that happens to be in AddPane order: the tie is a
  // measured rule and deserves to be written down.
  const bySlot = (a: SchLeftPane, b: SchLeftPane): number =>
    dockPos[a] - dockPos[b] ||
    SCH_LEFT_PANE_ADD_ORDER.indexOf(a) - SCH_LEFT_PANE_ADD_ORDER.indexOf(b);

  // The Selection Filter is not one of the panes that contend for a slot. It is
  // the LAST row of the column, always, and the three facts that say so all
  // agree: `Position( 4 )` where the others are 0, 1 and 2 and 3 is deliberately
  // skipped; `dock_proportion = 0`, so it alone never grows; and no visibility
  // control of its own. Read back out of a real eeschema's saved perspective on
  // this machine (`~/.config/kicad/10.0/eeschema.json`):
  //
  //     PropertiesManager    pos=0 prop=100000
  //     SchematicHierarchy   pos=1 prop=100000
  //     SelectionFilter      pos=2 prop=0
  //
  // -- highest position of the three, and the only one with no proportion, which
  // is why it sits flush against the message panel as part of the same band
  // rather than floating between two palettes.
  const CONTENDERS = SCH_LEFT_PANE_ADD_ORDER.filter((p) => p !== 'selectionFilter');

  const shownContenders = CONTENDERS.filter((p) => shown[p]).sort(bySlot);
  const next: Record<SchLeftPane, number> = { ...dockPos };
  shownContenders.forEach((pane, i) => {
    next[pane] = i;
  });

  // A HIDDEN contender is left alone, which is what wxAUI does and what
  // `qa/probes/aui_dock_pos_probe.cpp` measures -- including the tie that
  // follows when a shown pane later compacts onto the number a hidden one still
  // holds. The probe drives the same path the frame does, `Show()` then
  // `SetAuiPaneSize`'s MinSize/Fixed/Update/Resizable/Update (its lines
  // 406-422), so that tie is real and is deliberately NOT smoothed away here.

  // The filter goes immediately after the SHOWN panes, so nothing can renumber
  // it into the middle of the column. `shownContenders.length` and not
  // `CONTENDERS.length`, because that is the number a real perspective holds:
  // with Properties and the hierarchy shown and the Net Navigator hidden, this
  // machine's eeschema.json has `SelectionFilter … pos=2`, one past the two
  // panes above it — not one past every pane that could exist.
  // Only when it is on screen: a hidden pane keeps the number it had, which is
  // the rule the probe measured for every other pane and there is no reason the
  // filter should differ. It also keeps an empty column a no-op.
  if (shown.selectionFilter) next.selectionFilter = shownContenders.length;

  const order: SchLeftPane[] = shown.selectionFilter
    ? [...shownContenders, 'selectionFilter']
    : shownContenders;

  return { order, dockPos: next };
}

/**
 * Whether a pane can GROW to fill the column.
 *
 * Only the Selection Filter cannot: `selectionFilterPane.dock_proportion = 0`
 * (sch_edit_frame.cpp:325), with the comment "The selection filter doesn't need
 * to grow in the vertical direction when docked", and its pane info asks for a
 * `-1` height (eeschema_settings.cpp:123-125). Every other pane in the column
 * takes a share of the leftover height, so only those get a drag sash.
 *
 * This is a per-pane predicate and no longer a list, because a list would have
 * to carry an order, and the order is {@link schLeftDockLayout}'s answer now.
 */
export function schPaneGrows(pane: SchLeftPane): boolean {
  return pane !== 'selectionFilter';
}

/**
 * Whether the Selection Filter is on screen.
 *
 * It has no visibility control of its own. `SCH_EDIT_FRAME::updateSelectionFilterVisbility`
 * (sch_edit_frame.cpp:2817-2831) decides for it, with the comment
 *
 *   // Don't give the selection filter its own visibility controls; instead show it if
 *   // anything else is visible
 *
 * and the condition
 *
 *   bool showFilter = ( hierarchyPane.IsShown() && hierarchyPane.IsDocked() )
 *                     || ( netNavigatorPane.IsShown() && netNavigatorPane.IsDocked() )
 *                     || ( propertiesPane.IsShown() && propertiesPane.IsDocked() );
 *
 * Ours keyed on Properties alone, so closing Properties with the hierarchy open
 * took the filter away with it.
 *
 * The `IsDocked()` half has no counterpart here: we have no floating panes, so
 * a shown pane is always a docked one. It is written out above rather than
 * dropped silently, because if panes ever float this predicate is where the
 * other half belongs.
 *
 * The Search pane is deliberately not a term — it is `.Bottom()`, not part of
 * this column, and upstream does not consult it.
 */
export function schSelectionFilterShown(
  shown: Readonly<Record<Exclude<SchLeftPane, 'selectionFilter'>, boolean>>,
): boolean {
  return shown.hierarchy || shown.netNavigator || shown.properties;
}

/**
 * The Search pane, which is docked at the BOTTOM and not in the column above.
 *
 * `sch_edit_frame.cpp:290-300`:
 *
 *   m_auimgr.AddPane( m_searchPane, EDA_PANE()
 *                     .Name( SearchPaneName() )
 *                     .Bottom()
 *                     .Caption( _( "Search" ) )
 *                     .PaneBorder( false )
 *                     .MinSize( FromDIP( wxSize( 180, 60 ) ) )
 *                     .BestSize( FromDIP( wxSize( 180, 100 ) ) )
 *                     ...
 *
 * **It does not span the window.** There is no `.Layer()` call, so it takes the
 * default layer 0, and wxAUI nests docks outward by layer: layer 0 is the
 * innermost ring around the centre pane, and layers 1-3 then 4-6 wrap it. The
 * panes it has to clear are all outside it —
 *
 *   | pane        | dock   | layer | where                   |
 *   |-------------|--------|-------|-------------------------|
 *   | Search      | Bottom |   0   | sch_edit_frame.cpp:292  |
 *   | LeftToolbar | Left   |   2   | sch_edit_frame.cpp:281  |
 *   | left panes  | Left   |   3   | eeschema_settings.cpp   |
 *   | MsgPanel    | Bottom |   6   | sch_edit_frame.cpp:257  |
 *
 * — so the Search pane is as wide as the CANVAS COLUMN, with the left dock and
 * both toolbars running full height past it, and the message panel below all of
 * them at the full width of the frame.
 *
 * Ours rendered it as the first pane of the left column instead.
 */
export const SCH_BOTTOM_DOCK = {
  /* [data] `.BestSize( FromDIP( wxSize( 180, 100 ) ) )`, sch_edit_frame.cpp:297
     — the height the dock opens at. KiCad hardcodes the pair itself. */
  bestHeight: 100,
  /* [data] `.MinSize( FromDIP( wxSize( 180, 60 ) ) )`, sch_edit_frame.cpp:296
     — how far the sash above it can be dragged down. */
  minHeight: 60,
} as const;

applyMixins(SCH_EDIT_FRAME, [
  SCH_UNDO_REDO_MIXIN,
  SCH_DESIGN_BLOCK_UTILS_MIXIN,
  SCH_FILES_IO_MIXIN,
  SCH_ANNOTATE_MIXIN,
  SCH_NETLIST_GENERATOR_MIXIN,
  SCH_SHEET_MIXIN,
]);

/**
 * `SCH_EDIT_FRAME::updateTitle` (eeschema/sch_edit_frame.cpp:1819-1862).
 *
 * The frame title is per-frame upstream — each editor has its own
 * `updateTitle()` — but the SHAPE of it is not: star, document, suffixes, em
 * dash, frame name is `docs/frame-titles.md`'s twelve-of-thirteen rule, and
 * `frameTitle()` in `ui/useDocumentTitle.ts` is where that shape lives. This
 * is only the schematic's own three decisions on top of it, and it states
 * nothing the shared function already states.
 *
 * The C++, in full:
 *
 *     wxFileName fn( Prj().AbsolutePath( screen->GetFileName() ) );
 *     if( IsContentModified() ) title = wxT( "*" );
 *     title += fn.GetName();
 *     wxString sheetPath = GetCurrentSheet().PathHumanReadable( false, true );
 *     if( sheetPath != fn.GetName() )
 *         title += wxString::Format( wxT( " [%s]" ), sheetPath );
 *     if( readOnly ) title += wxS( " " ) + _( "[Read Only]" );
 *     if( unsaved )  title += wxS( " " ) + _( "[Unsaved]" );
 *     ...
 *     title = _( "[no schematic loaded]" );      // the else branch
 *     title += wxT( " — " ) + _( "Schematic Editor" );
 *
 * Three things that are easy to get wrong and were each wrong here:
 *
 *  - The document half is **the current SCREEN's file name**, not the project
 *    name. Descend into a sub-sheet and the title names the sub-sheet's file.
 *  - `wxFileName::GetName()` drops the extension, so it is `ecc83`, never
 *    `ecc83.kicad_sch`.
 *  - The sheet-path bracket is **suppressed at the root**, because
 *    `PathHumanReadable( false, ... )` seeds the path with the root screen's
 *    own `GetName()` — so on the root sheet the two strings are equal and the
 *    comparison at `:1846` fails. A bracket that showed `[ecc83]` on the root
 *    sheet would be wrong in the one place the title is seen most.
 */

/** `_( "Schematic Editor" )`, the half after the dash. */
export const SCH_FRAME_NAME = 'Schematic Editor';

/** `_( "[no schematic loaded]" )` — sch_edit_frame.cpp:1856. */
export const SCH_NO_DOCUMENT = '[no schematic loaded]';

/**
 * `SCH_SHEET_PATH::PathHumanReadable( false, true )`
 * (eeschema/sch_sheet_path.cpp), for the two arguments `updateTitle` passes.
 *
 * `aUseShortRootName = false` seeds the string with the ROOT screen's file name
 * without its extension rather than with a bare `"/"`; every sheet below the
 * root then contributes its **sheet name** (not its file name) and a `"/"`; and
 * `aStripTrailingSeparator = true` removes the final separator.
 *
 * So the root sheet of `ecc83.kicad_sch` is `"ecc83"`, and a sheet named
 * `Power` beneath it is `"ecc83/Power"`.
 *
 * @param rootFileBase the root screen's file name with the extension already
 *   dropped — `wxFileName( … ).GetName()` of `at( 0 )->GetScreen()`.
 * @param sheetNames the sheet names from the root's child down to the current
 *   sheet, in order. Empty at the root.
 */
export function pathHumanReadable(rootFileBase: string, sheetNames: readonly string[]): string {
  const parts = [rootFileBase, ...sheetNames];
  // `s << sheetName << "/"` for each, then strip the one trailing separator —
  // which is the same string as joining on "/".
  return parts.join('/');
}

export interface SchFrameTitleSpec {
  /**
   * The CURRENT sheet's file name, extension included or not — this function
   * drops it, the way `wxFileName::GetName()` does. Null/empty is the
   * `[no schematic loaded]` branch.
   */
  fileName?: string | null;
  /** `PathHumanReadable( false, true )` for the current sheet. */
  sheetPath?: string;
  /** `IsContentModified()`. */
  modified?: boolean;
  /**
   * `screen->IsReadOnly()`. There is no `[Unsaved]` counterpart here: upstream
   * sets it from `!screen->FileExists()`, and a document in this app exists in
   * the store from the moment it is opened, so the flag would never be true.
   */
  readOnly?: boolean;
}

/** `wxFileName::GetName()` — the base name without its last extension. */
export function fileBaseName(fileName: string): string {
  // A leading dot is not an extension and neither is a dot in a directory
  // component, the same two cases `frameTitleName` handles.
  return fileName.replace(/(?!^)\.[^./\\]*$/, '');
}

export function schFrameTitle(spec: SchFrameTitleSpec): FrameTitleParts {
  const raw = spec.fileName?.trim() ?? '';

  if (raw === '') {
    return frameTitle({
      frameName: SCH_FRAME_NAME,
      document: null,
      placeholder: SCH_NO_DOCUMENT,
      modified: spec.modified,
    });
  }

  const base = fileBaseName(raw);
  // `if( sheetPath != fn.GetName() ) title += " [" + sheetPath + "]"` — equal
  // on the root sheet, so the root carries no bracket.
  const path = spec.sheetPath?.trim() ?? '';
  const document = path !== '' && path !== base ? `${base} [${path}]` : base;

  return frameTitle({
    frameName: SCH_FRAME_NAME,
    document,
    modified: spec.modified,
    suffixes: spec.readOnly ? [READ_ONLY_SUFFIX] : [],
  });
}
