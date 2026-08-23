// Where does a REAL wxSlider put its three labels, and how big is its trough?
//
// The colour picker builds two of them with exactly these bits:
//
//   wxSL_INVERSE | wxSL_LABELS | wxSL_LEFT | wxSL_VERTICAL
//   (dialog_color_picker_base.cpp:124 and :173)
//
// wxSL_LABELS is documented as "displays minimum, maximum and value labels",
// but nothing in the docs says WHERE, and wxSL_LEFT is documented for the
// value label only. Reading the flag names got it wrong once already - the
// labels went to the left of the scale and the value ended up under the thumb.
//
// This builds that slider, lays it out, and prints the allocation of every GTK
// widget wx made for it, so the three labels can be placed from measurements
// rather than from the names of the style bits. It also asks the scale's own
// style context for the trough and slider node sizes and colours, which is
// where --slider-track-height / --slider-thumb-size / --slider-track-bg come
// from.
//
// Build and run: see qa/probes/README.md. `env -i` is not optional.
#include <wx/wx.h>
#include <wx/slider.h>
#include <gtk/gtk.h>
#include <cstdio>

static const char* posName(GtkPositionType p)
{
    switch (p)
    {
    case GTK_POS_LEFT:   return "LEFT";
    case GTK_POS_RIGHT:  return "RIGHT";
    case GTK_POS_TOP:    return "TOP";
    case GTK_POS_BOTTOM: return "BOTTOM";
    }
    return "?";
}

static void dumpTree(GtkWidget* w, int depth)
{
    GtkAllocation a;
    gtk_widget_get_allocation(w, &a);

    const char* type = G_OBJECT_TYPE_NAME(w);
    const char* orient = "";

    if (GTK_IS_ORIENTABLE(w))
        orient = gtk_orientable_get_orientation(GTK_ORIENTABLE(w)) == GTK_ORIENTATION_VERTICAL
                         ? "[vert]"
                         : "[horz]";
    const char* text = GTK_IS_LABEL(w) ? gtk_label_get_text(GTK_LABEL(w)) : "";

    printf("%*s%-16s x=%-5d y=%-5d w=%-4d h=%-4d %-7s %s\n", depth * 2, "", type,
           a.x, a.y, a.width, a.height, orient, text);

    if (GTK_IS_CONTAINER(w))
    {
        GList* kids = gtk_container_get_children(GTK_CONTAINER(w));
        for (GList* k = kids; k; k = k->next)
            dumpTree(GTK_WIDGET(k->data), depth + 1);
        g_list_free(kids);
    }
}

// The trough and the slider are CSS nodes under the scale, not widgets, so they
// have no allocation of their own. gtk_style_context_get_* on a sub-path is how
// GTK itself sizes them.
static void dumpNode(GtkWidget* scale, const char* nodeName)
{
    GtkWidgetPath* path = gtk_widget_path_copy(gtk_widget_get_path(scale));
    gtk_widget_path_append_type(path, G_TYPE_NONE);
    gtk_widget_path_iter_set_object_name(path, -1, nodeName);

    GtkStyleContext* ctx = gtk_style_context_new();
    gtk_style_context_set_path(ctx, path);
    gtk_style_context_set_parent(ctx, gtk_widget_get_style_context(scale));

    gint minw = 0, minh = 0;
    gtk_style_context_get(ctx, GTK_STATE_FLAG_NORMAL, "min-width", &minw, "min-height", &minh,
                          NULL);

    GdkRGBA bg;
    gtk_style_context_get_background_color(ctx, GTK_STATE_FLAG_NORMAL, &bg);

    GtkBorder margin;
    gtk_style_context_get_margin(ctx, GTK_STATE_FLAG_NORMAL, &margin);

    printf("  node %-10s min-width=%-3d min-height=%-3d  bg #%02x%02x%02x a=%.2f  "
           "margin l%d r%d t%d b%d\n",
           nodeName, minw, minh, (int) (bg.red * 255 + .5), (int) (bg.green * 255 + .5),
           (int) (bg.blue * 255 + .5), bg.alpha, margin.left, margin.right, margin.top,
           margin.bottom);

    g_object_unref(ctx);
    gtk_widget_path_unref(path);
}


