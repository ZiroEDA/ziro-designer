// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
//
// What wxImage::ConvertToDisabled( brightness ) does to a pixel: the call
// BITMAP_STORE::GetDisabledBitmapBundle makes, with 70 on a dark theme and
// 255 on a light one. Prints "brightness r g b a -> r g b a" per sample.
//
// Build: g++ convert_disabled_probe.cpp $(wx-config --cxxflags --libs core,base) -o convert_disabled_probe
#include <wx/app.h>
#include <wx/image.h>
#include <cstdio>

int main( int argc, char** argv )
{
    wxInitializer init( argc, argv );
    const unsigned char px[][4] = { { 0, 0, 0, 255 },       { 255, 255, 255, 255 },
                                    { 255, 0, 0, 255 },     { 0, 255, 0, 255 },
                                    { 0, 0, 255, 255 },     { 200, 100, 50, 128 },
                                    { 17, 34, 51, 0 },      { 128, 128, 128, 255 },
                                    { 1, 2, 3, 255 },       { 254, 253, 252, 255 },
                                    { 77, 166, 229, 40 } };
    const int n = sizeof( px ) / sizeof( px[0] );

    for( int brightness : { 70, 255, 0, 128 } )
    {
        wxImage img( n, 1 );
        img.SetAlpha();

        for( int i = 0; i < n; ++i )
        {
            img.SetRGB( i, 0, px[i][0], px[i][1], px[i][2] );
            img.SetAlpha( i, 0, px[i][3] );
        }

        wxImage out = img.ConvertToDisabled( brightness );

        for( int i = 0; i < n; ++i )
            printf( "%d %d %d %d %d -> %d %d %d %d\n", brightness, px[i][0], px[i][1], px[i][2],
                    px[i][3], out.GetRed( i, 0 ), out.GetGreen( i, 0 ), out.GetBlue( i, 0 ),
                    out.HasAlpha() ? out.GetAlpha( i, 0 ) : -1 );
    }
}
