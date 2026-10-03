import { type AiBridge, aiBridge, registerAiBridge } from '@ziroeda/ai/ai_bridge.js';
import { appBridge, designDocName, projectBridge, type Workspace } from '@ziroeda/ai/app_bridge.js';
import { shownDoc } from '@ziroeda/ai/doc_viewer.js';
import { describe, expect, it } from 'vitest';

const stub = (kind: AiBridge['kind']): AiBridge => ({ kind, read: () => '', run: () => null });

describe('the AI app tools', () => {
  it('open_editor opens the editor and answers once its bridge is up', async () => {
    const opened: string[] = [];
    let unregister: (() => void) | undefined;
    const app = appBridge({
      open: (e) => {
        opened.push(e);
        // The frame mounts a little later, as React does it.
        setTimeout(() => {
          unregister = registerAiBridge(stub('pcb'));
        }, 50);
      },
      describe: () => 'On screen: pcb; project: demo.',
    });
    const out = await app.run('open_editor', { editor: 'pcb' });
    // Answered only once the editor can be driven: the next tool call works.
    expect(aiBridge('pcb')).toBeDefined();
    expect(opened).toEqual(['pcb']);
    expect(out?.isError).toBeFalsy();
    expect(out?.text).toBe('pcb is open. On screen: pcb; project: demo.');
    unregister?.();
  });

  it('open_editor refuses an editor it does not know', async () => {
    const app = appBridge({ open: () => {}, describe: () => '' });
    const out = await app.run('open_editor', { editor: 'gerbview' });
    expect(out?.isError).toBe(true);
  });

  it('new_project creates from the named template and reports refusals', async () => {
    const made: [string, string | undefined][] = [];
    const project = projectBridge({
      templates: async () => [{ id: 'default', title: 'Default', description: '' }],
      create: async (name, template) => {
        if (name === 'taken') throw new Error('a project named "taken" already exists');
        made.push([name, template]);
        return name;
      },
    });
    expect((await project.run('new_project', { name: 'blinky', template: 'default' }))?.text).toBe(
      'Created project "blinky" and opened it in the schematic editor. Write its DESIGN.md next.',
    );
    expect(made).toEqual([['blinky', 'default']]);
    expect((await project.run('new_project', { name: 'taken' }))?.isError).toBe(true);
    expect((await project.run('new_project', { name: '  ' }))?.isError).toBe(true);
    expect((await project.run('list_templates', {}))?.text).toBe('default: Default');
  });

  describe('the workspace', () => {
    const none: Workspace = { project: null, onScreen: 'home', files: [], designDoc: null };
    const open: Workspace = {
      project: 'blinky',
      onScreen: 'schematic',
      files: ['blinky/blinky.kicad_pro', 'blinky/blinky.kicad_sch'],
      designDoc: null,
    };

    it('with no project, refuses schematic and board tools but not app or library ones', () => {
      const app = appBridge({ open: () => {}, describe: () => '', workspace: () => none });
      expect(app.guard?.('apply_zsch')?.isError).toBe(true);
      expect(app.guard?.('route')?.isError).toBe(true);
      expect(app.guard?.('read_schematic')?.isError).toBe(true);
      expect(app.guard?.('new_project')).toBeNull();
      expect(app.guard?.('search_symbols')).toBeNull();
      expect(app.read()).toMatch(/^No project is open/);
    });

    it('with a project open, lets every tool through and shows the project and its doc', () => {
      let ws = open;
      const written: string[] = [];
      const app = appBridge({
        open: () => {},
        describe: () => '',
        workspace: () => ws,
        writeDesignDoc: (t) => {
          written.push(t);
          ws = { ...ws, designDoc: t };
        },
      });
      expect(app.guard?.('apply_zsch')).toBeNull();
      expect(app.read()).toContain('project blinky (on screen: schematic)');
      expect(app.read()).toContain('files: blinky.kicad_pro, blinky.kicad_sch');
      expect(app.read()).toContain('DESIGN.md: none yet');
      return app.run('write_design_doc', { markdown: '# Blinky' })!.then((out) => {
        expect(out.text).toBe('DESIGN.md saved and opened for the user to read.');
        // Opened for reading, titled with the project.
        expect(shownDoc()).toEqual({ title: 'DESIGN.md - blinky', text: '# Blinky' });
        expect(written).toEqual(['# Blinky']);
        expect(app.read()).toContain('DESIGN.md:\n# Blinky');
      });
    });

    it('keeps DESIGN.md beside the project file', () => {
      expect(designDocName('blinky/blinky.kicad_pro')).toBe('blinky/DESIGN.md');
      expect(designDocName('blinky.kicad_pro')).toBe('DESIGN.md');
    });
  });

  it('runs a project tool from any editor: goes home, waits for the manager, hands it over', async () => {
    let unregister: (() => void) | undefined;
    const wentHome: number[] = [];
    const app = appBridge({
      open: () => {},
      describe: () => '',
      goHome: () => {
        wentHome.push(1);
        // The manager mounts a little later and registers its bridge.
        setTimeout(() => {
          unregister = registerAiBridge(
            projectBridge({
              templates: async () => [{ id: 'default', title: 'Default', description: '' }],
              create: async (name) => name,
            }),
          );
        }, 50);
      },
    });
    expect(aiBridge('project')).toBeUndefined();
    const out = await app.run('new_project', { name: 'blinky' });
    expect(wentHome).toEqual([1]);
    expect(out?.isError).toBeFalsy();
    expect(out?.text).toMatch(/^Created project "blinky"/);
    unregister?.();
  });

  it('view_3d brings up the board, opens the 3D viewer, waits for it and hands over', async () => {
    const opened: string[] = [];
    const undo: (() => void)[] = [];
    const app = appBridge({
      open: (e) => {
        opened.push(e);
        setTimeout(() => {
          undo.push(
            registerAiBridge({
              kind: 'pcb',
              read: () => '',
              run: (name) =>
                name === 'open_3d'
                  ? (setTimeout(() => {
                      undo.push(
                        registerAiBridge({
                          kind: '3d',
                          read: () => '',
                          run: (n, a) =>
                            n === 'view_3d'
                              ? Promise.resolve({ text: `3D ${String(a.view)}`, note: 'looked' })
                              : null,
                        }),
                      );
                    }, 30),
                    Promise.resolve({ text: 'Opening the 3D viewer.', note: 'open 3D' }))
                  : null,
            }),
          );
        }, 20);
      },
      describe: () => '',
    });
    const out = await app.run('view_3d', { view: 'angled' });
    expect(opened).toEqual(['pcb']);
    expect(out?.text).toBe('3D angled');
    for (const u of undo) u();
  });

  it('brings the editor doing the work to the front, unless it already is', () => {
    const opened: string[] = [];
    let onScreen = 'home';
    const app = appBridge({
      open: (e) => {
        opened.push(e);
        onScreen = e;
      },
      describe: () => '',
      workspace: () => ({ project: 'p', onScreen, files: [], designDoc: null }),
    });
    app.show?.('sch');
    app.show?.('sch');
    app.show?.('pcb');
    expect(opened).toEqual(['schematic', 'pcb']);
  });
});
