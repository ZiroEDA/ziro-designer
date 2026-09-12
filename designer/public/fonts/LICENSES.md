# Bundled outline fonts

Unmodified files from Ubuntu's `fonts-liberation`, `fonts-dejavu-core` and `fonts-noto-core` packages, served under `/fonts/` so that a schematic or board text with a `(font (face …))` draws with the face KiCad's fontconfig would substitute on a Linux desktop. Which name maps to which file is `common/src/font/fontconfig.ts`. The texts below are the Debian copyright files of those packages.

## Liberation (fonts-liberation)

```
Format: https://www.debian.org/doc/packaging-manuals/copyright-format/1.0/
Upstream-Name: Liberation Fonts
Source: https://github.com/liberationfonts

Files: *
Copyright:
 Digitized data copyright (c) 2010 Google Corporation with Reserved Font Arimo, Tinos and Cousine.
 Copyright (c) 2012 Red Hat, Inc. with Reserved Font Name Liberation.
License: SIL-OFL-1.1
 This Font Software is licensed under the SIL Open Font License,
 Version 1.1.
 .
 This license is copied below, and is also available with a FAQ at:
 http://scripts.sil.org/OFL
 .
 SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
 .
 PREAMBLE The goals of the Open Font License (OFL) are to stimulate
 worldwide development of collaborative font projects, to support the font
 creation efforts of academic and linguistic communities, and to provide
 a free and open framework in which fonts may be shared and improved in
 partnership with others.
 .
 The OFL allows the licensed fonts to be used, studied, modified and
 redistributed freely as long as they are not sold by themselves.
 The fonts, including any derivative works, can be bundled, embedded,
 redistributed and/or sold with any software provided that any reserved
 names are not used by derivative works.  The fonts and derivatives,
 however, cannot be released under any other type of license.  The
 requirement for fonts to remain under this license does not apply to
 any document created using the fonts or their derivatives.
 .
 .
 .
 DEFINITIONS
 "Font Software" refers to the set of files released by the Copyright
 Holder(s) under this license and clearly marked as such.
 This may include source files, build scripts and documentation.
 .
 "Reserved Font Name" refers to any names specified as such after the
 copyright statement(s).
 .
 "Original Version" refers to the collection of Font Software components
 as distributed by the Copyright Holder(s).
 .
 "Modified Version" refers to any derivative made by adding to, deleting,
 or substituting ? in part or in whole ?
 any of the components of the Original Version, by changing formats or
 by porting the Font Software to a new environment.
 .
 "Author" refers to any designer, engineer, programmer, technical writer
 or other person who contributed to the Font Software.
 .
 .
 PERMISSION & CONDITIONS
 .
 Permission is hereby granted, free of charge, to any person obtaining a
 copy of the Font Software, to use, study, copy, merge, embed, modify,
 redistribute, and sell modified and unmodified copies of the Font
 Software, subject to the following conditions:
 .
 1) Neither the Font Software nor any of its individual components,in
    Original or Modified Versions, may be sold by itself.
 .
 2) Original or Modified Versions of the Font Software may be bundled,
    redistributed and/or sold with any software, provided that each copy
    contains the above copyright notice and this license. These can be
    included either as stand-alone text files, human-readable headers or
    in the appropriate machine-readable metadata fields within text or
    binary files as long as those fields can be easily viewed by the user.
 .
 3) No Modified Version of the Font Software may use the Reserved Font
    Name(s) unless explicit written permission is granted by the
    corresponding Copyright Holder. This restriction only applies to the
    primary font name as presented to the users.
 .
 4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
    Software shall not be used to promote, endorse or advertise any
    Modified Version, except to acknowledge the contribution(s) of the
    Copyright Holder(s) and the Author(s) or with their explicit written
    permission.
 .
 5) The Font Software, modified or unmodified, in part or in whole, must
    be distributed entirely under this license, and must not be distributed
    under any other license. The requirement for fonts to remain under
    this license does not apply to any document created using the Font
    Software.
 .
 .
 .
 TERMINATION
 This license becomes null and void if any of the above conditions are not met.
 .
 .
 .
 DISCLAIMER
 THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
 EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
 MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
 OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT.  IN NO EVENT SHALL THE
 COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
 INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
 DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM OTHER
 DEALINGS IN THE FONT SOFTWARE.
 .

Files: debian/*
Copyright:
 2008 Alan Baghumian <alan@technotux.org>
 2008-2018 Holger Levsen <holger@debian.org>
 2009-2012 Christian Perrier <bubulle@debian.org>
 2011-2023 Fabian Greffrath <fabian@debian.org>
 2018 Rene Engelhard <rene@debian.org>
```

