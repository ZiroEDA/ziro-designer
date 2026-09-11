// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The bundled default repository.
 *
 * KiCad ships a well-known default repository URL; the equivalent here is a
 * repository compiled into the app so the Plugin and Content Manager has real,
 * installable content out of the box (and works with no network). Third-party
 * repositories can still be added by URL, see `pcmStore.addRepository`.
 *
 * The colour themes are the ones KiCad's own repository offers, files and
 * metadata verbatim (`kicad_color_schemes.ts`). The library packages carry
 * small, real `.kicad_sym` libraries, read by the same parser as any other
 * symbol library.
 */

import { KICAD_COLOR_SCHEMES } from './kicad_color_schemes.js';
import type { Contact, LibraryPayload, PackageVersion, Repository, RepoPackage } from './types.js';

// ---- symbol libraries --------------------------------------------------------
// Small, real `.kicad_sym` libraries (KiCad 10 format), read by readSymbolLib.

const LIB_PASSIVES = `(kicad_symbol_lib
	(version 20251024)
	(generator "kicad_symbol_editor")
	(generator_version "10.0")
	(symbol "R"
		(pin_numbers (hide yes))
		(pin_names (offset 0))
		(exclude_from_sim no)
		(in_bom yes)
		(on_board yes)
		(property "Reference" "R" (at 2.032 0 90)
			(show_name no) (effects (font (size 1.27 1.27))))
		(property "Value" "R" (at 0 0 90)
			(show_name no) (effects (font (size 1.27 1.27))))
		(property "Footprint" "" (at -1.778 0 90)
			(show_name no) (hide yes) (effects (font (size 1.27 1.27))))
		(property "Datasheet" "" (at 0 0 0)
			(show_name no) (hide yes) (effects (font (size 1.27 1.27))))
		(property "Description" "Resistor" (at 0 0 0)
			(show_name no) (hide yes) (effects (font (size 1.27 1.27))))
		(symbol "R_0_1"
			(rectangle (start -1.016 -2.54) (end 1.016 2.54)
				(stroke (width 0.254) (type default)) (fill (type none))))
		(symbol "R_1_1"
			(pin passive line (at 0 3.81 270) (length 1.27)
				(name "" (effects (font (size 1.27 1.27))))
				(number "1" (effects (font (size 1.27 1.27)))))
			(pin passive line (at 0 -3.81 90) (length 1.27)
				(name "" (effects (font (size 1.27 1.27))))
				(number "2" (effects (font (size 1.27 1.27))))))
		(embedded_fonts no)
	)
	(symbol "C"
		(pin_numbers (hide yes))
		(pin_names (offset 0.254))
		(exclude_from_sim no)
		(in_bom yes)
		(on_board yes)
		(property "Reference" "C" (at 0.635 2.54 0)
			(effects (font (size 1.27 1.27)) (justify left)))
		(property "Value" "C" (at 0.635 -2.54 0)
			(effects (font (size 1.27 1.27)) (justify left)))
		(property "Footprint" "" (at 0.9652 -3.81 0)
			(show_name no) (hide yes) (effects (font (size 1.27 1.27)) (justify left)))
		(property "Datasheet" "" (at 0 0 0)
			(show_name no) (hide yes) (effects (font (size 1.27 1.27))))
		(property "Description" "Unpolarized capacitor" (at 0 0 0)
			(show_name no) (hide yes) (effects (font (size 1.27 1.27))))
		(symbol "C_0_1"
			(polyline (pts (xy -2.032 -0.762) (xy 2.032 -0.762))
				(stroke (width 0.508) (type default)) (fill (type none)))
			(polyline (pts (xy -2.032 0.762) (xy 2.032 0.762))
				(stroke (width 0.508) (type default)) (fill (type none))))
		(symbol "C_1_1"
			(pin passive line (at 0 3.81 270) (length 2.794)
				(name "~" (effects (font (size 1.27 1.27))))
				(number "1" (effects (font (size 1.27 1.27)))))
			(pin passive line (at 0 -3.81 90) (length 2.794)
				(name "~" (effects (font (size 1.27 1.27))))
				(number "2" (effects (font (size 1.27 1.27))))))
		(embedded_fonts no)
	)
	(symbol "L"
		(pin_numbers (hide yes))
		(pin_names (offset 1.016) (hide yes))
		(exclude_from_sim no)
		(in_bom yes)
		(on_board yes)
		(property "Reference" "L" (at -1.27 0 90)
			(effects (font (size 1.27 1.27))))
		(property "Value" "L" (at 1.905 0 90)
			(effects (font (size 1.27 1.27))))
		(property "Footprint" "" (at 0 0 0)
			(show_name no) (hide yes) (effects (font (size 1.27 1.27))))
		(property "Datasheet" "" (at 0 0 0)
			(show_name no) (hide yes) (effects (font (size 1.27 1.27))))
		(property "Description" "Inductor" (at 0 0 0)
			(show_name no) (hide yes) (effects (font (size 1.27 1.27))))
		(symbol "L_0_1"
			(arc (start 0 -2.54) (mid 0.6323 -1.905) (end 0 -1.27)
				(stroke (width 0) (type default)) (fill (type none)))
			(arc (start 0 -1.27) (mid 0.6323 -0.635) (end 0 0)
				(stroke (width 0) (type default)) (fill (type none)))
			(arc (start 0 0) (mid 0.6323 0.635) (end 0 1.27)
				(stroke (width 0) (type default)) (fill (type none)))
			(arc (start 0 1.27) (mid 0.6323 1.905) (end 0 2.54)
				(stroke (width 0) (type default)) (fill (type none))))
		(symbol "L_1_1"
			(pin passive line (at 0 3.81 270) (length 1.27)
				(name "1" (effects (font (size 1.27 1.27))))
				(number "1" (effects (font (size 1.27 1.27)))))
			(pin passive line (at 0 -3.81 90) (length 1.27)
				(name "2" (effects (font (size 1.27 1.27))))
				(number "2" (effects (font (size 1.27 1.27))))))
		(embedded_fonts no)
	)
)
`;

