// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Load and place footprint 3D models in the three.js scene, replicating KiCad's
 * exact placement matrix (render_3d_opengl.cpp get3dModelsFromFootprint):
 *
 *   footprint: translate(x·s, -y·s, GetFootprintZPos(flipped)) · rotateZ(orientation)
 *              · [if back: rotateY(π)·rotateZ(π)] · scale(BiuTo3dUnits · IU_PER_MM)
 *   per model: translate(offset) · rotateZ(-rz)·rotateY(-ry)·rotateX(-rx)
 *              · scale(scale)
 *
 * KiCad's model space is millimetres (modelunit_to_3d_units_factor =
 * BiuTo3dUnits · IU_PER_MM), and `(offset …)` is millimetres applied in that
 * space. Each loader normalises geometry into mm exactly as KiCad's plugins
 * do:
 *   - `.glb` (our hosted library, converted from the KiCad 10 STEP set) and
 *     project STEP/IGES models are native mm, loaded raw;
 *   - `.wrl` is authored in 0.1-inch units, scaled ×2.54 at load, unless the
 *     file carries its own top-level scale transform (WRL2BASE's
 *     "ApplyUnitConversion" rule in plugins/3d/vrml).
 *
 * Materials: `MODEL_3D` draws every material group through `OglSetMaterial`
 * under `glColorMaterial( GL_AMBIENT_AND_DIFFUSE )` (3d_model.cpp:479-528),
 * so what a model brings is its diffuse (as ambient too), its specular, its
 * shininess and its transparency — the `SMATERIAL` the loader filled. The
 * three.js material each loader produced is read back into that struct and
 * replaced by the fixed-function material the caller hands out; an opaque
 * group goes in the opaque pass, a transparent one (or any group of a model
 * with `(opacity …)` below 1) in the back-to-front pass after the mask.
 *
 * Models load async and are cached per source; a part used many times is
 * fetched once and cloned.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLLoader } from 'three/addons/loaders/VRMLLoader.js';
import type { Board } from '@ziroeda/pcbnew';
import { resolvePath } from './filename_resolver.js';
import { loadCadModel } from './loadmodel.js';
import { stepFaceMaterial, type SMaterial, type Vec3 } from './gl_fixed_function.js';

const VRML_UNIT_MM = 2.54; // legacy VRML model unit = 0.1 inch (WRL2BASE)

type Footprint = Board['footprints'][number];
type Model = Footprint['models'][number];

/** The placement frame `get3dModelsFromFootprint` builds in, 3D units. */
export interface ModelFrame {
  /** `BiuTo3dUnits()`. */
  scale: number;
  /** `GetFootprintZPos( false )` — the F.Paste top. */
  zTopFront: number;
  /** `GetFootprintZPos( true )` — the B.Paste bottom. */
  zTopBack: number;
  /** `modelunit_to_3d_units_factor = BiuTo3dUnits() · UNITS3D_TO_UNITSPCB`. */
  modelUnitToWorld: number;
}

/** A file bundled with the uploaded project (VRML/STEP sources are ASCII). */
export interface ProjectFile {
  name: string;
  text: string;
}

const rotZ = (r: number): THREE.Matrix4 => new THREE.Matrix4().makeRotationZ(r);
const rotY = (r: number): THREE.Matrix4 => new THREE.Matrix4().makeRotationY(r);
const rotX = (r: number): THREE.Matrix4 => new THREE.Matrix4().makeRotationX(r);
const deg = (d: number): number => (d * Math.PI) / 180;

/** KiCad placement matrix for one footprint model, in 3D units. */
export function modelMatrix(fp: Footprint, model: Model, frame: ModelFrame): THREE.Matrix4 {
  const flipped = fp.layer === 'B.Cu';
  const m = new THREE.Matrix4().makeTranslation(
    fp.at.x * frame.scale,
    -fp.at.y * frame.scale, // KiCad flips Y into the 3D frame
    flipped ? frame.zTopBack : frame.zTopFront,
  );
  m.multiply(rotZ(deg(fp.angle)));
  if (flipped) {
    m.multiply(rotY(Math.PI));
    m.multiply(rotZ(Math.PI));
  }
  m.multiply(
    new THREE.Matrix4().makeScale(
      frame.modelUnitToWorld,
      frame.modelUnitToWorld,
      frame.modelUnitToWorld,
    ),
  );
  m.multiply(new THREE.Matrix4().makeTranslation(model.offset.x, model.offset.y, model.offset.z));
  m.multiply(rotZ(deg(-model.rotate.z)));
  m.multiply(rotY(deg(-model.rotate.y)));
  m.multiply(rotX(deg(-model.rotate.x)));
  m.multiply(new THREE.Matrix4().makeScale(model.scale.x, model.scale.y, model.scale.z));
  return m;
}

