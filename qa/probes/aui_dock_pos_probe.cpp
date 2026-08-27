// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
//
// Does the vertical order of eeschema's left column depend on the order the
// panes were opened?
//
// The report was: "whatever I choose FIRST docks at top and whatever is chosen
// LATER docks below it". Reading the C++ alone says no — the numbers are fixed
// at AddPane time (Hierarchy `.Position( 1 )`, sch_edit_frame.cpp:262;
// Properties `.Position( 2 )`, eeschema_settings.cpp:95) and neither
// SCH_EDIT_FRAME::ToggleProperties (:2886) nor ToggleSchematicHierarchy (:2910)
// ever touches Position or dock_pos again; they only call `.Show()`.
//
// But wxAuiManager renumbers `dock_pos` behind the frame's back, so the C++ is
// not the whole story. This builds the same four panes eeschema builds, in the
// same dock (Left, Layer 3), toggles them in both orders, and after every step
// prints each pane's bookkeeping AND the on-screen y of its window, so the
// printed order is the DRAWN order.
//
// Build:
//   g++ -Wno-deprecated-declarations -o aui_dock_pos_probe aui_dock_pos_probe.cpp \
//       $(wx-config --cxxflags --libs core,base,aui)
// Run (a snap-injected LD_LIBRARY_PATH breaks the loader). There is no
// ~/.Xauthority under a Wayland session — $XAUTHORITY points at mutter's
// Xwayland cookie, and dropping it gives "Unable to initialize GTK+":
//   env -i HOME=$HOME DISPLAY=$DISPLAY XAUTHORITY=$XAUTHORITY \
//       XDG_RUNTIME_DIR=/run/user/$(id -u) PATH=/usr/bin:/bin ./aui_dock_pos_probe
//
// ---------------------------------------------------------------------------
// OUTPUT (wxWidgets 3.2.4, GTK3, this machine)
//
// == scenario: Hierarchy first, then Properties ==
// -- after AddPane + Update (both hidden) --
//     NetNavigator     hidden  dock_pos=0 layer=3 row=0  y=-
//     Hierarchy        hidden  dock_pos=1 layer=3 row=0  y=-
//     Properties       hidden  dock_pos=2 layer=3 row=0  y=-
//     SelectionFilter  hidden  dock_pos=4 layer=3 row=0  y=-
//   drawn top-to-bottom: (nothing)
//
// -- Show Hierarchy --
//     NetNavigator     hidden  dock_pos=0 layer=3 row=0  y=-
//     Hierarchy        SHOWN   dock_pos=0 layer=3 row=0  y=18
//     Properties       hidden  dock_pos=2 layer=3 row=0  y=-
//     SelectionFilter  SHOWN   dock_pos=1 layer=3 row=0  y=509
//   drawn top-to-bottom: Hierarchy, SelectionFilter
//
// -- Show Properties --
//     NetNavigator     hidden  dock_pos=0 layer=3 row=0  y=-
//     Hierarchy        SHOWN   dock_pos=0 layer=3 row=0  y=18
//     Properties       SHOWN   dock_pos=2 layer=3 row=0  y=288
//     SelectionFilter  SHOWN   dock_pos=1 layer=3 row=0  y=263
//   drawn top-to-bottom: Hierarchy, SelectionFilter, Properties
//
// == scenario: Properties first, then Hierarchy ==
// -- after AddPane + Update (both hidden) --
//     NetNavigator     hidden  dock_pos=0 layer=3 row=0  y=-
//     Hierarchy        hidden  dock_pos=1 layer=3 row=0  y=-
//     Properties       hidden  dock_pos=2 layer=3 row=0  y=-
//     SelectionFilter  hidden  dock_pos=4 layer=3 row=0  y=-
//   drawn top-to-bottom: (nothing)
//
// -- Show Properties --
//     NetNavigator     hidden  dock_pos=0 layer=3 row=0  y=-
//     Hierarchy        hidden  dock_pos=1 layer=3 row=0  y=-
//     Properties       SHOWN   dock_pos=0 layer=3 row=0  y=18
//     SelectionFilter  SHOWN   dock_pos=1 layer=3 row=0  y=509
//   drawn top-to-bottom: Properties, SelectionFilter
//
// -- Show Hierarchy --
//     NetNavigator     hidden  dock_pos=0 layer=3 row=0  y=-
//     Hierarchy        SHOWN   dock_pos=1 layer=3 row=0  y=263
//     Properties       SHOWN   dock_pos=0 layer=3 row=0  y=18
//     SelectionFilter  SHOWN   dock_pos=2 layer=3 row=0  y=509
//   drawn top-to-bottom: Properties, Hierarchy, SelectionFilter
//
// == scenario: both, then hide Hierarchy, then show it again ==
// -- after AddPane + Update (both hidden) --
//     NetNavigator     hidden  dock_pos=0 layer=3 row=0  y=-
//     Hierarchy        hidden  dock_pos=1 layer=3 row=0  y=-
//     Properties       hidden  dock_pos=2 layer=3 row=0  y=-
//     SelectionFilter  hidden  dock_pos=4 layer=3 row=0  y=-
//   drawn top-to-bottom: (nothing)
//
// -- Show Hierarchy --
//     NetNavigator     hidden  dock_pos=0 layer=3 row=0  y=-
//     Hierarchy        SHOWN   dock_pos=0 layer=3 row=0  y=18
//     Properties       hidden  dock_pos=2 layer=3 row=0  y=-
//     SelectionFilter  SHOWN   dock_pos=1 layer=3 row=0  y=509
//   drawn top-to-bottom: Hierarchy, SelectionFilter
//
// -- Show Properties --
//     NetNavigator     hidden  dock_pos=0 layer=3 row=0  y=-
//     Hierarchy        SHOWN   dock_pos=0 layer=3 row=0  y=18
//     Properties       SHOWN   dock_pos=2 layer=3 row=0  y=288
//     SelectionFilter  SHOWN   dock_pos=1 layer=3 row=0  y=263
//   drawn top-to-bottom: Hierarchy, SelectionFilter, Properties
//
// -- Hide Hierarchy --
//     NetNavigator     hidden  dock_pos=0 layer=3 row=0  y=-
//     Hierarchy        hidden  dock_pos=0 layer=3 row=0  y=-
//     Properties       SHOWN   dock_pos=1 layer=3 row=0  y=43
//     SelectionFilter  SHOWN   dock_pos=0 layer=3 row=0  y=18
//   drawn top-to-bottom: SelectionFilter, Properties
//
// -- Show Hierarchy --
//     NetNavigator     hidden  dock_pos=0 layer=3 row=0  y=-
//     Hierarchy        SHOWN   dock_pos=0 layer=3 row=0  y=18
//     Properties       SHOWN   dock_pos=2 layer=3 row=0  y=288
//     SelectionFilter  SHOWN   dock_pos=1 layer=3 row=0  y=263
//   drawn top-to-bottom: Hierarchy, SelectionFilter, Properties
//
// == scenario: Properties first, then Hierarchy, then re-open Properties ==
// -- after AddPane + Update (both hidden) --
//     NetNavigator     hidden  dock_pos=0 layer=3 row=0  y=-
//     Hierarchy        hidden  dock_pos=1 layer=3 row=0  y=-
//     Properties       hidden  dock_pos=2 layer=3 row=0  y=-
//     SelectionFilter  hidden  dock_pos=4 layer=3 row=0  y=-
//   drawn top-to-bottom: (nothing)
//
// -- Show Properties --
//     NetNavigator     hidden  dock_pos=0 layer=3 row=0  y=-
//     Hierarchy        hidden  dock_pos=1 layer=3 row=0  y=-
//     Properties       SHOWN   dock_pos=0 layer=3 row=0  y=18
//     SelectionFilter  SHOWN   dock_pos=1 layer=3 row=0  y=509
//   drawn top-to-bottom: Properties, SelectionFilter
//
// -- Show Hierarchy --
//     NetNavigator     hidden  dock_pos=0 layer=3 row=0  y=-
//     Hierarchy        SHOWN   dock_pos=1 layer=3 row=0  y=263
//     Properties       SHOWN   dock_pos=0 layer=3 row=0  y=18
//     SelectionFilter  SHOWN   dock_pos=2 layer=3 row=0  y=509
//   drawn top-to-bottom: Properties, Hierarchy, SelectionFilter
//
// -- Hide Properties --
//     NetNavigator     hidden  dock_pos=0 layer=3 row=0  y=-
//     Hierarchy        SHOWN   dock_pos=0 layer=3 row=0  y=18
//     Properties       hidden  dock_pos=0 layer=3 row=0  y=-
//     SelectionFilter  SHOWN   dock_pos=1 layer=3 row=0  y=509
//   drawn top-to-bottom: Hierarchy, SelectionFilter
//
// -- Show Properties --
//     NetNavigator     hidden  dock_pos=0 layer=3 row=0  y=-
//     Hierarchy        SHOWN   dock_pos=0 layer=3 row=0  y=18
//     Properties       SHOWN   dock_pos=1 layer=3 row=0  y=263
//     SelectionFilter  SHOWN   dock_pos=2 layer=3 row=0  y=509
//   drawn top-to-bottom: Hierarchy, Properties, SelectionFilter
//
// == scenario: all four shown in ONE Update (a restored frame) ==
// -- one Update with all four already shown --
//     NetNavigator     SHOWN   dock_pos=0 layer=3 row=0  y=18
//     Hierarchy        SHOWN   dock_pos=1 layer=3 row=0  y=181
//     Properties       SHOWN   dock_pos=2 layer=3 row=0  y=345
//     SelectionFilter  SHOWN   dock_pos=3 layer=3 row=0  y=509
//   drawn top-to-bottom: NetNavigator, Hierarchy, Properties, SelectionFilter
//
// ---------------------------------------------------------------------------
// WHAT wxAUI IS DOING
//
// Two rules account for every line above, and neither is in KiCad's source:
//
//   1. Every Update() renumbers the SHOWN panes of a dock. They are stable-
//      sorted by their current dock_pos and then written back as 0, 1, 2 ...
//      in that order. A HIDDEN pane is not touched and keeps its number.
//   2. A tie in dock_pos is broken by AddPane order. Reopening Properties in
//      the fourth scenario ties it with the hierarchy at 0, and the hierarchy
//      — added at sch_edit_frame.cpp:260, twelve lines before Properties —
//      takes the higher slot.
//
// So the FIRST pane opened is alone in the dock and is renumbered to 0, while
// the second still carries its original Position() (1, 2 or 4), which is
// greater — and therefore docks BELOW it, whichever of the two it is. That is
// the user's report, exactly, and it is why the fixed Position() table is the
// wrong model: those numbers only order panes that become visible in the SAME
// Update(), which is the restored-frame case in the last scenario.
//
// Two consequences worth having in a test:
//
//   * A pane hidden and re-shown keeps the compacted number it was given, so
//     re-opening does not send it to the bottom of the column.
//   * The Selection Filter is NOT pinned to the bottom. It is shown by
//     updateSelectionFilterVisbility() in the same Update() as whichever pane
//     triggered it, so it is compacted alongside that pane and can end up
//     ABOVE a pane opened later: open the hierarchy, then Properties, and the
//     column reads Hierarchy, Selection Filter, Properties. Its being fixed
//     height with no sash is a different rule — dock_proportion = 0,
//     sch_edit_frame.cpp:325 — and is unaffected by any of this.
#include <wx/wx.h>
#include <wx/aui/aui.h>