## DejaVu (fonts-dejavu-core)

```
Format: https://www.debian.org/doc/packaging-manuals/copyright-format/1.0/
Upstream-Name: DejaVu fonts
Upstream-Author: Stepan Roh <src@users.sourceforge.net> (original author),
                  see /usr/share/doc/fonts-dejavu-core/AUTHORS for full list
Source: https://dejavu-fonts.github.io/

Files: *
Copyright: Copyright (c) 2003 by Bitstream, Inc. All Rights Reserved. 
 Bitstream Vera is a trademark of Bitstream, Inc.
 DejaVu changes are in public domain.
License: bitstream-vera
 Permission is hereby granted, free of charge, to any person obtaining a copy
 of the fonts accompanying this license ("Fonts") and associated
 documentation files (the "Font Software"), to reproduce and distribute the
 Font Software, including without limitation the rights to use, copy, merge,
 publish, distribute, and/or sell copies of the Font Software, and to permit
 persons to whom the Font Software is furnished to do so, subject to the
 following conditions:
 .
 The above copyright and trademark notices and this permission notice shall
 be included in all copies of one or more of the Font Software typefaces.
 .
 The Font Software may be modified, altered, or added to, and in particular
 the designs of glyphs or characters in the Fonts may be modified and
 additional glyphs or characters may be added to the Fonts, only if the fonts
 are renamed to names not containing either the words "Bitstream" or the word
 "Vera".
 .
 This License becomes null and void to the extent applicable to Fonts or Font
 Software that has been modified and is distributed under the "Bitstream
 Vera" names.
 .
 The Font Software may be sold as part of a larger software package but no
 copy of one or more of the Font Software typefaces may be sold by itself.
 .
 THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
 OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF MERCHANTABILITY,
 FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT OF COPYRIGHT, PATENT,
 TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL BITSTREAM OR THE GNOME
 FOUNDATION BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, INCLUDING
 ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL DAMAGES,
 WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF
 THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM OTHER DEALINGS IN THE
 FONT SOFTWARE.
 .
 Except as contained in this notice, the names of Gnome, the Gnome
 Foundation, and Bitstream Inc., shall not be used in advertising or
 otherwise to promote the sale, use or other dealings in this Font Software
 without prior written authorization from the Gnome Foundation or Bitstream
 Inc., respectively. For further information, contact: fonts at gnome dot
 org.

Files: debian/*
Copyright: (C) 2005-2006 Peter Cernak <pce@users.sourceforge.net> 
           (C) 2006-2011 Davide Viti <zinosat@tiscali.it>
           (C) 2011-2013 Christian Perrier <bubulle@debian.org>
           (C) 2013 Fabian Greffrath <fabian+debian@greffrath.com>
License: GPL-2+
 This program is free software; you can redistribute it
 and/or modify it under the terms of the GNU General Public
```

## Noto (fonts-noto-core)

