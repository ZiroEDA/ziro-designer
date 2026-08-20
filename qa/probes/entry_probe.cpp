// What colour does a REAL wxTextCtrl paint its interior?
//
// shell.css:274-278 says Yaru declares #272727 for a bare GtkEntry but picks
// #282828 because "wx renders one level lighter and the sampled value is what
// the user sees". A python-gi reading of a bare GtkEntry cannot test that claim
// — it measures the toolkit, not wx. This builds the widget wx builds and asks
// THAT widget's GTK style context, plus renders it to a surface and reads the
// pixel, which is what a screenshot would have captured.
#include <wx/wx.h>
#include <wx/textctrl.h>
#include <gtk/gtk.h>
#include <cstdio>

static void dump_ctx(const char* label, GtkWidget* w, GtkStateFlags state)
{
    GtkStyleContext* ctx = gtk_widget_get_style_context(w);
    gtk_style_context_save(ctx);
    gtk_style_context_set_state(ctx, state);
    GdkRGBA bg, fg;
    gtk_style_context_get_background_color(ctx, state, &bg);
    gtk_style_context_get_color(ctx, state, &fg);
    printf("  %-22s bg #%02x%02x%02x (alpha %.2f)   fg #%02x%02x%02x\n", label,
           (int)(bg.red * 255 + .5), (int)(bg.green * 255 + .5), (int)(bg.blue * 255 + .5),
           bg.alpha,
           (int)(fg.red * 255 + .5), (int)(fg.green * 255 + .5), (int)(fg.blue * 255 + .5));
    gtk_style_context_restore(ctx);
}

// Paint the widget into an image surface and read a pixel well inside it.
static void dump_rendered(const char* label, GtkWidget* w, int px, int py)
{
    GtkAllocation a;
    gtk_widget_get_allocation(w, &a);
    if (a.width < 4 || a.height < 4) { printf("  %-22s (not allocated: %dx%d)\n", label, a.width, a.height); return; }
    cairo_surface_t* surf = cairo_image_surface_create(CAIRO_FORMAT_ARGB32, a.width, a.height);
    cairo_t* cr = cairo_create(surf);
    gtk_widget_draw(w, cr);
    cairo_destroy(cr);
    cairo_surface_flush(surf);
    unsigned char* data = cairo_image_surface_get_data(surf);
    int stride = cairo_image_surface_get_stride(surf);
    if (px >= a.width) px = a.width / 2;
    if (py >= a.height) py = a.height / 2;
    unsigned char* p = data + py * stride + px * 4;      // BGRA, premultiplied
    printf("  %-22s rendered pixel at (%d,%d) of %dx%d -> #%02x%02x%02x (alpha %02x)\n",
           label, px, py, a.width, a.height, p[2], p[1], p[0], p[3]);
    cairo_surface_destroy(surf);
}

class Probe : public wxApp
{
public:
    bool OnInit() override
    {
        wxFrame* frame = new wxFrame(nullptr, wxID_ANY, "entry probe", wxDefaultPosition, wxSize(400, 300));
        wxPanel* panel = new wxPanel(frame);
        wxTextCtrl* normal   = new wxTextCtrl(panel, wxID_ANY, "normal",   wxPoint(10, 10),  wxSize(200, -1));
        wxTextCtrl* readonly = new wxTextCtrl(panel, wxID_ANY, "readonly", wxPoint(10, 50),  wxSize(200, -1), wxTE_READONLY);
        wxTextCtrl* disabled = new wxTextCtrl(panel, wxID_ANY, "disabled", wxPoint(10, 90),  wxSize(200, -1));
        disabled->Enable(false);
        frame->Show();
        // Let GTK realise, allocate and style everything.
        for (int i = 0; i < 200; ++i) { while (gtk_events_pending()) gtk_main_iteration(); }

        printf("panel font       : %s\n\n", (const char*) panel->GetFont().GetNativeFontInfoUserDesc().mb_str());

        printf("wxWidgets' own view (GetBackgroundColour):\n");
        auto wxbg = [](const char* n, wxWindow* w) {
            wxColour c = w->GetBackgroundColour();
            printf("  %-22s %s  (ok=%d)\n", n, (const char*) c.GetAsString(wxC2S_HTML_SYNTAX).mb_str(), c.IsOk());
        };
        wxbg("wxTextCtrl normal",   normal);
        wxbg("wxTextCtrl readonly", readonly);
        wxbg("wxTextCtrl disabled", disabled);
        wxbg("parent wxPanel",      panel);

        printf("\nGTK style context of the widget wx actually created:\n");
        dump_ctx("entry normal",   (GtkWidget*) normal->GetHandle(),   GTK_STATE_FLAG_NORMAL);
        dump_ctx("entry readonly", (GtkWidget*) readonly->GetHandle(), GTK_STATE_FLAG_NORMAL);
        dump_ctx("entry disabled", (GtkWidget*) disabled->GetHandle(), GTK_STATE_FLAG_INSENSITIVE);

        printf("\nWhat is actually PAINTED (widget rendered to a surface):\n");
        dump_rendered("entry normal",   (GtkWidget*) normal->GetHandle(),   100, 16);
        dump_rendered("entry readonly", (GtkWidget*) readonly->GetHandle(), 100, 16);
        dump_rendered("entry disabled", (GtkWidget*) disabled->GetHandle(), 100, 16);

        printf("\n[done]\n");
        fflush(stdout);
        frame->Destroy();
        return false;
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
