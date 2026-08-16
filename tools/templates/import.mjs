// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Import KiCad's project templates into designer/public/templates.
 *
 * A template is a directory holding the project files plus a `meta` directory
 * with `info.html` and optionally `icon.png` (project_template.cpp:42-72). The
 * selector reads three things out of it, and this script has to derive each the
 * same way or the list will not match:
 *
 *  - the title, from PROJECT_TEMPLATE::GetTitle(), which in 10.0.5 is simply the
 *    template's directory name - see templateTitle() for why;
 *  - the description, from DIALOG_TEMPLATE_SELECTOR::ExtractDescription(): a
 *    <meta name="description"> if there is one, else the first <p>, else the
 *    body text capped at 250 characters;
 *  - the icon, `meta/icon.png`, or none - in which case the dialog falls back
 *    to KiCad's own icon (SetTemplate: KiBitmapBundleDef( BITMAPS::icon_kicad )).
 *
 * The copied file list is PROJECT_TEMPLATE::GetFileList(), which traverses the
 * template directory through a FILE_TRAVERSER that skips `meta`.
 *
 * Usage:  node tools/templates/import.mjs [systemTemplateDir] [userTemplateDir]
 * Defaults to the paths a stock Linux KiCad installs to.
 */
import {
  readFileSync,
  readdirSync,
  statSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  cpSync,
} from 'node:fs';
import { join, relative, sep } from 'node:path';
import { homedir } from 'node:os';

const SYSTEM_DIR = process.argv[2] ?? '/usr/share/kicad/template';
// The built-in "default" template is seeded into the user template directory.
const USER_DIR = process.argv[3] ?? join(homedir(), '.local/share/kicad/10.0/template');
const OUT_DIR = 'designer/public/templates';

/**
 * What PROJECT_TEMPLATE::GetTitle() actually returns in 10.0.5: the directory
 * name.
 *
 * The constructor ends with
 *
 *     if( m_title.IsEmpty() )
 *         m_title = GetPrjDirName();
 *
 * and GetTitle() only parses the HTML `if( m_title == wxEmptyString )` - which,
 * after that line, it never is. So the <title> in meta/info.html is dead: every
 * card is labelled with its folder name, which is why the real dialog reads
 * "API_Series-500" and not "API Series 500 - Audio Devices".
 *
 * (Master drops the constructor line and does parse the <title>. We follow the
 * 10.0.5 the user is running.)
 */
function templateTitle(dirName) {
  return dirName;
}

/** The entity decoding + whitespace normalisation both fallbacks share. */
function cleanup(text) {
  return text
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/** DIALOG_TEMPLATE_SELECTOR::ExtractDescription(). */
function extractDescription(html) {
  // The C++ reads the file line by line into one space-joined string first.
  const content = html.split(/\r?\n/).join(' ');

  const meta = content.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i);
  if (meta) return meta[1];

  const para = content.match(/<p[^>]*>(.*?)<\/p>/i);
  if (para) {
    const desc = cleanup(para[1]);
    if (desc !== '') return desc;
  }

  const body = content.match(/<body[^>]*>(.*)<\/body>/i);
  if (body) {
    const text = cleanup(body[1]);
    return text.length > 250 ? `${text.slice(0, 250)}...` : text;
  }

  return '';
}

/** PROJECT_TEMPLATE::GetFileList()'s traversal: everything but `meta`. */
function listFiles(dir, base = dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'meta' && dir === base) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full, base));
    else if (entry.isFile()) out.push(relative(base, full).split(sep).join('/'));
  }
  return out;
}

/** The template's own .kicad_pro basename, which CreateProject renames. */
function projectBase(files, id) {
  const pro = files.find((f) => f.toLowerCase().endsWith('.kicad_pro') && !f.includes('/'));
  return pro ? pro.replace(/\.kicad_pro$/i, '') : id;
}

