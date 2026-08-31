// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
//
// Preferences > Common > "User Interface", built with wxWidgets on this machine
// with this GTK theme, so the group's METRICS can be read off the widgets
// instead of guessed from a screenshot or derived from the stylesheet.
//
// The sizer is `bUserInterfaceSizer` transcribed from
// common/dialogs/panel_common_settings_base.cpp:163-293, with exactly the rows
// panel_common_settings.cpp hides on GTK left out:
//
//   m_checkBoxIconsInMenus  Show( KIPLATFORM::UI::AllowIconsInMenus() )  (:123)
//                           -> wxgtk/ui.cpp:296 reads "gtk-menu-images", off
//   m_scaleFonts / m_fontScalingHelp    Show( false )                    (:125)
//   m_gbUserInterface (Canvas scale)    !m_AllowManualCanvasScale        (:108)
//   bSizerAppTheme                      #ifndef __WXMSW__                (:73)
//
// so what it lays out is what the installed build puts on the screen.
//
//   g++ -Wno-deprecated-declarations -o prefs_ui_group_probe \
//       prefs_ui_group_probe.cpp $(wx-config --cxxflags --libs core,base)
#include <wx/wx.h>

static void row( const char* what, wxWindow* w )
{
    wxRect r = w->GetRect();
    wxPrintf( "%-46s x=%4d y=%4d w=%4d h=%3d  (bottom %d)\n", what, r.x, r.y, r.width, r.height,
              r.GetBottom() + 1 );
}

