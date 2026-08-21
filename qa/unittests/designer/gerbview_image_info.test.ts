// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The GerbView message panel, `GERBER_FILE_IMAGE::DisplayImageInfo`
 * (`gerbview/gerber_file_image.cpp:395-434`).
 *
 * Upstream appends eight rows, of which only `Image name` is conditional:
 *
 *     ClearMsgPanel();
 *     AppendMsgPanel( _( "Format" ), m_IsX2_file ? "X2" : "X1" );
 *     if( !m_ImageName.IsEmpty() )
 *         AppendMsgPanel( _( "Image name" ), m_ImageName );
 *     AppendMsgPanel( _( "Graphic layer" ), m_GraphicLayer + 1 );
 *     AppendMsgPanel( _( "Img Rot." ), m_ImageRotation );
 *     AppendMsgPanel( _( "Polarity" ), m_ImageNegative ? "Negative" : "Normal" );
 *     AppendMsgPanel( _( "X Justify" ), m_ImageJustifyXCenter ? "Center" : "Normal" );
 *     AppendMsgPanel( _( "Y Justify" ), m_ImageJustifyYCenter ? "Center" : "Normal" );
 *     msg.Printf( "X=%s Y=%s", MessageTextFromValue( m_ImageJustifyOffset.x ),
 *                              MessageTextFromValue( m_ImageJustifyOffset.y ) );
 *     AppendMsgPanel( _( "Image Justify Offset" ), msg );
 *
 * Ours stopped after Polarity, five rows in, because the parser did not read
 * `%IJ`. A side-by-side against a real GerbView with the same board loaded is
 * what showed it: KiCad's bottom bar carried three fields ours did not.
 *
 * The function had NO test at all before this file — adding three rows to it
 * moved zero expectations, which is the finding CLAUDE.md names: the behaviour
 * was never pinned, so every one of the five rows it did emit is asserted here
 * too, not just the three that were missing.
 */
import { describe, expect, it } from 'vitest';
import { gerbviewImageInfoRows } from '@ziroeda/designer/src/editors/gerbview/gerberAuxControls.js';
import { parseGerber } from '@ziroeda/gerbview';

/** A minimal metric gerber, with `extra` spliced in after the unit command. */
const image = (extra = ''): ReturnType<typeof parseGerber> =>
  parseGerber(
    ['%FSLAX46Y46*%', '%MOMM*%', extra, '%ADD10C,0.5*%', 'D10*', 'X0Y0D03*', 'M02*']
      .filter(Boolean)
      .join('\n'),
    'board-F_Cu.gbr',
  );

const uppers = (rows: { upper: string }[]): string[] => rows.map((r) => r.upper);
const lower = (rows: { upper: string; lower: string }[], upper: string): string | undefined =>
  rows.find((r) => r.upper === upper)?.lower;

describe('the message panel with no image on the active layer', () => {
  it('is empty, because DisplayImageInfo opens with ClearMsgPanel', () => {
    expect(gerbviewImageInfoRows(null, 0, 'mm')).toStrictEqual([]);
  });
});

describe('the eight rows, in upstream order', () => {
  it('names all of them, and Image name is the only one left out', () => {
    // %IN is deprecated and upstream notes a non-empty image name is "probably
    // never found", so the eight-row form is the rare one.
    expect(uppers(gerbviewImageInfoRows(image(), 0, 'mm'))).toStrictEqual([
      'Format',
      'Graphic layer',
      'Img Rot.',
      'Polarity',
      'X Justify',
      'Y Justify',
      'Image Justify Offset',
    ]);
  });

  it('inserts Image name second when %IN gave one', () => {
    const rows = gerbviewImageInfoRows(image('%INMyBoard*%'), 0, 'mm');
    expect(uppers(rows)).toStrictEqual([
      'Format',
      'Image name',
      'Graphic layer',
      'Img Rot.',
      'Polarity',
      'X Justify',
      'Y Justify',
      'Image Justify Offset',
    ]);
    expect(lower(rows, 'Image name')).toBe('MyBoard');
  });
});

describe('the five rows that were already there', () => {
  it('reads X1 until a %TF file function has parsed, then X2', () => {
    // m_IsX2_file is set only once a file function is seen (rs274x.cpp:390-397).
    expect(lower(gerbviewImageInfoRows(image(), 0, 'mm'), 'Format')).toBe('X1');
    expect(
      lower(gerbviewImageInfoRows(image('%TF.FileFunction,Copper,L1,Top*%'), 0, 'mm'), 'Format'),
    ).toBe('X2');
  });

  it('numbers the graphic layer from one', () => {
    // msg.Printf( "%d", m_GraphicLayer + 1 )   :411
    expect(lower(gerbviewImageInfoRows(image(), 0, 'mm'), 'Graphic layer')).toBe('1');
    expect(lower(gerbviewImageInfoRows(image(), 18, 'mm'), 'Graphic layer')).toBe('19');
  });

  it('prints the image rotation %IR gave', () => {
    expect(lower(gerbviewImageInfoRows(image(), 0, 'mm'), 'Img Rot.')).toBe('0');
    expect(lower(gerbviewImageInfoRows(image('%IR90*%'), 0, 'mm'), 'Img Rot.')).toBe('90');
  });

  it('calls a negative image Negative and everything else Normal', () => {
    expect(lower(gerbviewImageInfoRows(image(), 0, 'mm'), 'Polarity')).toBe('Normal');
    expect(lower(gerbviewImageInfoRows(image('%IPNEG*%'), 0, 'mm'), 'Polarity')).toBe('Negative');
  });
});

