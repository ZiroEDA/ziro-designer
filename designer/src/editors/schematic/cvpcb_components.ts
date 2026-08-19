// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The component list the Assign Footprints window works on. Counterpart:
 * `eeschema/netlist_exporters/netlist_exporter_base.cpp`
 * (NETLIST_EXPORTER_BASE::CreatePinList / findNextSymbol) feeding
 * `cvpcb/cvpcb_mainframe.cpp`'s COMPONENT list.
 *
 * Like the netlist CVPCB is handed, this is one entry per *symbol*, not per
 * symbol unit: the units of a multi-unit part (U1A, U1B, …) collapse into a
 * single row whose pin count is the whole part's, and assigning a footprint
 * writes the field to every unit (CVPCB_MAINFRAME::AssociateFootprint sets the
 * FPID on every netlist entry sharing the symbol's KIID). Power and other
 * virtual symbols (reference starting with '#') and symbols excluded from the
 * board are left out, exactly as the netlist leaves them out.
 */

import {
  compareRefs,
  refId,
  type LibSymbol,
  type Schematic,
  type SchSymbol,
} from '@ziroeda/eeschema';
import { schSymbolLibraryName } from '@ziroeda/eeschema';
import { expandStackedPinNotation } from '@ziroeda/common/src/string_utils.js';

/** One row of the "Symbol : Footprint Assignments" pane. */
export interface CvpcbComponent {
  /** Reference designator ("R1"), the identity units are merged on. */
  reference: string;
  value: string;
  /** Current FPID ("Library:Footprint"), '' when unassigned. */
  footprint: string;
  /** `ki_fp_filters` globs of the library symbol (the "Use symbol footprint
   *  filters" filter's patterns). */
  fpFilters: readonly string[];
  /** Pins of the whole part: every unit, each pin *number* counted once,
   *  then stacked-pin notation expanded. See `libSymbolPinCount`. */
  pinCount: number;
  /** Every unit of the part: the sheet file and the symbol's edit id. */
  instances: readonly { file: string; id: string }[];
}

const fieldOf = (s: SchSymbol, key: string): string =>
  s.fields.find((f) => f.key === key)?.value ?? '';

/**
 * The `<pins>` count CVPCB reads out of the netlist for a whole part, which is
 * what "Filter by pin count" matches against a footprint's unique pad count.
 *
 * `netlist_exporter_xml.cpp:1040-1060` is the specification, and both halves of
 * it matter:
 *
 *  1. `lcomp->GetGraphicalPins( 0, 0 )` — unit 0 and body style 0 both mean "no
 *     filtering" (`lib_symbol.cpp:1124-1141`), so this is *every* pin of *every*
 *     unit and both De Morgan representations. The list is then sorted by number
 *     and adjacent duplicates erased, with the comment naming exactly the two
 *     ways a pin turns up twice: a symbol with several units per package, and a
 *     DeMorgan conversion. The dedupe key is therefore the **pin number alone**
 *     — a quad op-amp that draws V+/V- on all four units contributes those two
 *     pins once, not eight times. Keying on `unit + number`, as this did,
 *     reported a quad op-amp with far too many pins, and since no footprint has
 *     that many pads "Filter by pin count" then matched nothing at all.
 *  2. Each surviving pin emits one `<pin>` node per number its stacked-pin
 *     notation expands to (`:1074-1092`, `SCH_PIN::GetStackedPinNumbers`), and
 *     `kicad_netlist_reader.cpp:874-878` counts the emitted nodes. A pin
 *     numbered `[1-4]` is four footprint pads, not one. The expansion runs
 *     *after* the dedupe and its results are not deduped again, so pins
 *     numbered `[1-4]` and `[3-6]` count 8, exactly as upstream.
 *
 * An unparseable stack (upstream's `aValid` false) falls back to the single pin
 * upstream emits for it.
 */
export function libSymbolPinCount(lib: LibSymbol | undefined): number {
  if (!lib) return 0;
  const numbers = new Set<string>();
  for (const unit of lib.units) for (const pin of unit.pins) numbers.add(pin.number);

  let count = 0;
  for (const number of numbers) {
    const { numbers: expanded, valid } = expandStackedPinNotation(number);
    count += valid && expanded.length > 0 ? expanded.length : 1;
  }
  return count;
}

/** `ki_fp_filters` of a library symbol, split on whitespace like KiCad. */
export function libSymbolFpFilters(lib: LibSymbol | undefined): string[] {
  const raw = lib?.properties.find((p) => p.key === 'ki_fp_filters')?.value ?? '';
  return raw.split(/\s+/).filter(Boolean);
}

/**
 * Collect the components of a hierarchy. `files` names the sheets to read in
 * hierarchy order (the current schematic's sheets — not every `.kicad_sch`ic
 * that happens to sit in the project folder); when omitted every doc is read.
 */
export function collectCvpcbComponents(
  docs: ReadonlyMap<string, Schematic>,
  files?: readonly string[],
): CvpcbComponent[] {
  const order = files?.length ? files : [...docs.keys()];
  const byRef = new Map<string, CvpcbComponent & { fpFilters: string[] }>();
  const seenFiles = new Set<string>();

  for (const file of order) {
    // A sheet reached twice in the hierarchy is the same screen: read it once.
    if (seenFiles.has(file)) continue;
    seenFiles.add(file);
    const doc = docs.get(file);
    if (!doc) continue;
    const libs = new Map(doc.libSymbols.map((l) => [l.libId, l]));

    doc.symbols.forEach((sym, index) => {
      const reference = fieldOf(sym, 'Reference');
      if (!reference || reference.startsWith('#') || !sym.onBoard) return;
      const instance = { file, id: refId('symbol', sym.uuid, index) };
      const existing = byRef.get(reference);
      if (existing) {
        existing.instances = [...existing.instances, instance];
        // The first unit carrying a value/footprint wins, like the netlist's
        // first-found symbol for the reference.
        if (!existing.value) existing.value = fieldOf(sym, 'Value');
        if (!existing.footprint) existing.footprint = fieldOf(sym, 'Footprint');
        return;
      }
      const lib = libs.get(schSymbolLibraryName(sym));
      byRef.set(reference, {
        reference,
        value: fieldOf(sym, 'Value'),
        footprint: fieldOf(sym, 'Footprint'),
        fpFilters: libSymbolFpFilters(lib),
        pinCount: libSymbolPinCount(lib),
        instances: [instance],
      });
    });
  }

  return [...byRef.values()].sort((a, b) => compareRefs(a.reference, b.reference));
}

/**
 * `CVPCB_MAINFRAME::ReadNetListAndFpFiles` (readwrite_dlgs.cpp:255-274) — the
 * row the window opens on.
 *
 *     int firstUnassigned = wxNOT_FOUND;
 *
 *     for( unsigned i = 0; i < m_netlist.GetCount(); i++ )
 *     {
 *         …
 *         if( firstUnassigned == wxNOT_FOUND && component->GetFPID().empty() )
 *             firstUnassigned = i;
 *     }
 *
 *     if( firstUnassigned >= 0 )
 *         m_symbolsListBox->SetSelection( firstUnassigned, true );
 *
 * Two rules in that, and we had neither. The window lands on the **first
 * symbol still needing a footprint**, which is the job you opened it to do;
 * and when there is no such symbol - every part already assigned - the guard
 * fails and **nothing is selected at all**, so the real window opens with no
 * highlighted row. Ours selected row 0 unconditionally, which also dragged the
 * footprint pane onto C1's footprint and made an already-finished board look
 * like it had work outstanding.
 *
 * Returns -1 (`wxNOT_FOUND`) for "select nothing".
 */
export function firstUnassignedComponent(components: readonly CvpcbComponent[]): number {
  return components.findIndex((c) => !c.footprint);
}

/**
 * CVPCB_MAINFRAME::formatSymbolDesc — the exact text of a row in the
 * "Symbol : Footprint Assignments" pane: a 3-wide index, the reference right
 * aligned in 8 columns, " - ", the value right aligned in 16, " : " and the
 * footprint. The pane is monospaced so the columns line up.
 */
export function formatSymbolDesc(
  index: number,
  reference: string,
  value: string,
  footprint: string,
): string {
  const ref = `${' '.repeat(Math.max(0, 8 - reference.length))}${reference}`;
  const val = `${' '.repeat(Math.max(0, 16 - value.length))}${value}`;
  return `${String(index).padStart(3, ' ')} ${ref} - ${val} : ${footprint}`;
}

/** FOOTPRINTS_LISTBOX::SetFootprints — "%3d Lib:Footprint". */
export function formatFootprintDesc(index: number, fpid: string): string {
  return `${String(index).padStart(3, ' ')} ${fpid}`;
}

/**
 * `CVPCB_CONTROL::ToNA` — the index of the next or previous *unassociated*
 * component, or null when there is nowhere to go.
 *
 * **It does not wrap**, and that is deliberate rather than an oversight:
 *
 *     for( unsigned int idx : naComp )
 *         if( idx > newSel ) { changeSel = true; newSel = idx; break; }
 *     …
 *     if( changeSel )
 *         m_frame->SetSelectedComponent( newSel );
 *
 * `changeSel` stays false when the scan finds nothing, so past the last
 * unassociated component the selection holds and the button looks dead. Ours
 * wrapped modulo the component count, which is arguably friendlier but is not
 * what the application does — and a wrap silently takes you back to the top of
 * a board you thought you had finished.
 *
 * An empty set of unassociated components is "nowhere to go": nothing is
 * unassociated, so `naComp.empty()` returns early.
 *
 * Upstream also does nothing in *either* direction when nothing is selected —
 * `newSel` starts at `UINT_MAX`, so the forward scan can never match, and the
 * backward branch is guarded on a non-empty selection. There is no such state in
 * this dialog: the current index is always valid.
 *
 * Lives here rather than in the dialog because a closure inside a `.tsx` cannot
 * be tested — which is how the wrap survived unnoticed.
 */
export function nextUnassociated(
  count: number,
  current: number,
  dir: 1 | -1,
  isAssigned: (index: number) => boolean,
): number | null {
  const na: number[] = [];
  for (let i = 0; i < count; i++) if (!isAssigned(i)) na.push(i);
  if (na.length === 0) return null;
  const found =
    dir === 1 ? na.find((i) => i > current) : [...na].reverse().find((i) => i < current);
  return found ?? null;
}
