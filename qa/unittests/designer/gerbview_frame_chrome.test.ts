// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The strings and sizes GerbView's frame chrome is made of.
 *
 * Every one of these lived in the `.tsx` first, where qa cannot reach it, and
 * that is exactly how they came to be wrong: a greeting in status field 0, a
 * tool name that is only correct after a tool has been used, an invented
 * message-panel row, and a layer label of our own design. Pulled into `.ts`,
 * each becomes a decision with a name, which is the only kind a test can check.
 */
import { describe, expect, it } from 'vitest';
import {
  gerbviewLayerDisplayName,
  gerbviewStatusField0,
  layersPaneWidth,
  shortenLayerFileName,
} from '@ziroeda/designer/src/editors/gerbview/gerberAuxControls.js';
import { parseGerber } from '@ziroeda/gerbview';

const image = (extra = ''): ReturnType<typeof parseGerber> =>
  parseGerber(
    ['%FSLAX46Y46*%', '%MOMM*%', extra, '%ADD10C,0.5*%', 'D10*', 'X0Y0D03*', 'M02*']
      .filter(Boolean)
      .join('\n'),
    'board-F_Cu.gbr',
  );

describe('status bar field 0', () => {
  it('is blank when the active layer has no image', () => {
    // SetStatusText( wxEmptyString, 0 )  gerbview_frame.cpp:668
    expect(gerbviewStatusField0(null)).toBe('');
  });

  it('is the image and layer names, two spaces apart, each quoted', () => {
    // status.Printf( _( "Image name: '%s'  Layer name: '%s'" ), ... )  :696
    const img = image();
    img.imageName = 'MyImage';
    img.layerName = 'TopCopper';
    expect(gerbviewStatusField0(img)).toBe("Image name: 'MyImage'  Layer name: 'TopCopper'");
  });
});

describe('GetDisplayName', () => {
  it('names an empty layer by its one-based index', () => {
    // name.Printf( _( "Graphic layer %d" ), aIdx + 1 )  gerber_file_image_list.cpp:197
    expect(gerbviewLayerDisplayName(null, '', 0)).toBe('Graphic layer 1');
    expect(gerbviewLayerDisplayName(null, '', 63)).toBe('Graphic layer 64');
  });

  it('prefixes the one-based index', () => {
    // fullname.Printf( "%d " ); fullname << name;   :190-192
    const img = image();
    expect(gerbviewLayerDisplayName(img, 'a.gbr', 2)).toBe('3 a.gbr');
  });

  it('omits the index for aNameOnly, which is what that flag does', () => {
    // if( aNameOnly ) return name;   :185-186 - it returns BEFORE the prefix,
    // so it suppresses the number and not the file-function suffix.
    const img = image();
    expect(gerbviewLayerDisplayName(img, 'a.gbr', 2, { nameOnly: true })).toBe('a.gbr');
  });

  it('gives a copper layer the TWO-field suffix, because upstream overwrites', () => {
    // The copper branch at :156-162 has no `else` after it, so the `else` of
    // the drill test at :172 runs and replaces the three-field string. A copper
    // row reads "(Copper, L1)" in KiCad, never "(Copper, L1, Top)". Reproduced
    // deliberately; "fixing" it would print something KiCad never shows.
    const img = image('%TF.FileFunction,Copper,L1,Top,Signal*%');
    expect(img.fileFunction).not.toBeNull();
    expect(gerbviewLayerDisplayName(img, 'a.gbr', 0)).toBe('1 a.gbr (Copper, L1)');
  });

  it('gives a drill file its own four-field suffix', () => {
    // IsDrillFile() is "Plated" or "NonPlated"  X2_gerber_attributes.cpp:229
    const img = image('%TF.FileFunction,Plated,1,4,PTH*%');
    expect(gerbviewLayerDisplayName(img, 'd.gbr', 0)).toBe('1 d.gbr (Plated,1,4,PTH)');
  });

  it('caps the file name at 30 by default, and not at all for aFullName', () => {
    const long = 'kit-dev-coldfire-xilinx_5213-Top_layer.gbr'; // 41 chars
    expect(long.length).toBeGreaterThan(30);
    const img = image();
    // The layers manager passes aFullName=true (gerbview_layer_widget.cpp:308),
    // which is why a long name widens the pane without limit.
    expect(gerbviewLayerDisplayName(img, long, 0, { fullName: true })).toBe(`1 ${long}`);
    // The layer dropdown takes the defaults (gbr_layer_box_selector.cpp:56).
    expect(gerbviewLayerDisplayName(img, long, 0)).toBe(`1 ${shortenLayerFileName(long)}`);
  });
});

describe('the 30-character file-name cap', () => {
  it('keeps the first two characters and the last twenty-five', () => {
    // filename.Left( 2 ) + "..." + filename.Right( maxlen - 5 )
    //                              gerber_file_image_list.cpp:150
    const long = 'kit-dev-coldfire-xilinx_5213-Top_layer.gbr';
    const out = shortenLayerFileName(long);
    expect(out).toBe(`${long.slice(0, 2)}...${long.slice(long.length - 25)}`);
    expect(out).toHaveLength(30);
    expect(out.startsWith('ki...')).toBe(true);
  });

  it('leaves a name of exactly the cap alone', () => {
    const at = 'x'.repeat(30);
    expect(shortenLayerFileName(at)).toBe(at);
    expect(shortenLayerFileName('short.gbr')).toBe('short.gbr');
  });

  it('uses three ASCII dots, never an ellipsis character', () => {
    const out = shortenLayerFileName('y'.repeat(40));
    expect(out).toContain('...');
    expect(out).not.toContain('…');
  });
});

describe('layers pane width', () => {
  it('is the widest row plus 15 for the frame and 5 of margin', () => {
    // totWidth += 15  (layer_widget.cpp:592) then bestz.x += 5
    // (gerbview_frame.cpp:383).
    expect(layersPaneWidth([100, 250, 80], 0, 30)).toBe(300);
  });

  it('never goes under the smallest-layer string', () => {
    // Every row label is a wxStaticText with
    // SetMinimumStringLength( m_smallestLayerString )  layer_widget.cpp:364
    expect(layersPaneWidth([10, 20], 200, 0)).toBe(220);
  });

  it('has no upper cap of its own', () => {
    // The cap is on the *name*, and the rows do not even apply it.
    expect(layersPaneWidth([5000], 0, 0)).toBe(5020);
  });

  it('handles no layers at all', () => {
    expect(layersPaneWidth([], 120, 10)).toBe(150);
  });
});
