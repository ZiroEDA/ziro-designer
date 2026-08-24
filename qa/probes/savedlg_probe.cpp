// Where does pl_editor's "Save Drawing Sheet As" actually open, and what name
// does it suggest?
//
// `PL_EDITOR_FRAME::Files_io` builds it like this (pagelayout_editor/files.cpp:199):
//
//     wxString dir = PATHS::GetUserTemplatesPath();
//     wxFileDialog openFileDialog( this, _( "Save Drawing Sheet As" ), dir,
//                                  wxEmptyString,
//                                  FILEEXT::DrawingSheetFileWildcard(),
//                                  wxFD_SAVE | wxFD_OVERWRITE_PROMPT );
//
// Two things worth confirming rather than assuming. The directory is the USER
// TEMPLATES path — not the open project, and `files.cpp` never mentions the
// project at all — and the suggested filename is `wxEmptyString`, i.e. none.
//
// The third thing, which only running it answers: that templates directory does
// not necessarily EXIST. It is ~/Documents/kicad/<ver>/template, which KiCad
// creates on demand, and there is no such folder on this machine. What GTK does
// with a set_current_folder to a missing directory is the question a source
// read cannot settle.
//
// Build and run: see qa/probes/README.md. `env -i` is not optional.
#include <wx/wx.h>
#include <wx/filedlg.h>
#include <wx/filename.h>
#include <wx/stdpaths.h>
#include <glib.h>
#include <gtk/gtk.h>
#include <cstdio>

// PATHS::getUserDocumentPath + AppendDir("template"), transcribed
// (common/paths.cpp:35-47, :57-65). KICAD_PATH_STR is "kicad".
static wxString userTemplatesPath(const wxString& majorMinor)
{
    wxFileName tmp;
    wxString   envPath;

    if (wxGetEnv(wxT("KICAD_DOCUMENTS_HOME"), &envPath))
    {
        tmp.AssignDir(envPath);
    }
    else
    {
        // KIPLATFORM::ENV::GetDocumentsPath() on Linux is g_get_user_data_dir()
        // — ~/.local/share — NOT wxStandardPaths' documents dir
        // (libs/kiplatform/os/unix/environment.cpp:93-105). Getting that wrong
        // sent this probe to ~/Documents/kicad/... and reported a path that does
        // not exist, when the real dialog opens somewhere that does.
        tmp.AssignDir(wxString::FromUTF8(g_get_user_data_dir()));
    }

    tmp.AppendDir(wxT("kicad"));
    tmp.AppendDir(majorMinor);
    tmp.AppendDir(wxT("template"));

    return tmp.GetPathWithSep();
}

class App : public wxApp
{
public:
    bool OnInit() override
    {
        wxFrame* f = new wxFrame(nullptr, wxID_ANY, "save dialog probe");

        const wxString dir = userTemplatesPath("10.0");
        printf("PATHS::GetUserTemplatesPath() = %s\n", (const char*) dir.utf8_str());
        printf("  exists on this machine: %s\n", wxDirExists(dir) ? "yes" : "NO");
        printf("  g_get_user_data_dir()  : %s\n", g_get_user_data_dir());
        printf("  wx documents dir       : %s   <- NOT what KiCad uses on Linux\n",
               (const char*) wxStandardPaths::Get().GetDocumentsDir().utf8_str());

        // The dialog Files_io builds for wxID_SAVEAS, argument for argument.
        wxFileDialog dlg(f, wxT("Save Drawing Sheet As"), dir, wxT("complex_hierarchy.kicad_sch"),
                         wxT("KiCad drawing sheet files (*.kicad_wks)|*.kicad_wks"),
                         wxFD_SAVE | wxFD_OVERWRITE_PROMPT);

        printf("\nwx reports, before the dialog is shown:\n");
        printf("  GetDirectory() = '%s'\n", (const char*) dlg.GetDirectory().utf8_str());
        printf("  GetFilename()  = '%s'   <- the suggested name\n",
               (const char*) dlg.GetFilename().utf8_str());
        printf("  GetPath()      = '%s'\n", (const char*) dlg.GetPath().utf8_str());

        // Show it just long enough for GTK to settle, then ask the GtkFileChooser
        // itself where it landed — which is the only thing that can answer what a
        // missing current-folder does.
        GtkWidget* w = dlg.GetHandle();

        if (GTK_IS_FILE_CHOOSER(w))
        {
            gtk_widget_show(w);

            for (int i = 0; i < 100; ++i)
            {
                while (gtk_events_pending())
                    gtk_main_iteration();

                g_usleep(5000);
            }

            // Which widget holds the keyboard focus when the dialog opens, and
            // what is selected inside it. A save dialog that does not put the
            // caret in the name entry makes the user hunt for it.
            GtkWidget* focused = gtk_window_get_focus(GTK_WINDOW(w));
            printf("\nfocus when the dialog opens:\n");
            printf("  focused widget = %s\n",
                   focused ? G_OBJECT_TYPE_NAME(focused) : "(none)");

            if (focused && GTK_IS_ENTRY(focused))
            {
                gint a = 0, b = 0;
                gboolean sel = gtk_editable_get_selection_bounds(GTK_EDITABLE(focused), &a, &b);
                const gchar* txt = gtk_entry_get_text(GTK_ENTRY(focused));
                printf("  entry text     = '%s'\n", txt ? txt : "");
                printf("  selection      = %s [%d..%d]  <- what typing would replace\n",
                       sel ? "yes" : "none", a, b);
            }

            gchar* folder = gtk_file_chooser_get_current_folder(GTK_FILE_CHOOSER(w));
            gchar* name = gtk_file_chooser_get_current_name(GTK_FILE_CHOOSER(w));

            printf("\nGTK reports, with the chooser on screen:\n");
            printf("  current folder = '%s'\n", folder ? folder : "(null)");
            printf("  current name   = '%s'   <- what is typed in the name entry\n",
                   name ? name : "(null)");

            g_free(folder);
            g_free(name);
            gtk_widget_hide(w);
        }
        else
        {
            printf("\nnot a GtkFileChooser\n");
        }

        fflush(stdout);
        f->Destroy();
        return false;
    }
};

wxIMPLEMENT_APP_CONSOLE(App);
