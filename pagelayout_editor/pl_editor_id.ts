// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pagelayout_editor/pl_editor_id.h`: the Drawing Sheet Editor's command
 * ids, numbered on from `ID_END_LIST` (include/id.h). `Files_io` takes
 * `ID_APPEND_DESCR_FILE` by its name (`PL_FILES_IO_ID`); the two choice ids
 * name the toolbar boxes `ClearToolbarControl` forgets.
 */
import { main_id } from '@ziroeda/common/id.js';

export enum pl_editor_ids {
  ID_SELECT_COORDINATE_ORIGIN = main_id.ID_END_LIST,
  ID_SELECT_PAGE_NUMBER,

  ID_APPEND_DESCR_FILE,

  ID_PLEDITOR_END_LIST,
}