// A stand-in for one of eeschema's palettes: a panel we can find on screen.
static wxPanel* makePanel( wxWindow* parent, const wxColour& c )
{
    wxPanel* p = new wxPanel( parent );
    p->SetBackgroundColour( c );
    return p;
}


static void pump()
{
    for( int i = 0; i < 20; ++i )
    {
        wxTheApp->Yield( true );
        wxMilliSleep( 5 );
    }
}


struct Pane
{
    const char* name;
    wxWindow*   window;
};


static void report( wxAuiManager& mgr, const std::vector<Pane>& panes, const char* step )
{
    printf( "-- %s --\n", step );

    std::vector<std::pair<int, const char*>> drawn;

    for( const Pane& p : panes )
    {
        wxAuiPaneInfo& info = mgr.GetPane( p.name );
        bool           shown = info.IsShown();
        int            y = p.window->GetPosition().y;

        printf( "    %-16s %-7s dock_pos=%d layer=%d row=%d  y=", p.name,
                shown ? "SHOWN" : "hidden", info.dock_pos, info.dock_layer, info.dock_row );

        if( shown )
        {
            printf( "%d\n", y );
            drawn.emplace_back( y, p.name );
        }
        else
        {
            printf( "-\n" );
        }
    }

    std::sort( drawn.begin(), drawn.end() );
    printf( "  drawn top-to-bottom:" );

    for( size_t i = 0; i < drawn.size(); ++i )
        printf( "%s %s", i ? "," : "", drawn[i].second );

    printf( "%s\n\n", drawn.empty() ? " (nothing)" : "" );
}


