// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
//
// What GTK actually draws for a wxCheckBox, both states. LAYER_WIDGET's
// visibility column is a plain wxCheckBox (gerbview/widgets/layer_widget.cpp:347),
// so this is the widget, not an approximation of it.
//
//   g++ -Wno-deprecated-declarations -o checkbox_probe checkbox_probe.cpp \
//       $(wx-config --cxxflags --libs core,base)
#include <wx/wx.h>
#include <wx/renderer.h>
#include <wx/rawbmp.h>
#include <map>

static void dump( wxWindow* win, int flags, const char* label, int size )
{
    wxBitmap bmp( size + 8, size + 8, 24 );
    wxMemoryDC dc( bmp );
    // A neutral magenta ground so anything the renderer leaves untouched is
    // obvious rather than being mistaken for a drawn colour.
    dc.SetBackground( wxBrush( wxColour( 255, 0, 255 ) ) );
    dc.Clear();
    wxRendererNative::Get().DrawCheckBox( win, dc, wxRect( 4, 4, size, size ), flags );
    dc.SelectObject( wxNullBitmap );

    wxImage img = bmp.ConvertToImage();
    std::map<unsigned, int> hist;

    for( int y = 0; y < img.GetHeight(); ++y )
        for( int x = 0; x < img.GetWidth(); ++x )
            hist[ ( img.GetRed( x, y ) << 16 ) | ( img.GetGreen( x, y ) << 8 )
                  | img.GetBlue( x, y ) ]++;

    wxPrintf( "%s (%dpx):\n", label, size );

    std::multimap<int, unsigned> byCount;
    for( auto& p : hist ) byCount.insert( { p.second, p.first } );

    // An ASCII map of the drawn shape: '#' the dominant fill, '.' untouched
    // ground, '+' anything else (border, antialiasing, the check stroke).
    unsigned fill = 0; int best = 0;
    for( auto& p2 : hist )
        if( p2.first != 0xff00ff && p2.second > best ) { best = p2.second; fill = p2.first; }

    for( int y = 0; y < img.GetHeight(); ++y )
    {
        wxString line;
        for( int x = 0; x < img.GetWidth(); ++x )
        {
            unsigned c = ( img.GetRed( x, y ) << 16 ) | ( img.GetGreen( x, y ) << 8 )
                         | img.GetBlue( x, y );
            line << ( c == 0xff00ff ? '.' : ( c == fill ? '#' : '+' ) );
        }
        wxPrintf( "   |%s|\n", line );
    }

    int shown = 0;
    for( auto it = byCount.rbegin(); it != byCount.rend() && shown < 6; ++it, ++shown )
        wxPrintf( "   rgb(%3u,%3u,%3u)  x%d\n", ( it->second >> 16 ) & 0xff,
                  ( it->second >> 8 ) & 0xff, it->second & 0xff, it->first );
    wxPrintf( "\n" );
}

class Probe : public wxApp
{
public:
    bool OnInit() override
    {
        wxFrame* f = new wxFrame( nullptr, wxID_ANY, "p" );
        wxCheckBox* cb = new wxCheckBox( f, wxID_ANY, wxEmptyString );
        wxPrintf( "wxCheckBox best size: %d x %d\n\n", cb->GetBestSize().x, cb->GetBestSize().y );
        int sz = cb->GetBestSize().y;
        dump( f, wxCONTROL_CHECKED, "CHECKED", sz );
        dump( f, 0, "UNCHECKED", sz );
        return false;
    }
};
wxIMPLEMENT_APP_CONSOLE( Probe );
