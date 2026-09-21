// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * PeerRole wiring in the schematic editor (designer/src/sync/ProjectSyncTransport.ts):
 * the same shape of work pcb_peer_roles.test.ts pins for PcbEditor.tsx, applied
 * to SchematicEditor.tsx's own choke point. Unlike PCB's commitBoard, this
 * editor funnels every edit — the open sheet's own runCommand, a batched
 * multi-sheet operation, a cross-sheet applySheetCommand/Symbols/Document, a
 * dropIntoSheet, applyFieldsEdits — through one function, runProject, so a
 * single guard there covers all of them (see
 * docs/proposals/multiplayer-architecture.md).
 *
 * SchematicEditor.tsx is a .tsx qa's tsconfig cannot compile standalone, and
 * too large to mount — read as text and asserted on directly, the same way
 * pcb_peer_roles.test.ts does for PcbEditor.tsx.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const text = readFileSync(
  fileURLToPath(
    new URL('../../../designer/src/editors/schematic/SchematicEditor.tsx', import.meta.url),
  ),
  'utf8',
);

const GUARD = "if (!applyingRemoteRef.current && myRoleRef.current === 'viewer') return;";

describe('a viewer cannot originate an edit', () => {
  it('runProject, the one choke point every edit funnels through, refuses a local one', () => {
    const i = text.indexOf('const runProject = useCallback(');
    expect(i).toBeGreaterThan(-1);
    const body = text.slice(i, text.indexOf('setDoc((d) =>', i));
    expect(body).toContain(GUARD);
  });

  it('runCommand, applySheetCommand, dropIntoSheet and applyFieldsEdits all reach runProject', () => {
    // The guard lives once, in runProject — everything else is a thin wrapper
    // (runCommand, applySheetCommand -> stage -> runProject) or calls
    // runProject directly (dropIntoSheet, applyFieldsEdits, sheetBatch). This
    // just confirms none of them still holds its own copy of the guard, which
    // would mean runProject's copy is not actually the only one left.
    for (const fn of ['runCommand', 'applySheetCommand', 'dropIntoSheet', 'applyFieldsEdits']) {
      const decl = `const ${fn} = useCallback(`;
      const i = text.indexOf(decl);
      expect(i).toBeGreaterThan(-1);
      // Search for the next declaration starting after THIS one's own
      // `= useCallback(` text, not from i + 1 — which would immediately
      // re-find this same declaration's own occurrence and clip body to
      // almost nothing, silently passing regardless of what is inside it.
      const nextFn = text.indexOf('= useCallback(', i + decl.length);
      const body = text.slice(i, nextFn > -1 ? nextFn : i + 2000);
      expect(body).not.toContain(GUARD);
    }
  });

  it('the remote-update effect brackets its applySheetDocument call with applyingRemoteRef', () => {
    const i = text.indexOf("applySheetDocument(target.file, next, 'Remote update');");
    expect(i).toBeGreaterThan(-1);
    const before = text.slice(Math.max(0, i - 200), i);
    const after = text.slice(i, i + 200);
    expect(before).toContain('applyingRemoteRef.current = true;');
    expect(after).toContain('applyingRemoteRef.current = false;');
  });
});

describe('the transport keeps this tab in step with its own role', () => {
  it("takes the tab's shared connection instead of opening one of its own", () => {
    // Both editors stay mounted, so an editor that connects for itself makes
    // the tab a second peer of itself — see ProjectSyncProvider.tsx and
    // project_sync_provider.test.ts, which pins the connect side.
    expect(text).toContain('const sharedSync = useProjectSync();');
    expect(text).not.toContain('createProjectSyncTransport(');
  });

  it('owns the sheet half of presence, and re-announces it when it comes back', () => {
    // The provider announces the view but cannot name a sheet; this editor is
    // the only thing that knows one, so it has to re-announce on becoming
    // shown, or the sheet path is lost on every trip to the board.
    const i = text.indexOf("sharedSync?.updatePresence('schematic', currentPath);");
    expect(i).toBeGreaterThan(-1);
    const body = text.slice(i, i + 120);
    expect(body).toContain('[currentPath, shown, sharedSync]');
  });

  it("applies a 'self-role' message to React state, not just a ref", () => {
    const i = text.indexOf("payload.kind === 'self-role'");
    expect(i).toBeGreaterThan(-1);
    const body = text.slice(i, i + 300);
    expect(body).toContain('setMyRole(payload.role)');
  });

  it("only applies a 'role-assign' addressed to this peer", () => {
    const i = text.indexOf("payload.kind === 'role-assign'");
    expect(i).toBeGreaterThan(-1);
    const body = text.slice(i, i + 300);
    expect(body).toContain('if (payload.toPeerId !== transport.peerId) return;');
    expect(body).toContain('syncTransport.current?.setRole(payload.role);');
  });

  it('myRoleRef is kept in sync with the myRole state, every render', () => {
    const i = text.indexOf('const [myRole, setMyRole] = useState<PeerRole>');
    expect(i).toBeGreaterThan(-1);
    const body = text.slice(i, i + 200);
    expect(body).toContain('const myRoleRef = useRef<PeerRole>');
    expect(body).toContain('myRoleRef.current = myRole;');
  });
});

describe('the presence panel only lets the owner reassign roles', () => {
  it('passes onSetRole through to a role-assign publish', () => {
    const i = text.indexOf('<PresencePanel');
    expect(i).toBeGreaterThan(-1);
    const body = text.slice(i, text.indexOf('/>', i) + 2);
    expect(body).toContain("kind: 'role-assign', toPeerId: peerId, role");
  });

  it('shows a view-only notice while this tab is a viewer', () => {
    const i = text.indexOf("myRole === 'viewer' && (");
    expect(i).toBeGreaterThan(-1);
    expect(text.slice(i, i + 200)).toContain('<ReadOnlyNotice');
  });

  it('the presence badge is a clickable button that opens the panel', () => {
    const i = text.indexOf('className="ze-presence-badge"');
    expect(i).toBeGreaterThan(-1);
    const tagStart = text.lastIndexOf('<button', i);
    expect(tagStart).toBeGreaterThan(-1);
    const body = text.slice(tagStart, text.indexOf('</button>', i));
    expect(body).toContain('onClick={() => setPresencePanelOpen((v) => !v)}');
  });
});
