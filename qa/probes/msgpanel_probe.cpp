// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
//
// Asks wxWidgets where EDA_MSG_PANEL puts each of its items.
//
// EDA_MSG_PANEL::updateItemPos (common/widgets/msgpanel.cpp:135-158) is not a
// flex row: the pitch of a cell is the width of the CHARACTER-LONGER of its two
// texts, with MSG_PANEL_DEFAULT_PAD (6) spaces appended, plus one 'W' width.
// The 6 spaces are inside the measured string, which is easy to miss.
//
//   g++ -Wno-deprecated-declarations -o msgpanel_probe msgpanel_probe.cpp \
//       $(wx-config --cxxflags --libs core,base)
//
//   env -i HOME="$HOME" PATH=/usr/bin:/bin USER="$USER" DISPLAY=:0 \
//       XAUTHORITY="$XAUTHORITY" XDG_RUNTIME_DIR="$XDG_RUNTIME_DIR" \
//       GDK_BACKEND=x11 ./msgpanel_probe

#include <wx/wx.h>
#include <wx/settings.h>

#include <vector>

#define MSG_PANEL_DEFAULT_PAD 6

struct Item
{
    wxString upper;
    wxString lower;
};

class Probe : public wxApp
{
public:
    bool OnInit() override
    {
        wxFrame* frame = new wxFrame( nullptr, wxID_ANY, "probe" );
        wxPanel* panel = new wxPanel( frame, wxID_ANY );

        // EDA_MSG_PANEL ctor: SetFont( KIUI::GetStatusFont( this ) ), which off
        // macOS is getGUIFont( win, 0 ) == the window's own font unchanged.
        wxFont font = panel->GetFont();
        panel->SetFont( font );

        wxPrintf( "font          : %s  %dpt\n", font.GetFaceName(), font.GetPointSize() );

        // updateFontSize(): GetTextExtent( "W", &x, &y, 0, 0, &font )
        int wx_ = 0, wy = 0;
        panel->GetTextExtent( "W", &wx_, &wy, 0, 0, &font );
        wxPrintf( "m_fontSize    : %d x %d   (GetTextExtent \"W\")\n", wx_, wy );
        wxPrintf( "GetCharWidth  : %d\n", panel->GetCharWidth() );
        wxPrintf( "GetCharHeight : %d\n", panel->GetCharHeight() );
        wxPrintf( "space         : %d\n", panel->GetTextExtent( " " ).x );
        wxPrintf( "%d spaces      : %d\n", MSG_PANEL_DEFAULT_PAD,
                  panel->GetTextExtent( wxString( ' ', MSG_PANEL_DEFAULT_PAD ) ).x );
        wxPrintf( "best height   : %d   (DoGetBestSize = 2 * m_fontSize.y)\n", 2 * wy );

        // GERBER_FILE_IMAGE::DisplayImageInfo, gerber_file_image.cpp:395-434,
        // for the X1 drill file in Akshay's KiCad capture.
        std::vector<Item> items = {
            { "Format", "X1" },
            { "Graphic layer", "1" },
            { "Img Rot.", "0" },
            { "Polarity", "Normal" },
            { "X Justify", "Normal" },
            { "Y Justify", "Normal" },
            { "Image Justify Offset", "X=0.0000 mm Y=0.0000 mm" },
        };

        int last_x = 0;

        wxPrintf( "\n%-24s %-24s %5s %5s %5s\n", "upper", "lower", "m_X", "meas", "pitch" );

        for( const Item& it : items )
        {
            wxString text = ( it.upper.Len() > it.lower.Len() ) ? it.upper : it.lower;
            text.Append( ' ', MSG_PANEL_DEFAULT_PAD );

            if( last_x == 0 )
                last_x = wx_;

            int m_X = last_x;

            int measured = panel->GetTextExtent( text ).x;
            last_x += measured;
            last_x += wx_;

            wxPrintf( "%-24s %-24s %5d %5d %5d\n", it.upper, it.lower, m_X, measured,
                      last_x - m_X );
        }

        // What the pitch would be WITHOUT the 6 padding spaces, i.e. what a
        // naive flex-row port produces.
        wxPrintf( "\nwithout the %d padding spaces:\n", MSG_PANEL_DEFAULT_PAD );
        last_x = 0;

        for( const Item& it : items )
        {
            wxString text = ( it.upper.Len() > it.lower.Len() ) ? it.upper : it.lower;

            if( last_x == 0 )
                last_x = wx_;

            int m_X = last_x;
            last_x += panel->GetTextExtent( text ).x;
            last_x += wx_;

            wxPrintf( "%-24s %5d\n", it.upper, m_X );
        }

        wxPrintf( "\n" );
        return false;
    }
};

wxIMPLEMENT_APP_CONSOLE( Probe );
