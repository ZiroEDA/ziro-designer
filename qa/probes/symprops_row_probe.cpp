// The real minimum of DIALOG_SYMBOL_PROPERTIES' lower row, built with wx
// instead of computed by hand. bLowerSizer holds three children with
// proportions 4:3:3 (dialog_symbol_properties_base.cpp:195,231,252), and
// wxBoxSizer::CalcMin sizes such a row at
//     max( child_min / proportion ) * total_proportion.
#include <wx/wx.h>
#include <wx/statbox.h>
#include <wx/notebook.h>
#include <wx/grid.h>
#include <wx/gbsizer.h>
#include <vector>
#include <functional>

class App : public wxApp
{
public:
    bool OnInit() override
    {
        wxDialog* dlg = new wxDialog( nullptr, wxID_ANY, "probe" );

        // sbGeneralProps: a wxGridBagSizer( 3, 3 ), NOT a FlexGrid - rows 0, 1,
        // 3, 4 with row 2 left empty at SetEmptyCellSize( -1, 12 ), and
        // AddGrowableCol( 1 ). base.cpp:122-173.
        wxStaticBoxSizer* gen = new wxStaticBoxSizer( wxVERTICAL, dlg, "General" );
        wxGridBagSizer* gb = new wxGridBagSizer( 3, 3 );
        gb->SetFlexibleDirection( wxBOTH );
        gb->SetNonFlexibleGrowMode( wxFLEX_GROWMODE_SPECIFIED );
        gb->SetEmptyCellSize( wxSize( -1, 12 ) );

        // Each label carries its own border flags; only "Body style:" is wxLEFT
        // alone. The choices carry the CONTENTS wx measures them by, which the
        // old probe replaced with one string for all four.
        struct GBRow { int row; const char* label; int labelFlags; int ctrlFlags;
                       std::vector<const char*> items; bool minWidth; };
        const std::vector<GBRow> rows = {
            { 0, "Unit:",       wxALIGN_CENTER_VERTICAL|wxLEFT|wxRIGHT,
                                wxEXPAND|wxRIGHT, {}, true },
            { 1, "Body style:", wxALIGN_CENTER_VERTICAL|wxLEFT,
                                wxEXPAND|wxALIGN_CENTER_VERTICAL|wxRIGHT, {}, false },
            { 3, "Angle:",      wxALIGN_CENTER_VERTICAL|wxLEFT|wxRIGHT,
                                wxALIGN_CENTER_VERTICAL|wxEXPAND|wxRIGHT,
                                { "0", "+90", "-90", "180" }, false },
            { 4, "Mirror:",     wxALIGN_CENTER_VERTICAL|wxLEFT|wxRIGHT,
                                wxEXPAND|wxRIGHT,
                                { "Not mirrored", "Around X axis", "Around Y axis" }, false },
        };
        for( const GBRow& r : rows )
        {
            wxStaticText* t = new wxStaticText( gen->GetStaticBox(), wxID_ANY, r.label );
            t->Wrap( -1 );
            gb->Add( t, wxGBPosition( r.row, 0 ), wxGBSpan( 1, 1 ), r.labelFlags, 5 );
            wxChoice* c = new wxChoice( gen->GetStaticBox(), wxID_ANY );
            for( const char* it : r.items ) c->Append( it );
            c->SetSelection( 0 );
            if( r.minWidth ) c->SetMinSize( wxSize( 100, -1 ) );   // base.cpp:138
            gb->Add( c, wxGBPosition( r.row, 1 ), wxGBSpan( 1, 1 ), r.ctrlFlags, 5 );
        }
        gb->AddGrowableCol( 1 );
        gen->Add( gb, 1, wxEXPAND, 5 );

        // bSizer11: BOTH checkboxes at proportion 1, border 3 - not proportion 0
        // at 5. A proportional row's CalcMin is max( child/prop ) * total_prop,
        // so two equal proportions make this 2 x the WIDER checkbox, which the
        // old probe's proportion 0 turned into a plain sum.  base.cpp:180-190.
        wxBoxSizer* pins = new wxBoxSizer( wxHORIZONTAL );
        pins->Add( new wxCheckBox( gen->GetStaticBox(), wxID_ANY, "Show pin numbers" ), 1, wxALL, 3 );
        pins->Add( new wxCheckBox( gen->GetStaticBox(), wxID_ANY, "Show pin names" ), 1, wxALL, 3 );
        gen->Add( pins, 0, wxEXPAND|wxTOP, 13 );

        // sbAttributes: the five "Exclude from …" checkboxes, each with its own
        // border flags (base.cpp:204-224). Horizontally they are all 5+5 except
        // "Exclude from simulation", which is also 5+5 - so this does not move
        // the width, but it is what the row heights come from.
        wxStaticBoxSizer* att = new wxStaticBoxSizer( wxVERTICAL, dlg, "Attributes" );
        att->Add( new wxCheckBox( att->GetStaticBox(), wxID_ANY, "Exclude from simulation" ),
                  0, wxRIGHT|wxLEFT, 5 );
        att->Add( 0, 10, 0, wxEXPAND, 5 );
        att->Add( new wxCheckBox( att->GetStaticBox(), wxID_ANY, "Exclude from bill of materials" ),
                  0, wxALL, 5 );
        for( const char* l : { "Exclude from board", "Exclude from position files",
                               "Do not populate" } )
            att->Add( new wxCheckBox( att->GetStaticBox(), wxID_ANY, l ),
                      0, wxBOTTOM|wxRIGHT|wxLEFT, 5 );

        // buttonsSizer: the four right-hand buttons.
        wxBoxSizer* btns = new wxBoxSizer( wxVERTICAL );
        btns->Add( new wxButton( dlg, wxID_ANY, "Update Symbol from Library..." ), 0,
                   wxEXPAND|wxBOTTOM|wxRIGHT|wxLEFT, 5 );
        btns->Add( new wxButton( dlg, wxID_ANY, "Change Symbol..." ), 0, wxEXPAND|wxALL, 5 );
        btns->Add( new wxButton( dlg, wxID_ANY, "Edit Symbol..." ), 0, wxEXPAND|wxALL, 5 );
        btns->Add( 0, 20, 0, wxEXPAND, 5 );
        btns->Add( new wxButton( dlg, wxID_ANY, "Edit Library Symbol..." ), 0,
                   wxEXPAND|wxTOP|wxRIGHT|wxLEFT, 5 );

        // bMiddleCol wraps sbAttributes (base.cpp:228-231), so that column pays
        // a 5px left/right border TWICE. The old probe added `att` straight to
        // the row and lost 10px of it.
        wxBoxSizer* mid = new wxBoxSizer( wxVERTICAL );
        mid->Add( att, 1, wxEXPAND|wxRIGHT|wxLEFT, 5 );

        wxBoxSizer* lower = new wxBoxSizer( wxHORIZONTAL );
        lower->Add( gen, 4, wxEXPAND|wxRIGHT|wxLEFT, 5 );
        lower->Add( mid, 3, wxEXPAND|wxRIGHT|wxLEFT, 5 );
        lower->Add( btns, 3, wxEXPAND|wxALL, 5 );
        const int lowerMin = lower->CalcMin().x;

        // Everything above sits on the notebook's General page, and the whole
        // notebook sits in mainSizer with the Library-link row beneath it.
        //     generalPageSizer->Add( sbFields,    1, wxEXPAND|wxBOTTOM|wxRIGHT|wxLEFT, 5 );  :117
        //     generalPageSizer->Add( bLowerSizer, 0, wxEXPAND|wxTOP|wxBOTTOM,          5 );  :255
        //     mainSizer->Add( m_notebook1,  1, wxEXPAND|wxALL,  10 );                        :314
        //     mainSizer->Add( bSizerBottom, 0, wxEXPAND|wxLEFT, 12 );                        :342
        wxNotebook* nb = new wxNotebook( dlg, wxID_ANY );
        wxPanel* page = new wxPanel( nb );
        wxBoxSizer* pageSizer = new wxBoxSizer( wxVERTICAL );

        wxStaticBoxSizer* sbFields = new wxStaticBoxSizer( wxVERTICAL, page, "Fields" );
        wxGrid* grid = new wxGrid( sbFields->GetStaticBox(), wxID_ANY );
        grid->CreateGrid( 4, 8 );
        const int colw[8] = { 72, 10, 48, 84, 66, 66, 48, 48 };   // base.cpp:40-47, shown 0..7
        for( int i = 0; i < 8; ++i ) grid->SetColSize( i, colw[i] );
        grid->HideRowLabels();
        grid->SetMinSize( wxSize( -1, 160 ) );                     // dialog_symbol_properties.cpp:342
        sbFields->Add( grid, 1, wxEXPAND|wxBOTTOM|wxRIGHT|wxLEFT, 5 );
        pageSizer->Add( sbFields, 1, wxEXPAND|wxBOTTOM|wxRIGHT|wxLEFT, 5 );

        // reparent the lower row onto the page
        for( wxWindow* w : { (wxWindow*) gen->GetStaticBox(), (wxWindow*) att->GetStaticBox() } )
            w->Reparent( page );
        for( wxSizerItem* it : btns->GetChildren() )
            if( it->GetWindow() ) it->GetWindow()->Reparent( page );
        pageSizer->Add( lower, 0, wxEXPAND|wxTOP|wxBOTTOM, 5 );
        page->SetSizer( pageSizer );
        nb->AddPage( page, "General", true );

        // The SECOND page. A wxNotebook's best size is the max over its pages,
        // so this counts even though it is not the visible tab.
        //     m_pinGrid = new WX_GRID( m_pinTablePage, ... );          base.cpp:269
        //     bMargins->Add( m_pinGrid, 1, wxEXPAND|wxALL|wxFIXED_MINSIZE, 5 );  :303
        //     SetColSize 0..4 = 160,160,160,140,140                    base.cpp:49-53
        wxPanel* pinPage = new wxPanel( nb );
        wxBoxSizer* bMargins = new wxBoxSizer( wxVERTICAL );
        wxGrid* pinGrid = new wxGrid( pinPage, wxID_ANY );
        pinGrid->CreateGrid( 4, 5 );
        const int pinw[5] = { 160, 160, 160, 140, 140 };
        for( int i = 0; i < 5; ++i ) pinGrid->SetColSize( i, pinw[i] );
        pinGrid->HideRowLabels();
        bMargins->Add( pinGrid, 1, wxEXPAND|wxALL|wxFIXED_MINSIZE, 5 );
        pinPage->SetSizer( bMargins );
        nb->AddPage( pinPage, "Pin Functions", false );

        // The THIRD page, present whenever the symbol has embedded files
        // (dialog_symbol_properties.cpp:347-351). PANEL_EMBEDDED_FILES' grid is
        // two columns, 100 + 180 (panel_embedded_files_base.cpp:32-33), so it
        // is the narrowest page of the three and cannot be what sets the width.
        wxPanel* embPage = new wxPanel( nb );
        wxBoxSizer* embSizer = new wxBoxSizer( wxVERTICAL );
        wxGrid* embGrid = new wxGrid( embPage, wxID_ANY );
        embGrid->CreateGrid( 1, 2 );
        embGrid->SetColSize( 0, 100 );
        embGrid->SetColSize( 1, 180 );
        embGrid->HideRowLabels();
        embSizer->Add( embGrid, 1, wxEXPAND|wxALL, 5 );
        embPage->SetSizer( embSizer );
        nb->AddPage( embPage, "Embedded Files", false );
        wxPrintf( "%-26s %d\n", "emb grid best width", embGrid->GetBestSize().x );
        wxPrintf( "%-26s %d\n", "emb page CalcMin", embSizer->CalcMin().x );
        wxPrintf( "%-26s %d\n", "pin grid best width", pinGrid->GetBestSize().x );
        wxPrintf( "%-26s %d\n", "pin page CalcMin", bMargins->CalcMin().x );

        wxBoxSizer* mainSizer = new wxBoxSizer( wxVERTICAL );
        mainSizer->Add( nb, 1, wxEXPAND|wxALL, 10 );

        wxBoxSizer* bottom = new wxBoxSizer( wxHORIZONTAL );
        wxFont small = dlg->GetFont();
        small.SetFractionalPointSize( small.GetFractionalPointSize() - 2 );
        wxStaticText* llbl = new wxStaticText( dlg, wxID_ANY, "Library link:" );
        wxTextCtrl* lid = new wxTextCtrl( dlg, wxID_ANY, "", wxDefaultPosition, wxDefaultSize,
                                          wxTE_READONLY|wxBORDER_NONE );
        llbl->SetFont( small ); lid->SetFont( small );
        bottom->Add( llbl, 0, wxALIGN_CENTER_VERTICAL|wxBOTTOM|wxTOP, 2 );
        bottom->Add( lid, 1, wxALIGN_CENTER_VERTICAL|wxALL, 5 );
        bottom->Add( 10, 0, 0, wxALIGN_CENTER_VERTICAL, 5 );
        bottom->Add( new wxButton( dlg, wxID_ANY, "Simulation Model..." ), 0,
                     wxALIGN_CENTER_VERTICAL|wxRIGHT|wxLEFT, 15 );
        wxStdDialogButtonSizer* sdb = new wxStdDialogButtonSizer();
        sdb->AddButton( new wxButton( dlg, wxID_OK ) );
        sdb->AddButton( new wxButton( dlg, wxID_CANCEL ) );
        sdb->Realize();
        bottom->Add( sdb, 0, wxALIGN_CENTER_VERTICAL|wxALL, 5 );
        mainSizer->Add( bottom, 0, wxEXPAND|wxLEFT, 12 );

        dlg->SetSizer( mainSizer );
        mainSizer->Fit( dlg );
        dlg->Show();
        while( Pending() ) Dispatch();

        wxPrintf( "%-26s %d\n", "General  min (prop 4)", gen->CalcMin().x );
        wxPrintf( "%-26s %d\n", "Attributes min (prop 3)", att->CalcMin().x );
        wxPrintf( "%-26s %d\n", "Buttons  min (prop 3)", btns->CalcMin().x );
        wxPrintf( "%-26s %d\n", "MiddleCol min (prop 3)", mid->CalcMin().x );
        wxPrintf( "%-26s %d\n", "bLowerSizer CalcMin", lowerMin );
        wxPrintf( "%-26s %.1f\n", "  gen/4", ( gen->CalcMin().x + 10 ) / 4.0 );
        wxPrintf( "%-26s %.1f\n", "  mid/3", ( mid->CalcMin().x + 10 ) / 3.0 );
        wxPrintf( "%-26s %.1f\n", "  btns/3", ( btns->CalcMin().x + 10 ) / 3.0 );
        wxPrintf( "%-26s %d\n", "grid best width", grid->GetBestSize().x );
        wxPrintf( "%-26s %d\n", "page CalcMin", pageSizer->CalcMin().x );
        wxPrintf( "%-26s %d\n", "notebook best", nb->GetBestSize().x );
        wxPrintf( "%-26s %d\n", "bottom row CalcMin", bottom->CalcMin().x );
        wxPrintf( "%-26s %d\n", "mainSizer CalcMin", mainSizer->CalcMin().x );
        wxPrintf( "%-26s %d\n", "dialog after Fit", dlg->GetSize().x );

        // Per-control minimums, so a gap against the live dialog can be
        // localised to a widget instead of guessed at from the total.
        dlg->Layout();
        wxPrintf( "\n-- allocated after Fit --\n" );
        wxPrintf( "%-26s %d\n", "General box", gen->GetStaticBox()->GetSize().x );
        wxPrintf( "%-26s %d\n", "Attributes box", att->GetStaticBox()->GetSize().x );
        std::function<void( wxWindow*, int )> dump =
            [&]( wxWindow* w, int depth )
            {
                wxString kind = w->GetClassInfo()->GetClassName();
                if( kind == "wxCheckBox" || kind == "wxButton" || kind == "wxChoice"
                    || kind == "wxStaticText" )
                {
                    wxPrintf( "%-30s best %4d  alloc %4d  \"%s\"\n", kind,
                              w->GetBestSize().x, w->GetSize().x, w->GetLabel() );
                }
                for( wxWindow* c : w->GetChildren() ) dump( c, depth + 1 );
            };
        dump( page, 0 );
        dlg->Destroy();
        return false;
    }
};
wxIMPLEMENT_APP_NO_MAIN( App );
int main( int argc, char** argv ) { wxEntryStart( argc, argv ); wxTheApp->CallOnInit(); return 0; }
