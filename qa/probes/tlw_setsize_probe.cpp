// What `SetSize( 880, 680 )` on a top-level window leaves as the CLIENT area
// on this desktop — whether the title bar is inside the 680 or on top of it.
//
// PANEL_FOOTPRINT_CHOOSER::FinishSetup does `GetParent()->SetSize( wxSize( w,
// h ) )` on the FOOTPRINT_CHOOSER_FRAME (a wxFrame), and
// PANEL_SYMBOL_CHOOSER::FinishSetup the same on DIALOG_SYMBOL_CHOOSER (a
// wxDialog). Ours draws its own 37px title bar inside the box, so the box
// height must be 680 + 37 if the 680 is a client size and 680 if it is the
// outer size. Two derivations disagreed — shell.css said client, a screenshot
// said outer — so this asks wx, for both window kinds, mapped and unmapped.
//
// Build (see README.md - env -i is mandatory):
//   g++ -Wno-deprecated-declarations -o tlw_setsize_probe tlw_setsize_probe.cpp \
//       $(wx-config --cxxflags --libs core,base) $(pkg-config --cflags --libs gtk+-3.0)
#include <wx/wx.h>
#include <gtk/gtk.h>
#include <cstdio>

static void pump()
{
    for( int i = 0; i < 400; ++i )
        while( gtk_events_pending() )
            gtk_main_iteration();
}

static void report( const char* what, wxTopLevelWindow* w )
{
    wxSize outer = w->GetSize();
    wxSize client = w->GetClientSize();
    printf( "%-28s GetSize %d x %d   GetClientSize %d x %d   (title bar = %d)\n", what,
            outer.x, outer.y, client.x, client.y, outer.y - client.y );
}

class App : public wxApp
{
public:
    bool OnInit() override
    {
        // KiCad has mapped windows long before the chooser opens — the board
        // editor at least — and wxGTK caches the decoration size it learned
        // from them (gs_decorCache in src/gtk/toplevel.cpp), so a warm process
        // is the case that matters. A throwaway frame warms it here.
        wxFrame* warm = new wxFrame( nullptr, wxID_ANY, "warm" );
        warm->Show();
        pump();
        warm->Destroy();
        pump();

        // The frame, the way FinishSetup sizes it: created, sized, THEN shown.
        wxFrame* frame = new wxFrame( nullptr, wxID_ANY, "frame" );
        frame->SetSize( wxSize( 880, 680 ) );
        report( "wxFrame  before Show", frame );
        frame->Show();
        pump();
        report( "wxFrame  after Show", frame );
        // And sized again while mapped, which a restored cfg size also does.
        frame->SetSize( wxSize( 880, 680 ) );
        pump();
        report( "wxFrame  SetSize mapped", frame );

        wxDialog* dlg = new wxDialog( nullptr, wxID_ANY, "dialog" );
        dlg->SetSize( wxSize( 880, 680 ) );
        report( "wxDialog before Show", dlg );
        dlg->Show();
        pump();
        report( "wxDialog after Show", dlg );
        dlg->SetSize( wxSize( 880, 680 ) );
        pump();
        report( "wxDialog SetSize mapped", dlg );

        frame->Destroy();
        dlg->Destroy();
        return false;
    }
};

wxIMPLEMENT_APP( App );
