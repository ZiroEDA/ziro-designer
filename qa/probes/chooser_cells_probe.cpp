// The file chooser's cell renderers, asked of the dialog wxWidgets builds.
//
// shell.css ships --chooser-icon-pad: 6px and --chooser-text-pad: 2px. Both come
// from ~/gtkdate/m2.py, which found its tree view with
//
//     tv = next(w for w in ws if isinstance(w, Gtk.TreeView))
//
// - the FIRST GtkTreeView in the dialog. A GtkFileChooser contains more than
// one: GtkPlacesSidebar is built on a tree view of its own and it is packed
// before the file list. So the padding those tokens carry may not be the file
// list's at all. The corrected probes (~/gtkdate/rowh.py, listfont.py) filter
// with `if "Size" not in cols: continue` for exactly this reason, and that is
// where the row height 24 -> 29 correction came from.
//
// This prints EVERY tree view in the dialog with its columns, so which is which
// is visible rather than assumed, and for the file list it reads each renderer's
// xpad/ypad AND gtk_tree_view_column_cell_get_position() - where the icon and
// the text actually land inside the Name column, which is the number that can be
// checked against the capture.
//
// wx, not python-gi: KiCad puts this window up with wxFileDialog
// (KICAD_MANAGER_CONTROL::openProject, kicad/tools/kicad_manager_control.cpp:490),
// so this builds it the same way and inspects the widget wx made.
#include <wx/wx.h>
#include <wx/filedlg.h>
#include <gtk/gtk.h>
#include <cstdio>
#include <vector>
#include <string>

static void collect(GtkWidget* w, std::vector<GtkWidget*>& out)
{
    out.push_back(w);
    if (GTK_IS_CONTAINER(w))
    {
        GList* kids = gtk_container_get_children(GTK_CONTAINER(w));
        for (GList* l = kids; l; l = l->next) collect(GTK_WIDGET(l->data), out);
        g_list_free(kids);
    }
}

// The chain of widget types from the dialog down, so a tree view can be told
// apart from another tree view by where it sits.
static std::string ancestry(GtkWidget* w)
{
    std::string s;
    for (GtkWidget* p = w; p; p = gtk_widget_get_parent(p))
    {
        std::string n = G_OBJECT_TYPE_NAME(p);
        s = n + (s.empty() ? "" : " > " + s);
    }
    return s;
}

