export { AiDock } from './ai_dock.js';
export { AI_AGENT_URL, aiEnabled } from './ai_flag.js';
export {
  type AiBridge,
  type ApplyResult,
  type EditorKind,
  type ToolOutput,
  aiBridge,
  allBridges,
  registerAiBridge,
} from './ai_bridge.js';
// sch_bridge.ts is imported by path ('@ziroeda/ai/sch_bridge.js') from the
// schematic frame's lazy chunk, so the entry chunk never pulls in eeschema.
