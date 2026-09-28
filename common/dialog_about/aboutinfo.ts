// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `common/dialog_about/aboutinfo.h`: the data the About dialog shows - who
 * contributed in which area, the description, the licence and the versions.
 *
 * One divergence: `CreateKiBitmap` and its `m_bitmaps` exist upstream only to
 * free wxBitmaps when the dialog closes, which garbage collection does here.
 */

/**
 * A contributor: a person involved in the development of the application or
 * who contributed to the project in any way. A name is mandatory; a URL and a
 * category are optional. `m_checked` is the About dialog's own bookkeeping,
 * marking a row once it has been listed under its category.
 */
export class CONTRIBUTOR {
  private m_name: string;
  private m_url: string;
  private m_category: string;
  private m_checked = false;

  constructor(aName: string, aCategory: string, aUrl = '') {
    this.m_name = aName;
    this.m_url = aUrl;
    this.m_category = aCategory;
  }

  GetName(): string {
    return this.m_name;
  }
  GetUrl(): string {
    return this.m_url;
  }
  GetCategory(): string {
    return this.m_category;
  }
  SetChecked(status: boolean): void {
    this.m_checked = status;
  }
  IsChecked(): boolean {
    return this.m_checked;
  }
}

/** `WX_DECLARE_OBJARRAY( CONTRIBUTOR, CONTRIBUTORS )`. */
export type CONTRIBUTORS = CONTRIBUTOR[];

/**
 * The getters return `CONTRIBUTORS` BY VALUE upstream, and an object array's
 * copy copies its objects. That is load-bearing: the dialog marks each row
 * `SetChecked( true )` as it lists it, and those marks land on the copy. Handing
 * out the stored array instead would leave every row checked after one
 * rendering, and the next would list nobody.
 */
const copy = (a: CONTRIBUTORS): CONTRIBUTORS =>
  a.map((c) => new CONTRIBUTOR(c.GetName(), c.GetCategory(), c.GetUrl()));

/**
 * Application-specific information: who contributed in which area, the
 * licence, the copyright and other descriptive text.
 */
export class ABOUT_APP_INFO {
  private mDevelopers: CONTRIBUTORS = [];
  private mDocWriters: CONTRIBUTORS = [];
  private mLibrarians: CONTRIBUTORS = [];
  private mArtists: CONTRIBUTORS = [];
  private mTranslators: CONTRIBUTORS = [];
  private mPackagers: CONTRIBUTORS = [];

  private description = '';
  private license = '';

  private appName = '';
  private buildVersion = '';
  private buildDate = '';
  private libVersion = '';

  /** `wxIcon m_appIcon`: a URL here. Empty is `!IsOk()`. */
  private m_appIcon = '';

  AddDeveloper(developer: CONTRIBUTOR | null): void {
    if (developer) this.mDevelopers.push(developer);
  }
  AddDocWriter(docwriter: CONTRIBUTOR | null): void {
    if (docwriter) this.mDocWriters.push(docwriter);
  }
  AddLibrarian(aLibrarian: CONTRIBUTOR | null): void {
    if (aLibrarian) this.mLibrarians.push(aLibrarian);
  }
  AddArtist(artist: CONTRIBUTOR | null): void {
    if (artist) this.mArtists.push(artist);
  }
  AddTranslator(translator: CONTRIBUTOR | null): void {
    if (translator) this.mTranslators.push(translator);
  }
  AddPackager(packager: CONTRIBUTOR | null): void {
    if (packager) this.mPackagers.push(packager);
  }

  GetDevelopers(): CONTRIBUTORS {
    return copy(this.mDevelopers);
  }
  GetDocWriters(): CONTRIBUTORS {
    return copy(this.mDocWriters);
  }
  GetLibrarians(): CONTRIBUTORS {
    return copy(this.mLibrarians);
  }
  GetArtists(): CONTRIBUTORS {
    return copy(this.mArtists);
  }
  GetTranslators(): CONTRIBUTORS {
    return copy(this.mTranslators);
  }
  GetPackagers(): CONTRIBUTORS {
    return copy(this.mPackagers);
  }

  SetDescription(text: string): void {
    this.description = text;
  }
  GetDescription(): string {
    return this.description;
  }

  SetLicense(text: string): void {
    this.license = text;
  }
  GetLicense(): string {
    return this.license;
  }

  SetAppName(name: string): void {
    this.appName = name;
  }
  GetAppName(): string {
    return this.appName;
  }

  SetBuildVersion(version: string): void {
    this.buildVersion = version;
  }
  GetBuildVersion(): string {
    return this.buildVersion;
  }

  SetBuildDate(date: string): void {
    this.buildDate = date;
  }
  GetBuildDate(): string {
    return this.buildDate;
  }

  SetLibVersion(version: string): void {
    this.libVersion = version;
  }
  GetLibVersion(): string {
    return this.libVersion;
  }

  SetAppIcon(aIcon: string): void {
    this.m_appIcon = aIcon;
  }
  GetAppIcon(): string {
    return this.m_appIcon;
  }
}