// Builds eeschema's left column: the same four panes, the same dock, the same
// Position() numbers, all hidden, and the selection filter's dock_proportion.
static wxAuiManager* build( wxFrame* f, std::vector<Pane>& panes )
{
    wxAuiManager* mgr = new wxAuiManager( f );

    wxWindow* netNav = makePanel( f, wxColour( 120, 80, 80 ) );
    wxWindow* hierarchy = makePanel( f, wxColour( 80, 120, 80 ) );
    wxWindow* properties = makePanel( f, wxColour( 80, 80, 120 ) );
    wxWindow* selFilter = makePanel( f, wxColour( 120, 120, 80 ) );
    wxWindow* canvas = makePanel( f, wxColour( 30, 30, 30 ) );

    // The AddPane ORDER below is eeschema's, because it is what breaks ties:
    // hierarchy (sch_edit_frame.cpp:260), properties (:272), selection filter
    // (:273), net navigator (:279). Note the net navigator is added LAST even
    // though its Position() is 0.

    // sch_edit_frame.cpp:260-270 — Schematic Hierarchy
    mgr->AddPane( hierarchy, wxAuiPaneInfo().Name( "Hierarchy" ).Caption( "Schematic Hierarchy" )
                             .Left().Layer( 3 ).Position( 1 )
                             .MinSize( 120, 60 ).BestSize( 200, 200 ).Show( false ) );

    // eeschema_settings.cpp:89-107 — Properties
    mgr->AddPane( properties, wxAuiPaneInfo().Name( "Properties" ).Caption( "Properties" )
                              .Left().Layer( 3 ).Position( 2 )
                              .MinSize( 240, 60 ).BestSize( 300, 200 ).Show( false ) );

    // eeschema_settings.cpp:111-129 — Selection Filter
    mgr->AddPane( selFilter, wxAuiPaneInfo().Name( "SelectionFilter" ).Caption( "Selection Filter" )
                             .Left().Layer( 3 ).Position( 4 )
                             .MinSize( 180, -1 ).BestSize( 180, -1 ).Show( false ) );

    // eeschema_settings.cpp:66-84 — Net Navigator
    mgr->AddPane( netNav, wxAuiPaneInfo().Name( "NetNavigator" ).Caption( "Net Navigator" )
                          .Left().Layer( 3 ).Position( 0 )
                          .MinSize( 120, 60 ).BestSize( 200, 200 ).Show( false ) );

    mgr->AddPane( canvas, wxAuiPaneInfo().Name( "DrawFrame" ).CenterPane() );

    // sch_edit_frame.cpp:325
    mgr->GetPane( "SelectionFilter" ).dock_proportion = 0;

    panes = { { "NetNavigator", netNav },
              { "Hierarchy", hierarchy },
              { "Properties", properties },
              { "SelectionFilter", selFilter } };

    return mgr;
}


