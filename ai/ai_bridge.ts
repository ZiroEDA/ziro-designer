/**
 * The seam between the AI pane and the editors. Each editor that the AI can
 * drive registers a bridge for as long as its frame exists; a bridge owns
 * the tools for its editor and runs them against the live document.
 */
export interface ApplyResult {
  applied: number;
  errors: string[];
  /** Facts that help fix the errors, e.g. a part's real pin names. */
  hints?: string[];
}

/** What a tool call answers. */
export interface ToolOutput {
  text: string;
  isError?: boolean;
  /** A picture for the model (PNG, base64 without the data: prefix). */
  imagePng?: string;
  /** One line for the chat, so the user sees the model working. */
  note: string;
}

/** The editors, plus the app shell (switching editors) and the project manager. */
export type EditorKind = 'sch' | 'pcb' | 'app' | 'project' | '3d';

export interface AiBridge {
  kind: EditorKind;
  /** The open document as compact text, sent when it changed since last seen. */
  read(): string;
  /** Run one of this editor's tools; null when the tool is not this editor's. */
  run(name: string, args: Record<string, unknown>): Promise<ToolOutput> | null;
  /** Refuse a tool before any bridge runs it (no project open); null lets it run. */
  guard?(name: string): ToolOutput | null;
  /** The open project's name (the app bridge); chats are kept per project. */
  project?(): string | null;
  /** Bring that editor to the front (the app bridge): the user watches the work. */
  show?(kind: EditorKind): void;
}

const bridges = new Map<EditorKind, AiBridge>();

export function registerAiBridge(b: AiBridge): () => void {
  bridges.set(b.kind, b);
  return () => {
    if (bridges.get(b.kind) === b) bridges.delete(b.kind);
  };
}

export function aiBridge(kind: EditorKind): AiBridge | undefined {
  return bridges.get(kind);
}

export function allBridges(): AiBridge[] {
  return [...bridges.values()];
}

/**
 * Run one agent tool on whichever bridge takes it: the app tools first, a guard may refuse.
 * The chat pane's turns and tool calls from the user's own AI app (over the agent's link) both
 * come through here. `kind` is the bridge that ran it (absent when none could).
 */
export async function runAiTool(
  name: string,
  args: Record<string, unknown>,
): Promise<{ out: ToolOutput; kind?: EditorKind }> {
  for (const b of allBridges()) {
    const refused = b.guard?.(name);
    if (refused) return { out: refused };
  }
  for (const b of [...allBridges()].sort(
    (x, y) => Number(y.kind === 'app') - Number(x.kind === 'app'),
  )) {
    const out = b.run(name, args);
    if (out) {
      // The editor doing the work is the one on screen.
      if (b.kind === 'sch' || b.kind === 'pcb') aiBridge('app')?.show?.(b.kind);
      return { out: await out, kind: b.kind };
    }
  }
  return {
    out: {
      text: `Nothing open can run ${name} right now: open the editor it belongs to (open_editor) first.`,
      isError: true,
      note: `${name}: its editor is not open`,
    },
  };
}
