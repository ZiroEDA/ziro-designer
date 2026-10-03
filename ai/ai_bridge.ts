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
