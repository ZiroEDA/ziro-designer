// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
//
// Preferences > Mouse and Touchpad, built with wxWidgets here so the sizes the
// theme gives its controls can be read rather than guessed: the two wxSliders
// of `m_zoomSizer` / `m_panSizer` carry no size of their own
// (`panel_mouse_settings_base.cpp:59`, `:81`), so what they take is wx's
// default for the control, and the Drag Gestures choices are a wxFlexGridSizer
// column, so they all take the width of the widest.
//
//   g++ -Wno-deprecated-declarations -o mouse_panel_probe mouse_panel_probe.cpp \
//       $(wx-config --cxxflags --libs core,base)
//   env -i HOME=$HOME DISPLAY=$DISPLAY PATH=/usr/bin:/bin XAUTHORITY=$XAUTHORITY \
//       ./mouse_panel_probe
//
// Reads, 2026-08-31, Yaru / Ubuntu Sans 11:
//
//   zoom slider    100 x 34   (best 100 x 34)
//   "Zoom speed:"  label 87 wide
//   choice 0..3    x=249 w=423 h=34      <- all four the same width
//
// so a wxSlider with no size of its own is 100 px wide, and the four Drag
// Gestures choices are one width because they share a flexgrid column.
#include <wx/wx.h>
#include <wx/slider.h>
#include <wx/gbsizer.h>

