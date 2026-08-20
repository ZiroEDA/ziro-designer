// Ask a LIVE wxWidgets window what COLOR_SWATCH's dialog units convert to.
//
// The open question was never the arithmetic, it was whether wxGTK's
// GetCharWidth()/GetCharHeight() return the Pango numbers the hand calculation
// assumed. This does not model that — it asks the toolkit, on this machine,
// with this theme and this font, exactly as COLOR_SWATCH does at
// common/widgets/color_swatch.cpp:166-172.
#include <wx/wx.h>
#include <cstdio>

static const wxSize SWATCH_SIZE_SMALL_DU(8, 6);     // color_swatch.h:46
static const wxSize SWATCH_SIZE_MEDIUM_DU(24, 10);  // :47
static const wxSize SWATCH_SIZE_LARGE_DU(24, 16);   // :48
static const wxSize CHECKERBOARD_SIZE_DU(3, 3);     // :49

class Probe : public wxApp
{
public:
    bool OnInit() override
    {
        wxFrame* frame = new wxFrame(nullptr, wxID_ANY, "probe");
        // COLOR_SWATCH is a wxPanel, so measure on a wxPanel.
        wxPanel* panel = new wxPanel(frame);

        const wxFont f = panel->GetFont();
        printf("font desc        : %s\n", (const char*) f.GetNativeFontInfoUserDesc().mb_str());
        printf("font point size  : %d\n", f.GetPointSize());
        printf("GetCharWidth()   : %d\n", panel->GetCharWidth());
        printf("GetCharHeight()  : %d\n", panel->GetCharHeight());
        printf("contentScale     : %.3f\n", (double) panel->GetContentScaleFactor());
        printf("DPI              : %d x %d\n", panel->GetDPI().x, panel->GetDPI().y);
        printf("\nConvertDialogToPixels, as color_swatch.cpp:166-172 calls it:\n");

        struct { const char* name; wxSize du; } rows[] = {
            { "SWATCH_SMALL       (8,6) ", SWATCH_SIZE_SMALL_DU  },
            { "SWATCH_MEDIUM     (24,10)", SWATCH_SIZE_MEDIUM_DU },
            { "SWATCH_LARGE      (24,16)", SWATCH_SIZE_LARGE_DU  },
            { "CHECKERBOARD       (3,3) ", CHECKERBOARD_SIZE_DU  },
        };
        for (const auto& r : rows)
        {
            const wxSize px = panel->ConvertDialogToPixels(r.du);
            printf("  %s -> %d x %d\n", r.name, px.x, px.y);
        }

        // The formula wx documents, recomputed from the same two numbers, so a
        // disagreement between these two lines would mean wx is not using it.
        const int cw = panel->GetCharWidth(), ch = panel->GetCharHeight();
        printf("\nhand-check  x = du*charW/4, y = du*charH/8  (charW=%d charH=%d):\n", cw, ch);
        for (const auto& r : rows)
            printf("  %s -> %d x %d\n", r.name, r.du.x * cw / 4, r.du.y * ch / 8);

        printf("\n[done]\n");
        fflush(stdout);
        frame->Destroy();
        return false;   // no main loop; OnInit false exits cleanly
    }
};

wxIMPLEMENT_APP_NO_MAIN(Probe);

int main(int argc, char** argv)
{
    wxEntryStart(argc, argv);
    wxTheApp->CallOnInit();
    wxEntryCleanup();
    return 0;
}
