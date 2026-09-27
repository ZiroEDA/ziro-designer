// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Excellon drill file, the counterpart of `GENDRILL_EXCELLON_WRITER`
 * (`pcbnew/exporters/gendrill_excellon_writer.cpp`) in decimal-metric format.
 *
 * Not yet a port of the class: this is the function writer that sat beside
 * the old Gerber writer in `plot_gerber.ts`, moved here unchanged when that
 * writer was replaced by GERBER_PLOTTER. It still reads the Board view.
 */

import type { Board } from '../types.js';
import { pcbIuToMM as iuToMM } from '@ziroeda/common/eda_units.js';
import { GENERATOR_APPLICATION } from '@ziroeda/common/generator.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

/** Trimmed decimal mm for Excellon coordinates ("X200.0Y-148.0"). */
const dmm = (iu: number): string => {
  const s = iuToMM(iu).toFixed(3).replace(/0+$/, '').replace(/\.$/, '.0');
  return s.includes('.') ? s : `${s}.0`;
};

/**
 * Excellon drill file for all plated + non-plated holes (PTH pads and vias),
 * GENDRILL_EXCELLON_WRITER's decimal-metric format.
 */
export function plotExcellonDrill(
  board: Board,
  opts: { creationDate?: string; origin?: Vec2 } = {},
): string {
  const org = opts.origin ?? { x: 0, y: 0 };
  // tool diameter (IU) -> hole positions
  const tools = new Map<number, Vec2[]>();
  const addHole = (d: number, at: Vec2): void => {
    if (d <= 0) return;
    const arr = tools.get(d) ?? [];
    arr.push(at);
    tools.set(d, arr);
  };
  for (const v of board.vias) addHole(v.drill, v.at);
  for (const fp of board.footprints)
    for (const p of fp.pads) if (p.drill && p.drill.w > 1) addHole(p.drill.w, p.at);

  const dias = [...tools.keys()].sort((a, b) => a - b);
  const out: string[] = [
    'M48',
    ...(opts.creationDate
      ? [`; DRILL file ${GENERATOR_APPLICATION} date ${opts.creationDate}`]
      : []),
    '; FORMAT={-:-/ absolute / metric / decimal}',
    'FMAT,2',
    'METRIC',
    ...dias.map((d, i) => `T${i + 1}C${iuToMM(d).toFixed(3)}`),
    '%',
    'G90',
    'G05',
  ];
  dias.forEach((d, i) => {
    out.push(`T${i + 1}`);
    for (const at of tools.get(d)!) out.push(`X${dmm(at.x - org.x)}Y${dmm(-(at.y - org.y))}`);
  });
  out.push('M30');
  return `${out.join('\n')}\n`;
}