class App : public wxApp
{
public:
    bool OnInit() override
    {
        wxFrame* f = new wxFrame( nullptr, wxID_ANY, "probe", wxDefaultPosition, wxSize( 900, 400 ) );
        wxPanel* p = new wxPanel( f );

        wxBoxSizer* top = new wxBoxSizer( wxVERTICAL );

        // gbSizer1 (`:31-88`), the Pan and Zoom grid bag sizer.
        wxGridBagSizer* gb = new wxGridBagSizer( 0, 0 );
        wxCheckBox* zoomCenter = new wxCheckBox( p, wxID_ANY, "Center and warp cursor on zoom" );
        gb->Add( zoomCenter, wxGBPosition( 0, 0 ), wxGBSpan( 1, 1 ), wxALL, 5 );
        gb->Add( 30, 0, wxGBPosition( 0, 1 ), wxGBSpan( 1, 1 ), wxEXPAND, 5 );
        wxCheckBox* autoPan = new wxCheckBox( p, wxID_ANY, "Automatically pan while moving object" );
        gb->Add( autoPan, wxGBPosition( 0, 2 ), wxGBSpan( 1, 1 ), wxALL, 5 );
        wxCheckBox* zoomAccel = new wxCheckBox( p, wxID_ANY, "Use zoom acceleration" );
        gb->Add( zoomAccel, wxGBPosition( 1, 0 ), wxGBSpan( 1, 3 ), wxBOTTOM | wxRIGHT | wxLEFT, 5 );

        // m_zoomSizer, verbatim.
        wxBoxSizer* zoom = new wxBoxSizer( wxHORIZONTAL );
        wxStaticText* zoomLabel = new wxStaticText( p, wxID_ANY, "Zoom speed:" );
        zoom->Add( zoomLabel, 0, wxRIGHT | wxLEFT | wxALIGN_CENTER_VERTICAL, 8 );
        wxSlider* zoomSpeed = new wxSlider( p, wxID_ANY, 5, 1, 10 );
        zoom->Add( zoomSpeed, 0, wxEXPAND | wxLEFT | wxRIGHT | wxTOP, 0 );
        wxCheckBox* autoZoom = new wxCheckBox( p, wxID_ANY, "Automatic" );
        zoom->Add( autoZoom, 0, wxALIGN_CENTER_VERTICAL | wxLEFT | wxRIGHT, 10 );
        gb->Add( zoom, wxGBPosition( 2, 0 ), wxGBSpan( 1, 1 ), wxBOTTOM | wxEXPAND | wxTOP, 5 );

        wxBoxSizer* panS = new wxBoxSizer( wxHORIZONTAL );
        wxStaticText* panLabel = new wxStaticText( p, wxID_ANY, "Auto pan speed:" );
        panS->Add( panLabel, 0, wxRIGHT | wxLEFT | wxALIGN_CENTER_VERTICAL, 8 );
        wxSlider* panSpeed = new wxSlider( p, wxID_ANY, 5, 1, 10 );
        panS->Add( panSpeed, 0, wxEXPAND | wxLEFT | wxRIGHT | wxTOP, 0 );
        gb->Add( panS, wxGBPosition( 2, 2 ), wxGBSpan( 1, 1 ), wxBOTTOM | wxEXPAND | wxTOP, 5 );

        top->Add( gb, 1, wxEXPAND | wxTOP | wxRIGHT | wxLEFT, 5 );

        // fgSizer1: label / choice / spacer, four rows.
        wxFlexGridSizer* fg = new wxFlexGridSizer( 0, 3, 5, 5 );
        const char* labels[] = { "Left button drag:", "Middle button drag:", "Right button drag:",
                                 "Pan on mouse movement with key:" };
        wxArrayString leftChoices;
        leftChoices.Add( "Draw selection rectangle" );
        leftChoices.Add( "Drag selected objects; otherwise draw selection rectangle" );
        leftChoices.Add( "Drag any object (selected or not)" );
        wxArrayString panZoom;
        panZoom.Add( "Pan" ); panZoom.Add( "Zoom" ); panZoom.Add( "None" );
        wxArrayString keys;
        keys.Add( "None" ); keys.Add( "Alt" ); keys.Add( "Ctrl" ); keys.Add( "Shift" );
        wxChoice* choices[4];

        for( int i = 0; i < 4; ++i )
        {
            wxStaticText* lbl = new wxStaticText( p, wxID_ANY, labels[i] );
            fg->Add( lbl, 0, wxALIGN_CENTER_VERTICAL | wxBOTTOM | wxRIGHT, 5 );
            choices[i] = new wxChoice( p, wxID_ANY, wxDefaultPosition, wxDefaultSize,
                                       i == 0 ? leftChoices : ( i == 3 ? keys : panZoom ) );
            choices[i]->SetSelection( 0 );
            fg->Add( choices[i], 0,
                     wxALIGN_CENTER_VERTICAL | wxBOTTOM | wxEXPAND | wxLEFT | wxRIGHT, 5 );
            fg->Add( 0, 0, 1, wxEXPAND, 5 );
        }

        top->Add( fg, 1, wxEXPAND | wxALL, 5 );

        // fgSizer2 (`:212-315`): six columns, vgap 8.
        wxFlexGridSizer* fg2 = new wxFlexGridSizer( 0, 6, 8, 0 );
        wxStaticText* corner = new wxStaticText( p, wxID_ANY, wxEmptyString );
        fg2->Add( corner, 0, wxALIGN_RIGHT | wxTOP | wxRIGHT | wxLEFT, 5 );
        const char* heads[] = { "--", "Ctrl", "Shift", "Alt" };
        wxStaticText* headWin[4];

        for( int i = 0; i < 4; ++i )
        {
            headWin[i] = new wxStaticText( p, wxID_ANY, heads[i] );
            fg2->Add( headWin[i], 0, wxTOP | wxALIGN_CENTER_VERTICAL | wxALIGN_CENTER_HORIZONTAL, 5 );
        }

        fg2->Add( new wxStaticText( p, wxID_ANY, wxEmptyString ), 0,
                  wxALIGN_CENTER_HORIZONTAL | wxALIGN_CENTER_VERTICAL | wxLEFT | wxRIGHT, 5 );

        const char* rows[] = { "Zoom:", "Pan up/down:", "Pan left/right:" };
        wxStaticText* rowLabel[3];
        wxRadioButton* firstRadio[3];

        for( int r = 0; r < 3; ++r )
        {
            rowLabel[r] = new wxStaticText( p, wxID_ANY, rows[r] );
            fg2->Add( rowLabel[r], 0, wxALIGN_CENTER_VERTICAL | wxRIGHT, 5 );

            for( int c = 0; c < 4; ++c )
            {
                wxRadioButton* rb = new wxRadioButton( p, wxID_ANY, wxEmptyString, wxDefaultPosition,
                                                       wxDefaultSize, c == 0 ? wxRB_GROUP : 0 );
                if( c == 0 )
                    firstRadio[r] = rb;

                fg2->Add( rb, 0, wxALIGN_CENTER_HORIZONTAL | wxALIGN_CENTER_VERTICAL, 5 );
            }

            if( r == 1 )
                fg2->Add( new wxStaticText( p, wxID_ANY, wxEmptyString ), 0, wxALL, 5 );
            else
                fg2->Add( new wxCheckBox( p, wxID_ANY, "Reverse" ), 0, wxRIGHT | wxLEFT, 5 );
        }

        top->Add( fg2, 0, wxRIGHT | wxLEFT, 24 );

        p->SetSizer( top );
        p->Layout();
        top->Fit( p );

        wxPrintf( "zoom slider    %d x %d   (best %d x %d)\n", zoomSpeed->GetSize().x,
                  zoomSpeed->GetSize().y, zoomSpeed->GetBestSize().x, zoomSpeed->GetBestSize().y );
        wxPrintf( "\"Zoom speed:\"   label %d wide\n", zoomLabel->GetSize().x );

        for( int i = 0; i < 4; ++i )
            wxPrintf( "choice %d       x=%3d y=%3d w=%3d h=%d\n", i, choices[i]->GetRect().x,
                      choices[i]->GetRect().y, choices[i]->GetSize().x, choices[i]->GetSize().y );

        wxPrintf( "\nPan and Zoom rows (top of each control):\n" );
        wxPrintf( "  Center and warp      y=%3d h=%d\n", zoomCenter->GetRect().y,
                  zoomCenter->GetSize().y );
        wxPrintf( "  Automatically pan    y=%3d x=%3d\n", autoPan->GetRect().y,
                  autoPan->GetRect().x );
        wxPrintf( "  Use zoom accel       y=%3d\n", zoomAccel->GetRect().y );
        wxPrintf( "  Zoom speed: label    y=%3d   slider y=%3d\n", zoomLabel->GetRect().y,
                  zoomSpeed->GetRect().y );
        wxPrintf( "  Auto pan speed lbl   y=%3d x=%3d\n", panLabel->GetRect().y,
                  panLabel->GetRect().x );
        wxPrintf( "  pitch: row0->row1 %d, row1->row2 %d\n",
                  zoomAccel->GetRect().y - zoomCenter->GetRect().y,
                  zoomLabel->GetRect().y - zoomAccel->GetRect().y );

        wxPrintf( "\nDrag Gestures pitch: %d\n",
                  choices[1]->GetRect().y - choices[0]->GetRect().y );

        wxPrintf( "\nScroll grid:\n" );
        wxPrintf( "  headings y=%3d h=%d\n", headWin[0]->GetRect().y, headWin[0]->GetSize().y );

        for( int r = 0; r < 3; ++r )
            wxPrintf( "  %-16s y=%3d  radio y=%3d h=%d\n", rows[r], rowLabel[r]->GetRect().y,
                      firstRadio[r]->GetRect().y, firstRadio[r]->GetSize().y );

        wxPrintf( "  pitch: head->row0 %d, row0->row1 %d, row1->row2 %d\n",
                  firstRadio[0]->GetRect().y - headWin[0]->GetRect().y,
                  firstRadio[1]->GetRect().y - firstRadio[0]->GetRect().y,
                  firstRadio[2]->GetRect().y - firstRadio[1]->GetRect().y );

        f->Destroy();
        return false;
    }
};

wxIMPLEMENT_APP_CONSOLE( App );
