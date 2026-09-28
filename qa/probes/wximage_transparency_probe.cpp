// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/*
 * What does wxImage::LoadFile() make of a PNG's transparency, on the wxGTK
 * KiCad 10.0.5 links? BITMAP2CMP_PANEL treats the two outcomes differently:
 * a mask colour turns masked pixels white in the greyscale image (so Negative
 * makes them black, i.e. traced), an alpha channel gates binarize().
 *
 *   g++ -o wximage_transparency_probe qa/probes/wximage_transparency_probe.cpp \
 *       $(wx-config --cxxflags --libs core,base)
 *   ./wximage_transparency_probe a.png b.png ...
 *
 * Prints, per file: HasAlpha, HasMask, the mask colour, each pixel's RGB, and
 * the resolution options OpenProjectFiles reads (wxIMAGE_OPTION_RESOLUTIONX,
 * _RESOLUTIONY, _RESOLUTIONUNIT).
 */
#include <cstdio>
#include <wx/image.h>
#include <wx/init.h>

int main( int argc, char** argv )
{
    wxInitializer init( argc, argv );
    wxInitAllImageHandlers();    // as PGM_BASE does

    for( int i = 1; i < argc; i++ )
    {
        wxImage img;

        if( !img.LoadFile( argv[i] ) )
        {
            std::printf( "%s: load failed\n", argv[i] );
            continue;
        }

        std::printf( "%s: alpha=%d mask=%d maskrgb=%d,%d,%d\n", argv[i], img.HasAlpha() ? 1 : 0,
                     img.HasMask() ? 1 : 0, img.GetMaskRed(), img.GetMaskGreen(),
                     img.GetMaskBlue() );
        std::printf( " resx=%d resy=%d unit=%d\n", img.GetOptionInt( wxIMAGE_OPTION_RESOLUTIONX ),
                     img.GetOptionInt( wxIMAGE_OPTION_RESOLUTIONY ),
                     img.GetOptionInt( wxIMAGE_OPTION_RESOLUTIONUNIT ) );

        for( int y = 0; y < img.GetHeight(); y++ )
        {
            for( int x = 0; x < img.GetWidth(); x++ )
                std::printf( " (%d,%d,%d)", img.GetRed( x, y ), img.GetGreen( x, y ), img.GetBlue( x, y ) );

            std::printf( "\n" );
        }
    }

    return 0;
}
