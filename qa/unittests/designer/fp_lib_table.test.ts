/**
 * Project footprint library table (FP_LIB_TABLE): the nickname a `.pretty`
 * directory is known by. The ECC83 demo stores `Footprints:Valve_ECC-83-1`
 * because its table names `${KIPRJMOD}/footprints.pretty` "Footprints", using
 * the directory name instead would make every such assignment look unknown.
 */
import { describe, it, expect } from 'vitest';
import {
  parseFpLibTable,
  projectFpLibTable,
  projectFpLibTablePath,
  projectLibraryNickname,
  projectPrettyDirs,
  rowPrettyDir,
  serializeFpLibTable,
} from '@ziroeda/designer/src/editors/footprint/fp_lib_table.js';

const TABLE = `(fp_lib_table
  (version 7)
  (lib (name "Footprints")(type "KiCad")(uri "\${KIPRJMOD}/footprints.pretty")(options "")(descr ""))
  (lib (name "Extra")(type "KiCad")(uri "\${KIPRJMOD}/more_parts.pretty")(options "")(descr "spares"))
)`;

describe('fp-lib-table', () => {
  it('reads the rows', () => {
    const rows = parseFpLibTable(TABLE);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      name: 'Footprints',
      type: 'KiCad',
      uri: '${KIPRJMOD}/footprints.pretty',
    });
    expect(rows[1]!.descr).toBe('spares');
    expect(rowPrettyDir(rows[0]!)).toBe('footprints');
  });

  it('survives a malformed table', () => {
    expect(parseFpLibTable('(fp_lib_table')).toEqual([]);
    expect(parseFpLibTable('')).toEqual([]);
  });

  it('names a project footprint by its table row, not its directory', () => {
    const rows = parseFpLibTable(TABLE);
    expect(projectLibraryNickname(rows, 'ecc83/footprints.pretty/Valve_ECC-83-1.kicad_mod')).toBe(
      'Footprints',
    );
    expect(projectLibraryNickname(rows, 'ecc83/more_parts.pretty/X.kicad_mod')).toBe('Extra');
  });

  it('leaves an unregistered .pretty folder unresolved (no directory fallback)', () => {
    // FP_LIB_TABLE::FindRow finds nothing for a directory no row points at, so
    // the folder is not a library and its footprints stay unknown.
    expect(projectLibraryNickname([], 'proj/footprints.pretty/X.kicad_mod')).toBe('');
    expect(projectLibraryNickname([], 'proj/x.kicad_sch')).toBe('');
  });

  it('ignores a disabled row', () => {
    const rows = parseFpLibTable(TABLE).map((r) =>
      r.name === 'Footprints' ? { ...r, disabled: true } : r,
    );
    expect(projectLibraryNickname(rows, 'ecc83/footprints.pretty/X.kicad_mod')).toBe('');
  });

  it('round-trips through the writer', () => {
    const rows = parseFpLibTable(TABLE);
    const text = serializeFpLibTable(rows);
    expect(text.startsWith('(fp_lib_table')).toBe(true);
    expect(text).toContain('(name "Footprints")');
    expect(text).toContain('(uri "${KIPRJMOD}/footprints.pretty")');
    expect(parseFpLibTable(text)).toEqual(rows);
  });

  it("offers the project's .pretty folders, flagging the registered ones", () => {
    const files = [
      { name: 'ecc83/fp-lib-table', text: TABLE },
      { name: 'ecc83/footprints.pretty/Valve_ECC-83-1.kicad_mod', text: '(footprint "x")' },
      { name: 'ecc83/spares.pretty/Thing.kicad_mod', text: '(footprint "y")' },
    ];
    const rows = parseFpLibTable(TABLE);
    const dirs = projectPrettyDirs(files, rows);
    expect(dirs.map((d) => d.dir).sort()).toEqual(['footprints', 'spares']);
    expect(dirs.find((d) => d.dir === 'footprints')!.registeredAs).toBe('Footprints');
    expect(dirs.find((d) => d.dir === 'spares')!.registeredAs).toBe('');
  });

  it('puts a new table next to the .kicad_pro', () => {
    expect(projectFpLibTablePath([{ name: 'ecc83/ecc83-pp.kicad_pro', text: '{}' }])).toBe(
      'ecc83/fp-lib-table',
    );
    expect(
      projectFpLibTablePath([
        { name: 'ecc83/fp-lib-table', text: TABLE },
        { name: 'ecc83/ecc83-pp.kicad_pro', text: '{}' },
      ]),
    ).toBe('ecc83/fp-lib-table');
  });

  it('finds the table among the project files', () => {
    const files = [
      { name: 'ecc83/ecc83-pp.kicad_sch', text: '(kicad_sch)' },
      { name: 'ecc83/fp-lib-table', text: TABLE },
    ];
    expect(projectFpLibTable(files)).toHaveLength(2);
    expect(projectFpLibTable([files[0]!])).toEqual([]);
  });
});
