/**
 * The AI's hands on the app itself, beside the editors: switching to (and
 * opening) an editor, and creating a project from a template. Two bridges,
 * because the two live in different places: editor switching in the shell
 * (App), projects in the project manager.
 */
import { type AiBridge, aiBridge, type EditorKind, type ToolOutput } from './ai_bridge.js';
import { showDoc } from './doc_viewer.js';

/** The editors the model can open, by the name the tool takes. */
export const EDITORS = ['schematic', 'pcb', 'symbol_editor', 'footprint_editor'] as const;
export type EditorName = (typeof EDITORS)[number];

/** Which bridge an opened editor registers, for the ones the AI can drive. */
const DRIVEN: Partial<Record<EditorName, EditorKind>> = { schematic: 'sch', pcb: 'pcb' };

export interface Workspace {
  /** The open project's name; null when none is open. */
  project: string | null;
  onScreen: string;
  files: readonly string[];
  /** DESIGN.md's text; null when the project has none yet. */
  designDoc: string | null;
}

export interface AppScriptApi {
  /** Show the editor, mounting its frame if it has never been opened. */
  open(editor: EditorName): void;
  /** What is on screen and which project is open, one line. */
  describe(): string;
  workspace?(): Workspace;
  /** Write the project's DESIGN.md; throws when no project is open. */
  writeDesignDoc?(text: string): void;
  /** Show the project manager, which owns the project tools. */
  goHome?(): void;
}

/** Tools the project manager owns; it is mounted only while on screen. */
const PROJECT_TOOLS = new Set(['new_project', 'list_templates']);

/** The design doc lives beside the project file, like Zener's spec.md. */
export function designDocName(proFile: string): string {
  const slash = proFile.lastIndexOf('/');
  return `${slash >= 0 ? proFile.slice(0, slash + 1) : ''}DESIGN.md`;
}

/** What the model is shown of the workspace at the start of a turn. */
export function describeWorkspace(w: Workspace): string {
  if (!w.project)
    return `No project is open (on screen: ${w.onScreen}). The schematic and PCB tools refuse until one is: create one with new_project, or ask the user to open theirs.`;
  const lines = [
    `project ${w.project} (on screen: ${w.onScreen})`,
    `files: ${w.files.map((f) => f.replace(/^.*\//, '')).join(', ')}`,
  ];
  lines.push(
    w.designDoc === null
      ? 'DESIGN.md: none yet - write one (write_design_doc) before designing.'
      : `DESIGN.md:\n${w.designDoc}`,
  );
  return lines.join('\n');
}

/** The tools that need no project: the app's own and the library lookups.
 *  Every other tool works on a schematic or board. */
const APP_TOOLS = new Set([
  'design_guide',
  'view_3d',
  'open_editor',
  'list_templates',
  'new_project',
  'read_design_doc',
  'write_design_doc',
  'search_symbols',
  'search_footprints',
]);

/** Resolves once `kind`'s bridge is registered, or after `ms`. */
async function waitForBridge(kind: EditorKind, ms = 8000): Promise<boolean> {
  const until = Date.now() + ms;
  while (!aiBridge(kind)) {
    if (Date.now() > until) return false;
    await new Promise((r) => setTimeout(r, 100));
  }
  return true;
}

