/**
 * The AI's hands and eyes on the board. Parts and nets come from the
 * schematic (Update PCB from Schematic); what the model decides here is
 * actions: the outline, where each footprint goes, pours, and checking the
 * result. Every edit is one BOARD_COMMIT on the live BOARD, so one Ctrl+Z.
 */
import { SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { toCss } from '@ziroeda/common/gal/color4d.js';
import { LAYER_PCB_BACKGROUND, PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { LSET } from '@ziroeda/common/lset.js';
import { DEFAULT_THEME, PgmOrNull } from '@ziroeda/common/pgm_base.js';
import { PLOT_FORMAT } from '@ziroeda/common/plotters/plotter.js';
import { Reporter } from '@ziroeda/common/reporter.js';
import { COLOR_SETTINGS } from '@ziroeda/common/settings/color_settings.js';
import { RPT_SEVERITY_ERROR, RPT_SEVERITY_IGNORE } from '@ziroeda/common/reporter.js';
import { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { BOARD } from '@ziroeda/pcbnew/board.js';
import { BOARD_COMMIT } from '@ziroeda/pcbnew/board_commit.js';
import type { DRC_JOB_VIOLATION } from '@ziroeda/pcbnew/browser/drc_job.js';
import { DRC_ITEM } from '@ziroeda/pcbnew/drc/drc_item.js';
import type { FOOTPRINT } from '@ziroeda/pcbnew/footprint.js';
import { PAD } from '@ziroeda/pcbnew/pad.js';
import {
  CTL_ENUMERATE_LAYERS,
  CTL_FOR_BOARD,
  FormatBoardAsync,
} from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import type { PcbScriptApi } from '@ziroeda/pcbnew/browser/pcb_script_api.js';
import { PCB_PLOTTER } from '@ziroeda/pcbnew/pcb_plotter.js';
import { DRILL_MARKS, PCB_PLOT_PARAMS } from '@ziroeda/pcbnew/pcb_plot_params.js';
import { PCB_SHAPE } from '@ziroeda/pcbnew/pcb_shape.js';
import { PADSTACK } from '@ziroeda/pcbnew/padstack.js';
import { PCB_VIA } from '@ziroeda/pcbnew/pcb_track.js';
import { VIATYPE } from '@ziroeda/pcbnew/pcb_track_types.js';
import { ZONE } from '@ziroeda/pcbnew/zone.js';
import type { AiBridge, ToolOutput } from './ai_bridge.js';

/** Board units: 1 nm. */
const NM_PER_MM = 1e6;
const mm = (nm: number) => String(Math.round((nm / NM_PER_MM) * 100) / 100);
const nm = (v: unknown) => Math.round(Number(v) * NM_PER_MM);

const EDGE_CUTS = 'Edge.Cuts';

const padName = (p: PAD) => `${p.GetParentFootprint()?.GetReference() ?? '?'}.${p.GetNumber()}`;

function describe(item: unknown): string {
  if (item instanceof PAD) return padName(item);
  const it = item as { GetNetname?: () => string; GetPosition?: () => { x: number; y: number } };
  const at = it.GetPosition?.();
  return `${it.GetNetname?.() || 'item'}${at ? `@${mm(at.x)},${mm(at.y)}` : ''}`;
}

/** KiCad's standard layer name (B.Cu), not a board's own rename of it. */
const layerName = (id: number) => BOARD.GetStandardLayerName(id);

function outlineOf(board: BOARD): string {
  const edges = board.Drawings().filter((d) => d.GetLayer() === board.GetLayerID(EDGE_CUTS));
  if (!edges.length) return 'outline none';
  // A lone shape by its own geometry: the bounding box carries half the
  // line width on every side.
  const only = edges.length === 1 ? edges[0] : undefined;
  if (only instanceof PCB_SHAPE) {
    const shape = only.GetShape();
    if (shape === SHAPE_T.RECTANGLE) {
      const a = only.GetStart();
      const b = only.GetEnd();
      const x = Math.min(a.x, b.x);
      const y = Math.min(a.y, b.y);
      const r = only.GetCornerRadius();
      return `outline rect @${mm(x)},${mm(y)} ${mm(Math.abs(b.x - a.x))}x${mm(Math.abs(b.y - a.y))}${r > 0 ? ` r=${mm(r)}` : ''}`;
    }
    if (shape === SHAPE_T.CIRCLE) {
      const c = only.getCenter();
      return `outline circle @${mm(c.x)},${mm(c.y)} d=${mm(2 * only.GetRadius())}`;
    }
    if (shape === SHAPE_T.POLY)
      return `outline poly ${only
        .GetPolyPoints()
        .map((p) => `${mm(p.x)},${mm(p.y)}`)
        .join(' ')}`;
  }
  const b = board.GetBoardEdgesBoundingBox();
  return `outline bbox @${mm(b.GetX())},${mm(b.GetY())} ${mm(b.GetWidth())}x${mm(b.GetHeight())}`;
}

/** The compact board view: what the model needs to place, pour and check. */
export function readBoard(board: BOARD): string {
  const lines = [`board ${board.GetCopperLayerCount()}-layer ${outlineOf(board)}`];
  for (const fp of board.Footprints()) {
    const p = fp.GetPosition();
    const box = fp.GetBoundingBox(false);
    const rot = Math.round(fp.GetOrientation().AsDegrees());
    lines.push(
      `fp ${fp.GetReference()} ${fp.GetFPID().Format()} @${mm(p.x)},${mm(p.y)}${rot ? ` r${rot}` : ''} ${
        fp.IsFlipped() ? 'B' : 'F'
      } size ${mm(box.GetWidth())}x${mm(box.GetHeight())} val=${fp.GetValue()}${fp.IsBoardOnly() ? ' board-only' : ''}`,
    );
  }
  // Nets by their pads, so the model knows what wants to be near what.
  const byNet = new Map<string, string[]>();
  for (const fp of board.Footprints())
    for (const pad of fp.Pads()) {
      const net = pad.GetNetname();
      if (!net) continue;
      byNet.set(net, [...(byNet.get(net) ?? []), padName(pad)]);
    }
  for (const [net, pads] of byNet) if (pads.length > 1) lines.push(`net ${net} ${pads.join(' ')}`);
  let tracks = 0;
  let vias = 0;
  for (const t of board.Tracks()) {
    if (t instanceof PCB_VIA) {
      vias++;
      const p = t.GetPosition();
      lines.push(`via ${t.GetNetname()} @${mm(p.x)},${mm(p.y)}`);
    } else tracks++;
  }
  for (const z of board.Zones())
    lines.push(
      `zone ${z.GetNetname() || '(no net)'} ${layerName(z.GetFirstLayer())}${z.IsFilled() ? ' filled' : ''}`,
    );
  const conn = board.GetConnectivity();
  const unrouted: string[] = [];
  conn.RunOnUnconnectedEdges((e) => {
    const a = e.GetSourceNode()?.Parent();
    const b = e.GetTargetNode()?.Parent();
    if (a && b) unrouted.push(`${a.GetNetname()}: ${describe(a)}-${describe(b)}`);
    return unrouted.length < 40;
  });
  lines.push(`tracks ${tracks} vias ${vias} unrouted ${conn.GetUnconnectedCount(false)}`);
  if (unrouted.length) lines.push(...unrouted.map((u) => `  unrouted ${u}`));
  return lines.join('\n');
}

/** One BOARD_COMMIT around `edit`, pushed with `message`. */
function commit(
  api: PcbScriptApi,
  message: string,
  edit: (c: BOARD_COMMIT, b: BOARD) => void,
): void {
  const frame = api.frame();
  const board = api.board();
  if (!frame || !board) throw new Error('no board open');
  const c = new BOARD_COMMIT(frame);
  edit(c, board);
  if (!c.Empty()) c.Push(message);
}

/**
 * Replace the board outline (Edge.Cuts) with one closed shape: a rectangle
 * (optionally with rounded corners), a circle, or any polygon.
 */
function setOutline(api: PcbScriptApi, args: Record<string, unknown>): string {
  const kind = String(args.shape ?? 'rect');
  let make: (b: BOARD) => PCB_SHAPE;
  let said: string;
  if (kind === 'rect') {
    const x = nm(args.x ?? 100);
    const y = nm(args.y ?? 50);
    const w = nm(args.width);
    const h = nm(args.height);
    if (!(w > 0 && h > 0)) throw new Error('a rect needs width and height (mm)');
    const r = args.corner_radius !== undefined ? nm(args.corner_radius) : 0;
    if (r < 0 || 2 * r > Math.min(w, h))
      throw new Error('corner_radius must be at most half the shorter side');
    make = (b) => {
      const s = new PCB_SHAPE(b, SHAPE_T.RECTANGLE);
      s.SetStart({ x, y });
      s.SetEnd({ x: x + w, y: y + h });
      if (r > 0) s.SetCornerRadius(r);
      return s;
    };
    said = `rectangle ${args.width} x ${args.height} mm at ${mm(x)},${mm(y)}${r > 0 ? `, corners r ${args.corner_radius}` : ''}`;
  } else if (kind === 'circle') {
    const cx = nm(args.x);
    const cy = nm(args.y);
    const d = nm(args.diameter);
    if (!(d > 0)) throw new Error('a circle needs x, y (centre) and diameter (mm)');
    make = (b) => {
      const s = new PCB_SHAPE(b, SHAPE_T.CIRCLE);
      s.SetStart({ x: cx, y: cy });
      s.SetEnd({ x: cx + d / 2, y: cy });
      return s;
    };
    said = `circle d ${args.diameter} mm at ${mm(cx)},${mm(cy)}`;
  } else if (kind === 'polygon') {
    const pts = ((args.points ?? []) as unknown[]).map((p) => {
      const [x, y] = Array.isArray(p) ? p : [];
      return { x: nm(x), y: nm(y) };
    });
    if (pts.length < 3 || pts.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y)))
      throw new Error('a polygon needs at least 3 points [[x,y],...] in mm');
    make = (b) => {
      const s = new PCB_SHAPE(b, SHAPE_T.POLY);
      s.SetPolyPoints(pts);
      return s;
    };
    said = `polygon of ${pts.length} corners`;
  } else throw new Error('shape is rect, circle or polygon');
  commit(api, 'Board outline', (c, b) => {
    const layer = b.GetLayerID(EDGE_CUTS);
    for (const d of b.Drawings()) if (d.GetLayer() === layer) c.Remove(d);
    const s = make(b);
    s.SetLayer(layer);
    s.SetWidth(nm(0.1));
    c.Add(s);
  });
  return `Outline set: ${said}.`;
}

interface Placement {
  ref: string;
  x: number;
  y: number;
  rot?: number;
  side?: 'F' | 'B';
}

function place(api: PcbScriptApi, args: Record<string, unknown>): string {
  const list = (args.placements ?? []) as Placement[];
  const errors: string[] = [];
  let moved = 0;
  commit(api, 'Place footprints', (c, b) => {
    const flipDir = api.frame()?.GetPcbNewSettings().m_FlipDirection;
    for (const p of list) {
      const fp: FOOTPRINT | null = b.FindFootprintByReference(p.ref);
      if (!fp) {
        errors.push(`no footprint ${p.ref}`);
        continue;
      }
      c.Modify(fp);
      const at = { x: nm(p.x), y: nm(p.y) };
      const wantBack = p.side === 'B';
      if (p.side && wantBack !== fp.IsFlipped() && flipDir !== undefined)
        fp.Flip(fp.GetPosition(), flipDir);
      fp.SetPosition(at);
      if (p.rot !== undefined) fp.SetOrientation(new EDA_ANGLE(Number(p.rot)));
      moved++;
    }
  });
  return `Placed ${moved} footprints.${errors.length ? `\n${errors.join('\n')}` : ''}`;
}

function addZone(api: PcbScriptApi, args: Record<string, unknown>): string {
  const netName = String(args.net ?? '');
  const layerName = String(args.layer ?? 'B.Cu');
  commit(api, 'Add zone', (c, b) => {
    const net = b.FindNet(netName);
    if (!net) throw new Error(`no net ${netName}`);
    const layer = b.GetLayerID(layerName);
    if (layer < 0) throw new Error(`no layer ${layerName}`);
    // The board outline, unless a rectangle is given.
    const box = b.GetBoardEdgesBoundingBox();
    const x = args.x !== undefined ? nm(args.x) : box.GetX();
    const y = args.y !== undefined ? nm(args.y) : box.GetY();
    const w = args.width !== undefined ? nm(args.width) : box.GetWidth();
    const h = args.height !== undefined ? nm(args.height) : box.GetHeight();
    const z = new ZONE(b);
    z.SetLayer(layer);
    z.SetNetCode(net.GetNetCode());
    for (const p of [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h },
    ])
      z.AppendCorner(p, -1);
    c.Add(z);
  });
  return `Zone added: ${netName} on ${layerName}. Run fill_zones to pour it.`;
}