```
Format: https://www.debian.org/doc/packaging-manuals/copyright-format/1.0/
Upstream-Name: Noto
Upstream-Contact: https://github.com/googlei18n/noto-fonts/issues
 http://groups.google.com/group/noto-font
Source: https://github.com/googlei18n/noto-fonts

Files: *
Copyright:
  2010,2012-2020, Google Inc.
  2015-2020, Google LLC.
License-Grant:
 This Font Software is licensed under the SIL Open Font License,
 Version 1.1.
License: OFL-1.1

Files:
 debian/*
Copyright:
  2013-2020, Jonas Smedegaard <dr@jones.dk>
  2020, Purism, SPC
  2013, Vasudev Kamath <kamathvasudev@gmail.com>
License-Grant:
 This program is free software;
 you can redistribute it and/or modify it
 under the terms of the GNU General Public License
 as published by the Free Software Foundation;
 either version 3, or (at your option) any later version.
License: GPL-3+

Files:
 debian/NotoMono/NotoMono-Regular.ttf
Copyright:
  2007, Google Inc.
License-Grant:
 This Font Software is licensed under the SIL Open Font License,
 Version 1.1.
License: OFL-1.1

License: OFL-1.1
 PREAMBLE
 .
 The goals of the Open Font License (OFL) are to stimulate
 worldwide development of collaborative font projects,
 to support the font creation efforts
 of academic and linguistic communities,
 and to provide a free and open framework
 in which fonts may be shared and improved
 in partnership with others.
 .
 The OFL allows the licensed fonts to be used, studied,
 modified and redistributed freely
 as long as they are not sold by themselves.
 The fonts, including any derivative works,
 can be bundled, embedded,
 redistributed and/or sold with any software
 provided that any reserved names are not used
 by derivative works.
 The fonts and derivatives, however,
 cannot be released under any other type of license.
 The requirement for fonts to remain under this license
 does not apply to any document
 created using the fonts or their derivatives.
 .
 DEFINITIONS
 .
 "Font Software" refers to the set of files
 released by the Copyright Holder(s) under this license
 and clearly marked as such.
 This may include source files, build scripts and documentation.
 .
 "Reserved Font Name" refers to any names specified as such
 after the copyright statement(s).
 .
 "Original Version" refers to the collection
 of Font Software components
 as distributed by the Copyright Holder(s).
 .
 "Modified Version" refers to any derivative
 made by adding to, deleting, or substituting --
 in part or in whole --
 any of the components of the Original Version,
 by changing formats
 or by porting the Font Software to a new environment.
 .
 "Author" refers to any designer, engineer, programmer,
 technical writer or other person
 who contributed to the Font Software.
 .
 PERMISSION & CONDITIONS
 .
 Permission is hereby granted, free of charge,
 to any person obtaining a copy of the Font Software,
 to use, study, copy, merge, embed, modify, redistribute,
 and sell modified and unmodified copies of the Font Software,
 subject to the following conditions:
 .
 1) Neither the Font Software nor any of its individual components,
 in Original or Modified Versions,
 may be sold by itself.
 .
 2) Original or Modified Versions of the Font Software
 may be bundled, redistributed and/or sold with any software,
 provided that each copy contains the above copyright notice
 and this license.
 These can be included either as stand-alone text files,
 human-readable headers or in the appropriate
 machine-readable metadata fields within text or binary files
 as long as those fields can be easily viewed by the user.
 .
 3) No Modified Version of the Font Software may use
 the Reserved Font Name(s)
 unless explicit written permission is granted
 by the corresponding Copyright Holder.
 This restriction only applies to the primary font name
 as presented to the users.
 .
 4) The name(s) of the Copyright Holder(s)
 or the Author(s) of the Font Software
 shall not be used to promote,
 endorse or advertise any Modified Version,
 except to acknowledge the contribution(s)
 of the Copyright Holder(s) and the Author(s)
 or with their explicit written permission.
 .
 5) The Font Software,
 modified or unmodified, in part or in whole,
 must be distributed entirely under this license,
 and must not be distributed under any other license.
 The requirement for fonts to remain under this license
 does not apply to any document
 created using the Font Software.
 .
 TERMINATION
 .
 This license becomes null and void
 if any of the above conditions are not met.
 .
 DISCLAIMER
 .
 THE FONT SOFTWARE IS PROVIDED "AS IS",
 WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
 INCLUDING BUT NOT LIMITED TO
 ANY WARRANTIES OF MERCHANTABILITY,
 FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
 OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT.
 IN NO EVENT SHALL THE COPYRIGHT HOLDER BE LIABLE
 FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
 INCLUDING ANY GENERAL, SPECIAL, INDIRECT,
 INCIDENTAL, OR CONSEQUENTIAL DAMAGES,
 WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
 ARISING FROM, OUT OF THE USE OR INABILITY TO USE
 THE FONT SOFTWARE OR FROM OTHER DEALINGS IN THE FONT SOFTWARE.

```
