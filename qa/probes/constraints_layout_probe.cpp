// What width does PANEL_SETUP_CONSTRAINTS's four-column flex grid actually
// give its entry column, and how wide is the whole page?
//
// `panel_setup_constraints_base.cpp` adds BOTH halves of `bScrolledSizer` with
// proportion 0 and puts a growable `Add( 0, 0, 1, wxEXPAND, 0 )` after them, so
// neither column stretches — every width on the page is a min width, and the
// only explicit one is `SetMinSize( wxSize( 120, -1 ) )` on two of the entries.
// Whether that 120 is the column, or whether a bare wxTextCtrl's own best size
// is wider, is a wx question, so ask wx.
//
// Build:
//   g++ -Wno-deprecated-declarations -o constraints_layout_probe \
//       constraints_layout_probe.cpp $(wx-config --cxxflags --libs core,base)
#include <wx/wx.h>
#include <wx/statline.h>
#include <wx/spinctrl.h>
#include <wx/scrolwin.h>
#include <cstdio>

class App : public wxApp
{
public:
    bool OnInit() override
    {
        wxFrame* frame = new wxFrame( nullptr, wxID_ANY, "probe" );
        wxPanel* panel = new wxPanel( frame );

        wxBoxSizer* bScrolledSizer = new wxBoxSizer( wxHORIZONTAL );

        // -- sbFeatureConstraints: the four-column grid ---------------------
        wxBoxSizer* sbFeatureConstraints = new wxBoxSizer( wxVERTICAL );
        wxFlexGridSizer* fg = new wxFlexGridSizer( 0, 4, 0, 0 );
        fg->SetFlexibleDirection( wxBOTH );
        fg->SetNonFlexibleGrowMode( wxFLEX_GROWMODE_SPECIFIED );
        fg->SetMinSize( wxSize( -1, 0 ) );

        auto heading = [&]( const char* text )
        {
            fg->Add( new wxStaticText( panel, wxID_ANY, text ), 0, wxTOP | wxLEFT, 13 );
            fg->Add( 0, 0, 1, wxEXPAND, 5 );
            fg->Add( 0, 0, 1, wxEXPAND, 5 );
            fg->Add( 0, 0, 1, wxEXPAND, 5 );
            for( int i = 0; i < 4; ++i )
                fg->Add( new wxStaticLine( panel, wxID_ANY, wxDefaultPosition, wxDefaultSize,
                                           wxLI_HORIZONTAL ), 0, wxEXPAND | wxTOP | wxBOTTOM, 2 );
        };

        wxTextCtrl* firstCtrl = nullptr;
        wxStaticText* firstLabel = nullptr;
        wxStaticBitmap* firstBmp = nullptr;
        auto row = [&]( const char* label, bool minSize )
        {
            wxStaticBitmap* bmp = new wxStaticBitmap( panel, wxID_ANY, wxNullBitmap );
            fg->Add( bmp, 0, wxALIGN_CENTER_HORIZONTAL | wxALIGN_CENTER_VERTICAL
                                    | wxRIGHT | wxLEFT, 5 );
            wxStaticText* lbl = new wxStaticText( panel, wxID_ANY, label );
            fg->Add( lbl, 0, wxALIGN_CENTER_VERTICAL | wxRIGHT, 5 );
            wxTextCtrl* ctrl = new wxTextCtrl( panel, wxID_ANY );
            if( minSize )
                ctrl->SetMinSize( wxSize( 120, -1 ) );
            fg->Add( ctrl, 0, wxALIGN_CENTER_VERTICAL | wxEXPAND | wxTOP | wxBOTTOM, 5 );
            fg->Add( new wxStaticText( panel, wxID_ANY, "mm" ), 0,
                     wxALIGN_CENTER_VERTICAL | wxLEFT, 5 );
            if( !firstCtrl ) { firstCtrl = ctrl; firstLabel = lbl; firstBmp = bmp; }
        };

        heading( "Copper" );
        row( "Minimum clearance:", false );
        row( "Minimum track width:", true );
        row( "Minimum connection width:", true );
        row( "Minimum annular width:", false );
        row( "Minimum via diameter:", false );
        row( "Copper to hole clearance:", false );
        row( "Copper to edge clearance:", false );
        row( "Minimum groove for creepage:", false );
        heading( "Holes" );
        row( "Minimum drill size:", false );
        row( "Hole to hole clearance:", false );
        heading( "uVias" );
        row( "Minimum uVia diameter:", false );
        row( "Minimum uVia hole:", false );
        heading( "Silk" );
        // The Silk rows have no bitmap: a spacer keeps the column.
        for( const char* s : { "Minimum item clearance:", "Minimum text height:",
                               "Minimum text thickness:" } )
        {
            fg->Add( 0, 0, 1, wxEXPAND, 5 );
            fg->Add( new wxStaticText( panel, wxID_ANY, s ), 0,
                     wxALIGN_CENTER_VERTICAL | wxTOP | wxRIGHT, 5 );
            fg->Add( new wxTextCtrl( panel, wxID_ANY ), 0,
                     wxALIGN_CENTER_VERTICAL | wxEXPAND | wxTOP, 5 );
            fg->Add( new wxStaticText( panel, wxID_ANY, "mm" ), 0,
                     wxALIGN_CENTER_VERTICAL | wxTOP | wxLEFT, 5 );
        }

        sbFeatureConstraints->Add( fg, 1, wxEXPAND, 5 );
        bScrolledSizer->Add( sbFeatureConstraints, 0, wxEXPAND | wxRIGHT, 5 );
        bScrolledSizer->Add( 0, 0, 0, wxEXPAND | wxRIGHT | wxLEFT, 15 );

        // -- sbFeatureRules -------------------------------------------------
        wxBoxSizer* sbFeatureRules = new wxBoxSizer( wxVERTICAL );

        wxBoxSizer* bSizerArcToPoly = new wxBoxSizer( wxVERTICAL );
        bSizerArcToPoly->Add( new wxStaticText( panel, wxID_ANY, "Arc/Circle Approximations" ),
                              0, wxTOP | wxLEFT, 13 );
        bSizerArcToPoly->Add( new wxStaticLine( panel, wxID_ANY, wxDefaultPosition,
                                                wxDefaultSize, wxLI_HORIZONTAL ),
                              0, wxEXPAND | wxTOP | wxBOTTOM, 2 );
        wxFlexGridSizer* fg2 = new wxFlexGridSizer( 0, 4, 3, 0 );
        fg2->AddGrowableCol( 2 );
        fg2->SetFlexibleDirection( wxBOTH );
        fg2->SetNonFlexibleGrowMode( wxFLEX_GROWMODE_SPECIFIED );
        wxStaticText* devLabel = new wxStaticText( panel, wxID_ANY, "Maximum allowed deviation:" );
        fg2->Add( devLabel, 0, wxALIGN_CENTER_VERTICAL | wxALIGN_LEFT | wxLEFT, 5 );
        wxTextCtrl* maxErrorCtrl = new wxTextCtrl( panel, wxID_ANY );
        fg2->Add( maxErrorCtrl, 0, wxALIGN_CENTER_VERTICAL | wxALL | wxEXPAND
                                           | wxLEFT | wxRIGHT, 5 );
        fg2->Add( new wxStaticText( panel, wxID_ANY, "mm" ), 0,
                  wxALIGN_CENTER_VERTICAL | wxRIGHT, 5 );
        bSizerArcToPoly->Add( fg2, 0, wxEXPAND | wxBOTTOM, 5 );
        wxStaticText* warn = new wxStaticText( panel, wxID_ANY,
                                               "Note: zone filling can be slow when < 0.005 mm." );
        bSizerArcToPoly->Add( warn, 0, wxBOTTOM | wxRIGHT | wxLEFT, 5 );
        sbFeatureRules->Add( bSizerArcToPoly, 0, wxEXPAND, 5 );

        wxBoxSizer* fillOpt = new wxBoxSizer( wxVERTICAL );
        fillOpt->Add( new wxStaticText( panel, wxID_ANY, "Zone Fill Strategy" ), 0,
                      wxTOP | wxLEFT, 13 );
        fillOpt->Add( new wxStaticLine( panel, wxID_ANY, wxDefaultPosition, wxDefaultSize,
                                        wxLI_HORIZONTAL ), 0, wxEXPAND | wxTOP | wxBOTTOM, 2 );
        wxBoxSizer* bSizer9 = new wxBoxSizer( wxHORIZONTAL );
        bSizer9->Add( new wxStaticBitmap( panel, wxID_ANY, wxNullBitmap ), 0,
                      wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT, 5 );
        wxCheckBox* fillets = new wxCheckBox( panel, wxID_ANY,
                                              "Allow fillets/chamfers outside zone outline" );
        bSizer9->Add( fillets, 0, wxALL | wxALIGN_CENTER_VERTICAL, 5 );
        fillOpt->Add( bSizer9, 0, wxEXPAND | wxTOP, 7 );
        wxBoxSizer* bSizer111 = new wxBoxSizer( wxHORIZONTAL );
        bSizer111->Add( new wxStaticBitmap( panel, wxID_ANY, wxNullBitmap ), 0,
                        wxRIGHT | wxLEFT | wxALIGN_CENTER_VERTICAL, 5 );
        wxStaticText* spokeLabel = new wxStaticText( panel, wxID_ANY,
                                                     "Minimum thermal relief spoke count:" );
        bSizer111->Add( spokeLabel, 0, wxALIGN_CENTER_VERTICAL | wxLEFT, 5 );
        wxSpinCtrl* spoke = new wxSpinCtrl( panel, wxID_ANY, wxEmptyString, wxDefaultPosition,
                                            wxSize( -1, -1 ), wxSP_ARROW_KEYS, 0, 10, 0 );
        bSizer111->Add( spoke, 0, wxALL | wxALIGN_CENTER_VERTICAL, 5 );
        fillOpt->Add( bSizer111, 1, wxEXPAND | wxTOP | wxBOTTOM, 5 );
        sbFeatureRules->Add( fillOpt, 0, wxEXPAND | wxTOP, 10 );

        wxBoxSizer* bSizer11 = new wxBoxSizer( wxVERTICAL );
        bSizer11->Add( new wxStaticText( panel, wxID_ANY, "Length Tuning" ), 0, wxTOP | wxLEFT, 13 );
        bSizer11->Add( new wxStaticLine( panel, wxID_ANY, wxDefaultPosition, wxDefaultSize,
                                         wxLI_HORIZONTAL ), 0, wxEXPAND | wxTOP | wxBOTTOM, 2 );
        wxCheckBox* stackup = new wxCheckBox(
                panel, wxID_ANY, "Include stackup height in track length calculations" );
        bSizer11->Add( stackup, 0, wxALL, 5 );
        sbFeatureRules->Add( bSizer11, 1, wxEXPAND, 5 );

        bScrolledSizer->Add( sbFeatureRules, 0, wxEXPAND | wxRIGHT, 5 );
        bScrolledSizer->Add( 0, 0, 1, wxEXPAND, 0 );

        panel->SetSizer( bScrolledSizer );
        panel->Layout();
        frame->SetClientSize( bScrolledSizer->GetMinSize() );
        frame->Show();
        panel->Layout();

        wxSize pageMin = bScrolledSizer->GetMinSize();
        printf( "page min size                 %d x %d\n", pageMin.x, pageMin.y );
        printf( "left grid min width           %d\n", fg->GetMinSize().x );
        printf( "rules column min width        %d\n", sbFeatureRules->GetMinSize().x );
        printf( "\ncolumn 0 (bitmap)  x=%d w=%d   \"Copper\" heading sets it\n",
                firstBmp->GetPosition().x, firstBmp->GetSize().x );
        printf( "column 1 (label)   x=%d w=%d\n", firstLabel->GetPosition().x,
                firstLabel->GetSize().x );
        printf( "column 2 (entry)   x=%d w=%d   <- SetMinSize(120,-1)\n",
                firstCtrl->GetPosition().x, firstCtrl->GetSize().x );
        printf( "bare wxTextCtrl best width    %d\n",
                wxTextCtrl( panel, wxID_ANY ).GetBestSize().x );
        printf( "entry height                  %d\n", firstCtrl->GetSize().y );
        printf( "\nrules: deviation label x=%d  entry x=%d w=%d\n", devLabel->GetPosition().x,
                maxErrorCtrl->GetPosition().x, maxErrorCtrl->GetSize().x );
        printf( "spin ctrl          x=%d w=%d h=%d   best=%d\n", spoke->GetPosition().x,
                spoke->GetSize().x, spoke->GetSize().y, spoke->GetBestSize().x );
        printf( "spoke label        x=%d\n", spokeLabel->GetPosition().x );
        printf( "fillets checkbox   x=%d\n", fillets->GetPosition().x );
        printf( "stackup checkbox   x=%d w=%d\n", stackup->GetPosition().x,
                stackup->GetSize().x );
        printf( "rules column start x=%d\n", devLabel->GetPosition().x - 5 - 13 );
        fflush( stdout );
        frame->Destroy();
        return true;
    }
};
wxIMPLEMENT_APP_CONSOLE( App );
