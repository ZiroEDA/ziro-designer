import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pcbBridge, plotPictureLayers, readBoard } from '@ziroeda/ai/pcb_bridge.js';
import { EMBEDDED_FILES } from '@ziroeda/common/embedded_files.js';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import { TOOL_MANAGER } from '@ziroeda/common/tool/tool_manager.js';
import { LeaderMode as LEADER_MODE } from '@ziroeda/kimath/src/geometry/geometry_utils.js';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import type { BOARD_ITEM_CONTAINER } from '@ziroeda/pcbnew/board_item_container.js';
import { BOARD_COMMIT } from '@ziroeda/pcbnew/board_commit.js';
import { PCB_BASE_EDIT_FRAME } from '@ziroeda/pcbnew/pcb_base_edit_frame.js';
import type { FOOTPRINT_EDITOR_SETTINGS_LIKE } from '@ziroeda/pcbnew/pcb_base_frame.js';
import type { PCB_EDIT_FRAME } from '@ziroeda/pcbnew/pcb_edit_frame.js';
import { PCB_VIA } from '@ziroeda/pcbnew/pcb_track.js';
import { PCB_IO_KICAD_SEXPR_PARSER } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr_parser.js';
import type { FOOTPRINT } from '@ziroeda/pcbnew/footprint.js';
import type { PcbScriptApi } from '@ziroeda/pcbnew/pcb_script_api.js';
import { PCBNEW_SETTINGS } from '@ziroeda/pcbnew/pcbnew_settings.js';
import { beforeAll, describe, expect, it } from 'vitest';

const BOARD_FILE = fileURLToPath(
  new URL('../../data/pcbnew/resave/ecc83-pp.kicad_pcb', import.meta.url),
);

/** A PCB editor frame without the window, as board_commit.test.ts builds it. */
class TEST_FRAME extends PCB_BASE_EDIT_FRAME {
  readonly settings = new PCBNEW_SETTINGS();
  commits = 0;
  constructor(board: BOARD) {
    super(FRAME_T.FRAME_PCB_EDITOR);
    this.SetBoard(board);
    this.m_toolManager = new TOOL_MANAGER();
    this.m_toolManager.SetEnvironment(board, null, null, this.settings, this);
  }
  GetName(): string {
    return 'PcbFrame';
  }
  GetModel(): BOARD_ITEM_CONTAINER | null {
    return this.m_pcb;
  }
  GetPcbNewSettings(): PCBNEW_SETTINGS {
    return this.settings;
  }
  GetFootprintEditorSettings(): FOOTPRINT_EDITOR_SETTINGS_LIKE {
    return {
      m_DisplayInvertXAxis: false,
      m_DisplayInvertYAxis: false,
      m_AngleSnapMode: LEADER_MODE.DIRECT,
    };
  }
  override OnModify(): void {
    super.OnModify();
    this.commits++;
  }
}

type Pt = { x: number; y: number };

/** Two top-only SMD pads on one net: the fixture above is all through-hole. */
const SMD_BOARD = `(kicad_pcb (version 20241229) (generator "test")
  (general (thickness 1.6))
  (layers (0 "F.Cu" signal) (31 "B.Cu" signal) (44 "Edge.Cuts" user))
  (net 0 "")
  (net 1 "N1")
  (footprint "R:R1" (layer "F.Cu") (at 100 100)
    (property "Reference" "R1" (at 0 0 0) (layer "F.SilkS"))
    (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu") (net 1 "N1")))
  (footprint "R:R2" (layer "F.Cu") (at 110 100)
    (property "Reference" "R2" (at 0 0 0) (layer "F.SilkS"))
    (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu") (net 1 "N1")))
)`;

function setup(text = readFileSync(BOARD_FILE, 'utf8')) {
  const board = new PCB_IO_KICAD_SEXPR_PARSER(text, BOARD_FILE).Parse() as BOARD;
  board.BuildConnectivity();
  const frame = new TEST_FRAME(board);
  const routed: { from: Pt; to: Pt; layer: string; through?: Pt[] }[] = [];
  const api: PcbScriptApi = {
    route: async (from, to, layer, through = []) => {
      routed.push({ from, to, layer, ...(through.length ? { through: [...through] } : {}) });
      return { ok: true, reason: '' };
    },
    board: () => board,
    frame: () => frame as unknown as PCB_EDIT_FRAME,
    updateFromSchematic: async () => ({ ok: true, report: '' }),
    fillZones: () => {},
    // A stand-in library footprint: a fresh copy of one on the board.
    loadFootprint: async () => (board.Footprints()[0]?.Duplicate(false) as FOOTPRINT) ?? null,
  };
  return { board, frame, routed, bridge: pcbBridge(api) };
}