static void dump_tree_view(GtkTreeView* tv, int index)
{
    GList* cols = gtk_tree_view_get_columns(tv);
    int ncols = (int) g_list_length(cols);

    printf("\n--- TreeView #%d --- %d column(s)\n", index, ncols);
    printf("    where: %s\n", ancestry(GTK_WIDGET(tv)).c_str());

    GtkAllocation a;
    gtk_widget_get_allocation(GTK_WIDGET(tv), &a);
    printf("    alloc: %d x %d at (%d,%d)\n", a.width, a.height, a.x, a.y);

    printf("    columns:");
    bool isFileList = false;
    for (GList* l = cols; l; l = l->next)
    {
        GtkTreeViewColumn* c = GTK_TREE_VIEW_COLUMN(l->data);
        const char* t = gtk_tree_view_column_get_title(c);
        printf(" [%s w=%d]", t && *t ? t : "(none)", gtk_tree_view_column_get_width(c));
        if (t && (g_strcmp0(t, "Size") == 0)) isFileList = true;
    }
    printf("\n    identified as: %s\n", isFileList
           ? "THE FILE LIST (has a Size column)"
           : "not the file list");

    // Every renderer of every column, with the padding the tokens claim.
    for (GList* l = cols; l; l = l->next)
    {
        GtkTreeViewColumn* c = GTK_TREE_VIEW_COLUMN(l->data);
        const char* title = gtk_tree_view_column_get_title(c);
        GList* cells = gtk_cell_layout_get_cells(GTK_CELL_LAYOUT(c));
        for (GList* r = cells; r; r = r->next)
        {
            GtkCellRenderer* cr = GTK_CELL_RENDERER(r->data);
            guint xpad = 0, ypad = 0;
            gfloat xalign = 0;
            gtk_cell_renderer_get_padding(cr, (gint*) &xpad, (gint*) &ypad);
            gtk_cell_renderer_get_alignment(cr, &xalign, nullptr);
            gint fw = -1, fh = -1;
            gtk_cell_renderer_get_fixed_size(cr, &fw, &fh);

            // Where this renderer sits inside its column.
            gint xoff = -1, cw = -1;
            gtk_tree_view_column_cell_get_position(c, cr, &xoff, &cw);

            gint minh = -1, nath = -1;
            gtk_cell_renderer_get_preferred_height(cr, GTK_WIDGET(tv), &minh, &nath);
            printf("      col %-9s %-24s xpad=%u ypad=%u xalign=%.2f fixed=%dx%d"
                   "  position: x_offset=%d width=%d  pref_height min=%d nat=%d\n",
                   title && *title ? title : "(none)", G_OBJECT_TYPE_NAME(cr),
                   xpad, ypad, xalign, fw, fh, xoff, cw, minh, nath);
        }
        g_list_free(cells);
    }

    // Row geometry, and where column 0 begins, so the x of the icon and of the
    // text can be reconciled with a capture.
    GtkTreeModel* m = gtk_tree_view_get_model(tv);
    GtkTreeIter it;
    if (m && gtk_tree_model_get_iter_first(m, &it) && ncols > 0)
    {
        GtkTreePath* p = gtk_tree_model_get_path(m, &it);
        GtkTreeViewColumn* c0 = GTK_TREE_VIEW_COLUMN(cols->data);
        GdkRectangle bg, cell;
        gtk_tree_view_get_background_area(tv, p, c0, &bg);
        gtk_tree_view_get_cell_area(tv, p, c0, &cell);
        printf("    row 0: background y=%d h=%d x=%d w=%d | cell y=%d h=%d x=%d w=%d\n",
               bg.y, bg.height, bg.x, bg.width, cell.y, cell.height, cell.x, cell.width);
        gtk_tree_path_free(p);

        // What is actually in these rows - a row's height is its tallest cell,
        // so the content is part of the measurement.
        int shown = 0;
        GtkTreeIter it2 = it;
        do {
            GtkTreePath* pp = gtk_tree_model_get_path(m, &it2);
            GdkRectangle bb;
            gtk_tree_view_get_background_area(tv, pp, c0, &bb);
            gchar* nm = nullptr;
            gtk_tree_model_get(m, &it2, 2 /* MODEL_COL_NAME in gtkfilechooserwidget */, &nm, -1);
            printf("      row %d h=%-3d name=%s\n", shown, bb.height, nm ? nm : "(?)");
            g_free(nm);
            gtk_tree_path_free(pp);
            ++shown;
        } while (shown < 6 && gtk_tree_model_iter_next(m, &it2));
    }
    else
    {
        printf("    row 0: (no rows in the model)\n");
    }

    // The column header is a GtkButton with a label inside, NOT a cell
    // renderer - its padding is the theme's button padding and has nothing to
    // do with xpad. Measured as the gap between the button's allocation and
    // its label's, so the header text can be lined up against the cell text.
    for (GList* l = cols; l; l = l->next)
    {
        GtkTreeViewColumn* c = GTK_TREE_VIEW_COLUMN(l->data);
        GtkWidget* btn = gtk_tree_view_column_get_button(c);
        if (!btn) continue;
        GtkAllocation ba;
        gtk_widget_get_allocation(btn, &ba);
        std::vector<GtkWidget*> inner;
        collect(btn, inner);
        for (GtkWidget* w : inner)
        {
            if (!GTK_IS_LABEL(w)) continue;
            GtkAllocation la;
            gtk_widget_get_allocation(w, &la);
            GtkBorder pad;
            gtk_style_context_get_padding(gtk_widget_get_style_context(btn),
                                          GTK_STATE_FLAG_NORMAL, &pad);
            printf("    header %-9s button %dx%d at x=%d | label '%s' %dx%d at x=%d"
                   "  -> label starts %d px into the button; css padding l=%d r=%d\n",
                   gtk_tree_view_column_get_title(c), ba.width, ba.height, ba.x,
                   gtk_label_get_text(GTK_LABEL(w)), la.width, la.height, la.x,
                   la.x - ba.x, pad.left, pad.right);
        }
    }

    g_list_free(cols);
}