const LIB_LED = `(kicad_symbol_lib
	(version 20251024)
	(generator "kicad_symbol_editor")
	(generator_version "10.0")
	(symbol "LED"
		(pin_numbers (hide yes))
		(pin_names (offset 1.016) (hide yes))
		(exclude_from_sim no)
		(in_bom yes)
		(on_board yes)
		(property "Reference" "D" (at 0 2.54 0)
			(effects (font (size 1.27 1.27))))
		(property "Value" "LED" (at 0 -2.54 0)
			(effects (font (size 1.27 1.27))))
		(property "Footprint" "" (at 0 0 0)
			(show_name no) (hide yes) (effects (font (size 1.27 1.27))))
		(property "Datasheet" "" (at 0 0 0)
			(show_name no) (hide yes) (effects (font (size 1.27 1.27))))
		(property "Description" "Light emitting diode" (at 0 0 0)
			(show_name no) (hide yes) (effects (font (size 1.27 1.27))))
		(symbol "LED_0_1"
			(polyline (pts (xy -1.27 -1.27) (xy -1.27 1.27))
				(stroke (width 0.254) (type default)) (fill (type none)))
			(polyline (pts (xy -1.27 0) (xy 1.27 0))
				(stroke (width 0) (type default)) (fill (type none)))
			(polyline (pts (xy 1.27 -1.27) (xy 1.27 1.27) (xy -1.27 0) (xy 1.27 -1.27))
				(stroke (width 0.254) (type default)) (fill (type none))))
		(symbol "LED_1_1"
			(pin passive line (at -3.81 0 0) (length 2.54)
				(name "K" (effects (font (size 1.27 1.27))))
				(number "1" (effects (font (size 1.27 1.27)))))
			(pin passive line (at 3.81 0 180) (length 2.54)
				(name "A" (effects (font (size 1.27 1.27))))
				(number "2" (effects (font (size 1.27 1.27))))))
		(embedded_fonts no)
	)
)
`;

