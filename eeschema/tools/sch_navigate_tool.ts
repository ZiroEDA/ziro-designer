// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Hierarchy navigation. Counterpart: `eeschema/tools/sch_navigate_tool.cpp`
 * (SCH_NAVIGATE_TOOL): a linear history of visited sheet instances for
 * Back/Forward, path-pop for Up/Leave Sheet, and the depth-first hierarchy
 * order (SCH_SHEET_LIST virtual page numbers) for Previous/Next Sheet.
 */

import { GetAssociatedDocument, ResolveUriByEnvVars } from '@ziroeda/common/eda_doc.js';
import { EDA_TEXT } from '@ziroeda/common/eda_text.js';
import { ACTION_MENU } from '@ziroeda/common/tool/action_menu.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import { TOOL_EVENT } from '@ziroeda/common/tool/tool_event.js';
import { SYNC_HANDLER } from '@ziroeda/common/tool/tool_interactive.js';
import { wxBell } from '@ziroeda/common/wx/utils.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { SheetTreeNode } from '../project.js';
import type { SCH_EDIT_FRAME } from '../sch_edit_frame.js';
import type { SCH_SHEET } from '../sch_sheet.js';
import type { SCH_SHEET_PATH } from '../sch_sheet_path.js';
import { SCH_ACTIONS } from './sch_actions.js';
import { SCH_SELECTION_TOOL } from './sch_selection_tool.js';
import { SCH_TOOL_BASE } from './sch_tool_base.js';

export interface SheetRef {
  path: string;
  file: string;
}

/** Depth-first flattening of the hierarchy, KiCad's Schematic().Hierarchy()
 *  order, which defines the virtual page numbers Previous/Next step through. */
export function flattenHierarchy(root: SheetTreeNode): SheetRef[] {
  const out: SheetRef[] = [];
  const walk = (n: SheetTreeNode): void => {
    out.push({ path: n.path, file: n.file });
    for (const c of n.children) walk(c);
  };
  walk(root);
  return out;
}

/** Parent instance path (SCH_SHEET_PATH::pop_back): "/a/b/" → "/a/"; the root
 *  has no parent (CanGoUp() is false on a top-level sheet). */
export function parentPath(path: string): string | null {
  if (path === '/') return null;
  const parts = path.split('/').filter(Boolean);
  parts.pop();
  return parts.length ? `/${parts.join('/')}/` : '/';
}

/** The Back/Forward history (m_navHistory + m_navIndex). Paths only, the
 *  file for a path comes from the flattened hierarchy at use time. */
export class SchNavigateTool {
  private history: string[] = ['/'];
  private index = 0;

  /** ResetHistory(): restart at the given (current) sheet. */
  resetHistory(path: string): void {
    this.history = [path];
    this.index = 0;
  }

  /** CleanHistory(): drop entries that no longer exist in the hierarchy, and
   *  collapse consecutive duplicates that removal creates. */
  cleanHistory(valid: ReadonlySet<string>): void {
    const kept: string[] = [];
    for (const p of this.history) {
      if (!valid.has(p)) continue;
      if (kept.length > 0 && kept[kept.length - 1] === p) continue;
      kept.push(p);
    }
    this.history = kept.length ? kept : ['/'];
    this.index = this.history.length <= 1 ? 0 : this.history.length - 1;
  }

  canGoBack(): boolean {
    return this.index > 0;
  }

  canGoForward(): boolean {
    return this.index < this.history.length - 1;
  }

  /** Back(): move the cursor without re-pushing; null when at the beginning. */
  back(): string | null {
    return this.canGoBack() ? this.history[--this.index]! : null;
  }

  /** Forward(): move the cursor without re-pushing; null when at the end. */
  forward(): string | null {
    return this.canGoForward() ? this.history[++this.index]! : null;
  }

  /** pushToHistory(): a sheet change truncates any forward tail and appends
   *  (skipping a consecutive duplicate of the tail entry). */
  pushToHistory(path: string): void {
    if (this.canGoForward()) this.history.length = this.index + 1;
    if (this.history.length === 0 || this.history[this.history.length - 1] !== path)
      this.history.push(path);
    this.index = this.history.length - 1;
  }
}

// -----------------------------------------------------------------------------------------------
// SCH_NAVIGATE_TOOL (sch_navigate_tool.{h,cpp}) on the live model
// -----------------------------------------------------------------------------------------------

