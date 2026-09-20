/**
 * Where a DRC run's time goes, phase by phase, and what a cancel would have to
 * interrupt. `DIALOG_DRC` is a PROGRESS_REPORTER; this is the same reporter
 * with a clock on `AdvancePhase`, so the phases below are the very strings the
 * dialog prints.
 *
 *   cd qa
 *   V=../node_modules/.pnpm/vite-node@*\/node_modules/vite-node/vite-node.mjs
 *   node --max-old-space-size=4000 $V perf/drc_timing.mts \
 *       ~/kicad-reference/demos/cm5_minima/CM5_MINIMA_3.kicad_pcb
 *
 * Add `--cpu-prof --cpu-prof-dir=/tmp/prof` for the flame data.
 */
import { existsSync, readFileSync } from 'node:fs';
import { EMBEDDED_FILES } from '@ziroeda/common/src/embedded_files.js';
import { PCB_LAYER_ID } from '@ziroeda/common/src/layer_ids.js';
import { LSET } from '@ziroeda/common/src/lset.js';
import { ENUM_MAP } from '@ziroeda/common/src/properties/property.js';
import { PROGRESS_REPORTER_BASE } from '@ziroeda/common/src/widgets/progress_reporter_base.js';
import { DRC_ENGINE } from '@ziroeda/pcbnew/drc/drc_engine.js';
import '@ziroeda/pcbnew/drc/drc_test_providers.js';
import type { DRC_ITEM } from '@ziroeda/pcbnew/drc/drc_item.js';
import { ParseBoard } from '@ziroeda/pcbnew/read-board.js';

const boardPath = process.argv[2]!;
const base = boardPath.replace(/\.kicad_pcb$/, '');

/** Every `KeepRefreshing()` the engine makes, timed and counted per phase. */
class TIMING_REPORTER extends PROGRESS_REPORTER_BASE {
  rows: { phase: string; ms: number; refreshes: number }[] = [];
  private phaseName = '(startup)';
  private t0 = performance.now();
  private refreshes = 0;
  /** The longest gap between two `updateUI()` calls: a browser's freeze. */
  worstGapMs = 0;
  private lastRefresh = performance.now();

  constructor() {
    super(1);
  }

  override AdvancePhase(aMessage?: string): void {
    this.close();
    super.AdvancePhase(aMessage);
    if (aMessage !== undefined) this.phaseName = aMessage;
  }

  override Report(aMessage: string): void {
    this.close();
    super.Report(aMessage);
    this.phaseName = aMessage;
  }

  close(): void {
    const ms = performance.now() - this.t0;
    if (ms > 0.5) this.rows.push({ phase: this.phaseName, ms, refreshes: this.refreshes });
    this.t0 = performance.now();
    this.refreshes = 0;
  }

  protected updateUI(): boolean {
    const now = performance.now();
    this.worstGapMs = Math.max(this.worstGapMs, now - this.lastRefresh);
    this.lastRefresh = now;
    this.refreshes += 1;
    return true;
  }
}

const stage = async <T,>(name: string, fn: () => T | Promise<T>): Promise<T> => {
  const t0 = performance.now();
  const out = await fn();
  console.log(`${name.padEnd(34)} ${((performance.now() - t0) / 1000).toFixed(2).padStart(7)} s`);
  return out;
};

await EMBEDDED_FILES.InitCodec();

const board = await stage('parse', () => ParseBoard(readFileSync(boardPath, 'utf8'), boardPath));

await stage('project settings', () => {
  const proPath = `${base}.kicad_pro`;
  if (!existsSync(proPath)) return;
  const pro = JSON.parse(readFileSync(proPath, 'utf8')) as Record<string, unknown>;
  const boardJ = (pro.board ?? {}) as Record<string, unknown>;
  if (boardJ.design_settings !== undefined)
    board.GetDesignSettings().LoadFromJson(boardJ.design_settings);
  if (pro.net_settings !== undefined)
    board.GetDesignSettings().m_NetSettings.LoadFromJson(pro.net_settings);
  if (pro.tuning_profiles !== undefined)
    board.GetTuningProfiles().LoadFromJson(pro.tuning_profiles);
});

// PCB_EDIT_FRAME::OnBoardLoaded's layer enum, which the rule language reads.
const layerEnum = ENUM_MAP.Instance<PCB_LAYER_ID>('PCB_LAYER_ID');
layerEnum.Choices().Clear();
layerEnum.Undefined(PCB_LAYER_ID.UNDEFINED_LAYER);

for (const layer of LSET.AllLayersMask()) {
  layerEnum.Map(layer, LSET.Name(layer));
  layerEnum.Map(layer, board.GetLayerName(layer));
}

const engine = new DRC_ENGINE(board, board.GetDesignSettings());
const rulesPath = `${base}.kicad_dru`;

await stage('InitEngine', () =>
  existsSync(rulesPath)
    ? engine.InitEngine(readFileSync(rulesPath, 'utf8'), rulesPath)
    : engine.InitEngine(null),
);

board.GetDesignSettings().m_DRCEngine = engine;

await stage('BuildListOfNets', () => board.BuildListOfNets());
await stage('BuildConnectivity', () => board.BuildConnectivity());
await stage('tuning caches', () => board.SynchronizeTuningProfileProperties());

const reporter = new TIMING_REPORTER();
const counts = new Map<string, number>();

engine.SetProgressReporter(reporter);
engine.SetViolationHandler((aItem: DRC_ITEM) => {
  const key = aItem.GetSettingsKey();
  counts.set(key, (counts.get(key) ?? 0) + 1);
});

const t0 = performance.now();
engine.RunTests('mm', true, false);
const total = performance.now() - t0;
reporter.close();

console.log('');
reporter.rows.sort((a, b) => b.ms - a.ms);

let other = 0;

for (const row of reporter.rows) {
  if (row.ms < total / 100) {
    other += row.ms;
    continue;
  }

  console.log(
    `${(row.ms / 1000).toFixed(2).padStart(7)} s  ${((row.ms / total) * 100).toFixed(1).padStart(5)}%  ` +
      `${String(row.refreshes).padStart(6)} refreshes   ${row.phase}`,
  );
}

console.log(`${(other / 1000).toFixed(2).padStart(7)} s         (everything under 1%)`);
console.log('');
console.log(`RunTests                        ${(total / 1000).toFixed(2).padStart(7)} s`);
console.log(
  `longest gap between updateUI()  ${(reporter.worstGapMs / 1000).toFixed(2).padStart(7)} s`,
);
console.log('');

let n = 0;

for (const [key, count] of [...counts].sort((a, b) => b[1] - a[1])) {
  console.log(`${String(count).padStart(5)}  ${key}`);
  n += count;
}

console.log(`${String(n).padStart(5)}  TOTAL`);