describe('the three %IJ rows', () => {
  it('are present with their defaults when the file has no %IJ at all', () => {
    // The three fields default to false / false / (0,0) (rs274x.cpp:594-597),
    // and upstream appends the rows unconditionally — so "no justification" is
    // still three rows, not zero. This is the case every real board hits.
    const rows = gerbviewImageInfoRows(image(), 0, 'mm');
    expect(lower(rows, 'X Justify')).toBe('Normal');
    expect(lower(rows, 'Y Justify')).toBe('Normal');
    expect(lower(rows, 'Image Justify Offset')).toBe('X=0.0000 mm Y=0.0000 mm');
  });

  it('reads AC and BC as centred on each axis', () => {
    const rows = gerbviewImageInfoRows(image('%IJACBC*%'), 0, 'mm');
    expect(lower(rows, 'X Justify')).toBe('Center');
    expect(lower(rows, 'Y Justify')).toBe('Center');
  });

  it('treats AL exactly as AC, which is what the C++ does', () => {
    // Both branches set m_ImageJustifyXCenter = true (:609-616).
    expect(lower(gerbviewImageInfoRows(image('%IJAL*%'), 0, 'mm'), 'X Justify')).toBe('Center');
    // B is the Y axis, so BL centres Y and leaves X alone.
    expect(lower(gerbviewImageInfoRows(image('%IJBL*%'), 0, 'mm'), 'Y Justify')).toBe('Center');
    expect(lower(gerbviewImageInfoRows(image('%IJBL*%'), 0, 'mm'), 'X Justify')).toBe('Normal');
  });

  it('scales a coordinate offset out of file units', () => {
    // KiROUND( ReadDouble( aText ) * conv_scale ) (:619,:639) — the file is in
    // mm here, so A2.5 is 2.5 mm and the row prints it back at the message
    // precision, unit label included.
    const rows = gerbviewImageInfoRows(image('%IJA2.5B-1.25*%'), 0, 'mm');
    expect(lower(rows, 'Image Justify Offset')).toBe('X=2.5000 mm Y=-1.2500 mm');
    expect(lower(rows, 'X Justify')).toBe('Normal');
  });

  it('zeroes the offset on an axis that is centred', () => {
    // if( m_ImageJustifyXCenter ) m_ImageJustifyOffset.x = 0;   :650-654
    // The order in the file must not matter: the clamp runs after the loop.
    const rows = gerbviewImageInfoRows(image('%IJA2.5ACB3*%'), 0, 'mm');
    expect(lower(rows, 'Image Justify Offset')).toBe('X=0.0000 mm Y=3.0000 mm');
  });

  it('clears a previous justification when a bare %IJ*% follows', () => {
    // The command assigns all three defaults before parsing (:595-597), so the
    // second one wins outright rather than merging into the first.
    const rows = gerbviewImageInfoRows(image('%IJACB2*%\n%IJ*%'), 0, 'mm');
    expect(lower(rows, 'X Justify')).toBe('Normal');
    expect(lower(rows, 'Image Justify Offset')).toBe('X=0.0000 mm Y=0.0000 mm');
  });

  it('follows the frame units, because MessageTextFromValue does', () => {
    // 2.5 mm is 0.0984 inches and 98.43 mils. The digit counts are
    // MessageTextFromValue's own — 4 for mm and inches, 2 for mils
    // (`common/eda_units.cpp`), which is why the mils row is shorter.
    const inch = gerbviewImageInfoRows(image('%IJA2.5*%'), 0, 'in');
    expect(lower(inch, 'Image Justify Offset')).toBe('X=0.0984 in Y=0.0000 in');
    const mils = gerbviewImageInfoRows(image('%IJA2.5*%'), 0, 'mils');
    expect(lower(mils, 'Image Justify Offset')).toBe('X=98.43 mils Y=0.00 mils');
  });

  it('reads an inch file in inches, so the scale comes from %MO', () => {
    // conv_scale is IU-per-file-unit and flips on %MOIN / %MOMM (rs274x.cpp:210-216).
    const inchFile = parseGerber(
      ['%FSLAX46Y46*%', '%MOIN*%', '%IJA1*%', '%ADD10C,0.5*%', 'D10*', 'X0Y0D03*', 'M02*'].join(
        '\n',
      ),
      'board.gbr',
    );
    expect(lower(gerbviewImageInfoRows(inchFile, 0, 'mm'), 'Image Justify Offset')).toBe(
      'X=25.4000 mm Y=0.0000 mm',
    );
  });
});
