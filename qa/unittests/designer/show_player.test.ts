// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * What a launcher does with no project open, against
 * `KICAD_MANAGER_CONTROL::ShowPlayer` (`kicad/tools/kicad_manager_control.cpp:735-750`)
 * and `PANEL_KICAD_LAUNCHER::CreateLaunchers` (`kicad/dialogs/panel_kicad_launcher.cpp`).
 *
 * Nothing pinned this: our tiles greyed themselves on a predicate of our own
 * and offered a tooltip that exists nowhere in KiCad, and no test moved.
 *
 * The two messages below are transcribed from the C++, never read back from
 * the module under test.
 */

import { describe, expect, it } from 'vitest';
import {
  NO_PROJECT_PCB_MESSAGE,
  NO_PROJECT_SCHEMATIC_MESSAGE,
  type LauncherId,
  showPlayerRefusal,
} from '@ziroeda/designer/src/home/show_player.js';
import { INFO_CAPTION } from '@ziroeda/designer/src/ui/message_dialog.js';

const ALL: LauncherId[] = [
  'schematic',
  'symbols',
  'pcb',
  'footprints',
  'gerber',
  'image',
  'calculator',
  'drawingsheet',
];

describe('the two messages', () => {
  it('are upstream’s, to the character', () => {
    expect(NO_PROJECT_SCHEMATIC_MESSAGE).toBe('Create (or open) a project to edit a schematic.');
    // Lower-case "pcb" is what the C++ says; tidying it would be inventing.
    expect(NO_PROJECT_PCB_MESSAGE).toBe('Create (or open) a project to edit a pcb.');
  });

  it('are raised in a box captioned "Information"', () => {
    // DisplayInfoMessage passes _( "Information" ) (common/confirm.cpp:266).
    expect(INFO_CAPTION).toBe('Information');
  });
});

describe('with no project open', () => {
  it('the Schematic Editor refuses, with the schematic message', () => {
    expect(showPlayerRefusal('schematic', false)).toBe(
      'Create (or open) a project to edit a schematic.',
    );
  });

  it('the PCB Editor refuses, with the pcb message', () => {
    expect(showPlayerRefusal('pcb', false)).toBe('Create (or open) a project to edit a pcb.');
  });

  // One test per launcher, named for it: `ShowPlayer` guards exactly two
  // FRAME_Ts and a third appearing is a separate bug from one disappearing.
  for (const id of [
    'symbols',
    'footprints',
    'gerber',
    'image',
    'calculator',
    'drawingsheet',
  ] as LauncherId[]) {
    it(`the ${id} launcher opens anyway - ShowPlayer does not guard it`, () => {
      expect(showPlayerRefusal(id, false)).toBeNull();
    });
  }

  it('guards exactly two of the eight', () => {
    const refused = ALL.filter((id) => showPlayerRefusal(id, false) !== null);
    expect(refused).toStrictEqual(['schematic', 'pcb']);
  });
});

describe('with a project open', () => {
  it('nothing refuses at all, the two guarded ones included', () => {
    for (const id of ALL) expect(showPlayerRefusal(id, true)).toBeNull();
  });
});

describe('the predicate is IsProjectActive, not "the file list has one"', () => {
  it('opens the PCB Editor for a project with no board in it', () => {
    // `m_active_project` is set by LoadProject and cleared by CloseProject
    // (kicad_manager_frame.cpp:835, 977) - it says a project is loaded, not
    // what is in it. Ours tested the loaded file list for a .kicad_pcb, so a
    // project whose board had been deleted greyed a tile KiCad would open.
    expect(showPlayerRefusal('pcb', true)).toBeNull();
    expect(showPlayerRefusal('schematic', true)).toBeNull();
  });
});