// The trough's thickness and the thumb's diameter as PAINTED. The style context
// reports the trough as 0 because Yaru sets no min-size on it - GTK derives it
// from the slider node's own min-size plus that node's negative margins - so the
// only honest reading is the rendered pixel.
static void dumpPainted(GtkWidget* widget, int w, int h, bool vertical)
{
    cairo_surface_t* surf = cairo_image_surface_create(CAIRO_FORMAT_ARGB32, w, h);
    cairo_t*         cr = cairo_create(surf);

    gtk_widget_draw(widget, cr);
    cairo_destroy(cr);
    cairo_surface_flush(surf);

    unsigned char* data = cairo_image_surface_get_data(surf);
    int            stride = cairo_image_surface_get_stride(surf);

    // Scan the line across the middle of the scale, perpendicular to the track.
    int len = vertical ? w : h;
    int fixed = vertical ? h / 2 : w / 2;

    int troughRun = 0, thumbRun = 0;
    int troughStart = -1, thumbStart = -1;

    for (int i = 0; i < len; ++i)
    {
        int            x = vertical ? i : fixed;
        int            y = vertical ? fixed : i;
        unsigned char* px = data + y * stride + x * 4;
        int            b = px[0], g = px[1], r = px[2];

        bool isTrough = (abs(r - 0x4b) < 12 && abs(g - 0x4b) < 12 && abs(b - 0x4b) < 12);
        bool isAccent = (abs(r - 0xe9) < 20 && abs(g - 0x54) < 24 && abs(b - 0x20) < 24);
        bool isThumb = (r > 0xf0 && g > 0xf0 && b > 0xf0);

        if (isTrough || isAccent)
        {
            if (troughStart < 0)
                troughStart = i;

            troughRun++;
        }

        if (isThumb)
        {
            if (thumbStart < 0)
                thumbStart = i;

            thumbRun++;
        }
    }

    printf("  painted %-10s trough/highlight run = %d px (from %d)   thumb run = %d px (from %d)\n",
           vertical ? "[vertical]" : "[horizontal]", troughRun, troughStart, thumbRun, thumbStart);

    cairo_surface_destroy(surf);
}

