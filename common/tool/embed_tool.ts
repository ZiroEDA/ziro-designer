// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `EMBED_TOOL` (`common/tool/embed_tool.cpp`, `include/tool/embed_tool.h`):
 * the tool behind `ACTIONS::embeddedFiles` and `ACTIONS::removeFile`, which
 * add a file to, or drop one from, the model's `EMBEDDED_FILES`.
 *
 * Four frames register it upstream: `sch_edit_frame.cpp:708`,
 * `symbol_edit_frame.cpp:438`, `pcb_edit_frame.cpp:978` and
 * `footprint_edit_frame.cpp:1253`. Nothing in KiCad 10.0.5 runs either action
 * through the manager - `PANEL_EMBEDDED_FILES` edits its collection directly,
 * and `pcb_edit_frame.cpp:1322` / `footprint_edit_frame.cpp:1473` only name
 * `ACTIONS::embeddedFiles` in a `CURRENT_EDIT_TOOL` condition.
 *
 * The one difference from the C++: a model the manager does not have yet
 * (our PCB_EDIT_FRAME builds its tools before a board is loaded, where
 * upstream's constructor has already made an empty BOARD) leaves `m_files`
 * null rather than dereferencing it; `Reset( MODEL_RELOAD )` on the board's
 * arrival picks the collection up.
 */
import type { EDA_ITEM } from '../eda_item.js';
import type { EMBEDDED_FILES } from '../embedded_files.js';
import { ACTIONS } from './actions.js';
import type { RESET_REASON } from './tool_base.js';
import type { TOOL_EVENT } from './tool_event.js';
import { SYNC_HANDLER, TOOL_INTERACTIVE } from './tool_interactive.js';

export class EMBED_TOOL extends TOOL_INTERACTIVE {
  private m_files: EMBEDDED_FILES | null;

  constructor(aName = 'common.Embed') {
    super(aName);
    this.m_files = null;
  }

  /** `m_files = getModel<EDA_ITEM>()->GetEmbeddedFiles()`. */
  private modelFiles(): EMBEDDED_FILES | null {
    return this.getModel<EDA_ITEM>()?.GetEmbeddedFiles() ?? null;
  }

  /// @copydoc TOOL_INTERACTIVE::Init()
  override Init(): boolean {
    this.m_files = this.modelFiles();

    return true;
  }

  /// @copydoc TOOL_INTERACTIVE::Reset()
  override Reset(_aReason: RESET_REASON): void {
    this.m_files = this.modelFiles();
  }

  AddFile(aEvent: TOOL_EVENT): number {
    const name = aEvent.Parameter<string>();
    this.m_files?.AddFile(name, false);

    return 1;
  }

  RemoveFile(aEvent: TOOL_EVENT): number {
    const name = aEvent.Parameter<string>();
    this.m_files?.RemoveFile(name);

    return 1;
  }

  GetFileList(): string[] {
    const list: string[] = [];

    if (!this.m_files) return list;

    for (const [name] of this.m_files.EmbeddedFileMap()) list.push(name);

    return list;
  }

  /// @copydoc TOOL_INTERACTIVE::setTransitions();
  protected setTransitions(): void {
    this.Go(SYNC_HANDLER(this.AddFile), ACTIONS.embeddedFiles.MakeEvent());
    this.Go(SYNC_HANDLER(this.RemoveFile), ACTIONS.removeFile.MakeEvent());
  }
}
