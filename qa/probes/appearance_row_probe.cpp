// How tall is an APPEARANCE_CONTROLS object row, and how big is its slider?
//
// The Objects page builds one row per object type and, for the six that carry
// an opacity control, adds a `wxSlider`
// (`pcbnew/widgets/appearance_controls.cpp`, createControls / rebuildObjects).
// A wxPanel row is as tall as its tallest child, so the row height is the
// slider's - not a number anybody wrote. Same question for the wxNotebook the
// three pages live in: its tab strip is GTK's, not ours.
//
// Ask the widgets.
#include <wx/wx.h>
#include <wx/slider.h>
#include <wx/notebook.h>
#include <cstdio>

static void report( const char* label, wxWindow* w )
{
    const wxSize best = w->GetBestSize();
    const wxSize size = w->GetSize();
    printf( "  %-30s best %3d x %-3d   size %3d x %d\n", label, best.x, best.y, size.x, size.y );
}

class Probe : public wxApp
{
public:
    bool OnInit() override
    {
        wxFrame* frame = new wxFrame( nullptr, wxID_ANY, "appearance row probe",
                                      wxDefaultPosition, wxSize( 400, 500 ) );
        wxPanel* panel = new wxPanel( frame );

        printf( "font: %s\n\n", panel->GetFont().GetNativeFontInfoUserDesc().mb_str().data() );

        // The opacity slider, as APPEARANCE_CONTROLS builds it: 0..100, no
        // labels, horizontal.
        wxSlider* slider = new wxSlider( panel, wxID_ANY, 100, 0, 100, wxDefaultPosition,
                                         wxDefaultSize, wxSL_HORIZONTAL );
        report( "opacity wxSlider", slider );

        // A wxStaticText row label, for the rows that carry no slider.
        wxStaticText* label = new wxStaticText( panel, wxID_ANY, "Footprints Front" );
        report( "row label (wxStaticText)", label );

        wxCheckBox* check = new wxCheckBox( panel, wxID_ANY, wxEmptyString );
        report( "wxCheckBox", check );

        wxTextCtrl* entry = new wxTextCtrl( panel, wxID_ANY, wxEmptyString );
        report( "wxTextCtrl (the --ctl-height)", entry );

        wxNotebook* book = new wxNotebook( panel, wxID_ANY );
        wxPanel*    p1 = new wxPanel( book );
        wxPanel*    p2 = new wxPanel( book );
        wxPanel*    p3 = new wxPanel( book );
        book->AddPage( p1, "Layers", true );
        book->AddPage( p2, "Objects", false );
        book->AddPage( p3, "Nets", false );
        book->SetSize( 250, 400 );
        report( "wxNotebook", book );

        frame->Show();
        CallAfter( [=]() {
            printf( "\nafter layout:\n" );
            report( "opacity wxSlider", slider );
            report( "wxNotebook", book );
            // The tab strip is the gap between the book's client origin and
            // the page's, which is what a CSS tab-strip height has to be.
            const wxPoint pageOrigin = p1->GetPosition();
            const wxSize  pageSize = p1->GetSize();
            printf( "  page 1 at (%d, %d) size %d x %d inside a %d x %d book\n",
                    pageOrigin.x, pageOrigin.y, pageSize.x, pageSize.y,
                    book->GetSize().x, book->GetSize().y );
            printf( "  -> tab strip + frame above the page: %d px\n", pageOrigin.y );
            ExitMainLoop();
        } );
        return true;
    }
};

wxIMPLEMENT_APP( Probe );
