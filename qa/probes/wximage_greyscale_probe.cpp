// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/*
 * How does wxImage::ConvertToGreyscale() round, on the wxGTK KiCad 10.0.5
 * links? BITMAP2CMP_PANEL::OpenProjectFiles builds its greyscale image with
 * it, and binarize() thresholds that image's green byte.
 *
 *   g++ -o wximage_greyscale_probe qa/probes/wximage_greyscale_probe.cpp \
 *       $(wx-config --cxxflags --libs core,base)
 *
 * Prints how many of all 2^24 colours match each candidate formula for
 * luma = 0.299 r + 0.587 g + 0.114 b: rounded (wxRound, half away from zero)
 * and truncated.
 */
#include <cmath>
#include <cstdio>
#include <wx/image.h>
#include <wx/init.h>

int main( int argc, char** argv )
{
    wxInitializer init( argc, argv );

    const int W = 4096, H = 4096;    // every 24-bit colour once
    wxImage img( W, H, false );
    unsigned char* d = img.GetData();

    for( long i = 0; i < (long) W * H; i++ )
    {
        d[i * 3 + 0] = ( i >> 16 ) & 0xff;
        d[i * 3 + 1] = ( i >> 8 ) & 0xff;
        d[i * 3 + 2] = i & 0xff;
    }

    wxImage grey = img.ConvertToGreyscale();
    unsigned char* g = grey.GetData();
    long rounded = 0, truncated = 0, total = (long) W * H;

    for( long i = 0; i < total; i++ )
    {
        double luma = d[i * 3] * 0.299 + d[i * 3 + 1] * 0.587 + d[i * 3 + 2] * 0.114;
        unsigned char r = (unsigned char) ( luma < 0 ? std::ceil( luma - 0.5 ) : std::floor( luma + 0.5 ) );
        unsigned char t = (unsigned char) luma;

        if( g[i * 3 + 1] == r )
            rounded++;

        if( g[i * 3 + 1] == t )
            truncated++;
    }

    std::printf( "total %ld rounded %ld truncated %ld\n", total, rounded, truncated );
    return 0;
}