const LIB_DIODE = `(kicad_symbol_lib
	(version 20251024)
	(generator "kicad_symbol_editor")
	(generator_version "10.0")
	(symbol "D"
		(pin_numbers (hide yes))
		(pin_names (offset 1.016) (hide yes))
		(exclude_from_sim no)
		(in_bom yes)
		(on_board yes)
		(property "Reference" "D" (at 0 2.54 0) (effects (font (size 1.27 1.27))))
		(property "Value" "D" (at 0 -2.54 0) (effects (font (size 1.27 1.27))))
		(property "Footprint" "" (at 0 0 0) (show_name no) (hide yes) (effects (font (size 1.27 1.27))))
		(property "Datasheet" "" (at 0 0 0) (show_name no) (hide yes) (effects (font (size 1.27 1.27))))
		(property "Description" "Diode" (at 0 0 0) (show_name no) (hide yes) (effects (font (size 1.27 1.27))))
		(symbol "D_0_1"
			(polyline (pts (xy 1.27 1.27) (xy 1.27 -1.27))
				(stroke (width 0.254) (type default)) (fill (type none)))
			(polyline (pts (xy -1.27 1.27) (xy 1.27 0) (xy -1.27 -1.27) (xy -1.27 1.27))
				(stroke (width 0.254) (type default)) (fill (type none))))
		(symbol "D_1_1"
			(pin passive line (at -3.81 0 0) (length 2.54)
				(name "K" (effects (font (size 1.27 1.27))))
				(number "1" (effects (font (size 1.27 1.27)))))
			(pin passive line (at 3.81 0 180) (length 2.54)
				(name "A" (effects (font (size 1.27 1.27))))
				(number "2" (effects (font (size 1.27 1.27))))))
		(embedded_fonts no)
	)
	(symbol "D_Zener"
		(pin_numbers (hide yes))
		(pin_names (offset 1.016) (hide yes))
		(exclude_from_sim no)
		(in_bom yes)
		(on_board yes)
		(property "Reference" "D" (at 0 2.54 0) (effects (font (size 1.27 1.27))))
		(property "Value" "D_Zener" (at 0 -2.54 0) (effects (font (size 1.27 1.27))))
		(property "Footprint" "" (at 0 0 0) (show_name no) (hide yes) (effects (font (size 1.27 1.27))))
		(property "Datasheet" "" (at 0 0 0) (show_name no) (hide yes) (effects (font (size 1.27 1.27))))
		(property "Description" "Zener diode" (at 0 0 0) (show_name no) (hide yes) (effects (font (size 1.27 1.27))))
		(symbol "D_Zener_0_1"
			(polyline (pts (xy 0.762 0.762) (xy 1.27 1.27) (xy 1.27 -1.27) (xy 1.778 -0.762))
				(stroke (width 0.254) (type default)) (fill (type none)))
			(polyline (pts (xy -1.27 1.27) (xy 1.27 0) (xy -1.27 -1.27) (xy -1.27 1.27))
				(stroke (width 0.254) (type default)) (fill (type none))))
		(symbol "D_Zener_1_1"
			(pin passive line (at -3.81 0 0) (length 2.54)
				(name "K" (effects (font (size 1.27 1.27))))
				(number "1" (effects (font (size 1.27 1.27)))))
			(pin passive line (at 3.81 0 180) (length 2.54)
				(name "A" (effects (font (size 1.27 1.27))))
				(number "2" (effects (font (size 1.27 1.27))))))
		(embedded_fonts no)
	)
	(symbol "D_Schottky"
		(pin_numbers (hide yes))
		(pin_names (offset 1.016) (hide yes))
		(exclude_from_sim no)
		(in_bom yes)
		(on_board yes)
		(property "Reference" "D" (at 0 2.54 0) (effects (font (size 1.27 1.27))))
		(property "Value" "D_Schottky" (at 0 -2.54 0) (effects (font (size 1.27 1.27))))
		(property "Footprint" "" (at 0 0 0) (show_name no) (hide yes) (effects (font (size 1.27 1.27))))
		(property "Datasheet" "" (at 0 0 0) (show_name no) (hide yes) (effects (font (size 1.27 1.27))))
		(property "Description" "Schottky diode" (at 0 0 0) (show_name no) (hide yes) (effects (font (size 1.27 1.27))))
		(symbol "D_Schottky_0_1"
			(polyline (pts (xy 1.905 0.762) (xy 1.905 1.143) (xy 1.27 1.143) (xy 1.27 -1.143) (xy 0.635 -1.143) (xy 0.635 -0.762))
				(stroke (width 0.254) (type default)) (fill (type none)))
			(polyline (pts (xy -1.27 1.27) (xy 1.27 0) (xy -1.27 -1.27) (xy -1.27 1.27))
				(stroke (width 0.254) (type default)) (fill (type none))))
		(symbol "D_Schottky_1_1"
			(pin passive line (at -3.81 0 0) (length 2.54)
				(name "K" (effects (font (size 1.27 1.27))))
				(number "1" (effects (font (size 1.27 1.27)))))
			(pin passive line (at 3.81 0 180) (length 2.54)
				(name "A" (effects (font (size 1.27 1.27))))
				(number "2" (effects (font (size 1.27 1.27))))))
		(embedded_fonts no)
	)
)
`;

