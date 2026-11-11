// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Board Setup > Board Stackup > Board Finish. Counterpart:
 * `pcbnew/board_stackup_manager/panel_board_finish_base.cpp` (PANEL_SETUP_BOARD_FINISH),
 * plated-board-edge flag, copper finish (from the predefined list in
 * stackup_predefined_prms.cpp), and edge-card-connector option. Feeds the
 * .gbrjob fabrication file.
 *
 * The page is a `wxCheckBox` and a `wxFlexGridSizer( 0, 2, 5, 0 )` of two
 * label + `wxChoice` rows, and nothing else — no group box, no heading, no
 * static line. So: `Check` and `Sel` out of `dialogs/prefs/widgets.tsx`, in a
 * bare `.ze-pref-group-body` (the sizer, without a `Group`'s heading). The
 * 12.5px grid and the two native `<select>`s that used to be here were both
 * ours; a wxChoice is owner-drawn and a `<select>`'s popup cannot be themed at
 * all (see `ui/Combo.tsx`).
 */

import type { JSX } from 'react';
import { PANEL_SETUP_BOARD_FINISH_BASE } from './panel_board_finish_base.js';
import { GetStandardCopperFinishes } from './stackup_predefined_prms.js';
import type { BOARD } from '../board.js';
import type { BS_EDGE_CONNECTOR_CONSTRAINTS } from './board_stackup.js';
import { _ } from '@ziroeda/wx/translation.js';
import { _HKI } from '@ziroeda/include/i18n_utility.js';

export interface BoardFinish {
  platedBoardEdge: boolean;
  copperFinish: string;
  edgeCardConnectors: string;
}

/** BS_EDGE_CONNECTOR_CONSTRAINTS: BS_EDGE_CONNECTOR_NONE 0, _IN_USE 1, _BEVELLED 2. */
export const EDGE_CONNECTORS = [_HKI('None'), _HKI('Yes'), _HKI('Yes, bevelled')] as const;

/** The choice's selection as BS_EDGE_CONNECTOR_CONSTRAINTS. */
export const edgeConnectorOf = (aLabel: string): BS_EDGE_CONNECTOR_CONSTRAINTS =>
  Math.max(0, EDGE_CONNECTORS.indexOf(aLabel as (typeof EDGE_CONNECTORS)[number]));

/** PANEL_SETUP_BOARD_FINISH's transfers (panel_board_finish.cpp), over the board's stackup. */
export const PANEL_SETUP_BOARD_FINISH = {
  TransferDataToWindow(aBoard: BOARD): BoardFinish {
    const stackup = aBoard.GetDesignSettings().GetStackupDescriptor();
    return {
      copperFinish: stackup.m_FinishType,
      edgeCardConnectors: EDGE_CONNECTORS[stackup.m_EdgeConnectorConstraints] ?? _('None'),
      platedBoardEdge: stackup.m_EdgePlating,
    };
  },

  /** `TransferDataFromWindow( aStackup )`; true when the stackup changed. */
  TransferDataFromWindow(v: BoardFinish, aBoard: BOARD): boolean {
    const st = aBoard.GetDesignSettings().GetStackupDescriptor();
    const edge = edgeConnectorOf(v.edgeCardConnectors);
    const modified =
      st.m_FinishType !== v.copperFinish ||
      st.m_EdgeConnectorConstraints !== edge ||
      st.m_EdgePlating !== v.platedBoardEdge;
    st.m_FinishType = v.copperFinish;
    st.m_EdgeConnectorConstraints = edge;
    st.m_EdgePlating = v.platedBoardEdge;
    return modified;
  },
};

// [data] `m_choiceEdgeConnChoices` (panel_board_finish_base.cpp:41).

interface Props {
  value: BoardFinish;
  onChange: (next: BoardFinish) => void;
}

/** PANEL_SETUP_BOARD_FINISH's window: its base over the stackup's finish fields. */
export function PanelPcbBoardFinish({ value, onChange }: Props): JSX.Element {
  const set = <K extends keyof BoardFinish>(k: K, v: BoardFinish[K]): void =>
    onChange({ ...value, [k]: v });
  const finishes = GetStandardCopperFinishes();

  return (
    <PANEL_SETUP_BOARD_FINISH_BASE
      m_cbEgdesPlated={{ value: value.platedBoardEdge, onChange: (b) => set('platedBoardEdge', b) }}
      m_choiceFinish={{
        choices: finishes,
        value: finishes.indexOf(value.copperFinish),
        onChange: (i) => set('copperFinish', finishes[i]!),
      }}
      m_choiceEdgeConn={{
        value: EDGE_CONNECTORS.indexOf(
          value.edgeCardConnectors as (typeof EDGE_CONNECTORS)[number],
        ),
        onChange: (i) => set('edgeCardConnectors', EDGE_CONNECTORS[i]!),
      }}
    />
  );
}