async function runDrc(api: PcbScriptApi): Promise<string> {
  const frame = api.frame();
  const board = api.board();
  if (!frame || !board) return 'no board open';
  const text = await FormatBoardAsync(
    board,
    () => new Promise((r) => setTimeout(r, 0)),
    () => false,
    undefined,
    undefined,
    CTL_FOR_BOARD | CTL_ENUMERATE_LAYERS,
  );
  if (text === null) return 'DRC could not read the board';
  const found: DRC_JOB_VIOLATION[] = [];
  await frame.RunDrcJob(
    {
      boardText: text,
      boardPath: board.GetFileName(),
      projectText: frame.GetProjectText(),
      rulesText: frame.GetDesignRulesText(),
      rulesPath: frame.GetDesignRulesPath(),
      netlistText: frame.GetSchematicNetlistText(),
      units: frame.GetUserUnits(),
      reportAllTrackErrors: false,
      testFootprints: true,
    },
    { onPhase: () => {}, onProgress: () => {}, onViolation: (v) => found.push(v) },
  );
  // Name the items by what the model knows them as.
  const names = new Map<string, string>();
  for (const fp of board.Footprints()) {
    names.set(fp.m_Uuid, fp.GetReference());
    for (const pad of fp.Pads()) names.set(pad.m_Uuid, padName(pad));
  }
  for (const t of board.Tracks()) names.set(t.m_Uuid, describe(t));
  for (const z of board.Zones()) names.set(z.m_Uuid, `zone ${z.GetNetname()}`);
  const settings = board.GetDesignSettings();
  const lines = new Set<string>();
  for (const v of found) {
    const sev = settings.GetSeverity(v.errorCode);
    if (sev === RPT_SEVERITY_IGNORE) continue;
    const title = DRC_ITEM.Create(v.errorCode)?.GetErrorText(false) ?? `code ${v.errorCode}`;
    const items = v.ids.map((id) => names.get(id) ?? '').filter(Boolean);
    lines.add(
      `${sev === RPT_SEVERITY_ERROR ? 'error' : 'warning'} ${title}${v.errorMessage ? `: ${v.errorMessage}` : ''} @${mm(v.pos.x)},${mm(v.pos.y)}${items.length ? ` [${items.join(' ')}]` : ''}`,
    );
  }
  const unrouted = board.GetConnectivity().GetUnconnectedCount(false);
  const head = `${lines.size} DRC violations, ${unrouted} unrouted connections`;
  return lines.size || unrouted ? [head, ...[...lines].slice(0, 60)].join('\n') : 'DRC clean';
}