class App : public wxApp
{
public:
    bool OnInit() override
    {
        wxFrame* f = new wxFrame( nullptr, wxID_ANY, "probe", wxDefaultPosition,
                                  wxSize( 700, 500 ) );
        wxPanel* p = new wxPanel( f );

        wxBoxSizer* bUserInterfaceSizer = new wxBoxSizer( wxVERTICAL );

        // bSizer14 — the checkbox run. Every Add is wxBOTTOM|wxRIGHT|wxLEFT, 5
        // once the icons-in-menus row (wxALL, 5) is hidden.
        wxBoxSizer* bSizer14 = new wxBoxSizer( wxVERTICAL );
        wxCheckBox* showScrollbars = new wxCheckBox( p, wxID_ANY, "Show scrollbars in editors" );
        bSizer14->Add( showScrollbars, 0, wxBOTTOM | wxRIGHT | wxLEFT, 5 );
        wxCheckBox* focusFollow =
                new wxCheckBox( p, wxID_ANY, "Focus follows mouse between schematic and PCB editors" );
        bSizer14->Add( focusFollow, 0, wxBOTTOM | wxRIGHT | wxLEFT, 5 );
        wxCheckBox* hotkeyFeedback = new wxCheckBox(
                p, wxID_ANY, "Show popup indicator when toggling settings with hotkeys" );
        bSizer14->Add( hotkeyFeedback, 0, wxBOTTOM | wxRIGHT | wxLEFT, 5 );
        wxCheckBox* gridStriping =
                new wxCheckBox( p, wxID_ANY, "Use alternating row colors in tables" );
        bSizer14->Add( gridStriping, 0, wxBOTTOM | wxLEFT | wxRIGHT, 5 );
        bUserInterfaceSizer->Add( bSizer14, 0, wxEXPAND, 5 );

        wxCheckBox* disableCursors = new wxCheckBox( p, wxID_ANY, "Disable custom cursors" );
        bUserInterfaceSizer->Add( disableCursors, 0, wxBOTTOM | wxLEFT | wxRIGHT, 5 );

        // bSizerIconsTheme — label + three radios, every child wxALL, 5.
        wxBoxSizer* bSizerIconsTheme = new wxBoxSizer( wxHORIZONTAL );
        wxStaticText* stIconTheme = new wxStaticText( p, wxID_ANY, "Icon theme:" );
        bSizerIconsTheme->Add( stIconTheme, 0, wxALL, 5 );
        wxRadioButton* rbLight =
                new wxRadioButton( p, wxID_ANY, "Light", wxDefaultPosition, wxDefaultSize, wxRB_GROUP );
        bSizerIconsTheme->Add( rbLight, 0, wxALL, 5 );
        wxRadioButton* rbDark = new wxRadioButton( p, wxID_ANY, "Dark" );
        bSizerIconsTheme->Add( rbDark, 0, wxALL, 5 );
        wxRadioButton* rbAuto = new wxRadioButton( p, wxID_ANY, "Automatic" );
        bSizerIconsTheme->Add( rbAuto, 0, wxALL, 5 );
        bUserInterfaceSizer->Add( bSizerIconsTheme, 0, wxEXPAND | wxTOP, 5 );

        // bSizerToolbarSize — the same shape, and its Add carries NO border.
        wxBoxSizer* bSizerToolbarSize = new wxBoxSizer( wxHORIZONTAL );
        wxStaticText* stToolbar = new wxStaticText( p, wxID_ANY, "Toolbar icon size:" );
        bSizerToolbarSize->Add( stToolbar, 0, wxALL, 5 );
        wxRadioButton* rbSmall =
                new wxRadioButton( p, wxID_ANY, "Small", wxDefaultPosition, wxDefaultSize, wxRB_GROUP );
        bSizerToolbarSize->Add( rbSmall, 0, wxALL, 5 );
        wxRadioButton* rbNormal = new wxRadioButton( p, wxID_ANY, "Normal" );
        bSizerToolbarSize->Add( rbNormal, 0, wxALL, 5 );
        wxRadioButton* rbLarge = new wxRadioButton( p, wxID_ANY, "Large" );
        bSizerToolbarSize->Add( rbLarge, 0, wxALL, 5 );
        bUserInterfaceSizer->Add( bSizerToolbarSize, 0, wxEXPAND, 5 );

        // bSizerHighContrast — label and units carry wxRIGHT|wxLEFT only, the
        // field none, and the row itself wxTOP|wxBOTTOM.
        wxBoxSizer* bSizerHighContrast = new wxBoxSizer( wxHORIZONTAL );
        wxStaticText* hcLabel = new wxStaticText( p, wxID_ANY, "High-contrast mode dimming factor:" );
        bSizerHighContrast->Add( hcLabel, 0, wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT, 5 );
        wxTextCtrl* hcCtrl = new wxTextCtrl( p, wxID_ANY, "80" );
        // panel_common_settings.cpp:145-148 — the field is sized to "XXX.XXX".
        hcCtrl->SetMinSize( wxSize( hcCtrl->GetTextExtent( "XXX.XXX" ).GetWidth(),
                                    hcCtrl->GetMinSize().GetHeight() ) );
        bSizerHighContrast->Add( hcCtrl, 0, wxALIGN_CENTER_VERTICAL, 5 );
        wxStaticText* hcUnits = new wxStaticText( p, wxID_ANY, "%" );
        bSizerHighContrast->Add( hcUnits, 0, wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT, 5 );
        bUserInterfaceSizer->Add( bSizerHighContrast, 0, wxEXPAND | wxTOP | wxBOTTOM, 5 );

        p->SetSizer( bUserInterfaceSizer );
        p->Layout();
        bUserInterfaceSizer->Fit( p );

        wxPrintf( "GUI font: %s\n\n", wxSystemSettings::GetFont( wxSYS_DEFAULT_GUI_FONT )
                                              .GetNativeFontInfoUserDesc() );

        row( "Show scrollbars in editors", showScrollbars );
        row( "Focus follows mouse ...", focusFollow );
        row( "Show popup indicator ...", hotkeyFeedback );
        row( "Use alternating row colors in tables", gridStriping );
        row( "Disable custom cursors", disableCursors );
        row( "Icon theme: (label)", stIconTheme );
        row( "  Light", rbLight );
        row( "  Dark", rbDark );
        row( "  Automatic", rbAuto );
        row( "Toolbar icon size: (label)", stToolbar );
        row( "  Small", rbSmall );
        row( "  Normal", rbNormal );
        row( "  Large", rbLarge );
        row( "High-contrast ... (label)", hcLabel );
        row( "  field", hcCtrl );
        row( "  %", hcUnits );

        wxPrintf( "\nrow pitch (top to top):\n" );
        wxPrintf( "  checkbox to checkbox      %d\n",
                  focusFollow->GetRect().y - showScrollbars->GetRect().y );
        wxPrintf( "  last checkbox to Icon     %d\n",
                  rbLight->GetRect().y - disableCursors->GetRect().y );
        wxPrintf( "  Icon theme to Toolbar     %d\n",
                  rbSmall->GetRect().y - rbLight->GetRect().y );
        wxPrintf( "  Toolbar to High-contrast  %d\n",
                  hcCtrl->GetRect().y - rbSmall->GetRect().y );
        wxPrintf( "\nhorizontal:\n" );
        wxPrintf( "  Icon theme label right edge -> first radio left   %d\n",
                  rbLight->GetRect().x - ( stIconTheme->GetRect().GetRight() + 1 ) );
        wxPrintf( "  radio to radio (Light right -> Dark left)         %d\n",
                  rbDark->GetRect().x - ( rbLight->GetRect().GetRight() + 1 ) );
        wxPrintf( "  Toolbar label right edge -> first radio left      %d\n",
                  rbSmall->GetRect().x - ( stToolbar->GetRect().GetRight() + 1 ) );
        wxPrintf( "  left edge: checkbox %d, Icon theme label %d, Toolbar label %d\n",
                  showScrollbars->GetRect().x, stIconTheme->GetRect().x, stToolbar->GetRect().x );
        wxPrintf( "  high-contrast field width %d\n", hcCtrl->GetRect().width );

        f->Destroy();
        return false;
    }
};

wxIMPLEMENT_APP_CONSOLE( App );