const LIB_CONNECTOR = `(kicad_symbol_lib
	(version 20251024)
	(generator "kicad_symbol_editor")
	(generator_version "10.0")
	(symbol "Conn_01x02"
		(pin_names (offset 1.016) (hide yes))
		(exclude_from_sim no)
		(in_bom yes)
		(on_board yes)
		(property "Reference" "J" (at 1.27 2.54 0) (effects (font (size 1.27 1.27))))
		(property "Value" "Conn_01x02" (at 1.27 -5.08 0) (effects (font (size 1.27 1.27))))
		(property "Footprint" "" (at 0 0 0) (show_name no) (hide yes) (effects (font (size 1.27 1.27))))
		(property "Datasheet" "" (at 0 0 0) (show_name no) (hide yes) (effects (font (size 1.27 1.27))))
		(property "Description" "Generic connector, single row, 01x02" (at 0 0 0) (show_name no) (hide yes) (effects (font (size 1.27 1.27))))
		(symbol "Conn_01x02_1_1"
			(rectangle (start -1.27 -1.27) (end 0 1.27)
				(stroke (width 0.1524) (type default)) (fill (type none)))
			(pin passive line (at -5.08 0 0) (length 3.81)
				(name "Pin_1" (effects (font (size 1.27 1.27))))
				(number "1" (effects (font (size 1.27 1.27)))))
			(pin passive line (at -5.08 -2.54 0) (length 3.81)
				(name "Pin_2" (effects (font (size 1.27 1.27))))
				(number "2" (effects (font (size 1.27 1.27))))))
		(embedded_fonts no)
	)
	(symbol "Conn_01x03"
		(pin_names (offset 1.016) (hide yes))
		(exclude_from_sim no)
		(in_bom yes)
		(on_board yes)
		(property "Reference" "J" (at 1.27 5.08 0) (effects (font (size 1.27 1.27))))
		(property "Value" "Conn_01x03" (at 1.27 -5.08 0) (effects (font (size 1.27 1.27))))
		(property "Footprint" "" (at 0 0 0) (show_name no) (hide yes) (effects (font (size 1.27 1.27))))
		(property "Datasheet" "" (at 0 0 0) (show_name no) (hide yes) (effects (font (size 1.27 1.27))))
		(property "Description" "Generic connector, single row, 01x03" (at 0 0 0) (show_name no) (hide yes) (effects (font (size 1.27 1.27))))
		(symbol "Conn_01x03_1_1"
			(rectangle (start -1.27 -3.81) (end 0 3.81)
				(stroke (width 0.1524) (type default)) (fill (type none)))
			(pin passive line (at -5.08 2.54 0) (length 3.81)
				(name "Pin_1" (effects (font (size 1.27 1.27))))
				(number "1" (effects (font (size 1.27 1.27)))))
			(pin passive line (at -5.08 0 0) (length 3.81)
				(name "Pin_2" (effects (font (size 1.27 1.27))))
				(number "2" (effects (font (size 1.27 1.27)))))
			(pin passive line (at -5.08 -2.54 0) (length 3.81)
				(name "Pin_3" (effects (font (size 1.27 1.27))))
				(number "3" (effects (font (size 1.27 1.27))))))
		(embedded_fonts no)
	)
)
`;