/** Remove the tracks, arcs and vias of a net, or of every net. */
function unroute(api: PcbScriptApi, args: Record<string, unknown>): string {
  const net = args.net === undefined ? undefined : String(args.net);
  let n = 0;
  commit(api, net ? `Unroute ${net}` : 'Unroute all', (c, b) => {
    if (net && !b.FindNet(net)) throw new Error(`no net ${net}`);
    for (const t of b.Tracks())
      if (net === undefined || t.GetNetname() === net) {
        c.Remove(t);
        n++;
      }
  });
  return `Removed ${n} tracks and vias${net ? ` of ${net}` : ''}.`;
}

function deleteZone(api: PcbScriptApi, args: Record<string, unknown>): string {
  const net = String(args.net ?? '');
  const layer = args.layer === undefined ? undefined : String(args.layer);
  let n = 0;
  commit(api, 'Delete zone', (c, b) => {
    for (const z of b.Zones())
      if (
        z.GetNetname() === net &&
        (layer === undefined || layerName(z.GetFirstLayer()) === layer)
      ) {
        c.Remove(z);
        n++;
      }
  });
  if (!n) throw new Error(`no zone for ${net}${layer ? ` on ${layer}` : ''}`);
  return `Removed ${n} zone${n === 1 ? '' : 's'}.`;
}