/** `SCH_NAVIGATE_TOOL`: back / forward history, up, previous / next page and hypertext links. */
export class SCH_NAVIGATE_TOOL extends SCH_TOOL_BASE<SCH_EDIT_FRAME> {
  static readonly g_BackLink = 'HYPERTEXT_BACK';

  // std::list<SCH_SHEET_PATH> plus an iterator into it: the index here.
  private m_navHistory: SCH_SHEET_PATH[] = [];
  private m_navIndex = 0;

  constructor() {
    super('eeschema.NavigateTool');
  }

  ResetHistory(): void {
    this.m_navHistory = [this.m_frame!.GetCurrentSheet().Clone()];
    this.m_navIndex = 0;
  }

  CleanHistory(): void {
    if (!this.m_frame) return; // wxCHECK

    const sheets = this.m_frame.Schematic().Hierarchy();

    if (sheets.length === 0) return; // wxCHECK

    // Search through our history, and removing any entries
    // that the no longer point to a sheet on the schematic
    let entry = 0;

    while (entry < this.m_navHistory.length) {
      const here = this.m_navHistory[entry]!;

      if (sheets.some((s) => s.equals(here))) {
        // Don't allow multiple consecutive instances of the same history.
        if (entry !== 0 && here.equals(this.m_navHistory[entry - 1]!))
          this.m_navHistory.splice(entry, 1);
        else ++entry;
      } else {
        this.m_navHistory.splice(entry, 1);
      }
    }

    if (this.m_navHistory.length <= 1) this.m_navIndex = 0;
    else this.m_navIndex = this.m_navHistory.length - 1;
  }

  HypertextCommand(aHref: string): void {
    const destPage: { value: string } = { value: '' };
    const href = ResolveUriByEnvVars(aHref, (token) => this.m_frame!.Prj().TextVarResolver(token));

    if (href === SCH_NAVIGATE_TOOL.g_BackLink) {
      this.Back(new TOOL_EVENT());
    } else if (EDA_TEXT.IsGotoPageHref(href, destPage) && destPage.value !== '') {
      for (const sheet of this.m_frame!.Schematic().Hierarchy()) {
        if (sheet.GetPageNumber() === destPage.value) {
          this.changeSheet(sheet);
          return;
        }
      }

      this.m_frame!.ShowInfoBarError(`Page '${destPage.value}' not found.`);
    } else {
      // wxMenu menu; menu.Append( 1, "Open %s" ); GetPopupMenuSelectionFromUser( menu ) == 1:
      // the popup answers when it closes.
      const menu = new ACTION_MENU(true);
      menu.Append(1, `Open ${href}`);

      this.m_frame!.PopupMenu(menu, () => {
        if (menu.GetSelected() === 1)
          GetAssociatedDocument(href, (token) => this.m_frame!.Prj().TextVarResolver(token), [
            this.m_frame!.Schematic().GetEmbeddedFiles(),
          ]);
      });
    }
  }

  Up(aEvent: TOOL_EVENT): number {
    // Checks for CanGoUp()
    this.LeaveSheet(aEvent);
    return 0;
  }

  Forward(_aEvent: TOOL_EVENT): number {
    if (this.CanGoForward()) {
      this.m_navIndex++;

      this.m_frame!.GetToolManager()!.RunAction(ACTIONS.cancelInteractive);
      this.m_frame!.GetToolManager()!.RunAction(ACTIONS.selectionClear);

      this.m_frame!.SetCurrentSheet(this.m_navHistory[this.m_navIndex]!);
      this.m_frame!.DisplayCurrentSheet();
    } else {
      wxBell();
    }

    return 0;
  }

  Back(_aEvent: TOOL_EVENT): number {
    if (this.CanGoBack()) {
      this.m_navIndex--;

      this.m_frame!.GetToolManager()!.RunAction(ACTIONS.cancelInteractive);
      this.m_frame!.GetToolManager()!.RunAction(ACTIONS.selectionClear);

      this.m_frame!.SetCurrentSheet(this.m_navHistory[this.m_navIndex]!);
      this.m_frame!.DisplayCurrentSheet();
    } else {
      wxBell();
    }

    return 0;
  }

  Previous(_aEvent: TOOL_EVENT): number {
    if (this.CanGoPrevious()) {
      const targetSheet = this.m_frame!.GetCurrentSheet().GetVirtualPageNumber() - 1;
      this.changeSheet(this.m_frame!.Schematic().Hierarchy()[targetSheet - 1]!);
    } else {
      wxBell();
    }

    return 0;
  }

