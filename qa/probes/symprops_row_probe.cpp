// The real minimum of DIALOG_SYMBOL_PROPERTIES' lower row, built with wx
// instead of computed by hand. bLowerSizer holds three children with
// proportions 4:3:3 (dialog_symbol_properties_base.cpp:195,231,252), and
// wxBoxSizer::CalcMin sizes such a row at
//     max( child_min / proportion ) * total_proportion.
#include <wx/wx.h>
#include <wx/statbox.h>
#include <wx/notebook.h>
#include <wx/grid.h>

class App : public wxApp
{
public:
    bool OnInit() override
    {
        wxDialog* dlg = new wxDialog( nullptr, wxID_ANY, "probe" );

        // sbGeneralProps: Unit / Body style / Angle / Mirror + two checkboxes.
        wxStaticBoxSizer* gen = new wxStaticBoxSizer( wxVERTICAL, dlg, "General" );
        wxFlexGridSizer* fg = new wxFlexGridSizer( 4, 2, 0, 0 );
        for( const char* l : { "Unit:", "Body style:", "Angle:", "Mirror:" } )
        {
            fg->Add( new wxStaticText( gen->GetStaticBox(), wxID_ANY, l ), 0, wxALL, 5 );
            wxChoice* c = new wxChoice( gen->GetStaticBox(), wxID_ANY );
            c->Append( "Not mirrored" );
            c->SetMinSize( wxSize( 100, -1 ) );   // base.cpp:138
            fg->Add( c, 0, wxALL, 5 );
        }
        gen->Add( fg, 1, wxEXPAND, 5 );
        wxBoxSizer* pins = new wxBoxSizer( wxHORIZONTAL );
        pins->Add( new wxCheckBox( gen->GetStaticBox(), wxID_ANY, "Show pin numbers" ), 0, wxALL, 5 );
        pins->Add( new wxCheckBox( gen->GetStaticBox(), wxID_ANY, "Show pin names" ), 0, wxALL, 5 );
        gen->Add( pins, 0, wxEXPAND|wxTOP, 13 );

        // sbAttributes: the five "Exclude from …" checkboxes.
        wxStaticBoxSizer* att = new wxStaticBoxSizer( wxVERTICAL, dlg, "Attributes" );
        for( const char* l : { "Exclude from simulation", "Exclude from bill of materials",
                               "Exclude from board", "Exclude from position files",
                               "Do not populate" } )
            att->Add( new wxCheckBox( att->GetStaticBox(), wxID_ANY, l ), 0, wxALL, 5 );

        // buttonsSizer: the four right-hand buttons.
        wxBoxSizer* btns = new wxBoxSizer( wxVERTICAL );
        for( const char* l : { "Update Symbol from Library...", "Change Symbol...",
                               "Edit Symbol...", "Edit Library Symbol..." } )
            btns->Add( new wxButton( dlg, wxID_ANY, l ), 0, wxEXPAND|wxALL, 5 );

        wxBoxSizer* lower = new wxBoxSizer( wxHORIZONTAL );
        lower->Add( gen, 4, wxEXPAND|wxRIGHT|wxLEFT, 5 );
        lower->Add( att, 3, wxEXPAND|wxRIGHT|wxLEFT, 5 );
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
        wxPrintf( "%-26s %d\n", "bLowerSizer CalcMin", lowerMin );
        wxPrintf( "%-26s %d\n", "grid best width", grid->GetBestSize().x );
        wxPrintf( "%-26s %d\n", "page CalcMin", pageSizer->CalcMin().x );
        wxPrintf( "%-26s %d\n", "notebook best", nb->GetBestSize().x );
        wxPrintf( "%-26s %d\n", "bottom row CalcMin", bottom->CalcMin().x );
        wxPrintf( "%-26s %d\n", "mainSizer CalcMin", mainSizer->CalcMin().x );
        wxPrintf( "%-26s %d\n", "dialog after Fit", dlg->GetSize().x );
        dlg->Destroy();
        return false;
    }
};
wxIMPLEMENT_APP_NO_MAIN( App );
int main( int argc, char** argv ) { wxEntryStart( argc, argv ); wxTheApp->CallOnInit(); return 0; }