const LIB_TRANSISTOR = `(kicad_symbol_lib
	(version 20251024)
	(generator "kicad_symbol_editor")
	(generator_version "10.0")
	(symbol "Q_NPN_BCE"
		(pin_names (offset 0) (hide yes))
		(exclude_from_sim no)
		(in_bom yes)
		(on_board yes)
		(property "Reference" "Q" (at 5.08 1.27 0) (effects (font (size 1.27 1.27)) (justify left)))
		(property "Value" "Q_NPN_BCE" (at 5.08 -1.27 0) (effects (font (size 1.27 1.27)) (justify left)))
		(property "Footprint" "" (at 5.08 -3.81 0) (show_name no) (hide yes) (effects (font (size 1.27 1.27)) (justify left)))
		(property "Datasheet" "" (at 0 0 0) (show_name no) (hide yes) (effects (font (size 1.27 1.27))))
		(property "Description" "NPN transistor, base/collector/emitter" (at 0 0 0) (show_name no) (hide yes) (effects (font (size 1.27 1.27))))
		(symbol "Q_NPN_BCE_0_1"
			(polyline (pts (xy 0.635 0.635) (xy 2.54 2.54))
				(stroke (width 0) (type default)) (fill (type none)))
			(polyline (pts (xy 0.635 -0.635) (xy 2.54 -2.54))
				(stroke (width 0) (type default)) (fill (type none)))
			(polyline (pts (xy 0.635 1.905) (xy 0.635 -1.905))
				(stroke (width 0.254) (type default)) (fill (type none)))
			(polyline (pts (xy 1.7018 -1.27) (xy 2.54 -2.54) (xy 1.27 -1.8542) (xy 1.7018 -1.27))
				(stroke (width 0) (type default)) (fill (type none)))
			(circle (center 1.27 0) (radius 2.8194)
				(stroke (width 0.254) (type default)) (fill (type none))))
		(symbol "Q_NPN_BCE_1_1"
			(pin input line (at -5.08 0 0) (length 5.715)
				(name "B" (effects (font (size 1.27 1.27))))
				(number "1" (effects (font (size 1.27 1.27)))))
			(pin passive line (at 2.54 5.08 270) (length 2.54)
				(name "C" (effects (font (size 1.27 1.27))))
				(number "2" (effects (font (size 1.27 1.27)))))
			(pin passive line (at 2.54 -5.08 90) (length 2.54)
				(name "E" (effects (font (size 1.27 1.27))))
				(number "3" (effects (font (size 1.27 1.27))))))
		(embedded_fonts no)
	)
	(symbol "Q_PNP_BCE"
		(pin_names (offset 0) (hide yes))
		(exclude_from_sim no)
		(in_bom yes)
		(on_board yes)
		(property "Reference" "Q" (at 5.08 1.27 0) (effects (font (size 1.27 1.27)) (justify left)))
		(property "Value" "Q_PNP_BCE" (at 5.08 -1.27 0) (effects (font (size 1.27 1.27)) (justify left)))
		(property "Footprint" "" (at 5.08 -3.81 0) (show_name no) (hide yes) (effects (font (size 1.27 1.27)) (justify left)))
		(property "Datasheet" "" (at 0 0 0) (show_name no) (hide yes) (effects (font (size 1.27 1.27))))
		(property "Description" "PNP transistor, base/collector/emitter" (at 0 0 0) (show_name no) (hide yes) (effects (font (size 1.27 1.27))))
		(symbol "Q_PNP_BCE_0_1"
			(polyline (pts (xy 0.635 0.635) (xy 2.54 2.54))
				(stroke (width 0) (type default)) (fill (type none)))
			(polyline (pts (xy 0.635 -0.635) (xy 2.54 -2.54))
				(stroke (width 0) (type default)) (fill (type none)))
			(polyline (pts (xy 0.635 1.905) (xy 0.635 -1.905))
				(stroke (width 0.254) (type default)) (fill (type none)))
			(polyline (pts (xy 1.4732 -1.8542) (xy 0.635 -0.635) (xy 1.905 -1.2446) (xy 1.4732 -1.8542))
				(stroke (width 0) (type default)) (fill (type none)))
			(circle (center 1.27 0) (radius 2.8194)
				(stroke (width 0.254) (type default)) (fill (type none))))
		(symbol "Q_PNP_BCE_1_1"
			(pin input line (at -5.08 0 0) (length 5.715)
				(name "B" (effects (font (size 1.27 1.27))))
				(number "1" (effects (font (size 1.27 1.27)))))
			(pin passive line (at 2.54 5.08 270) (length 2.54)
				(name "C" (effects (font (size 1.27 1.27))))
				(number "2" (effects (font (size 1.27 1.27)))))
			(pin passive line (at 2.54 -5.08 90) (length 2.54)
				(name "E" (effects (font (size 1.27 1.27))))
				(number "3" (effects (font (size 1.27 1.27))))))
		(embedded_fonts no)
	)
)
`;