/** A through via (F.Cu to B.Cu) on a net, at the board's current via size. */
function addVia(api: PcbScriptApi, args: Record<string, unknown>): string {
  const netName = String(args.net ?? '');
  const at = { x: nm(args.x), y: nm(args.y) };
  commit(api, 'Add via', (c, b) => {
    const net = b.FindNet(netName);
    if (!net) throw new Error(`no net ${netName}`);
    const ds = b.GetDesignSettings();
    const v = new PCB_VIA(b);
    v.SetPosition(at);
    v.SetViaType(VIATYPE.THROUGH);
    v.SetLayerPair(PCB_LAYER_ID.F_Cu, PCB_LAYER_ID.B_Cu);
    v.SetWidth(
      PADSTACK.ALL_LAYERS,
      args.size !== undefined ? nm(args.size) : ds.GetCurrentViaSize(),
    );
    v.SetDrill(args.drill !== undefined ? nm(args.drill) : ds.GetCurrentViaDrill());
    v.SetNetCode(net.GetNetCode());
    c.Add(v);
  });
  return `Via on ${netName} at ${mm(at.x)},${mm(at.y)}. Route to it with route from/to "@${mm(at.x)},${mm(at.y)}".`;
}

/** [data] KiCad's MountingHole library: the plain (unplated) hole per screw. */
const MOUNTING_HOLE: Record<string, string> = {
  M2: 'MountingHole:MountingHole_2.2mm_M2',
  'M2.5': 'MountingHole:MountingHole_2.7mm_M2.5',
  M3: 'MountingHole:MountingHole_3.2mm_M3',
  M4: 'MountingHole:MountingHole_4.3mm_M4',
};