// updateSelectionFilterVisbility(), sch_edit_frame.cpp:2817-2831.
static void updateSelectionFilter( wxAuiManager& mgr )
{
    bool show = mgr.GetPane( "Hierarchy" ).IsShown() || mgr.GetPane( "NetNavigator" ).IsShown()
                || mgr.GetPane( "Properties" ).IsShown();

    mgr.GetPane( "SelectionFilter" ).Show( show );
}


// SetAuiPaneSize, common/widgets/wx_aui_utils.cpp:24-41 — the "force width by
// setting MinSize() and then Fixed()" hack. Both toggles call it on the way IN
// (with the stored docked width) and a plain Update() on the way OUT, so the
// probe does too: two more Update()s per show, which is exactly the chance for
// a renumbering pass that a naive probe would miss.
static void setAuiPaneSize( wxAuiManager& mgr, wxAuiPaneInfo& pane, int w, int h )
{
    wxSize minSize = pane.min_size;

    pane.MinSize( w, h );
    pane.Fixed();
    mgr.Update();

    pane.Resizable();
    mgr.Update();

    pane.MinSize( minSize.x, minSize.y );
}


static void showPane( wxAuiManager& mgr, const char* name, bool show )
{
    wxAuiPaneInfo& pane = mgr.GetPane( name );

    pane.Show( show );
    updateSelectionFilter( mgr );

    if( show )
        setAuiPaneSize( mgr, pane, 200, -1 );    // the stored docked width
    else
        mgr.Update();

    pump();
}