const LIB_POWER = `(kicad_symbol_lib
	(version 20251024)
	(generator "kicad_symbol_editor")
	(generator_version "10.0")
	(symbol "GND"
		(power)
		(pin_numbers (hide yes))
		(pin_names (offset 0) (hide yes))
		(exclude_from_sim no)
		(in_bom yes)
		(on_board yes)
		(property "Reference" "#PWR" (at 0 -6.35 0) (show_name no) (hide yes) (effects (font (size 1.27 1.27))))
		(property "Value" "GND" (at 0 -3.81 0) (effects (font (size 1.27 1.27))))
		(property "Footprint" "" (at 0 0 0) (show_name no) (hide yes) (effects (font (size 1.27 1.27))))
		(property "Datasheet" "" (at 0 0 0) (show_name no) (hide yes) (effects (font (size 1.27 1.27))))
		(property "Description" "Power symbol GND (ground)" (at 0 0 0) (show_name no) (hide yes) (effects (font (size 1.27 1.27))))
		(symbol "GND_0_1"
			(polyline (pts (xy 0 0) (xy 0 -1.27))
				(stroke (width 0) (type default)) (fill (type none)))
			(polyline (pts (xy -1.27 -1.27) (xy 1.27 -1.27))
				(stroke (width 0) (type default)) (fill (type none)))
			(polyline (pts (xy -0.762 -1.905) (xy 0.762 -1.905))
				(stroke (width 0) (type default)) (fill (type none)))
			(polyline (pts (xy -0.254 -2.54) (xy 0.254 -2.54))
				(stroke (width 0) (type default)) (fill (type none))))
		(symbol "GND_1_1"
			(pin power_in line (at 0 0 270) (length 0)
				(name "GND" (effects (font (size 1.27 1.27))))
				(number "1" (effects (font (size 1.27 1.27))))))
		(embedded_fonts no)
	)
	(symbol "VCC"
		(power)
		(pin_numbers (hide yes))
		(pin_names (offset 0) (hide yes))
		(exclude_from_sim no)
		(in_bom yes)
		(on_board yes)
		(property "Reference" "#PWR" (at 0 -3.81 0) (show_name no) (hide yes) (effects (font (size 1.27 1.27))))
		(property "Value" "VCC" (at 0 3.81 0) (effects (font (size 1.27 1.27))))
		(property "Footprint" "" (at 0 0 0) (show_name no) (hide yes) (effects (font (size 1.27 1.27))))
		(property "Datasheet" "" (at 0 0 0) (show_name no) (hide yes) (effects (font (size 1.27 1.27))))
		(property "Description" "Power symbol VCC" (at 0 0 0) (show_name no) (hide yes) (effects (font (size 1.27 1.27))))
		(symbol "VCC_0_1"
			(polyline (pts (xy -0.762 1.27) (xy 0 2.54) (xy 0.762 1.27))
				(stroke (width 0) (type default)) (fill (type none)))
			(polyline (pts (xy 0 0) (xy 0 2.54))
				(stroke (width 0) (type default)) (fill (type none))))
		(symbol "VCC_1_1"
			(pin power_in line (at 0 0 90) (length 0)
				(name "VCC" (effects (font (size 1.27 1.27))))
				(number "1" (effects (font (size 1.27 1.27))))))
		(embedded_fonts no)
	)
	(symbol "+5V"
		(power)
		(pin_numbers (hide yes))
		(pin_names (offset 0) (hide yes))
		(exclude_from_sim no)
		(in_bom yes)
		(on_board yes)
		(property "Reference" "#PWR" (at 0 -3.81 0) (show_name no) (hide yes) (effects (font (size 1.27 1.27))))
		(property "Value" "+5V" (at 0 3.556 0) (effects (font (size 1.27 1.27))))
		(property "Footprint" "" (at 0 0 0) (show_name no) (hide yes) (effects (font (size 1.27 1.27))))
		(property "Datasheet" "" (at 0 0 0) (show_name no) (hide yes) (effects (font (size 1.27 1.27))))
		(property "Description" "Power symbol +5V" (at 0 0 0) (show_name no) (hide yes) (effects (font (size 1.27 1.27))))
		(symbol "+5V_0_1"
			(polyline (pts (xy -0.762 1.27) (xy 0 2.54) (xy 0.762 1.27))
				(stroke (width 0) (type default)) (fill (type none)))
			(polyline (pts (xy 0 0) (xy 0 2.54))
				(stroke (width 0) (type default)) (fill (type none))))
		(symbol "+5V_1_1"
			(pin power_in line (at 0 0 90) (length 0)
				(name "+5V" (effects (font (size 1.27 1.27))))
				(number "1" (effects (font (size 1.27 1.27))))))
		(embedded_fonts no)
	)
	(symbol "+3V3"
		(power)
		(pin_numbers (hide yes))
		(pin_names (offset 0) (hide yes))
		(exclude_from_sim no)
		(in_bom yes)
		(on_board yes)
		(property "Reference" "#PWR" (at 0 -3.81 0) (show_name no) (hide yes) (effects (font (size 1.27 1.27))))
		(property "Value" "+3V3" (at 0 3.556 0) (effects (font (size 1.27 1.27))))
		(property "Footprint" "" (at 0 0 0) (show_name no) (hide yes) (effects (font (size 1.27 1.27))))
		(property "Datasheet" "" (at 0 0 0) (show_name no) (hide yes) (effects (font (size 1.27 1.27))))
		(property "Description" "Power symbol +3.3V" (at 0 0 0) (show_name no) (hide yes) (effects (font (size 1.27 1.27))))
		(symbol "+3V3_0_1"
			(polyline (pts (xy -0.762 1.27) (xy 0 2.54) (xy 0.762 1.27))
				(stroke (width 0) (type default)) (fill (type none)))
			(polyline (pts (xy 0 0) (xy 0 2.54))
				(stroke (width 0) (type default)) (fill (type none))))
		(symbol "+3V3_1_1"
			(pin power_in line (at 0 0 90) (length 0)
				(name "+3V3" (effects (font (size 1.27 1.27))))
				(number "1" (effects (font (size 1.27 1.27))))))
		(embedded_fonts no)
	)
)
`;