async function addMountingHole(api: PcbScriptApi, args: Record<string, unknown>): Promise<string> {
  const size = String(args.size ?? 'M3');
  const libId = MOUNTING_HOLE[size];
  if (!libId) throw new Error(`size is one of ${Object.keys(MOUNTING_HOLE).join(', ')}`);
  const fp = await api.loadFootprint(libId);
  if (!fp) throw new Error(`could not load ${libId}`);
  let ref = '';
  commit(api, 'Add mounting hole', (c, b) => {
    let n = 1;
    while (b.FindFootprintByReference(`H${n}`)) n++;
    ref = `H${n}`;
    fp.SetParent(b);
    fp.SetReference(ref);
    fp.SetPosition({ x: nm(args.x), y: nm(args.y) });
    // Not in the schematic, and must survive Update PCB from Schematic.
    fp.SetBoardOnly(true);
    c.Add(fp);
  });
  return `${ref} (${size}) at ${args.x},${args.y}.`;
}

/** Move, turn, resize or hide a footprint's reference or value text. */
function editText(api: PcbScriptApi, args: Record<string, unknown>): string {
  const ref = String(args.ref ?? '');
  const which = args.field === 'value' ? 'value' : 'reference';
  commit(api, 'Edit footprint text', (c, b) => {
    const fp = b.FindFootprintByReference(ref);
    if (!fp) throw new Error(`no footprint ${ref}`);
    c.Modify(fp);
    const t = which === 'value' ? fp.Value() : fp.Reference();
    if (args.x !== undefined && args.y !== undefined)
      t.SetPosition({ x: nm(args.x), y: nm(args.y) });
    if (args.rot !== undefined) t.SetTextAngle(new EDA_ANGLE(Number(args.rot)));
    if (args.size !== undefined) t.SetTextSize({ x: nm(args.size), y: nm(args.size) });
    if (args.visible !== undefined) t.SetVisible(Boolean(args.visible));
  });
  return `Edited ${ref}'s ${which} text.`;
}

function findPad(board: BOARD, name: string): PAD {
  const dot = name.lastIndexOf('.');
  const fp = board.FindFootprintByReference(name.slice(0, dot));
  const pad = fp?.FindPadByNumber(name.slice(dot + 1));
  if (!pad) throw new Error(`no pad ${name}`);
  return pad;
}

/** The copper side a pad can be routed from: its own for SMD, F.Cu for through-hole. */
const padLayer = (board: BOARD, pad: PAD) =>
  pad.IsOnLayer(board.GetLayerID('F.Cu')) ? 'F.Cu' : 'B.Cu';

/** A route end: `REF.PAD`, or `@x,y` (mm) for a via or a track point. */
function endpoint(board: BOARD, spec: string): { at: { x: number; y: number }; pad?: PAD } {
  const m = /^@(-?[\d.]+),(-?[\d.]+)$/.exec(spec);
  if (m) return { at: { x: nm(m[1]), y: nm(m[2]) } };
  const pad = findPad(board, spec);
  return { at: pad.GetPosition(), pad };
}

