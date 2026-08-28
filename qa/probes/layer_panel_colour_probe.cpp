// SPDX-License-Identifier: GPL-3.0-or-later
// What APPEARANCE_CONTROLS' m_layerPanelColour actually is on this machine.
//
//   m_layerPanelColour = m_panelLayers->GetBackgroundColour().ChangeLightness( 110 );
//       pcbnew/widgets/appearance_controls.cpp:433 and :1240
//
// m_panelLayers is a wxPanel inside the docked APPEARANCE_CONTROLS panel, so
// this builds that shape and asks wx for both the panel's own background and
// the lightened result. ChangeLightness is wx's own arithmetic, not ours.
//
//   g++ -Wno-deprecated-declarations -o layer_panel_colour_probe layer_panel_colour_probe.cpp \
//       $(wx-config --cxxflags --libs core,base,adv)
#include <wx/wx.h>

static void say( const char* what, const wxColour& c )
{
    wxPrintf( "%-38s rgb(%3d, %3d, %3d)  %s\n", what, c.Red(), c.Green(), c.Blue(),
              c.GetAsString( wxC2S_HTML_SYNTAX ) );
}

class App : public wxApp
{
public:
    bool OnInit() override
    {
        wxFrame* frame = new wxFrame( nullptr, wxID_ANY, "probe" );
        wxPanel* outer = new wxPanel( frame );
        wxPanel* panelLayers = new wxPanel( outer );
        frame->Show();
        while( Pending() ) Dispatch();

        wxColour bg = panelLayers->GetBackgroundColour();
        say( "m_panelLayers GetBackgroundColour", bg );
        say( "  .ChangeLightness( 110 )", bg.ChangeLightness( 110 ) );
        say( "wxSYS_COLOUR_BTNFACE", wxSystemSettings::GetColour( wxSYS_COLOUR_BTNFACE ) );
        say( "  .ChangeLightness( 110 )",
             wxSystemSettings::GetColour( wxSYS_COLOUR_BTNFACE ).ChangeLightness( 110 ) );
        frame->Destroy();
        return false;
    }
};
wxIMPLEMENT_APP_NO_MAIN( App );
int main( int argc, char** argv ) { wxEntryStart( argc, argv ); wxTheApp->CallOnInit(); return 0; }