/**
 * VRML unit conversion (WRL2BASE::SetApplyUnitConversion): legacy `.wrl`
 * models are 0.1-inch units → ×2.54 into mm, but a file that already carries a
 * top-level scale transform is self-converting and is left alone.
 */
function vrmlIntoMm(o: THREE.Object3D): THREE.Object3D {
  const selfScaled = [o, ...o.children].some(
    (c) => c.scale.x !== 1 || c.scale.y !== 1 || c.scale.z !== 1,
  );
  const wrapper = new THREE.Group();
  wrapper.add(o);
  if (!selfScaled) o.scale.setScalar(VRML_UNIT_MM);
  return wrapper;
}

const extOf = (name: string): string => name.split('.').pop()?.toLowerCase() ?? '';

/**
 * The `SMATERIAL` a loader's three.js material stands for.
 *
 * Colours come back sRGB-ENCODED: KiCad's OCE loader reads a STEP colour with
 * `Quantity_TOC_sRGB` and its VRML parser takes the file's numbers as they
 * are, and both light those numbers raw. three.js's loaders converted them
 * into its linear working space, so `getRGB( …, SRGBColorSpace )` is the
 * exact inverse — it hands back the file's numbers.
 */
export function smaterialOf(m: THREE.Material): SMaterial {
  const srgb = (c: THREE.Color): Vec3 => {
    const t = { r: 0, g: 0, b: 0 };
    c.getRGB(t, THREE.SRGBColorSpace);
    return [t.r, t.g, t.b];
  };
  const opacity = m.transparent ? m.opacity : 1;
  if (m instanceof THREE.MeshPhongMaterial) {
    // VRML: `Material { diffuseColor specularColor emissiveColor shininess transparency }`
    // (plugins/3d/vrml/v2/vrml2_material.cpp:285-300), shininess in VRML's 0..1.
    return {
      ambient: srgb(m.color),
      diffuse: srgb(m.color),
      specular: srgb(m.specular),
      emissive: srgb(m.emissive),
      shininess: m.shininess,
      transparency: 1 - opacity,
    };
  }
  // STEP (a hosted .glb, or a project file through OCCT): one colour per
  // BREP face, the OCE loader's fixed specular/shininess around it.
  const color =
    'color' in m && m.color instanceof THREE.Color ? m.color : new THREE.Color(0.6, 0.6, 0.6);
  return stepFaceMaterial(srgb(color), opacity, true);
}

export interface ComponentRenderHooks {
  /**
   * `OglSetMaterial( mat, opacity, aUseSelectedMaterial )` in the current
   * `MATERIAL_MODE`. Both materials are built up front and parked on the
   * mesh (`userData.normalMat` / `userData.selectedMat`) so a rollover or a
   * cross-probed selection is a swap, not a rebuild.
   */
  material: (
    m: SMaterial,
    opacity: number,
    transparentPass: boolean,
    selected: boolean,
  ) => THREE.Material;
  /** `renderOpaqueModels` / `renderTransparentModels` slots. */
  opaqueOrder: number;
  transparentOrder: number;
  /** `BOARD_ADAPTER::IsFootprintShown`. */
  showFootprint: (fp: Footprint) => boolean;
}

/**
 * Load every footprint's 3D models and add them to `parent`. `libBase` is
 * where the hosted library lives (a `.glb` URL prefix); `projectFiles` carries
 * the uploaded project's own files so ${KIPRJMOD}/relative references load
 * exactly as KiCad loads them from the project directory.
 */
