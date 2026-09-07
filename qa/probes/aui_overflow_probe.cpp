// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
//
// What a wxAuiToolBar does when it does not fit.
//
// ACTION_TOOLBAR binds wxEVT_SIZE to `SetOverflowVisible( !GetToolBarFits() )`
// (common/tool/action_toolbar.cpp:221-231), so a toolbar too long for its pane
// grows a chevron rather than overflowing. This reads back the three things a
// port needs and cannot guess: how much room the chevron takes, which items
// wx considers hidden, and what the chevron actually looks like.
//
//   g++ -Wno-deprecated-declarations -o aui_overflow_probe aui_overflow_probe.cpp \
//       $(wx-config --cxxflags --libs core,base,aui)
// Run (redirect to a file; a pipe swallows the output):
//   env -i HOME=$HOME DISPLAY=$DISPLAY XAUTHORITY=$XAUTHORITY \
//       XDG_RUNTIME_DIR=/run/user/$(id -u) PATH=/usr/bin:/bin ./aui_overflow_probe > out.txt
#include <wx/wx.h>
#include <wx/aui/aui.h>
#include <wx/aui/auibar.h>
#include <unistd.h>

/** An ASCII map of whatever the art provider drew, so the glyph is readable. */
static void dumpGlyph( wxAuiToolBarArt* art, wxWindow* win, int w, int h, bool hover )
{
    wxBitmap bmp( w, h, 24 );
    wxMemoryDC dc( bmp );
    dc.SetBackground( wxBrush( wxColour( 255, 0, 255 ) ) );  // magenta = untouched
    dc.Clear();
    art->DrawOverflowButton( dc, win, wxRect( 0, 0, w, h ),
                             hover ? wxAUI_BUTTON_STATE_HOVER : 0 );
    dc.SelectObject( wxNullBitmap );

    wxImage img = bmp.ConvertToImage();
    wxPrintf( "  overflow button %dx%d%s:\n", w, h, hover ? " (hover)" : "" );

    for( int y = 0; y < img.GetHeight(); ++y )
    {
        wxPrintf( "    " );

        for( int x = 0; x < img.GetWidth(); ++x )
        {
            int r = img.GetRed( x, y ), g = img.GetGreen( x, y ), b = img.GetBlue( x, y );
            char c;

            if( r == 255 && g == 0 && b == 255 )      c = '.';   // never painted
            else if( r + g + b < 200 )                c = '#';   // dark ink
            else if( r + g + b > 600 )                c = ' ';   // light fill
            else                                      c = '+';   // in between
            wxPrintf( "%c", c );
        }

        wxPrintf( "\n" );
    }
}

class App : public wxApp
{
public:
    bool OnInit() override
    {
        wxFrame* frame = new wxFrame( nullptr, wxID_ANY, "probe", wxDefaultPosition,
                                      wxSize( 400, 300 ) );

        // A VERTICAL bar, which is the one that overflowed: the left/right
        // toolbars are the ones a taller icon pushes past the window.
        wxAuiToolBar* tb = new wxAuiToolBar( frame, wxID_ANY, wxDefaultPosition, wxDefaultSize,
                                             wxAUI_TB_VERTICAL | wxAUI_TB_DEFAULT_STYLE );

        wxBitmap icon( 24, 24, 24 );
        {
            wxMemoryDC dc( icon );
            dc.SetBackground( *wxWHITE_BRUSH );
            dc.Clear();
        }

        for( int i = 0; i < 40; ++i )
            tb->AddTool( 1000 + i, wxString::Format( "tool %d", i ), icon,
                         wxString::Format( "Tool number %d\tCtrl+%d", i, i ) );

        tb->Realize();
        tb->SetSize( wxSize( 40, 200 ) );   // deliberately far too short

        wxAuiToolBarArt* art = tb->GetArtProvider();

        wxPrintf( "wxWidgets %d.%d.%d\n", wxMAJOR_VERSION, wxMINOR_VERSION, wxRELEASE_NUMBER );
        wxPrintf( "OVERFLOW_SIZE      = %d\n", art->GetElementSize( wxAUI_TBART_OVERFLOW_SIZE ) );
        wxPrintf( "SEPARATOR_SIZE     = %d\n", art->GetElementSize( wxAUI_TBART_SEPARATOR_SIZE ) );
        wxPrintf( "GRIPPER_SIZE       = %d\n", art->GetElementSize( wxAUI_TBART_GRIPPER_SIZE ) );
        wxPrintf( "tool packing/border= %d / %d\n", tb->GetToolPacking(), tb->GetToolBorderPadding() );
        wxPrintf( "GetToolBarFits()   = %d\n", (int) tb->GetToolBarFits() );
        wxPrintf( "toolbar size       = %d x %d\n", tb->GetSize().x, tb->GetSize().y );
        wxPrintf( "one tool rect      = %d x %d\n",
                  tb->GetToolRect( 1000 ).width, tb->GetToolRect( 1000 ).height );

        int shown = 0;
        for( int i = 0; i < 40; ++i )
            if( tb->GetToolRect( 1000 + i ).height > 0 && tb->GetToolRect( 1000 + i ).GetBottom() <= tb->GetSize().y )
                shown++;

        wxPrintf( "tools inside the bar = %d of 40\n", shown );

        dumpGlyph( art, tb, art->GetElementSize( wxAUI_TBART_OVERFLOW_SIZE ), 24, false );
        dumpGlyph( art, tb, art->GetElementSize( wxAUI_TBART_OVERFLOW_SIZE ), 24, true );

        fflush( stdout );
        _exit( 0 );
        return false;
    }
};
wxIMPLEMENT_APP( App );
