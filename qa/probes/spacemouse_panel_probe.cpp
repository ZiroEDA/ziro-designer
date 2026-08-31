// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
//
// Preferences > SpaceMouse — `m_gbSizer` from panel_spacemouse_base.cpp:30-67,
// built with wxWidgets here so the row positions can be read rather than
// derived. The sizer is a `wxGridBagSizer( 1, 10 )` whose rows 2 and 6 are
// EMPTY, and what an empty grid-bag row is worth is exactly the kind of thing
// that cannot be read off the source.
//
//   g++ -Wno-deprecated-declarations -o spacemouse_panel_probe \
//       spacemouse_panel_probe.cpp $(wx-config --cxxflags --libs core,base)
//   env -i HOME=$HOME DISPLAY=$DISPLAY PATH=/usr/bin:/bin XAUTHORITY=$XAUTHORITY \
//       ./spacemouse_panel_probe
#include <wx/wx.h>
#include <wx/gbsizer.h>
#include <wx/slider.h>

class App : public wxApp
{
public:
    bool OnInit() override
    {
        wxFrame* f = new wxFrame( nullptr, wxID_ANY, "probe", wxDefaultPosition, wxSize( 800, 400 ) );
        wxPanel* p = new wxPanel( f );

        wxBoxSizer*     outer = new wxBoxSizer( wxVERTICAL );
        wxGridBagSizer* gb = new wxGridBagSizer( 1, 10 );

        wxStaticText* rotLabel = new wxStaticText( p, wxID_ANY, "Rotation speed:" );
        gb->Add( rotLabel, wxGBPosition( 0, 0 ), wxGBSpan( 1, 1 ), wxALIGN_CENTER_VERTICAL, 5 );
        wxSlider* rot = new wxSlider( p, wxID_ANY, 5, 1, 10 );
        gb->Add( rot, wxGBPosition( 0, 1 ), wxGBSpan( 1, 1 ),
                 wxEXPAND | wxALIGN_BOTTOM | wxRIGHT | wxLEFT, 5 );

        wxCheckBox* revRot = new wxCheckBox( p, wxID_ANY, "Reverse rotation direction" );
        gb->Add( revRot, wxGBPosition( 1, 0 ), wxGBSpan( 1, 2 ), wxALIGN_CENTER_VERTICAL, 5 );

        wxStaticText* panLabel = new wxStaticText( p, wxID_ANY, "Pan speed:" );
        gb->Add( panLabel, wxGBPosition( 3, 0 ), wxGBSpan( 1, 1 ), wxALIGN_CENTER_VERTICAL, 5 );
        wxSlider* pan = new wxSlider( p, wxID_ANY, 5, 1, 10 );
        gb->Add( pan, wxGBPosition( 3, 1 ), wxGBSpan( 1, 1 ),
                 wxEXPAND | wxALIGN_BOTTOM | wxRIGHT | wxLEFT, 5 );

        wxCheckBox* revY = new wxCheckBox( p, wxID_ANY, "Reverse vertical pan direction" );
        gb->Add( revY, wxGBPosition( 4, 0 ), wxGBSpan( 1, 2 ), wxALIGN_CENTER_VERTICAL, 5 );
        wxCheckBox* revX = new wxCheckBox( p, wxID_ANY, "Reverse horizontal pan direction" );
        gb->Add( revX, wxGBPosition( 5, 0 ), wxGBSpan( 1, 2 ), wxALIGN_CENTER_VERTICAL | wxTOP, 3 );
        wxCheckBox* revZ = new wxCheckBox( p, wxID_ANY, "Reverse zoom direction" );
        gb->Add( revZ, wxGBPosition( 7, 0 ), wxGBSpan( 1, 2 ), wxALIGN_CENTER_VERTICAL, 5 );

        outer->Add( gb, 1, wxEXPAND | wxTOP | wxRIGHT | wxLEFT, 10 );
        p->SetSizer( outer );
        p->Layout();
        outer->Fit( p );

        auto row = []( const char* what, wxWindow* w )
        {
            wxRect r = w->GetRect();
            wxPrintf( "%-34s x=%3d y=%3d w=%3d h=%2d\n", what, r.x, r.y, r.width, r.height );
        };

        row( "Rotation speed: (label)", rotLabel );
        row( "  rotation slider", rot );
        row( "Reverse rotation direction", revRot );
        row( "Pan speed: (label)", panLabel );
        row( "  pan slider", pan );
        row( "Reverse vertical pan direction", revY );
        row( "Reverse horizontal pan direction", revX );
        row( "Reverse zoom direction", revZ );

        wxPrintf( "\npitch (top to top):\n" );
        wxPrintf( "  rotation row -> reverse rotation   %d\n",
                  revRot->GetRect().y - rot->GetRect().y );
        wxPrintf( "  reverse rotation -> pan row (EMPTY row 2 between)  %d\n",
                  pan->GetRect().y - revRot->GetRect().y );
        wxPrintf( "  pan row -> reverse vertical        %d\n",
                  revY->GetRect().y - pan->GetRect().y );
        wxPrintf( "  reverse vertical -> horizontal     %d\n",
                  revX->GetRect().y - revY->GetRect().y );
        wxPrintf( "  horizontal -> zoom (EMPTY row 6)   %d\n",
                  revZ->GetRect().y - revX->GetRect().y );
        wxPrintf( "  label column width                 %d\n", rot->GetRect().x );

        f->Destroy();
        return false;
    }
};

wxIMPLEMENT_APP_CONSOLE( App );
