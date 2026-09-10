// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The project manager's launcher tiles and its left toolbar, as data.
 *
 * Lifted out of HomePage so the sign-in wall can draw the same chrome behind
 * its panel WITHOUT mounting the manager: the wall used to render the real
 * app blurred, which loaded the project and put its file names in the DOM for
 * anyone with devtools. These tables hold nothing but KiCad's own tool names
 * and help lines, which is all the backdrop may show.
 */
import type { JSX } from 'react';

// KiCad's own dark-theme icons (GPL), vendored under assets/.
const TILE_ICONS = import.meta.glob('../assets/launcher/*.svg', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>;
const tileUrl = (id: string): string | undefined => TILE_ICONS[`../assets/launcher/${id}.svg`];

export interface Tile {
  id: string;
  name: string;
  /** The help line printed under the title (CreateLaunchers' aHelpText). */
  desc: string;
  /** The action's own `.Tooltip(...)`, which is what the tooltip shows -
   *  a different string from the help line, and the one we were missing. */
  tip: string;
  /** `.DefaultHotkey(...)`; GetTooltip() appends it in parentheses. */
  hotkey?: string;
}

// PANEL_KICAD_LAUNCHER::CreateLaunchers(), in order, with each launcher's help
// string verbatim. Upstream passes these as TOOL_ACTION friendly names plus a
// _( "..." ) help line; the only one it ever disables is the plugin manager,
// and only when the PCM admin policy is off.
export const TILES: Tile[] = [
  {
    id: 'schematic',
    name: 'Schematic Editor',
    desc: 'Edit the project schematic',
    tip: 'Edit schematic in schematic editor',
    hotkey: 'Ctrl+E',
  },
  {
    id: 'symbols',
    name: 'Symbol Editor',
    desc: 'Edit global and/or project schematic symbol libraries',
    tip: 'Create, delete and edit schematic symbols',
    hotkey: 'Ctrl+L',
  },
  {
    id: 'pcb',
    name: 'PCB Editor',
    desc: 'Edit the project PCB design',
    tip: 'Edit PCB in PCB editor',
    hotkey: 'Ctrl+P',
  },
  {
    id: 'footprints',
    name: 'Footprint Editor',
    desc: 'Edit global and/or project PCB footprint libraries',
    tip: 'Create, delete and edit PCB footprints',
    hotkey: 'Ctrl+F',
  },
  {
    id: 'gerber',
    name: 'Gerber Viewer',
    desc: 'Preview Gerber files',
    tip: 'Preview Gerber output files',
    hotkey: 'Ctrl+G',
  },
  {
    id: 'image',
    name: 'Image Converter',
    desc: 'Convert bitmap images to schematic symbols or PCB footprints',
    tip: 'Convert bitmap images to schematic or PCB components',
    hotkey: 'Ctrl+B',
  },
  {
    id: 'calculator',
    name: 'Calculator Tools',
    desc: 'Show tools for calculating resistance, current capacity, etc.',
    tip: 'Run component calculations, track width calculations, etc.',
  },
  {
    id: 'drawingsheet',
    name: 'Drawing Sheet Editor',
    desc: 'Edit drawing sheet borders and title blocks for use in schematics and PCB designs',
    tip: 'Edit drawing sheet borders and title block',
    hotkey: 'Ctrl+Y',
  },
  // Upstream's 9th launcher, showPluginManager, is deliberately absent: the
  // plugin/content manager still needs a lot of work and ships after the
  // web-app launch. It was here greyed out with a "coming soon" badge, which
  // is a tell no KiCad frame has - a disabled launcher upstream means the PCM
  // *policy* is off, and it never grows extra chrome. Better to show eight
  // launchers that all work than nine where one is visibly ours.
];

// KiCad project-manager left toolbar (toolbars_kicad_manager.cpp). "Browse
// Project Files" is dropped: a browser can't open the OS file manager, and the
// left panel already is the project tree.
export type MgrAction = 'open' | 'new' | 'archive' | 'unarchive' | 'refresh';
export interface MgrTool {
  icon: string;
  /** TOOL_ACTION::GetFriendlyName(). */
  name: string;
  action: MgrAction;
  hotkey?: string;
  /** TOOL_ACTION::Tooltip(); absent on openProject upstream. */
  tip?: string;
}
export const MGR_TOOLS: (MgrTool | 'sep')[] = [
  // KICAD_MANAGER_ACTIONS::newProject is .Icon( BITMAPS::new_project_from_template )
  // - not new_project, which is the plain notepad-and-sparkle with no badge.
  {
    icon: 'new_project_from_template',
    name: 'New Project...',
    action: 'new',
    // Ctrl+N upstream; the browser keeps that one. See BROWSER_REBINDS.
    hotkey: 'Ctrl+Alt+N',
    tip: 'Create a new project based on an existing project',
  },
  { icon: 'open_project', name: 'Open Project...', action: 'open', hotkey: 'Ctrl+O' },
  'sep',
  {
    icon: 'zip',
    name: 'Archive Project...',
    action: 'archive',
    tip: 'Archive all project files',
  },
  {
    icon: 'unzip',
    name: 'Unarchive Project...',
    action: 'unarchive',
    tip: 'Unarchive project files from zip archive',
  },
  // The Refresh button is ACTIONS::zoomRedraw, not a manager action - the same
  // action View > Refresh runs, so it answers to the same key. It advertised
  // Ctrl+R while the menu advertised F5: one action, two promises, and Ctrl+R
  // is upstream's macOS binding rather than the general one.
  //     #if defined( __WXMAC__ ) .DefaultHotkey( MD_CTRL + 'R' )
  //     #else                    .DefaultHotkey( WXK_F5 )
  { icon: 'refresh', name: 'Refresh', action: 'refresh', hotkey: 'F5' },
];

export const tileIcon = (id: string): JSX.Element => {
  const url = tileUrl(id);
  return url ? <img src={url} alt="" /> : <span style={{ width: 44, height: 44 }} />;
};
