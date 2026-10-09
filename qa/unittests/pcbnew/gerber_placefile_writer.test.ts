// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Gerber X3 placement files (PLACEFILE_GERBER_WRITER,
 * `gerber_placefile_writer.cpp`) against KiCad's own:
 * `qa/data/pcbnew/exporters_oracle/pnp/` is what `kicad-cli pcb export pos
 * --format gerber` (10.0.6) wrote. `gerber_oracle_pnp.kicad_pcb` has a
 * footprint with a courtyard at 90 degrees on the front and one without, at
 * 30 degrees, on the back (its outline is the pads' box). The writer is set
 * up as `PCBNEW_JOBS_HANDLER::JobExportPos` sets it up, and every file must
 * match byte for byte except the lines naming the program and the clock.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { PLACEFILE_GERBER_WRITER } from '@ziroeda/pcbnew/exporters/gerber_placefile_writer.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';

const DATA = resolve(__dirname, '../../data/pcbnew');
const PNP = resolve(DATA, 'exporters_oracle/pnp');

const BOARDS: Record<string, string> = {
  'ecc83-pp': 'resave/ecc83-pp.kicad_pcb',
  interf_u: 'resave/interf_u.kicad_pcb',
  gerber_oracle_pnp: 'plot/gerber_oracle_pnp.kicad_pcb',
  // gerber_oracle_pnp with an Edge.Cuts line inside U1: a footprint edge.
  gerber_oracle_pnp_fpedge: 'plot/gerber_oracle_pnp_fpedge.kicad_pcb',
};

const IDENTITY = /^(%TF\.GenerationSoftware,|%TF\.CreationDate,|G04 Created by )/;

const normalise = (text: string): string =>
  text
    .split('\n')
    .map((line) => (IDENTITY.test(line) ? '<identity>' : line))
    .join('\n');

/** One oracle file name -> the board, the side and the board-edge option. */
function jobOf(aFile: string): { board: string; layer: PCB_LAYER_ID; edges: boolean } {
  const m = /^(.*?)(-edge)?-pnp_(front|back)\.gbr$/.exec(aFile)!;
  return {
    board: m[1]!,
    edges: !!m[2],
    layer: m[3] === 'back' ? PCB_LAYER_ID.B_Cu : PCB_LAYER_ID.F_Cu,
  };
}

function write(
  aBoard: string,
  aLayer: PCB_LAYER_ID,
  aEdges: boolean,
): { text: string; count: number } {
  const board = ParseBoard(readFileSync(resolve(DATA, BOARDS[aBoard]!), 'utf8'));
  board.SetFileName(`/oracle/${aBoard}.kicad_pcb`);
  const writer = new PLACEFILE_GERBER_WRITER(board);
  // JobExportPos: exporter.SetVariant(...), then CreatePlaceFile( file, layer,
  // m_gerberBoardEdge, m_excludeDNP, false ).
  const name = writer.GetPlaceFileName('out.gbr', aLayer);
  const count = writer.CreatePlaceFile(name, aLayer, aEdges, false, false);
  return { text: new TextDecoder().decode(writer.GetWrittenFiles().get(name)), count };
}

describe('placement Gerbers match kicad-cli byte for byte', () => {
  for (const file of readdirSync(PNP).sort()) {
    it(file, () => {
      const job = jobOf(file);
      const expected = readFileSync(resolve(PNP, file), 'utf8');
      expect(normalise(write(job.board, job.layer, job.edges).text)).toBe(normalise(expected));
    });
  }
});

describe('PLACEFILE_GERBER_WRITER', () => {
  it('counts the footprints on the side it wrote', () => {
    expect(write('gerber_oracle_pnp', PCB_LAYER_ID.F_Cu, false).count).toBe(1);
    expect(write('gerber_oracle_pnp', PCB_LAYER_ID.B_Cu, false).count).toBe(1);
    expect(write('ecc83-pp', PCB_LAYER_ID.B_Cu, false).count).toBe(0);
  });

  it('names the file -pnp_top / -pnp_bottom with a .gbr extension', () => {
    const writer = new PLACEFILE_GERBER_WRITER(
      ParseBoard(readFileSync(resolve(DATA, BOARDS.interf_u!), 'utf8')),
    );
    expect(writer.GetPlaceFileName('dir/board.kicad_pcb', PCB_LAYER_ID.F_Cu)).toBe(
      'dir/board-pnp_top.gbr',
    );
    expect(writer.GetPlaceFileName('dir/board.kicad_pcb', PCB_LAYER_ID.B_Cu)).toBe(
      'dir/board-pnp_bottom.gbr',
    );
  });

  it("offsets every coordinate by the aux origin when the board's plot options use it", () => {
    // CreatePlaceFile reads PCB_PLOT_PARAMS::GetUseAuxOrigin, not a dialog option.
    const text = readFileSync(resolve(DATA, BOARDS.gerber_oracle_pnp!), 'utf8');
    const flash = (aUseAux: boolean): string => {
      const board = ParseBoard(text);
      board.GetDesignSettings().SetAuxOrigin({ x: 10_000_000, y: 5_000_000 });
      const opts = board.GetPlotOptions();
      opts.SetUseAuxOrigin(aUseAux);
      board.SetPlotOptions(opts);
      const writer = new PLACEFILE_GERBER_WRITER(board);
      writer.CreatePlaceFile('a.gbr', PCB_LAYER_ID.F_Cu, false, false, false);
      const out = new TextDecoder().decode(writer.GetWrittenFiles().get('a.gbr'));
      // The component position flash: the first D03 after the ComponentMain aperture.
      return /\nX(-?\d+)Y(-?\d+)D03\*/.exec(out)!.slice(1).join(',');
    };

    // U1 is at (40, 30) mm; Gerber Y is up, so (40, -30) less the origin (10, 5).
    expect(flash(false)).toBe('40000000,-30000000');
    expect(flash(true)).toBe('30000000,-25000000');
  });

  it('leaves out a DNP footprint only when asked', () => {
    const text = readFileSync(resolve(DATA, BOARDS.gerber_oracle_pnp!), 'utf8');
    const board = ParseBoard(text);
    const u1 = board.Footprints().find((f) => f.GetReference() === 'U1')!;
    u1.SetDNP(true);
    const writer = new PLACEFILE_GERBER_WRITER(board);

    expect(writer.CreatePlaceFile('a.gbr', PCB_LAYER_ID.F_Cu, false, false, false)).toBe(1);
    expect(writer.CreatePlaceFile('b.gbr', PCB_LAYER_ID.F_Cu, false, true, false)).toBe(0);
  });
});