// ---- the repository ----------------------------------------------------------

const ZIRO: Contact = { name: 'ZiroEDA', contact: { web: 'https://github.com/ziroeda' } };

/**
 * The symbol libraries bundled below are KiCad's official library content, not
 * ours. They are reproduced verbatim, so KiCad's library team is the author and
 * we are only the packager.
 *
 * Their licence is CC-BY-SA 4.0 with the KiCad library exception, which is a
 * different licence from KiCad's GPL source. Attribution is the central
 * obligation of CC-BY-SA, so naming ourselves author here would breach it. The
 * exception matters to users as well: it is what keeps the share-alike terms
 * from reaching a design that merely uses these symbols.
 */
const KICAD_LIBRARIES: Contact = {
  name: 'KiCad Libraries Team',
  contact: { web: 'https://gitlab.com/kicad/libraries' },
};

/** CC-BY-SA 4.0 plus the exception described at kicad.org/libraries/license. */
const KICAD_LIBRARY_LICENSE = 'CC-BY-SA-4.0 with KiCad Library Exception';

const KICAD_LIBRARY_RESOURCES: Record<string, string> = {
  license: 'https://www.kicad.org/libraries/license/',
  source: 'https://gitlab.com/kicad/libraries/kicad-symbols',
};

/** One stable version, compatible from KiCad 7 onward (matches our file format). */
const v1 = (): PackageVersion[] => [{ version: '1.0.0', status: 'stable', kicadVersion: '7.0' }];

