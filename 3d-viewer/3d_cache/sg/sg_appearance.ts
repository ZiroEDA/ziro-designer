// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `3d-viewer/3d_cache/sg/sg_appearance.{h,cpp}`: SGAPPEARANCE, a VRML Material. Every channel is a
 * C float, and the ambient intensity is computed in float, so the arithmetic is fround'ed where
 * the C++ narrows.
 */
import { SGCOLOR } from './sg_base.js';
import { FormatFloat } from './sg_helpers.js';
import { SGNODE } from './sg_node.js';
import { SGTYPES } from './sg_types.js';

const f32 = Math.fround;

export class SGAPPEARANCE extends SGNODE {
  shininess = f32(0.2); // default 0.2
  transparency = 0.0; // default 0.0
  ambient = new SGCOLOR(0.05317, 0.17879, 0.01804); // default 0.05317 0.17879 0.01804
  diffuse = new SGCOLOR(0.8, 0.8, 0.8); // default 0.8 0.8 0.8
  emissive = new SGCOLOR(); // default 0.0 0.0 0.0
  specular = new SGCOLOR(); // default 0.0 0.0 0.0

  constructor(aParent: SGNODE | null) {
    super(aParent);
    this.m_SGtype = SGTYPES.SGTYPE_APPEARANCE;

    if (aParent !== null && aParent.GetNodeType() !== SGTYPES.SGTYPE_SHAPE) this.m_Parent = null;
    else if (aParent !== null) aParent.AddChildNode(this);
  }

  SetEmissive(aRVal: number, aGVal: number, aBVal: number): boolean {
    return this.emissive.SetColor(aRVal, aGVal, aBVal);
  }

  SetDiffuse(aRVal: number, aGVal: number, aBVal: number): boolean {
    return this.diffuse.SetColor(aRVal, aGVal, aBVal);
  }

  SetSpecular(aRVal: number, aGVal: number, aBVal: number): boolean {
    return this.specular.SetColor(aRVal, aGVal, aBVal);
  }

  SetAmbient(aRVal: number, aGVal: number, aBVal: number): boolean {
    return this.ambient.SetColor(aRVal, aGVal, aBVal);
  }

  AddRefNode(_aNode: SGNODE): boolean {
    return false;
  }

  AddChildNode(_aNode: SGNODE): boolean {
    return false;
  }

  ReNameNodes(): void {
    this.m_written = false;

    // rename this node
    this.m_Name = '';
    this.GetName();
  }

  WriteVRML(aFile: string[], aReuseFlag: boolean): boolean {
    if (aReuseFlag) {
      if (!this.m_written) {
        aFile.push(` appearance DEF ${this.GetName()} Appearance {\n`);
        this.m_written = true;
      } else {
        aFile.push(` appearance USE ${this.GetName()}\n`);
        return true;
      }
    } else {
      aFile.push(' appearance Appearance {\n');
    }

    aFile.push('  material Material {\n');

    let [ambr, ambg, ambb] = this.ambient.GetColor();
    let amb = f32(0.212671 * ambr + 0.71516 * ambg + 0.072169 * ambb);
    [ambr, ambg, ambb] = this.diffuse.GetColor();
    let den = f32(0.212671 * ambr + 0.71516 * ambg + 0.072169 * ambb);

    if (den < f32(0.004)) den = f32(0.004);

    amb = f32(amb / den);

    if (amb > 1.0) amb = 1.0;

    aFile.push(`   ambientIntensity ${FormatFloat(amb)}\n`);

    let [red, green, blue] = this.diffuse.GetColor();
    aFile.push(`   diffuseColor ${FormatFloat(red)} ${FormatFloat(green)} ${FormatFloat(blue)}\n`);

    [red, green, blue] = this.emissive.GetColor();
    aFile.push(`   emissiveColor ${FormatFloat(red)} ${FormatFloat(green)} ${FormatFloat(blue)}\n`);

    aFile.push(`   shininess ${FormatFloat(this.shininess)}\n`);

    [red, green, blue] = this.specular.GetColor();
    aFile.push(`   specularColor ${FormatFloat(red)} ${FormatFloat(green)} ${FormatFloat(blue)}\n`);

    aFile.push(`   transparency ${FormatFloat(this.transparency)}\n`);

    aFile.push('} }\n');

    return true;
  }
}