function collect(rootDir, category) {
  const found = [];
  let entries;
  try {
    entries = readdirSync(rootDir, { withFileTypes: true });
  } catch {
    console.warn(`  (no such directory: ${rootDir})`);
    return found;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = join(rootDir, entry.name);
    let html;
    try {
      // A directory is a template only if it has meta/info.html; anything else
      // in the template path is silently skipped, as BuildTemplateList does.
      html = readFileSync(join(dir, 'meta', 'info.html'), 'utf8');
    } catch {
      continue;
    }
    let hasIcon = true;
    try {
      statSync(join(dir, 'meta', 'icon.png'));
    } catch {
      // No meta/icon.png: SetTemplate falls back to the KiCad application icon,
      //   bundle = KiBitmapBundleDef( BITMAPS::icon_kicad, 48 );
      // which is what `default` and STM32H7_DevEBox actually show.
      hasIcon = false;
    }
    const files = listFiles(dir);
    found.push({
      id: entry.name,
      dir,
      category,
      hasIcon,
      files,
      title: templateTitle(entry.name),
      description: extractDescription(html),
      base: projectBase(files, entry.name),
    });
  }
  return found;
}

console.log(`Scanning ${SYSTEM_DIR}`);
const system = collect(SYSTEM_DIR, 'system');
console.log(`  ${system.length} system templates`);
console.log(`Scanning ${USER_DIR}`);
/*
 * `default` is a USER template on a stock install, despite BuildTemplateList's
 * "Treated as a built-in, not a user template" comment. That line describes
 * scanDirectory( m_defaultTemplatesPath, false ), and on a stock install that
 * scan never happens.
 *
 * KICAD_USER_TEMPLATE_DIR is not an opt-in variable. common_settings.cpp
 * registers it with a default:
 *
 *     addVar( wxT( "KICAD_USER_TEMPLATE_DIR" ), PATHS::GetUserTemplatesPath() );
 *
 * so it is always set, even with `"vars": null` in kicad_common.json. NewProject
 * therefore fills userTemplatesPath with ~/.local/share/kicad/<ver>/template/,
 * and then blanks the separate default scan because the seeded default lives
 * inside it:
 *
 *     if( defaultRoot == userTemplatesPath || defaultRoot == systemTemplatesPath )
 *         defaultTemplatesPath = wxEmptyString;
 *
 * What is left is scanDirectory( m_userTemplatesPath, true ). The "built-in"
 * path only applies when someone repoints KICAD_USER_TEMPLATE_DIR elsewhere.
 */
const user = collect(USER_DIR, 'user');
console.log(`  ${user.length} templates`);

const all = [...system, ...user];
if (all.length === 0) {
  console.error('No templates found. Is KiCad installed?');
  process.exit(1);
}

rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

const manifest = [];
for (const t of all) {
  const dest = join(OUT_DIR, t.id);
  mkdirSync(dest, { recursive: true });
  for (const rel of t.files) {
    const to = join(dest, rel);
    mkdirSync(join(to, '..'), { recursive: true });
    cpSync(join(t.dir, rel), to);
  }
  // The whole meta directory, not just the icon. LoadTemplatePreview points the
  // WebView at meta/info.html itself, and those pages carry their own images -
  // STM32H7_DevEBox's references DevEBox_Board.png and a PDF beside it - so
  // copying info.html alone would render it with broken images.
  cpSync(join(t.dir, 'meta'), join(dest, 'meta'), { recursive: true });

  const base = `/templates/${encodeURIComponent(t.id)}`;
  manifest.push({
    id: t.id,
    base: t.base,
    title: t.title,
    description: t.description,
    icon: t.hasIcon ? `${base}/meta/icon.png` : null,
    /** PROJECT_TEMPLATE::GetHtmlFile(), what the preview pane actually loads. */
    html: `${base}/meta/info.html`,
    category: t.category,
    files: t.files,
  });
  console.log(`  ${t.id.padEnd(32)} ${t.title}`);
}

manifest.sort((a, b) => a.id.localeCompare(b.id));
writeFileSync(join(OUT_DIR, 'index.json'), `${JSON.stringify({ templates: manifest }, null, 2)}\n`);
console.log(`\nWrote ${manifest.length} templates to ${OUT_DIR}/index.json`);