class Probe : public wxApp
{
public:
    wxString m_dir = "/home/akshay/kicad-reference/demos";
    // KICAD_MANAGER_CONTROL::openProject's own three, joined in its order.
    wxString m_wildcard =
        "All KiCad project files (*.kicad_pro;*.pro)|*.kicad_pro;*.pro"
        "|KiCad project files (*.kicad_pro)|*.kicad_pro"
        "|KiCad legacy project files (*.pro)|*.pro";
    bool OnInit() override
    {
        GtkSettings* st = gtk_settings_get_default();
        gchar* font = nullptr;
        gint dpi = 0;
        g_object_get(st, "gtk-font-name", &font, "gtk-xft-dpi", &dpi, nullptr);
        // env -i silently swaps this to Cantarell; if it does not say the
        // session font, every number below is of a different widget.
        printf("gtk-font-name : %s\n", font ? font : "(null)");
        printf("gtk-xft-dpi   : %d  (%.1f dpi)\n", dpi, dpi / 1024.0);
        g_free(font);

        wxFrame* frame = new wxFrame(nullptr, wxID_ANY, "probe host");

        // KICAD_MANAGER_CONTROL::openProject's own wildcard and title.
        const wxString wildcard = m_wildcard;

        // A REAL DIRECTORY, so the chooser is in browse mode. Left unset it
        // opens on Recent, whose tree view has a different column set
        // (Name/Location/Size/Type/Accessed) - the mistake behind the 24 px row
        // and the 130 px Type column that both shipped and were wrong.
        const wxString dir = m_dir;

        wxFileDialog* dlg = new wxFileDialog(frame, "Open Existing Project", dir,
                                             wxEmptyString, wildcard,
                                             wxFD_OPEN | wxFD_FILE_MUST_EXIST);
        dlg->SetSize(1203, 762);
        dlg->Show();
        for (int i = 0; i < 400; ++i) { while (gtk_events_pending()) gtk_main_iteration(); }

        GtkWidget* handle = (GtkWidget*) dlg->GetHandle();
        printf("\nwxFileDialog::GetHandle() -> %s\n",
               handle ? G_OBJECT_TYPE_NAME(handle) : "(null)");
        printf("directory it was pointed at: %s\n", (const char*) dir.mb_str());

        if (handle)
        {
            std::vector<GtkWidget*> all;
            collect(handle, all);
            int n = 0, seen = 0;
            for (GtkWidget* w : all) if (GTK_IS_TREE_VIEW(w)) ++n;
            printf("GtkTreeViews inside this dialog: %d\n", n);
            printf("(m2.py took the first of these and read its renderers.)\n");
            for (GtkWidget* w : all)
                if (GTK_IS_TREE_VIEW(w)) dump_tree_view(GTK_TREE_VIEW(w), seen++);
        }

        printf("\n[done]\n");
        fflush(stdout);
        dlg->Destroy();
        frame->Destroy();
        return false;
    }
};

wxIMPLEMENT_APP_NO_MAIN(Probe);
int main(int argc, char** argv)
{
    wxEntryStart(argc, argv);
    if (argc > 1) ((Probe*) wxTheApp)->m_dir = wxString::FromUTF8(argv[1]);
    if (argc > 2) ((Probe*) wxTheApp)->m_wildcard = wxString::FromUTF8(argv[2]);
    wxTheApp->CallOnInit();
    wxEntryCleanup();
    return 0;
}
