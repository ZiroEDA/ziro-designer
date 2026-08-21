// What does a CHECKED toolbar button actually paint?
//
// Two different widgets in KiCad look like a toolbar button and are drawn by
// different code:
//
//   BITMAP_BUTTON  paints every state itself, as
//                  wxSYS_COLOUR_HIGHLIGHT.ChangeLightness( n ) —
//                  20 pressed, 40 hover, 40 checked, 50 hover+checked
//                  (bitmap_button.cpp:270-310). That is where our
//                  --accent-fill-checked (#5d220d) was measured.
//
//   ACTION_TOOLBAR is a wxAuiToolBar, so its items are drawn by
//                  wxAuiDefaultToolBarArt::DrawButton, which fills a checked
//                  item from ITS OWN highlight colour — a different formula
//                  entirely.
//
// The units control in pl_editor is a toolbar GROUP on the LEFT toolbar
// (`toolbars_pl_editor.cpp:57-60`), and `ACTION_TOOLBAR::AddGroup` makes the
// group item wxITEM_CHECK whenever any action in it is a toggle, then
// registers the SELECTED action's UI condition on it — for millimetresUnits
// that is `Check( cond.Units( MM ) )` (`eda_draw_frame.cpp:1372`), which is
// true whenever the group is showing millimetres. So by the source the item is
// checked at rest, and the question is only what "checked" LOOKS like here.
//
// This draws one normal and one checked item with the AUI art into a memory
// bitmap and reads the pixels back, so the answer is the toolkit's rather than
// an inference from two different widgets' code.
#include <wx/wx.h>
#include <wx/aui/auibar.h>
#include <wx/aui/framemanager.h>
#include <wx/dcmemory.h>
#include <cstdio>

static void sample(const wxImage& img, const char* label, int x, int y)
{
    printf("  %-28s (%3d,%3d)  #%02x%02x%02x\n", label, x, y,
           img.GetRed(x, y), img.GetGreen(x, y), img.GetBlue(x, y));
}

class Probe : public wxApp
{
public:
    bool OnInit() override
    {
        wxFrame* frame = new wxFrame(nullptr, wxID_ANY, "probe", wxDefaultPosition, wxSize(400, 120));

        const wxColour face = wxSystemSettings::GetColour(wxSYS_COLOUR_BTNFACE);
        const wxColour hi   = wxSystemSettings::GetColour(wxSYS_COLOUR_HIGHLIGHT);
        printf("wxSYS_COLOUR_BTNFACE    #%02x%02x%02x\n", face.Red(), face.Green(), face.Blue());
        printf("wxSYS_COLOUR_HIGHLIGHT  #%02x%02x%02x\n", hi.Red(), hi.Green(), hi.Blue());
        // BITMAP_BUTTON's own formula, for comparison with what the AUI art does.
        const wxColour bbChecked = hi.ChangeLightness(40);
        const wxColour bbHover   = hi.ChangeLightness(40);
        const wxColour bbPressed = hi.ChangeLightness(20);
        printf("BITMAP_BUTTON checked   #%02x%02x%02x   (highlight at lightness 40)\n",
               bbChecked.Red(), bbChecked.Green(), bbChecked.Blue());
        printf("BITMAP_BUTTON pressed   #%02x%02x%02x\n",
               bbPressed.Red(), bbPressed.Green(), bbPressed.Blue());
        printf("BITMAP_BUTTON hover     #%02x%02x%02x\n\n",
               bbHover.Red(), bbHover.Green(), bbHover.Blue());

        wxAuiDefaultToolBarArt art;

        // One bitmap per state, cleared to the toolbar face each time, so a
        // previous draw cannot bleed into the next reading. Sharing one
        // bitmap and one item gave "normal" the checked fill, which is plainly
        // not what a toolbar looks like — a probe that reports something
        // impossible is telling you the probe is wrong.
        const struct { const char* label; int state; } states[] = {
            { "normal",  0 },
            { "CHECKED", wxAUI_BUTTON_STATE_CHECKED },
            { "hover",   wxAUI_BUTTON_STATE_HOVER },
            { "pressed", wxAUI_BUTTON_STATE_PRESSED },
            { "hover + CHECKED", wxAUI_BUTTON_STATE_HOVER | wxAUI_BUTTON_STATE_CHECKED },
        };

        printf("wxAuiDefaultToolBarArt::DrawButton, 30x30, sampled mid-button:\n");
        for (const auto& st : states)
        {
            wxBitmap bmp(60, 60);
            wxMemoryDC dc(bmp);
            dc.SetBackground(wxBrush(face));
            dc.Clear();

            wxAuiToolBarItem item;
            item.SetKind(wxITEM_CHECK);
            item.SetState(st.state);

            art.DrawButton(dc, frame, item, wxRect(10, 10, 30, 30));
            dc.SelectObject(wxNullBitmap);

            wxImage img = bmp.ConvertToImage();
            sample(img, st.label, 25, 25);
        }

        frame->Destroy();
        return false;   // nothing to show; exit after printing
    }
};

wxIMPLEMENT_APP(Probe);