async function route(api: PcbScriptApi, args: Record<string, unknown>): Promise<string> {
  const board = api.board();
  if (!board) throw new Error('no board open');
  const a = endpoint(board, String(args.from ?? ''));
  const b = endpoint(board, String(args.to ?? ''));
  const layer = String(
    args.layer ?? (a.pad ? padLayer(board, a.pad) : b.pad ? padLayer(board, b.pad) : 'F.Cu'),
  );
  // Both ends must take a track on `layer`: a top-only SMD pad cannot start
  // or end a B.Cu route; that needs a via.
  const layerId = board.GetLayerID(layer);
  for (const [what, end] of [
    ['start', a],
    ['target', b],
  ] as const)
    if (end.pad && !end.pad.IsOnLayer(layerId))
      throw new Error(
        `the ${what} pad ${padName(end.pad)} is not on ${layer}; route on its layer, or add_via beside it and route to the via`,
      );
  const through = ((args.through ?? []) as unknown[]).map((p) => endpoint(board, String(p)).at);
  const r = await api.route(a.at, b.at, layer, through);
  if (!r.ok) throw new Error(`${args.from} -> ${args.to}: ${r.reason}`);
  return `Routed ${args.from} -> ${args.to} on ${layer}${through.length ? ` through ${through.length} point${through.length === 1 ? '' : 's'}` : ''}.`;
}

/** Every unrouted connection of a net, along the ratsnest's own pairs. */
async function routeNet(api: PcbScriptApi, args: Record<string, unknown>): Promise<string> {
  const board = api.board();
  if (!board) throw new Error('no board open');
  const net = String(args.net ?? '');
  const pairs: {
    a: { x: number; y: number };
    b: { x: number; y: number };
    label: string;
    layer: string;
  }[] = [];
  board.GetConnectivity().RunOnUnconnectedEdges((e) => {
    const s = e.GetSourceNode();
    const t = e.GetTargetNode();
    const sp = s?.Parent();
    if (!s || !t || !sp || sp.GetNetname() !== net) return true;
    const layer =
      args.layer !== undefined
        ? String(args.layer)
        : sp instanceof PAD
          ? padLayer(board, sp)
          : 'F.Cu';
    pairs.push({ a: s.Pos(), b: t.Pos(), label: `${describe(sp)}-${describe(t.Parent())}`, layer });
    return true;
  });
  if (!pairs.length) return `${net}: nothing to route.`;
  const failed: string[] = [];
  let done = 0;
  for (const p of pairs) {
    const r = await api.route(p.a, p.b, p.layer);
    if (r.ok) done++;
    else failed.push(`${p.label}: ${r.reason}`);
  }
  return `${net}: routed ${done} of ${pairs.length}.${failed.length ? `\n${failed.join('\n')}` : ''}`;
}

/**
 * The board as a picture, through File > Plot's own path: PCB_PLOTTER to SVG
 * per layer in the theme's colours (fit to the board, so every layer shares
 * one frame), stacked back to front on the theme background and rasterised.
 * The editor's canvas cannot be read back: it draws through WebGL.
 */
/** The picture's layers, back to front. */
const PICTURE_LAYERS = [
  PCB_LAYER_ID.B_Cu,
  PCB_LAYER_ID.F_Cu,
  PCB_LAYER_ID.F_SilkS,
  PCB_LAYER_ID.Edge_Cuts,
];

/** File > Plot to SVG, one document per layer of PICTURE_LAYERS, theme colours. */
export function plotPictureLayers(board: BOARD): { svgs: string[]; colors: COLOR_SETTINGS } {
  const layers = [
    PCB_LAYER_ID.B_Cu,
    PCB_LAYER_ID.F_Cu,
    PCB_LAYER_ID.F_SilkS,
    PCB_LAYER_ID.Edge_Cuts,
  ];
  const params = new PCB_PLOT_PARAMS();
  params.assign(board.GetPlotOptions());
  params.SetFormat(PLOT_FORMAT.SVG);
  params.SetPlotFrameRef(false);
  params.SetSvgFitPageToBoard(true);
  params.SetBlackAndWhite(false);
  params.SetMirror(false);
  params.SetNegative(false);
  params.SetAutoScale(false);
  params.SetScale(1);
  params.SetDrillMarksType(DRILL_MARKS.FULL_DRILL_SHAPE);
  params.SetLayerSelection(new LSET(layers));
  const mgr = PgmOrNull()?.GetSettingsManager();
  const cfg = mgr?.GetAppSettings<{ m_ColorTheme: string }>('pcbnew');
  const colors = mgr
    ? mgr.GetColorSettings(cfg ? cfg.m_ColorTheme : DEFAULT_THEME)
    : new COLOR_SETTINGS();
  params.SetColorSettings(colors);
  const svgs: string[] = [];
  new PCB_PLOTTER(board, new Reporter(), params).Plot('', layers, [], false, (_name, bytes) => {
    svgs.push(new TextDecoder().decode(bytes));
  });
  return { svgs, colors };
}

