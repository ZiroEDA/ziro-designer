// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SCH_EDIT_FRAME` (eeschema/sch_edit_frame.h) — so far only its KIWAY half:
 * the mail it takes in (`KiwayMailIn`, `ExecuteRemoteCommand`) and the
 * cross-probe packets it sends (eeschema/cross-probing.cpp).
 * `SchematicEditor.tsx` is the window, and owns the state each command
 * changes, so the frame reaches it through {@link SCH_EDIT_FRAME_HOOKS}.
 *
 * Its live-model half (stage E3b) holds a `SCHEMATIC` and the undo/redo lists over the
 * live items: the frame methods `SCH_COMMIT` and `schematic_undo_redo.ts`
 * (`SCH_UNDO_REDO_MIXIN`, mixed in below) need.
 */
import { schIUScale } from '@ziroeda/common/eda_units.js';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import type { KIWAY_MAIL_EVENT } from '@ziroeda/common/kiway_mail.js';
import { KIWAY_PLAYER } from '@ziroeda/common/kiway_player.js';
import { STRTOK, strncpyLine } from '@ziroeda/common/libc/string.js';
import { MAIL_T } from '@ziroeda/common/mail_type.js';
import type { CROSS_PROBING_SETTINGS } from '@ziroeda/common/settings/app_settings.js';
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import { TOOL_MANAGER } from '@ziroeda/common/tool/tool_manager.js';
import { applyMixins } from '@ziroeda/core/mixins.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { SCH_COMMIT } from './sch_commit.js';
import type { SCH_ITEM } from './sch_item.js';
import type { SCH_SCREEN } from './sch_screen.js';
import type { SCH_SHEET_PATH } from './sch_sheet_path.js';
import type { SCH_CLEANUP_FLAGS, SCHEMATIC } from './schematic.js';
import { SCH_UNDO_REDO_MIXIN } from './schematic_undo_redo.js';

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
  getNetlist(aAnnotateMessage: string): string | null;
}

// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: TS multiple inheritance (SCH_UNDO_REDO_MIXIN, see libs/core/mixins.ts)
export interface SCH_EDIT_FRAME extends SCH_UNDO_REDO_MIXIN {}

// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: TS multiple inheritance (SCH_UNDO_REDO_MIXIN, see libs/core/mixins.ts)
export class SCH_EDIT_FRAME extends KIWAY_PLAYER {
  private readonly hooks: SCH_EDIT_FRAME_HOOKS;

  /// The live-model schematic this frame edits (null until one is set).
  private m_schematic: SCHEMATIC | null = null;

  /// Set when an undo/redo or recalculation may have changed the highlighted net.
  m_highlightedConnChanged = false;

  /// The list of items for the repeat-last-item command.
  private m_items_to_repeat: SCH_ITEM[] = [];

  constructor(hooks: SCH_EDIT_FRAME_HOOKS) {
    super(FRAME_T.FRAME_SCH, schIUScale, 'mm');
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
  }

  Schematic(): SCHEMATIC {
    return this.m_schematic!;
  }

  /** The current sheet's screen (`SCH_BASE_FRAME::GetScreen`). */
  GetScreen(): SCH_SCREEN | null {
    return this.m_schematic ? this.m_schematic.CurrentSheet().LastScreen() : null;
  }

  GetCurrentSheet(): SCH_SHEET_PATH {
    return this.m_schematic!.CurrentSheet();
  }

  /** `SCH_BASE_FRAME::AddToScreen`, without the view. */
  AddToScreen(aItem: EDA_ITEM, aScreen: SCH_SCREEN | null = null): void {
    if (!aItem) return; // wxCHECK

    const screen = aScreen ?? this.GetScreen()!;

    if (aItem.Type() !== KICAD_T.SCH_TABLECELL_T) screen.Append(aItem as SCH_ITEM);

    if (screen === this.GetScreen()) this.UpdateItem(aItem, true); // handle any additional parent semantics
  }

  /** `SCH_BASE_FRAME::RemoveFromScreen`, without the view. */
  RemoveFromScreen(aItem: EDA_ITEM, aScreen: SCH_SCREEN | null = null): void {
    const screen = aScreen ?? this.GetScreen()!;

    if (aItem.Type() !== KICAD_T.SCH_TABLECELL_T) screen.Remove(aItem as SCH_ITEM);

    if (screen === this.GetScreen()) this.UpdateItem(aItem, true); // handle any additional parent semantics
  }

  /**
   * `SCH_BASE_FRAME::UpdateItem`: mark the item's screen stale and repaint it.  With no
   * view there is nothing to repaint.
   */
  UpdateItem(_aItem: EDA_ITEM, _isAddOrDelete = false, _aUpdateRtree = false): void {}

  /**
   * `SCH_EDIT_FRAME::RecalculateConnections`: the schematic's, with the change handler that
   * flags a changed highlighted net.  The view refresh upstream does after is left out.
   */
  RecalculateConnections(aCommit: SCH_COMMIT | null, aCleanupFlags: SCH_CLEANUP_FLAGS): void {
    this.m_schematic!.RecalculateConnections(aCommit, aCleanupFlags, () => {
      this.m_highlightedConnChanged = true;
    });
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
        const netlist = this.hooks.getNetlist(payload);

        if (netlist !== null) mail.SetPayload(netlist);

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

applyMixins(SCH_EDIT_FRAME, [SCH_UNDO_REDO_MIXIN]);
