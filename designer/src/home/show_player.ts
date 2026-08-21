// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * What happens when you press a launcher with no project open —
 * `KICAD_MANAGER_CONTROL::ShowPlayer` (`kicad/tools/kicad_manager_control.cpp:735-750`).
 *
 * The answer is **not** "the button is greyed". `PANEL_KICAD_LAUNCHER::CreateLaunchers`
 * builds every tile through an `addLauncher` whose last parameter is
 * `bool enabled = true` (`kicad/dialogs/panel_kicad_launcher.cpp:104`), and the
 * only call in the whole function that passes anything else is the plugin
 * manager, gated on an admin policy (`:171-174`). All eight of the others are
 * lit, always, project or no project.
 *
 * What refuses is the action behind them:
 *
 *     if( playerType == FRAME_SCH && !m_frame->IsProjectActive() )
 *     {
 *         DisplayInfoMessage( m_frame, _( "Create (or open) a project to edit a schematic." ),
 *                             wxEmptyString );
 *         return -1;
 *     }
 *     else if( playerType == FRAME_PCB_EDITOR && !m_frame->IsProjectActive() )
 *     {
 *         DisplayInfoMessage( m_frame, _( "Create (or open) a project to edit a pcb." ),
 *                             wxEmptyString );
 *         return -1;
 *     }
 *
 * Two frames, two messages, and nothing else in the list is guarded at all —
 * the Symbol Editor, the Footprint Editor, GerbView, the Image Converter, the
 * Calculator and the Drawing Sheet Editor all open standalone.
 *
 * That difference is worth the module. Ours greyed the Schematic and PCB tiles
 * to 45% and swapped their tooltip for a sentence of our own invention, so the
 * first thing anyone saw on opening the app was two of eight launchers looking
 * broken — and the comment above our own tile table already said upstream only
 * ever disables the plugin manager.
 *
 * The guard also keys off the wrong thing here: it asked whether the loaded
 * file list happened to contain a `.kicad_sch` or a `.kicad_pcb`, where
 * upstream asks `IsProjectActive()` — `m_active_project`, which is false at
 * construction, true once `LoadProject` succeeds and false again after
 * `CloseProject` (`kicad_manager_frame.cpp:149, 835, 977`). A project whose
 * board had been deleted therefore greyed a tile KiCad would have opened.
 */

/** `_( "Create (or open) a project to edit a schematic." )` — `:742`. */
export const NO_PROJECT_SCHEMATIC_MESSAGE = 'Create (or open) a project to edit a schematic.';

/** `_( "Create (or open) a project to edit a pcb." )` — `:747`. Lower-case
 *  "pcb" is upstream's own, and is not tidied here. */
export const NO_PROJECT_PCB_MESSAGE = 'Create (or open) a project to edit a pcb.';

/**
 * The launchers, by the id our tile table uses.
 *
 * Only two of them map to a `FRAME_T` that `ShowPlayer` guards, so only two can
 * ever refuse.
 */
export type LauncherId =
  | 'schematic'
  | 'symbols'
  | 'pcb'
  | 'footprints'
  | 'gerber'
  | 'image'
  | 'calculator'
  | 'drawingsheet';

/**
 * The message this launcher refuses with, or `null` to go ahead.
 *
 * `isProjectActive` is `KICAD_MANAGER_FRAME::IsProjectActive()`
 * (`kicad_manager_frame.cpp:1362-1365`), which returns `m_active_project` and
 * nothing else — not "is there a schematic in the file list".
 */
export function showPlayerRefusal(id: LauncherId, isProjectActive: boolean): string | null {
  if (isProjectActive) return null;
  if (id === 'schematic') return NO_PROJECT_SCHEMATIC_MESSAGE;
  if (id === 'pcb') return NO_PROJECT_PCB_MESSAGE;
  return null;
}