async function boardPicture(board: BOARD): Promise<string> {
  const { svgs, colors } = plotPictureLayers(board);
  if (!svgs.length) throw new Error('the plotter wrote nothing');
  const images = await Promise.all(
    svgs.map(async (svg) => {
      const img = new Image();
      img.src = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
      await img.decode();
      return img;
    }),
  );
  const first = images[0] as HTMLImageElement;
  const w = 1600;
  const h = Math.max(1, Math.round((w * first.naturalHeight) / Math.max(1, first.naturalWidth)));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2D canvas');
  ctx.fillStyle = toCss(colors.GetColor(LAYER_PCB_BACKGROUND));
  ctx.fillRect(0, 0, w, h);
  for (const img of images) {
    ctx.globalAlpha = 0.85;
    ctx.drawImage(img, 0, 0, w, h);
    URL.revokeObjectURL(img.src);
  }
  return canvas.toDataURL('image/png').slice('data:image/png;base64,'.length);
}

export function pcbBridge(api: PcbScriptApi): AiBridge {
  const read = () => {
    const b = api.board();
    return b ? readBoard(b) : '(no board open)';
  };
  const safe =
    (note: string, fn: (args: Record<string, unknown>) => string | Promise<string>) =>
    async (args: Record<string, unknown>): Promise<ToolOutput> => {
      try {
        const text = await fn(args);
        return { text, note: `${note}: ${text.split('\n')[0]}` };
      } catch (e) {
        return {
          text: (e as Error).message,
          isError: true,
          note: `${note} failed: ${(e as Error).message}`,
        };
      }
    };
  const tools: Record<string, (args: Record<string, unknown>) => Promise<ToolOutput>> = {
    update_pcb_from_schematic: safe('updated the PCB from the schematic', async () => {
      const r = await api.updateFromSchematic();
      if (!r.ok) throw new Error(r.report);
      return `${r.report || 'No changes.'}\n\n${read()}`;
    }),
    read_board: async () => ({ text: read(), note: 'read the board' }),
    set_outline: safe('board outline', (a) => setOutline(api, a)),
    place: safe('placed', (a) => place(api, a)),
    add_zone: safe('zone', (a) => addZone(api, a)),
    fill_zones: safe('filled zones', () => {
      api.fillZones();
      return 'Zones filled.';
    }),
    run_drc: safe('DRC', () => runDrc(api)),
    route: safe('route', (a) => route(api, a)),
    unroute: safe('unrouted', (a) => unroute(api, a)),
    add_via: safe('via', (a) => addVia(api, a)),
    add_mounting_hole: safe('mounting hole', (a) => addMountingHole(api, a)),
    edit_text: safe('text', (a) => editText(api, a)),
    delete_zone: safe('deleted zone', (a) => deleteZone(api, a)),
    undo_board: safe('undid', () => {
      const frame = api.frame();
      if (!frame) throw new Error('no board open');
      if (frame.GetUndoCommandCount() <= 0) throw new Error('nothing to undo');
      frame.RestoreCopyFromUndoList();
      return 'Undid the last board edit.';
    }),
    // Internal: the app bridge's view_3d opens the 3D frame through here.
    open_3d: safe('open 3D', () => {
      if (!api.show3D) throw new Error('this editor has no 3D viewer');
      api.show3D();
      return 'Opening the 3D viewer.';
    }),
    route_net: safe('route net', (a) => routeNet(api, a)),
    view_board: async () => {
      const b = api.board();
      if (!b) return { text: 'No board is open.', isError: true, note: 'no board to look at' };
      try {
        const png = await boardPicture(b);
        return {
          text: 'The board (plotted: B.Cu, F.Cu, F.Silkscreen, Edge.Cuts).',
          imagePng: png,
          note: 'looked at the board',
        };
      } catch (e) {
        return {
          text: `could not picture the board: ${(e as Error).message}`,
          isError: true,
          note: 'board picture failed',
        };
      }
    },
  };
  return { kind: 'pcb', read, run: (name, args) => tools[name]?.(args) ?? null };
}