function libPkg(
  id: string,
  name: string,
  description: string,
  libraries: LibraryPayload[],
  tags: string[],
): RepoPackage {
  return {
    id,
    kind: 'library',
    name,
    description,
    descriptionFull: `Symbol library "${libraries.map((l) => l.name).join(', ')}" for the Symbol Editor.`,
    author: KICAD_LIBRARIES,
    maintainer: ZIRO,
    license: KICAD_LIBRARY_LICENSE,
    resources: KICAD_LIBRARY_RESOURCES,
    category: 'Symbols',
    tags,
    versions: v1(),
    libraries,
  };
}

const PACKAGES: RepoPackage[] = [
  ...KICAD_COLOR_SCHEMES,
  libPkg(
    'com.ziroeda.lib.passives',
    'Basic Passives',
    'A starter symbol library: resistor, capacitor and inductor.',
    [{ name: 'ZiroEDA_Passives', text: LIB_PASSIVES }],
    ['resistor', 'capacitor', 'inductor', 'passive'],
  ),
  libPkg(
    'com.ziroeda.lib.led',
    'LED',
    'A single-symbol library with a light-emitting diode.',
    [{ name: 'ZiroEDA_LED', text: LIB_LED }],
    ['led', 'diode', 'light'],
  ),
  libPkg(
    'com.ziroeda.lib.diode',
    'Diodes',
    'Diode, Zener and Schottky symbols.',
    [{ name: 'ZiroEDA_Diode', text: LIB_DIODE }],
    ['diode', 'zener', 'schottky'],
  ),
  libPkg(
    'com.ziroeda.lib.connector',
    'Connectors',
    'Generic single-row connectors (2- and 3-pin).',
    [{ name: 'ZiroEDA_Connector', text: LIB_CONNECTOR }],
    ['connector', 'header', 'pins'],
  ),
  libPkg(
    'com.ziroeda.lib.transistor',
    'Transistors',
    'Bipolar transistors: NPN and PNP (BCE).',
    [{ name: 'ZiroEDA_Transistor', text: LIB_TRANSISTOR }],
    ['transistor', 'npn', 'pnp', 'bjt'],
  ),
  libPkg(
    'com.ziroeda.lib.power',
    'Power Symbols',
    'Power and ground symbols: GND, VCC, +5V, +3V3.',
    [{ name: 'ZiroEDA_Power', text: LIB_POWER }],
    ['power', 'ground', 'gnd', 'vcc'],
  ),
];

export const DEFAULT_REPOSITORY: Repository = {
  url: '',
  name: 'ZiroEDA Default Repository',
  schemaVersion: 1,
  maintainer: ZIRO,
  packages: PACKAGES,
};