class App : public wxApp
{
public:
    bool OnInit() override
    {
        wxFrame* f = new wxFrame(nullptr, wxID_ANY, "slider probe", wxDefaultPosition,
                                 wxSize(400, 420));

        // The colour picker's Value slider, bit for bit.
        wxSlider* s = new wxSlider(f, wxID_ANY, 255, 0, 255, wxDefaultPosition, wxDefaultSize,
                                   wxSL_INVERSE | wxSL_LABELS | wxSL_LEFT | wxSL_VERTICAL);

        wxBoxSizer* sizer = new wxBoxSizer(wxVERTICAL);
        sizer->Add(s, 1, wxALIGN_CENTER_HORIZONTAL | wxTOP | wxRIGHT, 5);
        f->SetSizer(sizer);
        f->Layout();
        f->Show();

        // Let GTK settle the allocations before reading them.
        for (int i = 0; i < 200; ++i)
        {
            while (gtk_events_pending())
                gtk_main_iteration();

            g_usleep(5000);
        }

        printf("wx reports: slider size %dx%d  best %dx%d\n", s->GetSize().x, s->GetSize().y,
               s->GetBestSize().x, s->GetBestSize().y);

        GtkWidget* w = s->GetHandle();
        printf("\nGTK tree under the wxSlider (x/y are window coords):\n");
        dumpTree(w, 1);

        // Find the GtkScale in there.
        GtkWidget* scale = nullptr;
        GList*     kids = GTK_IS_CONTAINER(w) ? gtk_container_get_children(GTK_CONTAINER(w))
                                              : nullptr;
        for (GList* k = kids; k; k = k->next)
        {
            if (GTK_IS_SCALE(k->data))
                scale = GTK_WIDGET(k->data);
        }
        g_list_free(kids);

        if (GTK_IS_SCALE(w))
            scale = w;

        if (scale)
        {
            GtkPositionType vp;
            g_object_get(scale, "value-pos", &vp, NULL);
            printf("\nscale: draw-value=%d value-pos=%s inverted=%d\n",
                   gtk_scale_get_draw_value(GTK_SCALE(scale)), posName(vp),
                   gtk_range_get_inverted(GTK_RANGE(scale)));

            gint lo = 0, hi = 0;
            gtk_range_get_slider_range(GTK_RANGE(scale), &lo, &hi);
            printf("slider range within the scale: %d..%d\n", lo, hi);

            // Where GTK draws the value text, and how wide the scale's own
            // padding makes the thumb lane.
            gint lx = 0, ly = 0;
            gtk_scale_get_layout_offsets(GTK_SCALE(scale), &lx, &ly);

            PangoLayout* pl = gtk_scale_get_layout(GTK_SCALE(scale));
            int          pw = 0, ph = 0;

            if (pl)
                pango_layout_get_pixel_size(pl, &pw, &ph);

            GtkAllocation sa;
            gtk_widget_get_allocation(scale, &sa);
            printf("value text at x=%d y=%d size %dx%d, scale allocation x=%d y=%d %dx%d\n", lx,
                   ly, pw, ph, sa.x, sa.y, sa.width, sa.height);

            GtkBorder pad;
            gtk_style_context_get_padding(gtk_widget_get_style_context(scale),
                                          GTK_STATE_FLAG_NORMAL, &pad);
            printf("scale padding l%d r%d t%d b%d\n", pad.left, pad.right, pad.top, pad.bottom);

            printf("\n");
            dumpNode(scale, "trough");
            dumpNode(scale, "highlight");
            dumpNode(scale, "slider");
        }
        else
        {
            printf("\nno GtkScale found\n");
        }

        printf("\n");

        if (scale)
            dumpPainted(scale, s->GetSize().x, s->GetSize().y, true);

        // The same control the image converter builds: horizontal, no INVERSE.
        wxSlider* hs = new wxSlider(f, wxID_ANY, 128, 0, 255, wxDefaultPosition, wxSize(300, -1),
                                    wxSL_HORIZONTAL | wxSL_LABELS);
        hs->SetSize(300, hs->GetBestSize().y);

        for (int i = 0; i < 100; ++i)
        {
            while (gtk_events_pending())
                gtk_main_iteration();

            g_usleep(5000);
        }

        GtkWidget* hw = hs->GetHandle();
        GtkWidget* hscale = nullptr;

        if (GTK_IS_CONTAINER(hw))
        {
            GList* hk = gtk_container_get_children(GTK_CONTAINER(hw));

            for (GList* k = hk; k; k = k->next)
            {
                if (GTK_IS_SCALE(k->data))
                    hscale = GTK_WIDGET(k->data);
            }

            g_list_free(hk);
        }

        if (GTK_IS_SCALE(hw))
            hscale = hw;

        if (hscale)
        {
            GtkAllocation ha;
            gtk_widget_get_allocation(hscale, &ha);
            printf("  horizontal scale allocation %dx%d\n", ha.width, ha.height);
            printf("\n  GTK tree under the HORIZONTAL wxSlider:\n");
            dumpTree(hw, 2);

            GtkPositionType hvp;
            g_object_get(hscale, "value-pos", &hvp, NULL);
            printf("  horizontal scale: value-pos=%s\n", posName(hvp));

            gint hlx = 0, hly = 0;
            gtk_scale_get_layout_offsets(GTK_SCALE(hscale), &hlx, &hly);
            printf("  horizontal value text at x=%d y=%d\n", hlx, hly);
            dumpPainted(hscale, ha.width, ha.height, false);
        }

        fflush(stdout);
        f->Destroy();
        return false;
    }
};

wxIMPLEMENT_APP_CONSOLE(App);