export function mountComponents(
  parent: THREE.Object3D,
  board: Board,
  frame: ModelFrame,
  libBase: string,
  projectFiles?: ProjectFile[],
  onChange?: () => void,
  /**
   * `EDA_3D_VIEWER_SETTINGS::m_Render.show_model_bbox` — Preferences >
   * 3D Viewer > Realtime Renderer's "Show model bounding boxes".
   *
   * `RENDER_3D_OPENGL::renderModel` draws each model's outer bounding box in
   * green (`MakeBbox( m_model_bbox, …, { 0, 1, 0, 1 } )`, 3d_model.cpp:247).
   */
  showModelBbox?: boolean,
  hooks?: ComponentRenderHooks,
): () => void {
  const vrmlLoader = new VRMLLoader();
  const gltfLoader = new GLTFLoader();
  const cache = new Map<string, Promise<THREE.Object3D | null>>();
  const added: THREE.Object3D[] = [];
  const disposables: { dispose(): void }[] = [];
  let cancelled = false;
  const enc = new TextEncoder();
  const fileNames = projectFiles?.map((f) => f.name);

  const loadUrl = (url: string): Promise<THREE.Object3D | null> =>
    /\.glb$/i.test(url)
      ? gltfLoader
          .loadAsync(url)
          .then((g) => g.scene as THREE.Object3D)
          .catch(() => null)
      : vrmlLoader
          .loadAsync(url)
          .then((o) => vrmlIntoMm(o))
          .catch(() => null);

  // Dispatch a project file by extension, mirroring KiCad's 3d plugin registry
  // (vrml plugin for .wrl, the OCC kernel for STEP/IGES). Compressed variants
  // (.wrz/.stpz) and .x3d are not loadable from text-ingested projects yet.
  const loadProjectFile = (name: string): Promise<THREE.Object3D | null> => {
    const file = projectFiles?.find((f) => f.name === name);
    if (!file) return Promise.resolve(null);
    switch (extOf(name)) {
      case 'wrl':
        return Promise.resolve().then(() => {
          try {
            return vrmlIntoMm(vrmlLoader.parse(file.text, name) as THREE.Object3D);
          } catch {
            return null;
          }
        });
      case 'step':
      case 'stp':
        return loadCadModel(enc.encode(file.text), 'step');
      case 'iges':
      case 'igs':
        return loadCadModel(enc.encode(file.text), 'iges');
      default:
        return Promise.resolve(null);
    }
  };

  board.footprints.forEach((fp, fpIndex) => {
    if (hooks && !hooks.showFootprint(fp)) return;
    for (const model of fp.models) {
      if (model.hide || !model.path) continue;
      const res = resolvePath(model.path, { libBase, libExt: 'glb', projectFiles: fileNames });
      if (res.kind === 'unresolved') continue;
      const key = res.kind === 'url' ? res.url : `project:${res.name}`;

      let p = cache.get(key);
      if (!p) {
        p = res.kind === 'url' ? loadUrl(res.url) : loadProjectFile(res.name);
        cache.set(key, p);
      }
      const matrix = modelMatrix(fp, model, frame);
      // `sM.m_Opacity`: 1 keeps the model in the opaque pass
      const opacity = model.opacity ?? 1;
      const opaque = opacity >= 1;
      void p.then((obj) => {
        if (cancelled || !obj) return;
        const inst = obj.clone();
        inst.matrixAutoUpdate = false;
        inst.matrix.copy(matrix);
        inst.matrixWorldNeedsUpdate = true;
        // the BOARD_ITEM a ray-hit on this model reports (addModels' aBoardItem)
        inst.userData.footprint = fpIndex;
        if (hooks) {
          inst.traverse((child) => {
            if (!(child instanceof THREE.Mesh)) return;
            const src = child.material as THREE.Material;
            const sm = smaterialOf(src);
            // MODEL_3D::Draw: a material with transparency goes to the
            // transparent pass; a model with opacity < 1 goes there whole.
            const transparentPass = !opaque || sm.transparency > 1.1920929e-7;
            const op = transparentPass ? opacity : 1;
            const mat = hooks.material(sm, op, transparentPass, false);
            const sel = hooks.material(sm, op, transparentPass, true);
            // glEnable( GL_CULL_FACE ) throughout — but a VRML file's winding
            // is its own affair (`solid`/`ccw`), and three.js's loader keeps
            // it two-sided; STEP faces come oriented.
            if (src.side === THREE.DoubleSide) {
              mat.side = THREE.DoubleSide;
              sel.side = THREE.DoubleSide;
            }
            child.material = mat;
            child.userData.normalMat = mat;
            child.userData.selectedMat = sel;
            child.renderOrder = transparentPass ? hooks.transparentOrder : hooks.opaqueOrder;
            disposables.push(mat, sel);
          });
        } else if (opacity < 1) {
          inst.traverse((child) => {
            if (child instanceof THREE.Mesh) {
              const m = (child.material as THREE.Material).clone();
              m.transparent = true;
              m.opacity *= opacity;
              child.material = m;
            }
          });
        }
        parent.add(inst);
        added.push(inst);
        if (showModelBbox) {
          const helper = new THREE.Box3Helper(new THREE.Box3().setFromObject(inst), 0x00ff00);
          parent.add(helper);
          added.push(helper);
        }
        onChange?.();
      });
    }
  });

  return () => {
    cancelled = true;
    for (const o of added) parent.remove(o);
    for (const d of disposables) d.dispose();
  };
}
