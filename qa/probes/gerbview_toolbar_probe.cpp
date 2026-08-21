// How wide are GerbView's two TOP_MAIN controls when nothing is loaded?
//
// `GERBVIEW_FRAME::configureToolbars` (gerbview/toolbars_gerber.cpp:131-171)
// builds both with wxDefaultSize and no content:
//
//     m_SelLayerBox = new GBR_LAYER_BOX_SELECTOR( toolbar, id, wxDefaultPosition,
//                                                 wxDefaultSize, 0, nullptr );
//     m_TextInfo    = new wxTextCtrl( toolbar, id, wxEmptyString,
//                                     wxDefaultPosition, wxDefaultSize, wxTE_READONLY );
//
// So neither width is a number anybody wrote — they are wx's defaults for an
// empty control, and the question is what wx actually answers on this machine.
//
// This matters because a python-gi reading of a BARE GtkComboBox says 36 px,
// a chevron and nothing else, and a screenshot of the real GerbView shows a
// box roughly three times that. wxBitmapComboBox is not a bare GtkComboBox:
// it is wx's wrapper, and wx supplies its own best size. That gap is exactly
// what a toolkit probe is for.
//
// The text box also GROWS: KIUI::EnsureTextCtrlWidth (common/widgets/ui_common.cpp:174)
// widens it to text + 10 px whenever the string does not fit, and never
// shrinks it back. So its default is a FLOOR, not a fixed width.
#include <wx/wx.h>
#include <wx/bmpcbox.h>
#include <wx/textctrl.h>
#include <cstdio>

static void report(const char* label, wxWindow* w)
{
    const wxSize best = w->GetBestSize();
    const wxSize size = w->GetSize();
    const wxSize min  = w->GetMinSize();
    printf("  %-26s best %3d x %-3d   size %3d x %-3d   min %3d x %d\n",
           label, best.x, best.y, size.x, size.y, min.x, min.y);
}

class Probe : public wxApp
{
public:
    bool OnInit() override
    {
        wxFrame* frame = new wxFrame(nullptr, wxID_ANY, "probe", wxDefaultPosition, wxSize(900, 200));
        wxPanel* panel = new wxPanel(frame);

        printf("font: %s\n", panel->GetFont().GetNativeFontInfoUserDesc().mb_str().data());
        printf("GetCharWidth() = %d   GetCharHeight() = %d\n\n",
               panel->GetCharWidth(), panel->GetCharHeight());

        // The layer selector, exactly as gerbview builds it: empty, default size.
        wxBitmapComboBox* empty = new wxBitmapComboBox(panel, wxID_ANY, wxEmptyString,
                                                       wxDefaultPosition, wxDefaultSize,
                                                       0, nullptr, wxCB_READONLY);
        report("layer selector, empty", empty);

        // And with one row, to show what Resync() does once a file is loaded.
        wxBitmapComboBox* filled = new wxBitmapComboBox(panel, wxID_ANY, wxEmptyString,
                                                        wxDefaultPosition, wxDefaultSize,
                                                        0, nullptr, wxCB_READONLY);
        filled->Append("Graphic layer 1");
        report("layer selector, one row", filled);

        // The info box, empty and read-only, as at startup.
        wxTextCtrl* info = new wxTextCtrl(panel, wxID_ANY, wxEmptyString,
                                          wxDefaultPosition, wxDefaultSize, wxTE_READONLY);
        report("text info, empty", info);

        // What EnsureTextCtrlWidth would widen it to for the string GerbView
        // puts there once a layer is active.
        const wxString msg = "Drawing layer not in use";
        wxSize textz = info->GetTextExtent(msg);
        printf("\n  \"%s\"\n", msg.mb_str().data());
        printf("  text extent %d x %d  ->  EnsureTextCtrlWidth would set width %d (text + 10)\n",
               textz.x, textz.y, textz.x + 10);

        frame->Show();
        // One idle round so sizers have run, then read the laid-out sizes.
        CallAfter([=]() {
            printf("\nafter layout:\n");
            report("layer selector, empty", empty);
            report("text info, empty", info);
            ExitMainLoop();
        });
        return true;
    }
};

wxIMPLEMENT_APP(Probe);
