// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `common/dialog_about/AboutDialog_main.cpp`: `ShowAboutDialog`, and the
 * `buildKicadAboutBanner` that fills an `ABOUT_APP_INFO` for it.
 *
 * Two halves, treated differently:
 *
 *   - The DESCRIPTION, the LICENCE and the version lines are about the product
 *     the user is running. Upstream's say KiCad; ours say ZiroEDA, because this
 *     program must not claim to be KiCad. The description keeps upstream's
 *     sections (description, on the web, bug tracker) and adds one, "Built on
 *     KiCad", which is the attribution the GPL and CC-BY-SA require wherever the
 *     work is conveyed. NOTICE.md holds the full detail.
 *   - The CONTRIBUTOR lists are data KiCad hardcodes, and they are KiCad's
 *     credits for the code, documentation, libraries, icons and translations
 *     this port is built from. They are transcribed from 10.0.5 unchanged, by
 *     `qa/probes/about_contributors_extract.py`, not retyped - re-run it
 *     against a new release rather than editing the block by hand. The dialog
 *     says whose credits they are (dialog_about.tsx).
 *
 * The frame icon: upstream takes `aParent->GetIcon()`. Our frames have no icon
 * of their own, so it is the product mark, `favicon.svg`.
 */
import type { JSX } from 'react';
import { GetBuildDate, GetBuildVersion } from '../build_version.js';
import { REPORT_BUG_URL } from '../eda_base_frame_help_menu.js';
import { PRODUCT } from '../eda_base_frame_about_titles.js';
import { ABOUT_APP_INFO, CONTRIBUTOR } from './aboutinfo.js';
import { DIALOG_ABOUT } from './dialog_about.js';
import { version as REACT_VERSION } from 'react';

/**
 * Wrap `aUrl` in an anchor: `<a href='url'>description</a>`, the URL itself
 * standing in for an empty description.
 */
function HtmlHyperlink(aUrl: string, aDescription = ''): string {
  return `<a href='${aUrl}'>${aDescription === '' ? aUrl : aDescription}</a>`;
}

/** `aCount` `<br>` tags. */
function HtmlNewline(aCount = 1): string {
  return '<br>'.repeat(aCount);
}

/**
 * Fill `aInfo` with the application's information. Upstream takes the parent
 * frame for its icon; ours takes the icon itself.
 */
