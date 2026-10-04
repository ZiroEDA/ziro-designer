/**
 * DIALOG_FIND (pcbnew/dialogs/dialog_find.cpp) on a live board: the hit list,
 * its cursor and wrap, the status line, and the selection each hit makes.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { installPgm } from '@ziroeda/designer/src/editors/pcb/pcb_canvas.js';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import { DEFAULT_FIND_OPTIONS, DIALOG_FIND } from '@ziroeda/pcbnew/dialogs/dialog_find.js';
import { PCB_EDIT_FRAME, type PCB_EDIT_FRAME_HOOKS } from '@ziroeda/pcbnew/pcb_edit_frame.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { PCBNEW_SETTINGS } from '@ziroeda/pcbnew/pcbnew_settings.js';

const fp = (aRef: string, aX: number, aN: number) => `
  (footprint "R" (layer "F.Cu") (at ${aX} 10) (uuid "00000000-0000-4000-8000-00000000000${aN}")
    (property "Reference" "${aRef}" (at 0 -2 0) (layer "F.SilkS") (uuid "00000000-0000-4000-8000-00000000001${aN}")
      (effects (font (size 1 1) (thickness 0.15))))
    (property "Value" "10k" (at 0 2 0) (layer "F.SilkS") (uuid "00000000-0000-4000-8000-00000000002${aN}")
      (effects (font (size 1 1) (thickness 0.15)))))`;

const BOARD_TEXT = `(kicad_pcb (version 20241229) (generator "pcbnew") (generator_version "9.0")
  (general (thickness 1.6) (legacy_teardrops no)) (paper "A4")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (5 "F.SilkS" user "F.Silkscreen") (25 "Edge.Cuts" user))
  (setup (pad_to_mask_clearance 0))
  (net 0 "") (net 1 "N1")
  ${fp('R1', 10, 1)}
  ${fp('R2', 20, 2)}
  ${fp('C1', 30, 3)}
)`;

let board: BOARD;
let frame: PCB_EDIT_FRAME;
let dlg: DIALOG_FIND;

const selected = (): string[] =>
  frame
    .GetSelectionTool()
    .GetSelection()
    .Items()
    .map((i) => (i as unknown as { GetReference(): string }).GetReference());

beforeEach(() => {
  installPgm();
  const settings = new PCBNEW_SETTINGS();
  frame = new PCB_EDIT_FRAME({
    settings: () => settings,
    onModify: () => {},
  } as unknown as PCB_EDIT_FRAME_HOOKS);
  board = ParseBoard(BOARD_TEXT);
  frame.SetBoard(board, false);
  dlg = new DIALOG_FIND(frame);
});

describe('DIALOG_FIND::search', () => {
  it('selects each hit in board order and counts it on the status line', () => {
    dlg.SetSearchString('R?');
    dlg.SetOptions({ ...DEFAULT_FIND_OPTIONS, wildcards: true });

    dlg.OnFindNext();
    expect(dlg.m_status).toBe('Hit(s): 1 / 2');
    expect(selected()).toEqual(['R1']);

    dlg.OnFindNext();
    expect(dlg.m_status).toBe('Hit(s): 2 / 2');
    expect(selected()).toEqual(['R2']);
  });

  it('wraps past the last hit when Wrap is checked, and stops when it is not', () => {
    dlg.SetSearchString('R?');
    dlg.SetOptions({ ...DEFAULT_FIND_OPTIONS, wildcards: true });
    dlg.OnFindNext();
    dlg.OnFindNext();
    dlg.OnFindNext();
    expect(dlg.m_status).toBe('Hit(s): 1 / 2');

    dlg.SetOptions({ ...DEFAULT_FIND_OPTIONS, wildcards: true, wrap: false });
    dlg.OnFindNext();
    dlg.OnFindNext();
    dlg.OnFindNext();
    // endIsReached: the cursor stays on the last real hit, the label says so.
    expect(dlg.m_status).toBe('No hits');
    expect(dlg.GetItem()).toBe(board.Footprints()[1]);
  });

  it('Find Previous starts from the end', () => {
    dlg.SetSearchString('R?');
    dlg.SetOptions({ ...DEFAULT_FIND_OPTIONS, wildcards: true });
    dlg.OnFindPrevious();
    expect(dlg.m_status).toBe('Hit(s): 2 / 2');
    expect(selected()).toEqual(['R2']);
  });

  it('Find Previous starts from the end even without Wrap', () => {
    // m_it = m_hitList.end() on a fresh list (dialog_find.cpp:327), so the
    // first step back lands on the last hit rather than reporting the start.
    dlg.SetSearchString('R?');
    dlg.SetOptions({ ...DEFAULT_FIND_OPTIONS, wildcards: true, wrap: false });
    dlg.OnFindPrevious();
    expect(dlg.m_status).toBe('Hit(s): 2 / 2');
  });

  it('a miss says so', () => {
    dlg.SetSearchString('Q9');
    dlg.OnFindNext();
    expect(dlg.m_status).toBe("'Q9' not found");
    expect(dlg.GetItem()).toBeNull();
  });

  it('a value is found through Values, or through Texts (which walks GetFields)', () => {
    dlg.SetSearchString('10k');
    dlg.OnFindNext();
    expect(dlg.m_status).toBe('Hit(s): 1 / 3');

    // dialog_find.cpp:264: the Texts loop visits every field, Value included.
    dlg.SetOptions({ ...DEFAULT_FIND_OPTIONS, includeValues: false });
    dlg.OnFindNext();
    expect(dlg.m_status).toBe('Hit(s): 1 / 3');

    dlg.SetOptions({ ...DEFAULT_FIND_OPTIONS, includeValues: false, includeTexts: false });
    dlg.OnFindNext();
    expect(dlg.m_status).toBe("'10k' not found");
  });

  it('a board change makes the hit list stale (BOARD_LISTENER)', () => {
    dlg.SetSearchString('R?');
    dlg.SetOptions({ ...DEFAULT_FIND_OPTIONS, wildcards: true });
    dlg.OnFindNext();

    const c1 = board.Footprints()[2]!;
    c1.SetReference('R3');
    board.OnItemChanged(c1);

    dlg.OnFindNext();
    // Re-collected, so this is the first hit of three, not the second of two.
    expect(dlg.m_status).toBe('Hit(s): 1 / 3');
  });

  it('puts the search string at the top of the frame history', () => {
    dlg.SetSearchString('C1');
    dlg.OnFindNext();
    dlg.SetSearchString('R1');
    dlg.OnFindNext();
    dlg.SetSearchString('C1');
    dlg.OnFindNext();
    expect(frame.GetFindHistoryList()).toEqual(['C1', 'R1']);
  });
});
