// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/*
 * What wxImage::LoadFile( stream, wxBITMAP_TYPE_ANY ) makes of an image, on the wxGTK 3.2 KiCad
 * links - the oracle for external/wx's image handlers (BMP, GIF, ...):
 *
 *   g++ -O2 -o wximage_load_oracle qa/probes/wximage_load_oracle.cpp \
 *       $(wx-config --cxxflags --libs core,base)
 *   ./wximage_load_oracle file
 *
 * Writes one header line, then the RGB plane, then the alpha plane when there is one:
 *
 *   W H TYPE ALPHA MASK MR MG MB RESX RESY UNIT
 *
 * TYPE is the wxBitmapType of the handler that read it (the first whose CanRead accepts the
 * stream, in wxInitAllImageHandlers' order); a file nothing can read prints "fail".
 */
#include <cstdio>
#include <wx/image.h>
#include <wx/init.h>
#include <wx/log.h>
#include <wx/mstream.h>
#include <wx/wfstream.h>

int main( int argc, char** argv )
{
    wxInitializer init( argc, argv );
    wxInitAllImageHandlers(); // as PGM_BASE::InitPgm does
    wxLog::EnableLogging( false );

    // BITMAP_BASE::ReadImageFile reads from a wxMemoryInputStream over the file's bytes, and a
    // stream's end-of-data behaviour is what a truncated file comes down to: read it the same way.
    wxFFileInputStream file( argv[1] );
    wxMemoryOutputStream bytes;
    file.Read( bytes );
    wxStreamBuffer* buf = bytes.GetOutputStreamBuffer();
    const void*     data = buf->GetBufferStart();
    size_t          size = bytes.GetSize();

    wxMemoryInputStream in( data, size );
    wxImage             img;

    if( !img.LoadFile( in, wxBITMAP_TYPE_ANY ) )
    {
        std::printf( "fail\n" );
        return 0;
    }

    // The handler that read it: the first in the list whose CanRead accepts the data.
    int type = 0;

    for( wxList::compatibility_iterator node = wxImage::GetHandlers().GetFirst(); node;
         node = node->GetNext() )
    {
        wxImageHandler* handler = (wxImageHandler*) node->GetData();
        wxMemoryInputStream again( data, size );

        if( handler->CanRead( again ) )
        {
            type = handler->GetType();
            break;
        }
    }

    std::printf( "%d %d %d %d %d %d %d %d %d %d %d\n", img.GetWidth(), img.GetHeight(), type,
                 img.HasAlpha() ? 1 : 0, img.HasMask() ? 1 : 0, img.GetMaskRed(),
                 img.GetMaskGreen(), img.GetMaskBlue(),
                 img.GetOptionInt( wxIMAGE_OPTION_RESOLUTIONX ),
                 img.GetOptionInt( wxIMAGE_OPTION_RESOLUTIONY ),
                 img.GetOptionInt( wxIMAGE_OPTION_RESOLUTIONUNIT ) );

    std::fwrite( img.GetData(), 1, (size_t) img.GetWidth() * img.GetHeight() * 3, stdout );

    if( img.HasAlpha() )
        std::fwrite( img.GetAlpha(), 1, (size_t) img.GetWidth() * img.GetHeight(), stdout );

    return 0;
}