function buildKicadAboutBanner(aAppIcon: string, aInfo: ABOUT_APP_INFO): void {
  // Set application specific icon
  aInfo.SetAppIcon(aAppIcon);

  /* Set title */
  aInfo.SetAppName(PRODUCT);

  /* build version: upstream's `KIPLATFORM::APP::IsOperatingSystemUnsupported`
     branch has no browser counterpart, and a production bundle is a release. */
  aInfo.SetBuildVersion(`${GetBuildVersion()}, release build`);
  aInfo.SetBuildDate(GetBuildDate());

  /* The library line: upstream names wxWidgets and Boost; the toolkit here is
     React. The platform follows on its own line, as upstream's does. */
  const platform = typeof navigator === 'undefined' ? 'unknown' : navigator.platform || 'unknown';
  aInfo.SetLibVersion(`React ${REACT_VERSION}\nPlatform: ${platform}`);

  // info/description part HTML formatted:
  let description = '';

  /* short description */
  description += '<p>';
  description += '<b><u>Description</u></b>'; // bold & underlined font for caption
  description += `<p>${PRODUCT} is a set of applications for the creation of electronic schematics and printed circuit boards, running in the browser.</p>`;
  description += '</p>';

  /* websites */
  description += `<p><b><u>${PRODUCT} on the web</u></b>`;
  // bullet-ed list with some http links
  description += '<ul>';
  description += `<li>The official ${PRODUCT} website - ${HtmlHyperlink('https://www.ziroeda.com')}</li>`;
  description += `<li>Documentation - ${HtmlHyperlink('https://docs.ziroeda.com/')}</li>`;
  description += `<li>Source code - ${HtmlHyperlink('https://github.com/ZiroEDA/ziro-designer')}</li>`;
  description += '</ul></p>';

  description += '<p><b><u>Bug tracker</u></b>';
  description += '<ul>';
  description += `<li>Report or examine bugs - ${HtmlHyperlink(REPORT_BUG_URL)}</li>`;
  description += '</ul></p>';

  /* Ours: the attribution the licences require. */
  description += "<p><b><u>Built on KiCad's work</u></b>";
  description += '<ul>';
  description += `<li>Much of ${PRODUCT} is a TypeScript port of ${HtmlHyperlink('https://gitlab.com/kicad/code/kicad', 'KiCad')}, and its icons are KiCad's. Copyright The KiCad Developers, GPL-3.0-or-later.</li>`;
  description += `<li>The symbol, footprint and 3D model libraries are KiCad's official ${HtmlHyperlink('https://gitlab.com/kicad/libraries', 'libraries')}, by the KiCad Libraries Team, under ${HtmlHyperlink('https://www.kicad.org/libraries/license/', 'CC-BY-SA 4.0 with the KiCad library exception')}. That exception means using them in a design does not place your design under share-alike terms.</li>`;
  description += `<li>${PRODUCT} is not affiliated with or endorsed by the KiCad project. "KiCad" is a trademark of its respective owners.</li>`;
  description += '</ul></p>';

  aInfo.SetDescription(description);

  // License information also HTML formatted:
  const license =
    "<div align='center'>" +
    HtmlNewline(4) +
    `The complete ${PRODUCT} suite is released under the` +
    HtmlNewline(2) +
    HtmlHyperlink(
      'http://www.gnu.org/licenses',
      'GNU General Public License (GPL) version 3 or any later version',
    ) +
    HtmlNewline(2) +
    'Portions derived from KiCad, copyright The KiCad Developers.' +
    '</div>';

  aInfo.SetLicense(license);

  /* A contributor consists of the following information:
   * Mandatory:
   * - Name
   * Optional:
   * - EMail address
   * - Category
   * - Category specific icon
   *
   * All contributors of the same category will be enumerated under this category
   * which should be represented by the same icon.
   */

  // ---- Transcribed from KiCad 10.0.5 by qa/probes/about_contributors_extract.py.
  {
    // The core developers
    const ADD_DEV = (name: string, category: string): void =>
      aInfo.AddDeveloper(new CONTRIBUTOR(name, category));
    const LEAD_DEV = 'Lead Development Team';
    const FORMER_DEV = 'Lead Development Alumni';
    const CONTRIB_DEV = 'Additional Contributions By';
    ADD_DEV('Jean-Pierre Charras', LEAD_DEV);
    ADD_DEV('Wayne Stambaugh', LEAD_DEV);

    // Alphabetical after the first two
    ADD_DEV('John Beard', LEAD_DEV);
    ADD_DEV('Jon Evans', LEAD_DEV);
    ADD_DEV('Roberto Fernandez Bautista', LEAD_DEV);
    ADD_DEV('Ethan Chien', LEAD_DEV);
    ADD_DEV('Fabien Corona', LEAD_DEV);
    ADD_DEV('Seth Hillbrand', LEAD_DEV);
    ADD_DEV('James Jackson', LEAD_DEV);
    ADD_DEV('Ian McInerney', LEAD_DEV);
    ADD_DEV('Mark Roszko', LEAD_DEV);
    ADD_DEV('Alex Shvartzkop', LEAD_DEV);
    ADD_DEV('Mike Williams', LEAD_DEV);
    ADD_DEV('Tomasz Wlostowski', LEAD_DEV);
    ADD_DEV('Jeff Young', LEAD_DEV);
    ADD_DEV('Eric Zhuang', LEAD_DEV);

    ADD_DEV('Dick Hollenbeck', FORMER_DEV);
    ADD_DEV('Alexis Lockwood', FORMER_DEV);
    ADD_DEV('Thomas Pointhuber', FORMER_DEV);
    ADD_DEV('Brian Sidebotham', FORMER_DEV);
    ADD_DEV('Orson (Maciej Sumiński)', FORMER_DEV);
    ADD_DEV('Mikolaj Wielgus', FORMER_DEV);

    ADD_DEV('Martin Aberg', CONTRIB_DEV);
    ADD_DEV('Yüksel Açikgöz', CONTRIB_DEV);
    ADD_DEV('Rohan Agrawal', CONTRIB_DEV);
    ADD_DEV('Johannes Agricola', CONTRIB_DEV);
    ADD_DEV('Erik Agsjö', CONTRIB_DEV);
    ADD_DEV('Nabeel Ahmad', CONTRIB_DEV);
    ADD_DEV('Christopher Alexander', CONTRIB_DEV);
    ADD_DEV('Werner Almesberger', CONTRIB_DEV);
    ADD_DEV('Shawn Anastasio', CONTRIB_DEV);
    ADD_DEV('Collin Anderson', CONTRIB_DEV);
    ADD_DEV('Tom Andrews', CONTRIB_DEV);
    ADD_DEV('Subaru Arai', CONTRIB_DEV);
    ADD_DEV('Mikael Arguedas', CONTRIB_DEV);
    ADD_DEV('Lachlan Audas', CONTRIB_DEV);
    ADD_DEV('Jean-Noel Avila', CONTRIB_DEV);

    ADD_DEV('Pascal Baerten', CONTRIB_DEV);
    ADD_DEV('Konstantin Baranovskiy', CONTRIB_DEV);
    ADD_DEV('Roman Bashkov', CONTRIB_DEV);
    ADD_DEV('Michael Beardsworth', CONTRIB_DEV);
    ADD_DEV('Markus Becker', CONTRIB_DEV);
    ADD_DEV('Matthew Beckler', CONTRIB_DEV);
    ADD_DEV('Konrad Beckmann', CONTRIB_DEV);
    ADD_DEV('Eduardo Behr', CONTRIB_DEV);
    ADD_DEV('David Beinder', CONTRIB_DEV);
    ADD_DEV('Frank Bennett', CONTRIB_DEV);
    ADD_DEV('Roman Beranek', CONTRIB_DEV);
    ADD_DEV('Francois Berder', CONTRIB_DEV);
    ADD_DEV('Martin Berglund', CONTRIB_DEV);
    ADD_DEV('Gustav Bergquist', CONTRIB_DEV);
    ADD_DEV('Cirilo Bernardo', CONTRIB_DEV);
    ADD_DEV('Joël Bertrand', CONTRIB_DEV);
    ADD_DEV('Harry Best', CONTRIB_DEV);
    ADD_DEV('Andreas Beutling', CONTRIB_DEV);
    ADD_DEV('Brian F. G. Bidulock', CONTRIB_DEV);
    ADD_DEV('Anton Blanchard', CONTRIB_DEV);
    ADD_DEV('Alexander Boehm', CONTRIB_DEV);
    ADD_DEV('Steve Bollinger', CONTRIB_DEV);
    ADD_DEV('Markus Bonk', CONTRIB_DEV);
    ADD_DEV('Blair Bonnett', CONTRIB_DEV);
    ADD_DEV('Franck Bourdonnec', CONTRIB_DEV);
    ADD_DEV('Kevin Bralten', CONTRIB_DEV);
    ADD_DEV('Carlo Bramini', CONTRIB_DEV);
    ADD_DEV('Matthias Breithaupt', CONTRIB_DEV);
    ADD_DEV('Stefan Brüns', CONTRIB_DEV);
    ADD_DEV('Andreas Buhr', CONTRIB_DEV);
    ADD_DEV('Ryan Bunch', CONTRIB_DEV);
    ADD_DEV('Emery Burhan', CONTRIB_DEV);

    ADD_DEV('Matt Campbell', CONTRIB_DEV);
    ADD_DEV('Scott Candey', CONTRIB_DEV);
    ADD_DEV('Phinitnan Chanasabaeng', CONTRIB_DEV);
    ADD_DEV('Shivpratap Chauhan', CONTRIB_DEV);
    ADD_DEV('Joseph Y. Chen', CONTRIB_DEV);
    ADD_DEV('Alexey Chernov', CONTRIB_DEV);
    ADD_DEV('Marco Ciampa', CONTRIB_DEV);
    ADD_DEV('Marcus Comstedt', CONTRIB_DEV);
    ADD_DEV('Diogo Condeco', CONTRIB_DEV);
    ADD_DEV('Colin Cooper', CONTRIB_DEV);
    ADD_DEV('Emile Cormier', CONTRIB_DEV);
    ADD_DEV('Garth Corral', CONTRIB_DEV);
    ADD_DEV('Sergio Costas', CONTRIB_DEV);
    ADD_DEV('Kevin Cozens', CONTRIB_DEV);
    ADD_DEV('Dan Cross', CONTRIB_DEV);

    ADD_DEV("Andrew D'Addesio", CONTRIB_DEV);
    ADD_DEV("Martin d'Allens", CONTRIB_DEV);
    ADD_DEV('Greg Davill', CONTRIB_DEV);
    ADD_DEV('Camille Delbegue', CONTRIB_DEV);
    ADD_DEV('Okan Demir', CONTRIB_DEV);
    ADD_DEV('Albin Dennevi', CONTRIB_DEV);
    ADD_DEV('Troy Denton', CONTRIB_DEV);
    ADD_DEV('Alexander Dewing', CONTRIB_DEV);
    ADD_DEV('Jonas Diemer', CONTRIB_DEV);
    ADD_DEV('Ben Dooks', CONTRIB_DEV);
    ADD_DEV('Jan Dorniak', CONTRIB_DEV);
    ADD_DEV('Pavel Dovgalyuk', CONTRIB_DEV);
    ADD_DEV('Andrew Downing', CONTRIB_DEV);
    ADD_DEV('Jan Dubiec', CONTRIB_DEV);
    ADD_DEV('Lucas Dumont', CONTRIB_DEV);
    ADD_DEV('Ruben De Smet', CONTRIB_DEV);

    ADD_DEV('Gerd Egidy', CONTRIB_DEV);
    ADD_DEV('Jean Philippe Eimer', CONTRIB_DEV);
    ADD_DEV('Ben Ellis', CONTRIB_DEV);
    ADD_DEV('Oleg Endo', CONTRIB_DEV);
    ADD_DEV('Damien Espitallier', CONTRIB_DEV);
    ADD_DEV('Paul Ewing', CONTRIB_DEV);

    ADD_DEV('Steven A. Falco', CONTRIB_DEV);
    ADD_DEV('Andrey Fedorushkov', CONTRIB_DEV);
    ADD_DEV('Julian Fellinger', CONTRIB_DEV);
    ADD_DEV('Joe Ferner', CONTRIB_DEV);
    ADD_DEV('Brian Fiete', CONTRIB_DEV);
    ADD_DEV('Thomas Figueroa', CONTRIB_DEV);
    ADD_DEV('Gilbert J.M. Forkel', CONTRIB_DEV);
    ADD_DEV('Vincenzo Fortunato', CONTRIB_DEV);
    ADD_DEV('Quentin Freimanis', CONTRIB_DEV);
    ADD_DEV('Dominique Fuchs', CONTRIB_DEV);
    ADD_DEV('Drew Fustini', CONTRIB_DEV);

    ADD_DEV('Ronnie Gaensli', CONTRIB_DEV);
    ADD_DEV('Christian Gagneraud', CONTRIB_DEV);
    ADD_DEV('Kamil Galik', CONTRIB_DEV);
    ADD_DEV('Ben Gamari', CONTRIB_DEV);
    ADD_DEV('Thomas Gambier', CONTRIB_DEV);
    ADD_DEV('Ashutosh Gangwar', CONTRIB_DEV);
    ADD_DEV('Adrián García', CONTRIB_DEV);
    ADD_DEV('Alessandro Gatti', CONTRIB_DEV);
    ADD_DEV('Zenn Geeraerts', CONTRIB_DEV);
    ADD_DEV('Hal Gentz', CONTRIB_DEV);
    ADD_DEV('Lucas Gerads', CONTRIB_DEV);
    ADD_DEV('Davide Gerhard', CONTRIB_DEV);
    ADD_DEV('Michael Geselbracht', CONTRIB_DEV);
    ADD_DEV('Giulio Girardi', CONTRIB_DEV);
    ADD_DEV('Jeff Glass', CONTRIB_DEV);
    ADD_DEV('Alexander Golubev', CONTRIB_DEV);
    ADD_DEV('Paweł Gorgoń', CONTRIB_DEV);
    ADD_DEV('Connor Goss', CONTRIB_DEV);
    ADD_DEV('Angus Gratton', CONTRIB_DEV);
    ADD_DEV('Andrea Greco', CONTRIB_DEV);
    ADD_DEV('Element Green', CONTRIB_DEV);
    ADD_DEV('Mathias Grimmberger', CONTRIB_DEV);
    ADD_DEV('Johan Grip', CONTRIB_DEV);
    ADD_DEV('Michal Grzegorzek', CONTRIB_DEV);
    ADD_DEV('Niki Guldbrand', CONTRIB_DEV);
    ADD_DEV('Tanay Gupta', CONTRIB_DEV);
    ADD_DEV('Alexander Guy', CONTRIB_DEV);
    ADD_DEV('Zoltan Gyarmati', CONTRIB_DEV);
    ADD_DEV('Hildo Guillardi Júnior', CONTRIB_DEV);

    ADD_DEV('Jonathan Haas', CONTRIB_DEV);
    ADD_DEV('Mark Hämmerling', CONTRIB_DEV);
    ADD_DEV('Stefan Hamminga', CONTRIB_DEV);
    ADD_DEV('Ma Han', CONTRIB_DEV);
    ADD_DEV('Scott Hanson', CONTRIB_DEV);
    ADD_DEV('Ben Harris', CONTRIB_DEV);
    ADD_DEV('Lukas F. Hartmann', CONTRIB_DEV);
    ADD_DEV('Jakob Haufe', CONTRIB_DEV);
    ADD_DEV('Aylons Hazzud', CONTRIB_DEV);
    ADD_DEV('Stefan Helmert', CONTRIB_DEV);
    ADD_DEV('Hartmut Henkel', CONTRIB_DEV);
    ADD_DEV('Brian Henning', CONTRIB_DEV);
    ADD_DEV('Diego Herranz', CONTRIB_DEV);
    ADD_DEV('Marco Hess', CONTRIB_DEV);
    ADD_DEV('Brendan Hickey', CONTRIB_DEV);
    ADD_DEV('Petri Hodju', CONTRIB_DEV);
    ADD_DEV('David Holdeman', CONTRIB_DEV);
    ADD_DEV('Laurens Holst', CONTRIB_DEV);
    ADD_DEV('Yang Hongbo', CONTRIB_DEV);
    ADD_DEV('Mario Hros', CONTRIB_DEV);
    ADD_DEV('Josue Huaroto', CONTRIB_DEV);
    ADD_DEV('Eli Hughes', CONTRIB_DEV);
    ADD_DEV('Matt Huszagh', CONTRIB_DEV);
    ADD_DEV('Torsten Hüter', CONTRIB_DEV);
    ADD_DEV('Paulo Henrique Silva', CONTRIB_DEV);
    ADD_DEV('Hans Henry von Tresckow', CONTRIB_DEV);

    ADD_DEV('Marco Inacio', CONTRIB_DEV);
    ADD_DEV('Kinichiro Inoguchi', CONTRIB_DEV);
    ADD_DEV('Fabián Inostroza', CONTRIB_DEV);
    ADD_DEV('Vlad Ivanov', CONTRIB_DEV);
    ADD_DEV('Andre Iwers', CONTRIB_DEV);
    ADD_DEV('José Ignacio Romero', CONTRIB_DEV);

    ADD_DEV('José Jorge Enríquez', CONTRIB_DEV);
    ADD_DEV('Hasan Jaafar', CONTRIB_DEV);
    ADD_DEV('Jerry Jacobs', CONTRIB_DEV);
    ADD_DEV('Christian Jacobsen', CONTRIB_DEV);
    ADD_DEV('Michal Jahelka', CONTRIB_DEV);
    ADD_DEV('Martin Janitschke', CONTRIB_DEV);
    ADD_DEV('Jonathan Jara-Almonte', CONTRIB_DEV);
    ADD_DEV('Zhuang Jiezhi', CONTRIB_DEV);
    ADD_DEV('Franck Jullien', CONTRIB_DEV);

    ADD_DEV('Eeli Kaikkonen', CONTRIB_DEV);
    ADD_DEV('Lajos Kamocsay', CONTRIB_DEV);
    ADD_DEV('Povilas Kanapickas', CONTRIB_DEV);
    ADD_DEV('Mikhail Karpenko', CONTRIB_DEV);
    ADD_DEV('Kerusey Karyu', CONTRIB_DEV);
    ADD_DEV('Michael Kavanagh', CONTRIB_DEV);
    ADD_DEV('Tom Keddie', CONTRIB_DEV);
    ADD_DEV('Graham Keeth', CONTRIB_DEV);
    ADD_DEV('Yury Khalyavin', CONTRIB_DEV);
    ADD_DEV('Eldar Khayrullin', CONTRIB_DEV);
    ADD_DEV('Lenny Khazan', CONTRIB_DEV);
    ADD_DEV('Georges Khaznadar', CONTRIB_DEV);
    ADD_DEV('Gary Kim', CONTRIB_DEV);
    ADD_DEV('Aristeidis Kimirtzis', CONTRIB_DEV);
    ADD_DEV('Bernhard Kirchen', CONTRIB_DEV);
    ADD_DEV('Ingo Kletti', CONTRIB_DEV);
    ADD_DEV('Kliment', CONTRIB_DEV);
    ADD_DEV('Sylwester Kocjan', CONTRIB_DEV);
    ADD_DEV('Uli Köhler', CONTRIB_DEV);
    ADD_DEV('Clemens Koller', CONTRIB_DEV);
    ADD_DEV('Asuki Kono', CONTRIB_DEV);
    ADD_DEV('Matt Kosman', CONTRIB_DEV);
    ADD_DEV('Jakub Kozdon', CONTRIB_DEV);
    ADD_DEV('Hajo Nils Krabbenhöft', CONTRIB_DEV);
    ADD_DEV('Andrej Krpic', CONTRIB_DEV);
    ADD_DEV('Simon Kueppers', CONTRIB_DEV);
    ADD_DEV('Martijn Kuipers', CONTRIB_DEV);
    ADD_DEV('Dhinesh Kumar', CONTRIB_DEV);
    ADD_DEV('Eric Kuzmenko', CONTRIB_DEV);

    ADD_DEV('Paul LeoNerd Evens', CONTRIB_DEV);
    ADD_DEV('Robbert Lagerweij', CONTRIB_DEV);
    ADD_DEV('Mika Laitio', CONTRIB_DEV);
    ADD_DEV('Floris Lambrechts', CONTRIB_DEV);
    ADD_DEV('Dimitris Lampridis', CONTRIB_DEV);
    ADD_DEV('Marco Langer', CONTRIB_DEV);
    ADD_DEV('Kevin Lannen', CONTRIB_DEV);
    ADD_DEV('lê văn lập', CONTRIB_DEV);
    ADD_DEV('Denis Latyshev', CONTRIB_DEV);
    ADD_DEV('Anton Lazarev', CONTRIB_DEV);
    ADD_DEV('Ludovic Léau-mercier', CONTRIB_DEV);
    ADD_DEV('Dag Lem', CONTRIB_DEV);
    ADD_DEV('Jonatan Liljedahl', CONTRIB_DEV);
    ADD_DEV('Huanyin Liu', CONTRIB_DEV);
    ADD_DEV('Brian Lu', CONTRIB_DEV);
    ADD_DEV('Magnus Lundmark', CONTRIB_DEV);
    ADD_DEV('Alexander Lunev', CONTRIB_DEV);
    ADD_DEV('Andrew Lutsenko', CONTRIB_DEV);
    ADD_DEV('Mario Luzeiro', CONTRIB_DEV);

    ADD_DEV('Mojca Miklavec Groenhuis', CONTRIB_DEV);
    ADD_DEV('Johannes Maibaum', CONTRIB_DEV);
    ADD_DEV('Philippe Maire', CONTRIB_DEV);
    ADD_DEV('Mateusz Majchrzycki', CONTRIB_DEV);
    ADD_DEV('Daniel Majewski', CONTRIB_DEV);
    ADD_DEV('Rachel Mant', CONTRIB_DEV);
    ADD_DEV('Lorenzo Marcantonio', CONTRIB_DEV);
    ADD_DEV('Miklós Márton', CONTRIB_DEV);
    ADD_DEV('Marco Mattila', CONTRIB_DEV);
    ADD_DEV('Steffen Mauch', CONTRIB_DEV);
    ADD_DEV('Maui', CONTRIB_DEV);
    ADD_DEV('Kirill Mavreshko', CONTRIB_DEV);
    ADD_DEV('Brian Mayton', CONTRIB_DEV);
    ADD_DEV('Miles McCoo', CONTRIB_DEV);
    ADD_DEV('Charles McDowell', CONTRIB_DEV);
    ADD_DEV('Ian McKernan', CONTRIB_DEV);
    ADD_DEV('Moses McKnight', CONTRIB_DEV);
    ADD_DEV('Martin McNamara', CONTRIB_DEV);
    ADD_DEV('Cameron McQuinn', CONTRIB_DEV);
    ADD_DEV('Ievgenii Meshcheriakov', CONTRIB_DEV);
    ADD_DEV('Yiannis Michael', CONTRIB_DEV);
    ADD_DEV('Ashley Mills', CONTRIB_DEV);
    ADD_DEV('Christoph Moench-Tegeder', CONTRIB_DEV);
    ADD_DEV('Sean Mollet', CONTRIB_DEV);
    ADD_DEV('Peter Montgomery', CONTRIB_DEV);
    ADD_DEV('Alejandro García Montoro', CONTRIB_DEV);
    ADD_DEV('Chris Morgan', CONTRIB_DEV);
    ADD_DEV('Felix Morgner', CONTRIB_DEV);
    ADD_DEV('Jan Mrázek', CONTRIB_DEV);
    ADD_DEV('Frank Muenstermann', CONTRIB_DEV);

    ADD_DEV('Michael Narigon', CONTRIB_DEV);
    ADD_DEV('Jon Neal', CONTRIB_DEV);
    ADD_DEV('Bastian Neumann', CONTRIB_DEV);
    ADD_DEV('Kristian Nielsen', CONTRIB_DEV);
    ADD_DEV('Daniil Nikolaev', CONTRIB_DEV);
    ADD_DEV('Érico Nogueira', CONTRIB_DEV);
    ADD_DEV('Allan Nordhøy', CONTRIB_DEV);
    ADD_DEV('Henrik Nyberg', CONTRIB_DEV);

    ADD_DEV('Kristoffer Ödmark', CONTRIB_DEV);
    ADD_DEV('Russell Oliver', CONTRIB_DEV);
    ADD_DEV('Jason Oster', CONTRIB_DEV);
    ADD_DEV('Juho Ovaska', CONTRIB_DEV);

    ADD_DEV('Frank Palazzolo', CONTRIB_DEV);
    ADD_DEV('Sven Pauli', CONTRIB_DEV);
    ADD_DEV('Matus Pavelek', CONTRIB_DEV);
    ADD_DEV('luz paz', CONTRIB_DEV);
    ADD_DEV('Miguel Angel Ajo Pelayo', CONTRIB_DEV);
    ADD_DEV('Patrick Pereira', CONTRIB_DEV);
    ADD_DEV('Jacobo Aragunde Perez', CONTRIB_DEV);
    ADD_DEV('Matthew Petroff', CONTRIB_DEV);
    ADD_DEV('Johannes Pfister', CONTRIB_DEV);
    ADD_DEV('Fabian Pflug', CONTRIB_DEV);
    ADD_DEV('Christian Pfluger', CONTRIB_DEV);
    ADD_DEV('Brian Piccioni', CONTRIB_DEV);
    ADD_DEV('Mathieu Pilato', CONTRIB_DEV);
    ADD_DEV('Nicolas Planel', CONTRIB_DEV);
    ADD_DEV('Carl Poirier', CONTRIB_DEV);
    ADD_DEV('Reece Pollack', CONTRIB_DEV);
    ADD_DEV('Alain Portal', CONTRIB_DEV);
    ADD_DEV('Andrei Pozolotin', CONTRIB_DEV);
    ADD_DEV('Damjan Prerad', CONTRIB_DEV);
    ADD_DEV('Antia Puentes', CONTRIB_DEV);
    ADD_DEV('Heikki Pulkkinen', CONTRIB_DEV);
    ADD_DEV('Zoltan Puskas', CONTRIB_DEV);
    ADD_DEV('Paweł Płóciennik', CONTRIB_DEV);

    ADD_DEV('Morgan Quigley', CONTRIB_DEV);

    ADD_DEV('Zlatan Radovanovic', CONTRIB_DEV);
    ADD_DEV('Barabas Raffai', CONTRIB_DEV);
    ADD_DEV('Urja Rannikko', CONTRIB_DEV);
    ADD_DEV('Alexander Rauth', CONTRIB_DEV);
    ADD_DEV('Hendrik v. Raven', CONTRIB_DEV);
    ADD_DEV('Joshua Redstone', CONTRIB_DEV);
    ADD_DEV('David Rees', CONTRIB_DEV);
    ADD_DEV('Michele Renda', CONTRIB_DEV);
    ADD_DEV('Jean-Samuel Reynaud', CONTRIB_DEV);
    ADD_DEV('Dmitry Rezvanov', CONTRIB_DEV);
    ADD_DEV('Simon Richter', CONTRIB_DEV);
    ADD_DEV('Christoph Riehl', CONTRIB_DEV);
    ADD_DEV('Thiadmer Riemersma', CONTRIB_DEV);
    ADD_DEV('Gregor Riepl', CONTRIB_DEV);
    ADD_DEV('RigoLigoRLC', CONTRIB_DEV);
    ADD_DEV('Ola Rinta-Koski', CONTRIB_DEV);
    ADD_DEV('Lubomir Rintel', CONTRIB_DEV);
    ADD_DEV('Érico Rolim', CONTRIB_DEV);
    ADD_DEV('Marcus A. Romer', CONTRIB_DEV);
    ADD_DEV('Heiko Rosemann', CONTRIB_DEV);
    ADD_DEV('Fabio Rossi', CONTRIB_DEV);
    ADD_DEV('Ian Roth', CONTRIB_DEV);
    ADD_DEV('Huang Rui', CONTRIB_DEV);

    ADD_DEV('Clément Saccoccio', CONTRIB_DEV);
    ADD_DEV('J. Morio Sakaguchi', CONTRIB_DEV);
    ADD_DEV('Simon Schaak', CONTRIB_DEV);
    ADD_DEV('Olliver Schinagl', CONTRIB_DEV);
    ADD_DEV('Ross Schlaikjer', CONTRIB_DEV);
    ADD_DEV('Julius Schmidt', CONTRIB_DEV);
    ADD_DEV('Marvin Schmidt', CONTRIB_DEV);
    ADD_DEV('Felix Schneider', CONTRIB_DEV);
    ADD_DEV('David Schneider', CONTRIB_DEV);
    ADD_DEV('Carsten Schoenert', CONTRIB_DEV);
    ADD_DEV('Armin Schoisswohl', CONTRIB_DEV);
    ADD_DEV('Simon Schubert', CONTRIB_DEV);
    ADD_DEV('Michal Schulz', CONTRIB_DEV);
    ADD_DEV('Adrian Scripca', CONTRIB_DEV);
    ADD_DEV('Pradeepa Senanayake', CONTRIB_DEV);
    ADD_DEV('Alihossein Sepahvand', CONTRIB_DEV);
    ADD_DEV('Marco Serantoni', CONTRIB_DEV);
    ADD_DEV('Julien Serin', CONTRIB_DEV);
    ADD_DEV('Frank Severinsen', CONTRIB_DEV);
    ADD_DEV('Cheng Sheng', CONTRIB_DEV);
    ADD_DEV('Yang Sheng', CONTRIB_DEV);
    ADD_DEV('Chetan Shinde', CONTRIB_DEV);
    ADD_DEV('Alexander Shuklin', CONTRIB_DEV);
    ADD_DEV('Guillaume Simard', CONTRIB_DEV);
    ADD_DEV('Adam Simpkins', CONTRIB_DEV);
    ADD_DEV('Slawomir Siudym', CONTRIB_DEV);
    ADD_DEV('Martin Sivak', CONTRIB_DEV);
    ADD_DEV('Mateusz Skowroński', CONTRIB_DEV);
    ADD_DEV('Dominik Sliwa', CONTRIB_DEV);
    ADD_DEV('Blake Smith', CONTRIB_DEV);
    ADD_DEV('Ikoma So', CONTRIB_DEV);
    ADD_DEV('Michal Sojka', CONTRIB_DEV);
    ADD_DEV('Rafael Sokolowski', CONTRIB_DEV);
    ADD_DEV('Vesa Solonen', CONTRIB_DEV);
    ADD_DEV('Ronald Sousa', CONTRIB_DEV);
    ADD_DEV('Craig Southeren', CONTRIB_DEV);
    ADD_DEV('Thomas Spindler', CONTRIB_DEV);
    ADD_DEV('Seppe Stas', CONTRIB_DEV);
    ADD_DEV('Bernhard Stegmaier', CONTRIB_DEV);
    ADD_DEV('Michael Steinberg', CONTRIB_DEV);
    ADD_DEV('Marco Sterbik', CONTRIB_DEV);
    ADD_DEV('Alexander Stock', CONTRIB_DEV);
    ADD_DEV('Martin Stoilov', CONTRIB_DEV);
    ADD_DEV('Michal Suchánek', CONTRIB_DEV);
    ADD_DEV('Hiroki Suenaga', CONTRIB_DEV);
    ADD_DEV('Kuba Sunderland-Ober', CONTRIB_DEV);
    ADD_DEV('Kacper Słomiński', CONTRIB_DEV);

    ADD_DEV('Nimish Telang', CONTRIB_DEV);
    ADD_DEV('Martin Thierer', CONTRIB_DEV);
    ADD_DEV('Karl Thorén', CONTRIB_DEV);
    ADD_DEV('Hiroshi Tokita', CONTRIB_DEV);
    ADD_DEV('Daniel Treffenstädt', CONTRIB_DEV);
    ADD_DEV('Salvador E. Tropea', CONTRIB_DEV);

    ADD_DEV('Vladimir Ur', CONTRIB_DEV);
    ADD_DEV('Yon Uriarte', CONTRIB_DEV);
    ADD_DEV('Matthias Urlichs', CONTRIB_DEV);
    ADD_DEV('Vladimir Uryvaev', CONTRIB_DEV);

    ADD_DEV('Mark van Doesburg', CONTRIB_DEV);
    ADD_DEV('Edwin van den Oetelaar', CONTRIB_DEV);
    ADD_DEV('Julie Vairai', CONTRIB_DEV);
    ADD_DEV('Andrej Valek', CONTRIB_DEV);
    ADD_DEV('Henri Valta', CONTRIB_DEV);
    ADD_DEV('Dave Vandenbout', CONTRIB_DEV);
    ADD_DEV('Raman Varabets', CONTRIB_DEV);
    ADD_DEV('Fabio Varesano', CONTRIB_DEV);
    ADD_DEV('Akhil Velagapudi', CONTRIB_DEV);
    ADD_DEV('Emmanuel Vera', CONTRIB_DEV);
    ADD_DEV('Benjamin Vernoux', CONTRIB_DEV);
    ADD_DEV('Frank Villaro-Dixon', CONTRIB_DEV);
    ADD_DEV('Mark Visser', CONTRIB_DEV);
    ADD_DEV('Forrest Voight', CONTRIB_DEV);
    ADD_DEV('Tormod Volden', CONTRIB_DEV);
    ADD_DEV('Nils van Zuijlen', CONTRIB_DEV);

    ADD_DEV('Bartek Wacławik', CONTRIB_DEV);
    ADD_DEV('Johannes Wågen', CONTRIB_DEV);
    ADD_DEV('Oliver Walters', CONTRIB_DEV);
    ADD_DEV('Jonathan Warner', CONTRIB_DEV);
    ADD_DEV('Dan Weatherill', CONTRIB_DEV);
    ADD_DEV('Stefan Weber', CONTRIB_DEV);
    ADD_DEV('Christian Weickhmann', CONTRIB_DEV);
    ADD_DEV('Bevan Weiss', CONTRIB_DEV);
    ADD_DEV('Simon Wells', CONTRIB_DEV);
    ADD_DEV('Dominik Wernberger', CONTRIB_DEV);
    ADD_DEV('Martin Whitaker', CONTRIB_DEV);
    ADD_DEV('Addo White', CONTRIB_DEV);
    ADD_DEV('Jan Wichmann', CONTRIB_DEV);
    ADD_DEV('Bernhard M. Wiedemann', CONTRIB_DEV);
    ADD_DEV('Nick Winters', CONTRIB_DEV);
    ADD_DEV('Adam Wolf', CONTRIB_DEV);
    ADD_DEV('Andrzej Wolski', CONTRIB_DEV);
    ADD_DEV('Céleste Wouters', CONTRIB_DEV);
    ADD_DEV('Damian Wrobel', CONTRIB_DEV);
    ADD_DEV('Andrew Wygle', CONTRIB_DEV);
    ADD_DEV('Adam Wysocki', CONTRIB_DEV);

    ADD_DEV('xx', CONTRIB_DEV);

    ADD_DEV('Jiaxun Yang', CONTRIB_DEV);
    ADD_DEV('Robert Yates', CONTRIB_DEV);
    ADD_DEV('Yegor Yefremov', CONTRIB_DEV);
    ADD_DEV('Kenta Yonekura', CONTRIB_DEV);

    ADD_DEV('Alexander Zakamaldin', CONTRIB_DEV);
    ADD_DEV('Frank Zeeman', CONTRIB_DEV);
    ADD_DEV('Karl Zeilhofer', CONTRIB_DEV);
    ADD_DEV('Henner Zeller', CONTRIB_DEV);
    ADD_DEV('Kevin Zheng', CONTRIB_DEV);
    ADD_DEV('Andrew Zonenberg', CONTRIB_DEV);

    ADD_DEV('wh201906', CONTRIB_DEV);
    ADD_DEV('Nick Østergaard', CONTRIB_DEV);
    ADD_DEV('木 王', CONTRIB_DEV);

    // The document writers
    const DOC_TEAM = 'Documentation Team';
    const ADD_WRITER = (name: string, category: string): void =>
      aInfo.AddDocWriter(new CONTRIBUTOR(name, category));
    ADD_WRITER('Scott Candey', DOC_TEAM);
    ADD_WRITER('Jean-Pierre Charras', DOC_TEAM);
    ADD_WRITER('Marco Ciampa', DOC_TEAM);
    ADD_WRITER('Jon Evans', DOC_TEAM);
    ADD_WRITER('Dick Hollenbeck', DOC_TEAM);
    ADD_WRITER('James Jackson', DOC_TEAM);
    ADD_WRITER('Graham Keeth', DOC_TEAM);
    ADD_WRITER('Igor Plyatov', DOC_TEAM);
    ADD_WRITER('Wayne Stambaugh', DOC_TEAM);
    ADD_WRITER('Fabrizio Tappero', DOC_TEAM);
    ADD_WRITER('taotieren', DOC_TEAM);

    /* The translators
     * As category the language to which the translation was done is used
     */
    const ADD_TRANSLATOR = (name: string, category: string): void =>
      aInfo.AddTranslator(new CONTRIBUTOR(name, category));
    ADD_TRANSLATOR('Radovan Blažek', 'Czech (CS)');
    ADD_TRANSLATOR('Ondřej Čertík', 'Czech (CS)');
    ADD_TRANSLATOR('Martin Kratoška', 'Czech (CS)');
    ADD_TRANSLATOR('Michal Kundrát', 'Czech (CS)');
    ADD_TRANSLATOR('Radek Kuznik', 'Czech (CS)');
    ADD_TRANSLATOR('Roman Ondráček', 'Czech (CS)');
    ADD_TRANSLATOR('Petr Pazourek', 'Czech (CS)');
    ADD_TRANSLATOR('René Široký', 'Czech (CS)');
    ADD_TRANSLATOR('Hynek Štětina', 'Czech (CS)');
    ADD_TRANSLATOR('Jan Straka', 'Czech (CS)');
    ADD_TRANSLATOR('Andrej Valek', 'Czech (CS)');
    ADD_TRANSLATOR('Jan Vykydal', 'Czech (CS)');

    ADD_TRANSLATOR('Mads Dyrmann', 'Danish (DA)');
    ADD_TRANSLATOR('Henrik Kauhanen', 'Danish (DA)');
    ADD_TRANSLATOR('Nick Østergaard', 'Danish (DA)');

    ADD_TRANSLATOR('Ettore Atalan', 'German (DE)');
    ADD_TRANSLATOR('Ivan Chuba', 'German (DE)');
    ADD_TRANSLATOR('Julian Daube', 'German (DE)');
    ADD_TRANSLATOR('Benedikt Freisen', 'German (DE)');
    ADD_TRANSLATOR('Jonathan Haas', 'German (DE)');
    ADD_TRANSLATOR('Mark Hämmerling', 'German (DE)');
    ADD_TRANSLATOR('Henrik Kauhanen', 'German (DE)');
    ADD_TRANSLATOR('Johannes Maibaum', 'German (DE)');
    ADD_TRANSLATOR('Mathias Neumann', 'German (DE)');
    ADD_TRANSLATOR('Ken Ovo', 'German (DE)');
    ADD_TRANSLATOR('Christian Schlüter', 'German (DE)');
    ADD_TRANSLATOR('Karl Schuh', 'German (DE)');
    ADD_TRANSLATOR('Frank Sonnenberg', 'German (DE)');
    ADD_TRANSLATOR('Lauritz Tieste', 'German (DE)');
    ADD_TRANSLATOR('Dominik Wernberger', 'German (DE)');

    ADD_TRANSLATOR('Theodoros Asimakopoulos', 'Greek (el_GR)');
    ADD_TRANSLATOR('Aristeidis Kimirtzis', 'Greek (el_GR)');
    ADD_TRANSLATOR('Milonas Kostas', 'Greek (el_GR)');
    ADD_TRANSLATOR('Michail Misirlis', 'Greek (el_GR)');
    ADD_TRANSLATOR('Manolis Stefanis', 'Greek (el_GR)');
    ADD_TRANSLATOR('Athanasios Vlastos', 'Greek (el_GR)');

    ADD_TRANSLATOR('Adolfo Jayme Barrientos', 'Spanish (ES)');
    ADD_TRANSLATOR('Roberto Fernandez Bautista', 'Spanish (ES)');
    ADD_TRANSLATOR('Pablo Bianchi', 'Spanish (ES)');
    ADD_TRANSLATOR('Echedey', 'Spanish (ES)');
    ADD_TRANSLATOR('Iñigo Figuero', 'Spanish (ES)');
    ADD_TRANSLATOR('Augusto Fraga Giachero', 'Spanish (ES)');
    ADD_TRANSLATOR('Ulices Avila Hernandez', 'Spanish (ES)');
    ADD_TRANSLATOR('Gabriel Martinez', 'Spanish (ES)');
    ADD_TRANSLATOR('Tomás Mora', 'Spanish (ES)');
    ADD_TRANSLATOR('Gallego Novato', 'Spanish (ES)');
    ADD_TRANSLATOR('Jose Perez', 'Spanish (ES)');
    ADD_TRANSLATOR('Francisco Jose Rey', 'Spanish (ES)');
    ADD_TRANSLATOR('Gaston Schelotto', 'Spanish (ES)');
    ADD_TRANSLATOR('uLe', 'Spanish (ES)');
    ADD_TRANSLATOR('Pedro Martin del Valle', 'Spanish (ES)');
    ADD_TRANSLATOR('VicSanRoPe', 'Spanish (ES)');
    ADD_TRANSLATOR('Iñigo Zuluaga', 'Spanish (ES)');

    ADD_TRANSLATOR('Ulices Avila Hernandez', 'Spanish - Latin American (ES)');
    ADD_TRANSLATOR('lylythechosenone', 'Spanish - Latin American (ES)');
    ADD_TRANSLATOR('uLe', 'Spanish - Latin American (ES)');
    ADD_TRANSLATOR('VicSanRoPe', 'Spanish - Latin American (ES)');

    ADD_TRANSLATOR('Alex Gellen', 'Finnish (FI)');
    ADD_TRANSLATOR('Henrik Kauhanen', 'Finnish (FI)');
    ADD_TRANSLATOR('Purkka Koodari', 'Finnish (FI)');
    ADD_TRANSLATOR('Toni Laiho', 'Finnish (FI)');
    ADD_TRANSLATOR('J. Lavoie', 'Finnish (FI)');
    ADD_TRANSLATOR('Simo Mattila', 'Finnish (FI)');
    ADD_TRANSLATOR('Petri Niemelä', 'Finnish (FI)');
    ADD_TRANSLATOR('Ola Rinta-Koski', 'Finnish (FI)');
    ADD_TRANSLATOR('Vesa Solonen', 'Finnish (FI)');
    ADD_TRANSLATOR('Ricky Tigg', 'Finnish (FI)');
    ADD_TRANSLATOR('Riku Viitanen', 'Finnish (FI)');

    ADD_TRANSLATOR('Jean-Pierre Charras', 'French (FR)');

    ADD_TRANSLATOR('Boromyr', 'Italian (IT)');
    ADD_TRANSLATOR('Marco Ciampa', 'Italian (IT)');
    ADD_TRANSLATOR('Luca Mattii', 'Italian (IT)');

    ADD_TRANSLATOR('2tama3', 'Japanese (JA)');
    ADD_TRANSLATOR('Subaru Arai', 'Japanese (JA)');
    ADD_TRANSLATOR('Ji Yoon Choi', 'Japanese (JA)');
    ADD_TRANSLATOR('Hidemichi Gotou', 'Japanese (JA)');
    ADD_TRANSLATOR('Kinichiro Inoguchi', 'Japanese (JA)');
    ADD_TRANSLATOR('co8 j', 'Japanese (JA)');
    ADD_TRANSLATOR('Keisuke Nakao', 'Japanese (JA)');
    ADD_TRANSLATOR('starfort-jp', 'Japanese (JA)');
    ADD_TRANSLATOR('Norio Suzuki', 'Japanese (JA)');
    ADD_TRANSLATOR('Hiroshi Tokita', 'Japanese (JA)');
    ADD_TRANSLATOR('Yutaro Urata', 'Japanese (JA)');
    ADD_TRANSLATOR('Kenta Yonekura', 'Japanese (JA)');
    ADD_TRANSLATOR('Kaoru Zenyouji', 'Japanese (JA)');

    ADD_TRANSLATOR('Minsu Kim (0xGabriel)', 'Korean (KO)');
    ADD_TRANSLATOR('Ji Yoon Choi', 'Korean (KO)');
    ADD_TRANSLATOR('DevAny', 'Korean (KO)');
    ADD_TRANSLATOR('hokim', 'Korean (KO)');
    ADD_TRANSLATOR('jehunseo', 'Korean (KO)');
    ADD_TRANSLATOR('jeong-sangwon', 'Korean (KO)');
    ADD_TRANSLATOR('jeongsuAn', 'Korean (KO)');
    ADD_TRANSLATOR('Uibeom Jung', 'Korean (KO)');
    ADD_TRANSLATOR('kmn4555', 'Korean (KO)');
    ADD_TRANSLATOR('KwonHyeokbeom', 'Korean (KO)');
    ADD_TRANSLATOR('Pedro Moreira', 'Korean (KO)');
    ADD_TRANSLATOR('Jason Son', 'Korean (KO)');
    ADD_TRANSLATOR('YunJiSang', 'Korean (KO)');
    ADD_TRANSLATOR('강명구', 'Korean (KO)');
    ADD_TRANSLATOR('김낙환', 'Korean (KO)');
    ADD_TRANSLATOR('김랑기', 'Korean (KO)');
    ADD_TRANSLATOR('김세영', 'Korean (KO)');
    ADD_TRANSLATOR('김용재', 'Korean (KO)');
    ADD_TRANSLATOR('김유진', 'Korean (KO)');
    ADD_TRANSLATOR('김인수', 'Korean (KO)');
    ADD_TRANSLATOR('김호진', 'Korean (KO)');
    ADD_TRANSLATOR('남우근', 'Korean (KO)');
    ADD_TRANSLATOR('박기정', 'Korean (KO)');
    ADD_TRANSLATOR('박세훈', 'Korean (KO)');
    ADD_TRANSLATOR('박준언', 'Korean (KO)');
    ADD_TRANSLATOR('방준영', 'Korean (KO)');
    ADD_TRANSLATOR('서범기', 'Korean (KO)');
    ADD_TRANSLATOR('이기형', 'Korean (KO)');
    ADD_TRANSLATOR('이상수', 'Korean (KO)');
    ADD_TRANSLATOR('이윤성', 'Korean (KO)');
    ADD_TRANSLATOR('킴슨김랑기', 'Korean (KO)');

    ADD_TRANSLATOR('Ignas Brašiškis', 'Lithuanian (LT)');
    ADD_TRANSLATOR('Henrik Kauhanen', 'Lithuanian (LT)');
    ADD_TRANSLATOR('Dainius Mazuika', 'Lithuanian (LT)');
    ADD_TRANSLATOR('WhiteChairFromIkea', 'Lithuanian (LT)');

    ADD_TRANSLATOR('Arend-Jan van Hilten', 'Dutch (NL)');
    ADD_TRANSLATOR('CJ van der Hoeven', 'Dutch (NL)');
    ADD_TRANSLATOR('Laurens Holst', 'Dutch (NL)');
    ADD_TRANSLATOR('Pim Jansen', 'Dutch (NL)');
    ADD_TRANSLATOR('Robin Janssens', 'Dutch (NL)');
    ADD_TRANSLATOR('johanneswilkens', 'Dutch (NL)');
    ADD_TRANSLATOR('Henrik Kauhanen', 'Dutch (NL)');
    ADD_TRANSLATOR('Tom Niesse', 'Dutch (NL)');
    ADD_TRANSLATOR('Christiaan Nieuwlaat', 'Dutch (NL)');
    ADD_TRANSLATOR('Stefan De Raedemaeker', 'Dutch (NL)');
    ADD_TRANSLATOR('Ranforingus', 'Dutch (NL)');
    ADD_TRANSLATOR('Herman van der Vaart', 'Dutch (NL)');
    ADD_TRANSLATOR('Bas Wijnen', 'Dutch (NL)');

    ADD_TRANSLATOR('Jarl Gjessing', 'Norwegian (NO)');
    ADD_TRANSLATOR('Henrik Kauhanen', 'Norwegian (NO)');
    ADD_TRANSLATOR('Stian Kristensen', 'Norwegian (NO)');
    ADD_TRANSLATOR('Allan Nordhøy', 'Norwegian (NO)');
    ADD_TRANSLATOR('Petter Reinholdtsen', 'Norwegian (NO)');
    ADD_TRANSLATOR('Håvard Syslak', 'Norwegian (NO)');

    ADD_TRANSLATOR('Ivan Chuba', 'Polish (PL)');
    ADD_TRANSLATOR('Czam Ciał', 'Polish (PL)');
    ADD_TRANSLATOR('Kerusey Karyu', 'Polish (PL)');
    ADD_TRANSLATOR('Krzysztof Kawa', 'Polish (PL)');
    ADD_TRANSLATOR('J Kolod', 'Polish (PL)');
    ADD_TRANSLATOR('maksz42', 'Polish (PL)');
    ADD_TRANSLATOR('Eryk Michalak', 'Polish (PL)');
    ADD_TRANSLATOR('Filip Piękoś', 'Polish (PL)');
    ADD_TRANSLATOR('Pomian', 'Polish (PL)');
    ADD_TRANSLATOR('Mark Roszko', 'Polish (PL)');
    ADD_TRANSLATOR('Mateusz Skowroński', 'Polish (PL)');
    ADD_TRANSLATOR('Jan Sobków', 'Polish (PL)');
    ADD_TRANSLATOR('szumsky', 'Polish (PL)');
    ADD_TRANSLATOR('Grzegorz Szymaszek', 'Polish (PL)');
    ADD_TRANSLATOR('ZbeeGin', 'Polish (PL)');

    ADD_TRANSLATOR('brunofaus', 'Brazilian Portuguese (PT_BR)');
    ADD_TRANSLATOR('Augusto Fraga Giachero', 'Brazilian Portuguese (PT_BR)');
    ADD_TRANSLATOR('Hildo Guillardi Júnior', 'Brazilian Portuguese (PT_BR)');
    ADD_TRANSLATOR('Pedro Moreira', 'Brazilian Portuguese (PT_BR)');
    ADD_TRANSLATOR('soldado-do-wolfenstein', 'Brazilian Portuguese (PT_BR)');
    ADD_TRANSLATOR('Wellington Terumi Uemura', 'Brazilian Portuguese (PT_BR)');

    ADD_TRANSLATOR('Julio Dias', 'Portuguese (PT)');
    ADD_TRANSLATOR('Augusto Fraga Giachero', 'Portuguese (PT)');
    ADD_TRANSLATOR('Hildo Guillardi Júnior', 'Portuguese (PT)');
    ADD_TRANSLATOR('leonardokr', 'Portuguese (PT)');
    ADD_TRANSLATOR('Renie Marquet', 'Portuguese (PT)');
    ADD_TRANSLATOR('Rafael Silva', 'Portuguese (PT)');
    ADD_TRANSLATOR('Manuela Silva', 'Portuguese (PT)');
    ADD_TRANSLATOR('ssantos', 'Portuguese (PT)');

    ADD_TRANSLATOR('Konstantin Baranovskiy', 'Russian (RU)');
    ADD_TRANSLATOR('Ivan Chuba', 'Russian (RU)');
    ADD_TRANSLATOR('Andrey Fedorushkov', 'Russian (RU)');
    ADD_TRANSLATOR('Free_squire', 'Russian (RU)');
    ADD_TRANSLATOR('Alevtina Karashokova', 'Russian (RU)');
    ADD_TRANSLATOR('Eldar Khayrullin', 'Russian (RU)');
    ADD_TRANSLATOR('Alex Life', 'Russian (RU)');
    ADD_TRANSLATOR('Dmitry Mikhirev', 'Russian (RU)');
    ADD_TRANSLATOR('Igor Plyatov', 'Russian (RU)');
    ADD_TRANSLATOR('sergio', 'Russian (RU)');
    ADD_TRANSLATOR('xXx', 'Russian (RU)');
    ADD_TRANSLATOR('Дмитрий Дёмин', 'Russian (RU)');
    ADD_TRANSLATOR('МАН69К', 'Russian (RU)');

    ADD_TRANSLATOR('Hanna Breisand', 'Swedish (SV)');
    ADD_TRANSLATOR('Stefan Bjornelund the Gnome', 'Swedish (SV)');
    ADD_TRANSLATOR('Johan Heikkilä', 'Swedish (SV)');
    ADD_TRANSLATOR('Axel Henriksson', 'Swedish (SV)');
    ADD_TRANSLATOR('Richard Jonsson', 'Swedish (SV)');
    ADD_TRANSLATOR('Henrik Kauhanen', 'Swedish (SV)');
    ADD_TRANSLATOR('Joakim Lundborg', 'Swedish (SV)');
    ADD_TRANSLATOR('Allan Nordhøy', 'Swedish (SV)');
    ADD_TRANSLATOR('Elias Sjögreen', 'Swedish (SV)');

    ADD_TRANSLATOR('Boonchai Kingrungped', 'Thai (TH)');

    ADD_TRANSLATOR('Artem', 'Ukrainian (UK)');
    ADD_TRANSLATOR('Ivan Chuba', 'Ukrainian (UK)');
    ADD_TRANSLATOR('Stanislav Kaliuk', 'Ukrainian (UK)');
    ADD_TRANSLATOR('Alexsandr Kuzemko', 'Ukrainian (UK)');
    ADD_TRANSLATOR('Andrii Shelestov', 'Ukrainian (UK)');
    ADD_TRANSLATOR('Максим Горпиніч', 'Ukrainian (UK)');

    ADD_TRANSLATOR('CharlieYu', 'Simplified Chinese (zh_CN)');
    ADD_TRANSLATOR('David Chen', 'Simplified Chinese (zh_CN)');
    ADD_TRANSLATOR('Dingzhong Chen', 'Simplified Chinese (zh_CN)');
    ADD_TRANSLATOR('CloverGit', 'Simplified Chinese (zh_CN)');
    ADD_TRANSLATOR('Eric', 'Simplified Chinese (zh_CN)');
    ADD_TRANSLATOR('Liu Guang', 'Simplified Chinese (zh_CN)');
    ADD_TRANSLATOR('HalfSweet', 'Simplified Chinese (zh_CN)');
    ADD_TRANSLATOR('Hubert Hu', 'Simplified Chinese (zh_CN)');
    ADD_TRANSLATOR('aisuneko icecat', 'Simplified Chinese (zh_CN)');
    ADD_TRANSLATOR('Pinpang Liao', 'Simplified Chinese (zh_CN)');
    ADD_TRANSLATOR('Rigo Ligo', 'Simplified Chinese (zh_CN)');
    ADD_TRANSLATOR('Huanyin Liu', 'Simplified Chinese (zh_CN)');
    ADD_TRANSLATOR('Zhen Sun', 'Simplified Chinese (zh_CN)');
    ADD_TRANSLATOR('Jason Tan', 'Simplified Chinese (zh_CN)');
    ADD_TRANSLATOR('Taotieren', 'Simplified Chinese (zh_CN)');
    ADD_TRANSLATOR('yangyangdaji', 'Simplified Chinese (zh_CN)');
    ADD_TRANSLATOR('Li Yi', 'Simplified Chinese (zh_CN)');
    ADD_TRANSLATOR('Li Yidong', 'Simplified Chinese (zh_CN)');
    ADD_TRANSLATOR('Tian Yunhao', 'Simplified Chinese (zh_CN)');
    ADD_TRANSLATOR('Lao Zhu', 'Simplified Chinese (zh_CN)');
    ADD_TRANSLATOR('yanzhen zhu', 'Simplified Chinese (zh_CN)');
    ADD_TRANSLATOR('zly20129', 'Simplified Chinese (zh_CN)');
    ADD_TRANSLATOR('向阳阳', 'Simplified Chinese (zh_CN)');
    ADD_TRANSLATOR('欠陥電気', 'Simplified Chinese (zh_CN)');

    ADD_TRANSLATOR('David Chen', 'Traditional Chinese (zh_TW)');
    ADD_TRANSLATOR('kai chiao chuang', 'Traditional Chinese (zh_TW)');
    ADD_TRANSLATOR('pon dahai', 'Traditional Chinese (zh_TW)');
    ADD_TRANSLATOR('Shuwn Hsu', 'Traditional Chinese (zh_TW)');
    ADD_TRANSLATOR('Poming Lee', 'Traditional Chinese (zh_TW)');
    ADD_TRANSLATOR('William Lin', 'Traditional Chinese (zh_TW)');
    ADD_TRANSLATOR('Oliver0804', 'Traditional Chinese (zh_TW)');
    ADD_TRANSLATOR('reimu105', 'Traditional Chinese (zh_TW)');
    ADD_TRANSLATOR('Che-Hsien Su', 'Traditional Chinese (zh_TW)');
    ADD_TRANSLATOR('Taotieren', 'Traditional Chinese (zh_TW)');
    ADD_TRANSLATOR('Li Yidong', 'Traditional Chinese (zh_TW)');
    ADD_TRANSLATOR('撒景賢', 'Traditional Chinese (zh_TW)');

    ADD_TRANSLATOR('Hesham Eina Abdalla', 'Arabic (AR)');
    ADD_TRANSLATOR('Djamel Dellaa', 'Arabic (AR)');
    ADD_TRANSLATOR('Ahmed Elswah', 'Arabic (AR)');
    ADD_TRANSLATOR('HADJAISSA', 'Arabic (AR)');
    ADD_TRANSLATOR('Morad Tamer', 'Arabic (AR)');

    ADD_TRANSLATOR('Adolfo Jayme Barrientos', 'Catalan (CA)');
    ADD_TRANSLATOR('Marc de Miguel', 'Catalan (CA)');
    ADD_TRANSLATOR('Rafael Serrano', 'Catalan (CA)');
    ADD_TRANSLATOR('Arnau Llovet Vidal', 'Catalan (CA)');

    ADD_TRANSLATOR('Ivan Chuba', 'Estonian (ET)');

    ADD_TRANSLATOR('Temuri Doghonadze', 'Georgian (KA)');

    ADD_TRANSLATOR('Viktor Döme', 'Hungarian (HU)');
    ADD_TRANSLATOR('István Farkas', 'Hungarian (HU)');
    ADD_TRANSLATOR('Flórián Fuszkó', 'Hungarian (HU)');
    ADD_TRANSLATOR('Sárkány Lőrinc', 'Hungarian (HU)');
    ADD_TRANSLATOR('Miklós Márton', 'Hungarian (HU)');
    ADD_TRANSLATOR('Balázs Meskó', 'Hungarian (HU)');
    ADD_TRANSLATOR('Hajdu Norbert', 'Hungarian (HU)');
    ADD_TRANSLATOR('Elek Zoltán', 'Hungarian (HU)');

    ADD_TRANSLATOR('Reza Almanda', 'Indonesian (ID)');
    ADD_TRANSLATOR('Jacque Fresco', 'Indonesian (ID)');
    ADD_TRANSLATOR('Neko Nekowazarashi', 'Indonesian (ID)');
    ADD_TRANSLATOR('Triyan W. Nugroho', 'Indonesian (ID)');

    ADD_TRANSLATOR('Rihards Skuja', 'Latvian (LV)');

    ADD_TRANSLATOR('Mahdi Ahmadzadeh', 'Persian (FA)');

    ADD_TRANSLATOR('Nicoara Alex', 'Romanian (RO)');
    ADD_TRANSLATOR('Tatu Bogdan', 'Romanian (RO)');
    ADD_TRANSLATOR('Alex Gellen', 'Romanian (RO)');
    ADD_TRANSLATOR('Adrian Scripcă', 'Romanian (RO)');

    ADD_TRANSLATOR('Luka Borkovic', 'Serbian (SR)');

    ADD_TRANSLATOR('David Chorváth', 'Slovak (SK)');
    ADD_TRANSLATOR('Marcel Hecko', 'Slovak (SK)');
    ADD_TRANSLATOR('Jakub Janek', 'Slovak (SK)');
    ADD_TRANSLATOR('Andrej Valek', 'Slovak (SK)');

    ADD_TRANSLATOR('Sašo Domadenik', 'Slovenian (SI)');
    ADD_TRANSLATOR('Vitan Košpenda', 'Slovenian (SI)');
    ADD_TRANSLATOR('Mitja Nemec', 'Slovenian (SI)');

    ADD_TRANSLATOR('தமிழ்நேரம்', 'Tamil (TA)');

    ADD_TRANSLATOR('YÜKSEL AÇIKGÖZ', 'Turkish (TR)');
    ADD_TRANSLATOR('Argeolog', 'Turkish (TR)');
    ADD_TRANSLATOR('Mahsum Aslan', 'Turkish (TR)');
    ADD_TRANSLATOR('Tevfik Bagcivan', 'Turkish (TR)');
    ADD_TRANSLATOR('Bahtiyar Bayram', 'Turkish (TR)');
    ADD_TRANSLATOR('Marine Biologist', 'Turkish (TR)');
    ADD_TRANSLATOR('Mustafa Selçuk ÇAVDAR', 'Turkish (TR)');
    ADD_TRANSLATOR('dogukansahil', 'Turkish (TR)');
    ADD_TRANSLATOR('Erkan', 'Turkish (TR)');
    ADD_TRANSLATOR('Oğuz Ersen', 'Turkish (TR)');
    ADD_TRANSLATOR('İclal Gör', 'Turkish (TR)');
    ADD_TRANSLATOR('Mert Gülsoy', 'Turkish (TR)');
    ADD_TRANSLATOR('Mert Kalkancı', 'Turkish (TR)');
    ADD_TRANSLATOR('metin kiruc', 'Turkish (TR)');
    ADD_TRANSLATOR('Gökhan Koçmarlı', 'Turkish (TR)');
    ADD_TRANSLATOR('Niyazi', 'Turkish (TR)');
    ADD_TRANSLATOR('Ahmet Saygın ÖĞÜLMÜŞ', 'Turkish (TR)');
    ADD_TRANSLATOR('Ertuğrul Reisoğlu', 'Turkish (TR)');
    ADD_TRANSLATOR('Murat Ursavaş', 'Turkish (TR)');
    ADD_TRANSLATOR('VEDAT YAMAN', 'Turkish (TR)');

    ADD_TRANSLATOR('Nguyen Van Dien', 'Vietnamese (VI)');
    ADD_TRANSLATOR('Trần Phi Hải', 'Vietnamese (VI)');
    ADD_TRANSLATOR('Nguyễn Ngọc Khánh', 'Vietnamese (VI)');
    ADD_TRANSLATOR('lê văn lập', 'Vietnamese (VI)');
    ADD_TRANSLATOR('Bế Trọng Nghĩa', 'Vietnamese (VI)');
    ADD_TRANSLATOR('An Nguyen', 'Vietnamese (VI)');
    ADD_TRANSLATOR('Phạm Minh Tấn', 'Vietnamese (VI)');

    ADD_TRANSLATOR('David J S Briscoe', 'Other');
    ADD_TRANSLATOR('Paul Burke', 'Other');
    ADD_TRANSLATOR('Remy Halvick', 'Other');
    ADD_TRANSLATOR('Dominique Laigle', 'Other');

    // Program credits for library team
    const LIBRARIANS = 'Librarian Team';
    const ADD_LIBRARIAN = (name: string): void =>
      aInfo.AddLibrarian(new CONTRIBUTOR(name, LIBRARIANS));

    // Lead librarians
    ADD_LIBRARIAN('Carsten Presser');
    // Librarian trainining/recruiting
    ADD_LIBRARIAN('Kliment Yanev');

    // Active librarians (last 2 years)
    ADD_LIBRARIAN('Geries AbuAkel');
    ADD_LIBRARIAN('Patrick Baus');
    ADD_LIBRARIAN('John Beard');
    ADD_LIBRARIAN('Jeremy Boynes');
    ADD_LIBRARIAN('Greg Cormier');
    ADD_LIBRARIAN('Tobias Falk');
    ADD_LIBRARIAN('Simon Fivat');
    ADD_LIBRARIAN('Ferrum');
    ADD_LIBRARIAN('Jan Sebastian Götte (jaseg)');
    ADD_LIBRARIAN('Petr Hodina');
    ADD_LIBRARIAN('Mikkel Jeppesen');
    ADD_LIBRARIAN('McDowell Johnson');
    ADD_LIBRARIAN('Graham Keeth');
    ADD_LIBRARIAN('Aristeidis Kimirtzis');
    ADD_LIBRARIAN('Brandon Kirisaki');
    ADD_LIBRARIAN('Thea Krug');
    ADD_LIBRARIAN('Uli Köhler');
    ADD_LIBRARIAN('Andrew Lutsenko');
    ADD_LIBRARIAN('Mojca Miklavec Groenhuis');
    ADD_LIBRARIAN('Peniel Mubita');
    ADD_LIBRARIAN('Jorge Neiva');
    ADD_LIBRARIAN('Carlos Nieves Ónega');
    ADD_LIBRARIAN('Lynn Ochs');
    ADD_LIBRARIAN('Ed Peguillan');
    ADD_LIBRARIAN('Dash Peters');
    ADD_LIBRARIAN('Sergio Rocha');
    ADD_LIBRARIAN('Benjamin Reynier');
    ADD_LIBRARIAN('Armin Schoisswohl');
    ADD_LIBRARIAN('Joel Schulz-Andres');
    ADD_LIBRARIAN('Frank Severinsen');
    ADD_LIBRARIAN('Martin Sotirov');
    ADD_LIBRARIAN('Philipp Swoboda');
    ADD_LIBRARIAN('Christoph Werner');

    // Previously active librarians
    ADD_LIBRARIAN('Christian Schlüter');
    ADD_LIBRARIAN('Rene Poeschl');
    ADD_LIBRARIAN('Antonio Vázquez Blanco ');
    ADD_LIBRARIAN('Daniel Giesbrecht');
    ADD_LIBRARIAN('Otavio Augusto Gomes');
    ADD_LIBRARIAN('herostrat');
    ADD_LIBRARIAN('Diego Herranz');
    ADD_LIBRARIAN('Joel Guittet');
    ADD_LIBRARIAN('Chris Morgan');
    ADD_LIBRARIAN('Thomas Pointhuber');
    ADD_LIBRARIAN('Evan Shultz');
    ADD_LIBRARIAN('Bob Cousins');
    ADD_LIBRARIAN('Nick Østergaard');
    ADD_LIBRARIAN('Oliver Walters');

    const MODELS_3D_CONTRIBUTION = '3D models';
    const SYMBOL_LIB_CONTRIBUTION = 'Symbols';
    const FOOTPRINT_LIB_CONTRIBUTION = 'Footprints';
    aInfo.AddLibrarian(
      new CONTRIBUTOR('Scripts by Maui', MODELS_3D_CONTRIBUTION, 'https://github.com/easyw'),
    );
    aInfo.AddLibrarian(
      new CONTRIBUTOR(
        'Hasan Yavuz Özderya',
        MODELS_3D_CONTRIBUTION,
        'https://bitbucket.org/hyOzd/freecad-macros/src/master/',
      ),
    );
    aInfo.AddLibrarian(
      new CONTRIBUTOR(
        'GitHub contributors',
        MODELS_3D_CONTRIBUTION,
        'https://github.com/easyw/kicad-3d-models-in-freecad/graphs/contributors',
      ),
    );
    aInfo.AddLibrarian(
      new CONTRIBUTOR(
        'GitLab contributors',
        MODELS_3D_CONTRIBUTION,
        'https://gitlab.com/kicad/libraries/kicad-packages3D/-/graphs/master',
      ),
    );

    aInfo.AddLibrarian(
      new CONTRIBUTOR(
        'GitLab contributors',
        SYMBOL_LIB_CONTRIBUTION,
        'https://gitlab.com/kicad/libraries/kicad-symbols/-/graphs/master',
      ),
    );

    aInfo.AddLibrarian(
      new CONTRIBUTOR(
        'Scripts by Thomas Pointhuber',
        FOOTPRINT_LIB_CONTRIBUTION,
        'https://gitlab.com/kicad/libraries/kicad-footprint-generator',
      ),
    );
    aInfo.AddLibrarian(
      new CONTRIBUTOR(
        'GitLab contributors',
        FOOTPRINT_LIB_CONTRIBUTION,
        'https://gitlab.com/kicad/libraries/kicad-footprints/-/graphs/master',
      ),
    );

    // Program credits for icons
    const ICON_CONTRIBUTION = 'Icons';
    aInfo.AddArtist(new CONTRIBUTOR('Aleksandr Zyrianov', ICON_CONTRIBUTION));
    aInfo.AddArtist(new CONTRIBUTOR('Anda Subero', ICON_CONTRIBUTION));
    aInfo.AddArtist(new CONTRIBUTOR('Iñigo Zuluaga', ICON_CONTRIBUTION));
    aInfo.AddArtist(new CONTRIBUTOR('Fabrizio Tappero', ICON_CONTRIBUTION));

    // Program credits for package developers.
    const PACKAGE_DEVS = 'Package Developers';

    aInfo.AddPackager(new CONTRIBUTOR('Steven Falco', PACKAGE_DEVS));
    aInfo.AddPackager(new CONTRIBUTOR('Johannes Maibaum', PACKAGE_DEVS));
    aInfo.AddPackager(new CONTRIBUTOR('Jean-Samuel Reynaud', PACKAGE_DEVS));
    aInfo.AddPackager(new CONTRIBUTOR('Bernhard Stegmaier', PACKAGE_DEVS));
    aInfo.AddPackager(new CONTRIBUTOR('Adam Wolf', PACKAGE_DEVS));
    aInfo.AddPackager(new CONTRIBUTOR('Nick Østergaard', PACKAGE_DEVS));
  }
  // ---- End of the transcription.
}

/**
 * `ShowAboutDialog( aParent )`: build the information and show the dialog.
 *
 * `title` is the frame's `GetAboutTitle()` (EDA_BASE_FRAME::m_aboutTitle), so
 * the PCB editor's window says "About <product> PCB Editor".
 */
export function ShowAboutDialog({
  title,
  onClose,
}: {
  title: string;
  onClose: () => void;
}): JSX.Element {
  const info = new ABOUT_APP_INFO();
  buildKicadAboutBanner(`${import.meta.env.BASE_URL}favicon.svg`, info);
  return (
    <DIALOG_ABOUT
      info={info}
      titleName={title}
      reportBug={() => window.open(REPORT_BUG_URL, '_blank', 'noopener,noreferrer')}
      onClose={onClose}
    />
  );
}