export function appBridge(api: AppScriptApi): AiBridge {
  const tools: Record<string, (args: Record<string, unknown>) => Promise<ToolOutput>> = {
    open_editor: async (args) => {
      const editor = String(args.editor ?? '') as EditorName;
      if (!EDITORS.includes(editor))
        return {
          text: `editor is one of ${EDITORS.join(', ')}`,
          isError: true,
          note: 'open editor: unknown editor',
        };
      api.open(editor);
      const kind = DRIVEN[editor];
      if (kind && !(await waitForBridge(kind)))
        return {
          text: `The ${editor} editor did not finish opening.`,
          isError: true,
          note: `${editor} did not open`,
        };
      return {
        text: `${editor} is open. ${api.describe()}`,
        note: `opened the ${editor.replace('_', ' ')}`,
      };
    },
    // design_guide is answered by the agent server: it needs nothing from the open design.
    read_design_doc: async () => {
      const w = api.workspace?.();
      if (!w?.project)
        return { text: 'No project is open.', isError: true, note: 'no project open' };
      return { text: w.designDoc ?? '(no DESIGN.md yet)', note: 'read the spec' };
    },
    write_design_doc: async (args) => {
      const text = String(args.markdown ?? '');
      if (!text.trim())
        return { text: 'markdown is required', isError: true, note: 'design doc: empty' };
      try {
        api.writeDesignDoc?.(text);
      } catch (e) {
        return {
          text: (e as Error).message,
          isError: true,
          note: `design doc: ${(e as Error).message}`,
        };
      }
      // Open it for the user to read, beside the chat.
      showDoc({ title: `DESIGN.md - ${api.workspace?.()?.project ?? ''}`, text });
      return {
        text: 'DESIGN.md saved and opened for the user to read.',
        note: 'wrote the spec',
      };
    },
  };
  return {
    kind: 'app',
    read: () => {
      const w = api.workspace?.();
      return w ? describeWorkspace(w) : '';
    },
    project: () => api.workspace?.()?.project ?? null,
    show: (kind) => {
      const editor = kind === 'sch' ? 'schematic' : kind === 'pcb' ? 'pcb' : null;
      if (editor && api.workspace?.()?.onScreen !== editor) api.open(editor);
    },
    guard: (name) => {
      if (APP_TOOLS.has(name)) return null;
      const w = api.workspace?.();
      if (!w || w.project) return null;
      return {
        text: 'No project is open, so there is no schematic or board to work on. Create one with new_project, or ask the user to open theirs.',
        isError: true,
        note: `${name}: no project open`,
      };
    },
    run: (name, args) => {
      if (name === 'view_3d') {
        // The 3D viewer is a child of the PCB editor: bring the board up,
        // have it open the 3D frame, wait for that, and hand the call over.
        return (async () => {
          if (!aiBridge('3d')) {
            api.open('pcb');
            if (!(await waitForBridge('pcb')))
              return {
                text: 'The PCB editor did not open.',
                isError: true,
                note: 'view 3D: no PCB editor',
              };
            const opened = await aiBridge('pcb')?.run('open_3d', {});
            if (opened?.isError) return opened;
            if (!(await waitForBridge('3d', 20000)))
              return {
                text: 'The 3D viewer did not open.',
                isError: true,
                note: 'view 3D: viewer did not open',
              };
          }
          return (
            (await aiBridge('3d')?.run('view_3d', args)) ?? {
              text: 'The 3D viewer cannot take a picture.',
              isError: true,
              note: 'view 3D: unavailable',
            }
          );
        })();
      }
      if (PROJECT_TOOLS.has(name)) {
        // The project manager is mounted only while on screen: bring it up,
        // wait for it, and hand the call over.
        return (async () => {
          if (!aiBridge('project')) api.goHome?.();
          if (!(await waitForBridge('project')))
            return {
              text: 'The project manager did not open.',
              isError: true,
              note: `${name}: project manager did not open`,
            };
          return (
            (await aiBridge('project')?.run(name, args)) ?? {
              text: `${name} is not available`,
              isError: true,
              note: `${name}: unavailable`,
            }
          );
        })();
      }
      return tools[name]?.(args) ?? null;
    },
  };
}

export interface ProjectTemplateInfo {
  id: string;
  title: string;
  description: string;
}

export interface ProjectScriptApi {
  templates(): Promise<readonly ProjectTemplateInfo[]>;
  /** File > New Project from `templateId` (the Default template when absent),
   *  named `name`; opens it. Returns the name it was created under. */
  create(name: string, templateId?: string): Promise<string>;
}

export function projectBridge(api: ProjectScriptApi): AiBridge {
  const tools: Record<string, (args: Record<string, unknown>) => Promise<ToolOutput>> = {
    list_templates: async () => {
      const list = await api.templates();
      return {
        text:
          list
            .map((t) => `${t.id}: ${t.title}${t.description ? ` - ${t.description}` : ''}`)
            .join('\n') || 'no templates',
        note: `listed ${list.length} project templates`,
      };
    },
    new_project: async (args) => {
      const name = String(args.name ?? '').trim();
      if (!name)
        return { text: 'a project name is required', isError: true, note: 'new project: no name' };
      try {
        const made = await api.create(
          name,
          args.template === undefined ? undefined : String(args.template),
        );
        return {
          text: `Created project "${made}" and opened it in the schematic editor. Write its DESIGN.md next.`,
          note: `created project ${made}`,
        };
      } catch (e) {
        return {
          text: (e as Error).message,
          isError: true,
          note: `new project failed: ${(e as Error).message}`,
        };
      }
    },
  };
  return { kind: 'project', read: () => '', run: (name, args) => tools[name]?.(args) ?? null };
}