class App : public wxApp
{
public:
    void scenario( const char* title, const std::vector<std::pair<const char*, bool>>& steps )
    {
        printf( "== scenario: %s ==\n", title );

        wxFrame*             f = new wxFrame( nullptr, wxID_ANY, "probe", wxDefaultPosition,
                                              wxSize( 900, 600 ) );
        std::vector<Pane>    panes;
        wxAuiManager*        mgr = build( f, panes );

        mgr->Update();
        f->Show();
        pump();
        report( *mgr, panes, "after AddPane + Update (both hidden)" );

        for( const auto& step : steps )
        {
            showPane( *mgr, step.first, step.second );
            report( *mgr, panes, wxString::Format( "%s %s", step.second ? "Show" : "Hide",
                                                   step.first ).utf8_str() );
        }

        mgr->UnInit();
        delete mgr;
        f->Destroy();
        pump();
    }

    void restored( const char* title )
    {
        printf( "== scenario: %s ==\n", title );

        wxFrame*          f = new wxFrame( nullptr, wxID_ANY, "probe", wxDefaultPosition,
                                           wxSize( 900, 600 ) );
        std::vector<Pane> panes;
        wxAuiManager*     mgr = build( f, panes );

        for( const Pane& p : panes )
            mgr->GetPane( p.name ).Show( true );

        mgr->Update();
        f->Show();
        pump();
        report( *mgr, panes, "one Update with all four already shown" );

        mgr->UnInit();
        delete mgr;
        f->Destroy();
        pump();
    }

    bool OnInit() override
    {
        scenario( "Hierarchy first, then Properties",
                  { { "Hierarchy", true }, { "Properties", true } } );

        scenario( "Properties first, then Hierarchy",
                  { { "Properties", true }, { "Hierarchy", true } } );

        scenario( "both, then hide Hierarchy, then show it again",
                  { { "Hierarchy", true },
                    { "Properties", true },
                    { "Hierarchy", false },
                    { "Hierarchy", true } } );

        // What breaks a tie once two panes hold the same dock_pos.
        scenario( "Properties first, then Hierarchy, then re-open Properties",
                  { { "Properties", true },
                    { "Hierarchy", true },
                    { "Properties", false },
                    { "Properties", true } } );

        // A frame that restores several panes at once: every Show() happens
        // before the single Update(), so nothing has been renumbered yet and
        // the Position() table is the only thing ordering them.
        restored( "all four shown in ONE Update (a restored frame)" );

        return false;
    }
};

wxIMPLEMENT_APP_NO_MAIN( App );

int main( int argc, char** argv )
{
    wxEntryStart( argc, argv );
    wxTheApp->CallOnInit();
    wxEntryCleanup();
    return 0;
}