const run = async (
  b: ReturnType<typeof setup>['bridge'],
  name: string,
  args: Record<string, unknown> = {},
) => {
  const out = await b.run(name, args);
  if (!out) throw new Error(`no tool ${name}`);
  return out;
};

beforeAll(async () => {
  await EMBEDDED_FILES.InitCodec();
});

describe('the AI board tools', () => {
  it('read_board lists every footprint and the connectivity state', () => {
    const { board } = setup();
    const view = readBoard(board);
    const fps = view.split('\n').filter((l) => l.startsWith('fp '));
    expect(fps).toHaveLength(board.Footprints().length);
    expect(view).toMatch(/^fp C1 \S+:\S+ @[\d.]+,[\d.]+/m);
    expect(view).toMatch(/^tracks \d+ vias \d+ unrouted \d+$/m);
  });

  it('place moves, rotates and flips footprints in ONE commit', async () => {
    const { board, frame, bridge } = setup();
    const out = await run(bridge, 'place', {
      placements: [
        { ref: 'C1', x: 120, y: 80, rot: 90 },
        { ref: 'C2', x: 130, y: 80, side: 'B' },
        { ref: 'NOPE', x: 0, y: 0 },
      ],
    });
    expect(out.text).toBe('Placed 2 footprints.\nno footprint NOPE');
    expect(frame.commits).toBe(1);
    const c1 = board.FindFootprintByReference('C1');
    expect(c1?.GetPosition()).toEqual({ x: 120e6, y: 80e6 });
    expect(c1?.GetOrientation().AsDegrees()).toBe(90);
    expect(board.FindFootprintByReference('C2')?.IsFlipped()).toBe(true);
    expect(readBoard(board)).toMatch(/^fp C1 \S+ @120,80 r90 F /m);
  });

  it('set_outline replaces Edge.Cuts with one rectangle', async () => {
    const { board, bridge } = setup();
    await run(bridge, 'set_outline', { x: 100, y: 50, width: 60, height: 40 });
    const edge = board.GetLayerID('Edge.Cuts');
    expect(board.Drawings().filter((d) => d.GetLayer() === edge)).toHaveLength(1);
    expect(readBoard(board)).toMatch(/^board \d-layer outline rect @100,50 60x40$/m);
  });

  it('add_zone pours a named net over the outline', async () => {
    const { board, bridge } = setup();
    await run(bridge, 'set_outline', { x: 100, y: 50, width: 60, height: 40 });
    const zones = board.Zones().length;
    const gnd =
      board
        .Footprints()
        .flatMap((f) => f.Pads())
        .find((p) => p.GetNetname())
        ?.GetNetname() ?? '';
    const out = await run(bridge, 'add_zone', { net: gnd, layer: 'B.Cu' });
    expect(out.isError).toBeFalsy();
    expect(board.Zones()).toHaveLength(zones + 1);
    // KiCad's standard name, whatever the board calls the layer (this one: bottom_cu).
    expect(readBoard(board)).toContain(`zone ${gnd} B.Cu`);
    expect((await run(bridge, 'add_zone', { net: 'NO_SUCH_NET', layer: 'B.Cu' })).isError).toBe(
      true,
    );
  });

  it('route hands the router the two pads, from the start pad side', async () => {
    const { board, routed, bridge } = setup();
    const pads = board
      .Footprints()
      .flatMap((f) => f.Pads())
      .filter((p) => p.GetNetname());
    const [a, b] = pads;
    if (!a || !b) throw new Error('fixture has no pads');
    const name = (p: typeof a) => `${p.GetParentFootprint()?.GetReference()}.${p.GetNumber()}`;
    const out = await run(bridge, 'route', { from: name(a), to: name(b) });
    expect(out.isError).toBeFalsy();
    expect(routed).toEqual([{ from: a.GetPosition(), to: b.GetPosition(), layer: 'F.Cu' }]);
    expect((await run(bridge, 'route', { from: 'Q9.9', to: name(b) })).text).toBe('no pad Q9.9');
  });

  it('route_net routes each unrouted ratsnest edge of that net and no other', async () => {
    const { board, frame, routed, bridge } = setup();
    // Rip every track up, so the ratsnest has edges to route.
    const rip = new BOARD_COMMIT(frame);
    for (const t of board.Tracks()) rip.Remove(t);
    rip.Push('rip up');
    const want = new Map<string, number>();
    board.GetConnectivity().RunOnUnconnectedEdges((e) => {
      const n = e.GetSourceNode()?.Parent().GetNetname() ?? '';
      want.set(n, (want.get(n) ?? 0) + 1);
      return true;
    });
    const [net, edges] = [...want].find(([n]) => n) ?? ['', 0];
    if (!net) throw new Error('fixture has no unrouted net');
    const out = await run(bridge, 'route_net', { net });
    expect(out.text).toBe(`${net}: routed ${edges} of ${edges}.`);
    expect(routed).toHaveLength(edges);
  });

  it("unroute removes one net's copper and leaves the rest", async () => {
    const { board, bridge } = setup();
    const net =
      board
        .Tracks()
        .find((t) => t.GetNetname())
        ?.GetNetname() ?? '';
    const others = board.Tracks().filter((t) => t.GetNetname() !== net).length;
    const out = await run(bridge, 'unroute', { net });
    expect(out.isError).toBeFalsy();
    expect(board.Tracks().filter((t) => t.GetNetname() === net)).toHaveLength(0);
    expect(board.Tracks()).toHaveLength(others);
    expect((await run(bridge, 'unroute', { net: 'NO_SUCH_NET' })).isError).toBe(true);
  });

  it('delete_zone removes the zones of that net', async () => {
    const { board, bridge } = setup();
    const z = board.Zones()[0];
    if (!z) throw new Error('fixture has no zone');
    const before = board.Zones().length;
    await run(bridge, 'delete_zone', { net: z.GetNetname() });
    expect(board.Zones().length).toBeLessThan(before);
    expect(board.Zones().some((x) => x.GetNetname() === z.GetNetname())).toBe(false);
  });

  it('undo_board takes back the last edit', async () => {
    const { board, bridge } = setup();
    const was = { ...(board.FindFootprintByReference('C1')?.GetPosition() ?? { x: 0, y: 0 }) };
    await run(bridge, 'place', { placements: [{ ref: 'C1', x: 120, y: 80 }] });
    expect(board.FindFootprintByReference('C1')?.GetPosition()).toEqual({ x: 120e6, y: 80e6 });
    const out = await run(bridge, 'undo_board');
    expect(out.isError).toBeFalsy();
    expect(board.FindFootprintByReference('C1')?.GetPosition()).toEqual(was);
  });

  it('add_via puts a through via on the net, and the view lists it', async () => {
    const { board, bridge } = setup();
    const net =
      board
        .Footprints()
        .flatMap((f) => f.Pads())
        .find((p) => p.GetNetname())
        ?.GetNetname() ?? '';
    const out = await run(bridge, 'add_via', { net, x: 110, y: 70 });
    expect(out.isError).toBeFalsy();
    const via = board.Tracks().find((t) => t instanceof PCB_VIA && t.GetPosition().x === 110e6);
    expect(via?.GetNetname()).toBe(net);
    expect(readBoard(board)).toContain(`via ${net} @110,70`);
  });

  it('add_mounting_hole adds a board-only H1 that schematic updates keep', async () => {
    const { board, bridge } = setup();
    const n = board.Footprints().length;
    const out = await run(bridge, 'add_mounting_hole', { x: 105, y: 55 });
    expect(out.text).toBe('H1 (M3) at 105,55.');
    expect(board.Footprints()).toHaveLength(n + 1);
    const h = board.FindFootprintByReference('H1');
    expect(h?.GetPosition()).toEqual({ x: 105e6, y: 55e6 });
    expect(h?.IsBoardOnly()).toBe(true);
    expect(readBoard(board)).toMatch(/^fp H1 .* board-only$/m);
    expect((await run(bridge, 'add_mounting_hole', { x: 1, y: 1, size: 'M7' })).isError).toBe(true);
  });

  it('edit_text moves, turns and hides a designator', async () => {
    const { board, bridge } = setup();
    await run(bridge, 'edit_text', { ref: 'C1', x: 101, y: 52, rot: 90 });
    const t = board.FindFootprintByReference('C1')?.Reference();
    expect(t?.GetPosition()).toEqual({ x: 101e6, y: 52e6 });
    expect(t?.GetTextAngle().AsDegrees()).toBe(90);
    await run(bridge, 'edit_text', { ref: 'C1', visible: false });
    expect(board.FindFootprintByReference('C1')?.Reference().IsVisible()).toBe(false);
  });

  it('route takes @x,y ends and refuses a pad that is not on the layer', async () => {
    const { routed, bridge } = setup(SMD_BOARD);
    const refused = await run(bridge, 'route', { from: 'R1.1', to: '@120,70', layer: 'B.Cu' });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain('the start pad R1.1 is not on B.Cu');
    const target = await run(bridge, 'route', { from: '@90,100', to: 'R2.1', layer: 'B.Cu' });
    expect(target.text).toContain('the target pad R2.1 is not on B.Cu');
    expect(routed).toHaveLength(0);
    await run(bridge, 'route', { from: 'R1.1', to: '@105,100' });
    expect(routed).toEqual([
      { from: { x: 100e6, y: 100e6 }, to: { x: 105e6, y: 100e6 }, layer: 'F.Cu' },
    ]);
  });

  it('view_board plots one SVG per picture layer, each with drawing in it', () => {
    const { board } = setup();
    const { svgs } = plotPictureLayers(board);
    expect(svgs).toHaveLength(4);
    for (const svg of svgs) {
      expect(svg).toMatch(/^<\?xml|<svg/);
      expect(svg).toMatch(/<(path|polyline|polygon|circle|line|rect)\b/);
    }
  });

  it('route passes waypoints to the router in mm order', async () => {
    const { routed, bridge } = setup(SMD_BOARD);
    const out = await run(bridge, 'route', {
      from: 'R1.1',
      to: 'R2.1',
      through: ['@102,95', '@108,95'],
    });
    expect(out.text).toBe('Routed R1.1 -> R2.1 on F.Cu through 2 points.');
    expect(routed[0]?.through).toEqual([
      { x: 102e6, y: 95e6 },
      { x: 108e6, y: 95e6 },
    ]);
  });

  it('set_outline makes a rounded rectangle, a circle and any polygon, and reads each back', async () => {
    const { board, bridge } = setup();
    const edges = () =>
      board.Drawings().filter((d) => d.GetLayer() === board.GetLayerID('Edge.Cuts'));
    await run(bridge, 'set_outline', { x: 100, y: 50, width: 60, height: 40, corner_radius: 3 });
    expect(readBoard(board)).toMatch(/^board \d-layer outline rect @100,50 60x40 r=3$/m);
    await run(bridge, 'set_outline', { shape: 'circle', x: 130, y: 70, diameter: 50 });
    expect(edges()).toHaveLength(1);
    expect(readBoard(board)).toMatch(/^board \d-layer outline circle @130,70 d=50$/m);
    // An L: what a board shaped to an enclosure looks like.
    const L = [
      [100, 50],
      [160, 50],
      [160, 70],
      [130, 70],
      [130, 90],
      [100, 90],
    ];
    await run(bridge, 'set_outline', { shape: 'polygon', points: L });
    expect(edges()).toHaveLength(1);
    expect(readBoard(board)).toMatch(
      /^board \d-layer outline poly 100,50 160,50 160,70 130,70 130,90 100,90$/m,
    );
    expect(
      (
        await run(bridge, 'set_outline', {
          shape: 'polygon',
          points: [
            [0, 0],
            [1, 1],
          ],
        })
      ).isError,
    ).toBe(true);
    expect(
      (await run(bridge, 'set_outline', { width: 10, height: 10, corner_radius: 6 })).isError,
    ).toBe(true);
  });
});