  Next(_aEvent: TOOL_EVENT): number {
    if (this.CanGoNext()) {
      const targetSheet = this.m_frame!.GetCurrentSheet().GetVirtualPageNumber() + 1;
      this.changeSheet(this.m_frame!.Schematic().Hierarchy()[targetSheet - 1]!);
    } else {
      wxBell();
    }

    return 0;
  }

  CanGoBack(): boolean {
    return this.m_navHistory.length > 0 && this.m_navIndex !== 0;
  }

  CanGoForward(): boolean {
    return this.m_navHistory.length > 0 && this.m_navIndex !== this.m_navHistory.length - 1;
  }

  CanGoUp(): boolean {
    const topLevelSheets = this.m_frame!.Schematic().GetTopLevelSheets();

    for (const top_sheet of topLevelSheets) {
      if (this.m_frame!.GetCurrentSheet().Last() === top_sheet) return false;
    }

    return true;
  }

  CanGoPrevious(): boolean {
    return this.m_frame!.GetCurrentSheet().GetVirtualPageNumber() > 1;
  }

  CanGoNext(): boolean {
    if (!this.m_frame!.Schematic().IsValid()) return false;

    return (
      this.m_frame!.GetCurrentSheet().GetVirtualPageNumber() <
      this.m_frame!.Schematic().Hierarchy().length
    );
  }

  ChangeSheet(aEvent: TOOL_EVENT): number {
    const path = aEvent.Parameter<SCH_SHEET_PATH>();

    if (!path) return 0; // wxCHECK

    this.changeSheet(path);

    return 0;
  }

  EnterSheet(_aEvent: TOOL_EVENT): number {
    const selTool = this.m_toolMgr!.GetTool(SCH_SELECTION_TOOL)!;
    const selection = selTool.RequestSelection([KICAD_T.SCH_SHEET_T]);

    if (selection.GetSize() === 1) {
      const pushed = this.m_frame!.GetCurrentSheet().Clone();
      pushed.push_back(selection.Front() as SCH_SHEET);

      this.changeSheet(pushed);
    }

    return 0;
  }

  LeaveSheet(_aEvent: TOOL_EVENT): number {
    if (this.CanGoUp()) {
      const popped = this.m_frame!.GetCurrentSheet().Clone();
      popped.pop_back();

      this.changeSheet(popped);
    } else {
      wxBell();
    }

    return 0;
  }

  protected override setTransitions(): void {
    this.Go(SYNC_HANDLER(this.ChangeSheet), SCH_ACTIONS.changeSheet.MakeEvent());
    this.Go(SYNC_HANDLER(this.EnterSheet), SCH_ACTIONS.enterSheet.MakeEvent());
    this.Go(SYNC_HANDLER(this.LeaveSheet), SCH_ACTIONS.leaveSheet.MakeEvent());

    this.Go(SYNC_HANDLER(this.Up), SCH_ACTIONS.navigateUp.MakeEvent());
    this.Go(SYNC_HANDLER(this.Forward), SCH_ACTIONS.navigateForward.MakeEvent());
    this.Go(SYNC_HANDLER(this.Back), SCH_ACTIONS.navigateBack.MakeEvent());

    this.Go(SYNC_HANDLER(this.Previous), SCH_ACTIONS.navigatePrevious.MakeEvent());
    this.Go(SYNC_HANDLER(this.Next), SCH_ACTIONS.navigateNext.MakeEvent());
  }

  private pushToHistory(aPath: SCH_SHEET_PATH): void {
    if (this.CanGoForward()) this.m_navHistory.splice(this.m_navIndex + 1);

    if (
      this.m_navHistory.length === 0 ||
      !this.m_navHistory[this.m_navHistory.length - 1]!.equals(aPath)
    )
      this.m_navHistory.push(aPath.Clone());

    this.m_navIndex = this.m_navHistory.length - 1;
  }

  private changeSheet(aPath: SCH_SHEET_PATH): void {
    this.m_frame!.GetToolManager()!.RunAction(ACTIONS.cancelInteractive);
    this.m_frame!.GetToolManager()!.RunAction(ACTIONS.selectionClear);

    // Store the current zoom level into the current screen before switching
    const view = this.m_frame!.GetCanvas()?.GetView();

    if (view) this.m_frame!.GetScreen()!.m_LastZoomLevel = view.GetScale();

    this.pushToHistory(aPath);

    this.m_frame!.ClearFocus();
    this.m_frame!.Schematic().SetCurrentSheet(aPath);
    this.m_frame!.DisplayCurrentSheet();
  }
}
