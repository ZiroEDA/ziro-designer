// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `BuildStackupReport` (`board_stackup_manager/board_stackup_reporter.cpp`):
 * the Physical Stackup page's "Export to Clipboard" text.
 */
import { describe, expect, it } from 'vitest';
import { IsValidLayer } from '@ziroeda/common/src/layer_ids.js';
import { BOARD } from '@ziroeda/pcbnew/board.js';
import { BS_EDGE_CONNECTOR_BEVELLED } from '@ziroeda/pcbnew/board_stackup_manager/board_stackup.js';
import { BuildStackupReport } from '@ziroeda/pcbnew/board_stackup_manager/board_stackup_reporter.js';

function fourLayer(): BOARD {
  const b = new BOARD();
  b.SetCopperLayerCount(4);
  const bds = b.GetDesignSettings();
  const st = bds.GetStackupDescriptor();
  st.BuildDefaultStackupList(bds, 4);
  // The names are empty until the Board Setup dialog has run once
  // (`transferDataFromUIToStackup`); a never-set-up board reports `layer ""`.
  for (const i of st.GetList())
    if (IsValidLayer(i.GetBrdLayerId())) i.SetLayerName(b.GetLayerName(i.GetBrdLayerId()));
  return b;
}

describe('BuildStackupReport', () => {
  it('is one line per enabled layer, the format strings of the C++ to the character', () => {
    const st = fourLayer().GetDesignSettings().GetStackupDescriptor();
    const lines = BuildStackupReport(st, 'mm').split('\n');
    // Silk: colour editable, thickness not, material yes, εr and tanδ not
    // (`IsColorEditable` / `IsThicknessEditable` / `HasEpsilonRValue`).
    expect(lines[0]).toBe(
      'layer "F.Silkscreen" type "Top Silk Screen" Color "Not specified" Material "Not specified"',
    );
    // Paste: nothing editable at all.
    expect(lines[1]).toBe('layer "F.Paste" type "Top Solder Paste"');
    // Mask: colour, thickness, material, εr AND tanδ.
    expect(lines[2]).toBe(
      'layer "F.Mask" type "Top Solder Mask" Color "Not specified" Thickness 0.01 mm Material "Not specified" EpsilonR 3.3 LossTg 0',
    );
    expect(lines[3]).toBe('layer "F.Cu" type "copper" Thickness 0.035 mm');
    // A dielectric: `FormatDielectricLayerName`, then the "1/n" sublayer text is
    // part of the SAME Printf, so the Color lands on the sublayer line.
    expect(lines[4]).toBe('layer "Dielectric 1" type "core"');
    expect(lines[5]).toBe(
      '  sublayer "1/1" Color "Not specified" Thickness 0.48 mm Material "FR4" EpsilonR 4.5 LossTg 0.02',
    );
    expect(lines.length).toBe(1 + 13 + 3 + 1); // 13 layers + 3 sublayer lines + finish + trailing ''
    expect(lines.at(-2)).toBe('Finish "None"');
    expect(lines.at(-1)).toBe('');
  });

  it('a locked sublayer says Locked, a second sublayer gets its own line, inches follow the units', () => {
    const st = fourLayer().GetDesignSettings().GetStackupDescriptor();
    const diel = st.GetList()[4]!;
    diel.SetThicknessLocked(true, 0);
    diel.AddDielectricPrms(1);
    const lines = BuildStackupReport(st, 'in').split('\n');
    expect(lines[5]).toMatch(
      /^ {2}sublayer "1\/2" Color "Not specified" Thickness 0\.0188\d* in Locked Material "FR4" EpsilonR 4\.5 LossTg 0\.02$/,
    );
    expect(lines[6]).toMatch(/^ {2}sublayer "2\/2" Thickness /);
  });

  it('the finish line carries the three options in upstream order', () => {
    const st = fourLayer().GetDesignSettings().GetStackupDescriptor();
    st.m_FinishType = 'ENIG';
    st.m_HasDielectricConstrains = true;
    st.m_EdgePlating = true;
    st.m_EdgeConnectorConstraints = BS_EDGE_CONNECTOR_BEVELLED;
    expect(BuildStackupReport(st, 'mm').split('\n').at(-2)).toBe(
      'Finish "ENIG" Option "Impedance Controlled" Option "Plated edges" EdgeConnector "yes,bevelled"',
    );
  });

  it('a disabled layer is skipped', () => {
    const st = fourLayer().GetDesignSettings().GetStackupDescriptor();
    st.GetList()[1]!.SetEnabled(false);
    expect(BuildStackupReport(st, 'mm')).not.toContain('F.Paste');
  });
});
