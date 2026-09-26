// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `view/view.h` + `common/view/view.cpp`: `KIGFX::VIEW`, the layered,
 * spatially indexed collection of VIEW_ITEMs the GAL draws, and
 * `VIEW_ITEM_DATA`, the per-item state the view keeps on each item.
 */

import { BOX2D, BOX2I, BOX2ISafe } from '@ziroeda/kimath/src/math/box2.js';
import { INT_MAX, INT_MIN } from '@ziroeda/kimath/src/math/util.js';
import type { Vec2, VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { ARC_LOW_DEF } from '@ziroeda/kimath/src/base_units.js';
import { CornerStrategy, SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { stdSort } from '@ziroeda/kimath/src/clipper2/clipper.core.js';
import { UNDEFINED_LAYER } from '../layer_ids.js';
import { MAX_LAYERS_FOR_VIEW, RENDER_TARGET } from '../gal/definitions.js';
import { type GAL, GAL_UPDATE_CONTEXT } from '../gal/graphics_abstraction_layer.js';
import type { PAINTER } from '../gal/painter.js';
import { VIEW_GROUP } from './view_group.js';
import { type VIEW_ITEM, VIEW_UPDATE_FLAGS, VIEW_VISIBILITY_FLAGS } from './view_item.js';
import { VIEW_OVERLAY } from './view_overlay.js';
import { VIEW_RTREE } from './view_rtree.js';
import { wxASSERT } from '@ziroeda/core/wx_assert.js';

const { NONE, APPEARANCE, COLOR, GEOMETRY, LAYERS, INITIAL_ADD, REPAINT, ALL } = VIEW_UPDATE_FLAGS;
const { VISIBLE, HIDDEN, OVERLAY_HIDDEN } = VIEW_VISIBILITY_FLAGS;
const { TARGET_CACHED, TARGET_NONCACHED, TARGET_OVERLAY, TARGETS_NUMBER } = RENDER_TARGET;

export type LAYER_ITEM_PAIR = [VIEW_ITEM, number];

export class VIEW_ITEM_DATA {
  /** `friend class VIEW`: the view reads and writes these directly. */
  m_view: VIEW | null; ///< Current dynamic view the item is assigned to.
  m_flags: number; ///< Visibility flags
  m_requiredUpdate: number; ///< Flag required for updating
  m_drawPriority: number; ///< Order to draw this item in a layer, lowest first
  m_cachedIndex: number; ///< Cached index in m_allItems.

  m_groups: [number, number][]; ///< layer_number:group_id pairs for each layer the
  ///< item occupies.
  m_groupsSize: number;

  m_layers: number[]; /// Stores layer numbers used by the item.

  m_bbox: BOX2I; /// Cached inserted Bbox for faster removals.

  constructor() {
    this.m_view = null;
    this.m_flags = VISIBLE;
    this.m_requiredUpdate = NONE;
    this.m_drawPriority = 0;
    this.m_cachedIndex = -1;
    this.m_groups = [];
    this.m_groupsSize = 0;
    this.m_layers = [];
    this.m_bbox = new BOX2I();
  }

  GetFlags(): number {
    return this.m_flags;
  }

  /**
   * Return number of the group id for the given layer, or -1 in case it was not cached before.
   *
   * @param aLayer is the layer number for which group id is queried.
   * @return group id or -1 in case there is no group id (ie. item is not cached).
   */
  getGroup(aLayer: number): number {
    for (let i = 0; i < this.m_groupsSize; ++i) {
      if (this.m_groups[i]![0] === aLayer) return this.m_groups[i]![1];
    }

    return -1;
  }

  /**
   * Set a group id for the item and the layer combination.
   *
   * @param aLayer is the layer number.
   * @param aGroup is the group id.
   */
  setGroup(aLayer: number, aGroup: number): void {
    // Look if there is already an entry for the layer
    for (let i = 0; i < this.m_groupsSize; ++i) {
      if (this.m_groups[i]![0] === aLayer) {
        this.m_groups[i]![1] = aGroup;
        return;
      }
    }

    // If there was no entry for the given layer - create one
    this.m_groups.push([aLayer, aGroup]);
    this.m_groupsSize++;
  }

  /**
   * Remove all of the stored group ids. Forces recaching of the item.
   */
  deleteGroups(): void {
    this.m_groups = [];
    this.m_groupsSize = 0;
  }

  /**
   * Return information if the item uses at least one group id (ie. if it is cached at all).
   *
   * @returns true in case it is cached at least for one layer.
   */
  storesGroups(): boolean {
    return this.m_groupsSize > 0;
  }

  /**
   * Reorder the stored groups (to facilitate reordering of layers).
   *
   * @see VIEW::ReorderLayerData
   *
   * @param aReorderMap is the mapping of old to new layer ids
   */
  reorderGroups(aReorderMap: Map<number, number>): void {
    for (let i = 0; i < this.m_groupsSize; ++i) {
      const orig_layer = this.m_groups[i]![0];
      let new_layer = orig_layer;

      if (aReorderMap.has(orig_layer)) new_layer = aReorderMap.get(orig_layer)!;

      this.m_groups[i]![0] = new_layer;
    }
  }

  /**
   * Save layers used by the item.
   *
   * @param aLayers is an array containing layer numbers to be saved.
   */
  saveLayers(aLayers: readonly number[]): void {
    this.m_layers = [];

    for (const layer of aLayers) {
      // wxCHECK2_MSG( layer >= 0 && layer < VIEW::VIEW_MAX_LAYERS, continue, "Invalid layer number" )
      if (!(layer >= 0 && layer < VIEW.VIEW_MAX_LAYERS)) continue;
      this.m_layers.push(layer);
    }
  }

  /**
   * Return current update flag for an item.
   */
  requiredUpdate(): number {
    return this.m_requiredUpdate;
  }

  /**
   * Mark an item as already updated, so it is not going to be redrawn.
   */
  clearUpdateFlags(): void {
    this.m_requiredUpdate = NONE;
  }

  /**
   * Return if the item should be drawn or not.
   */
  isRenderable(): boolean {
    return this.m_flags === VISIBLE;
  }
}

export interface VIEW_LAYER {
  visible: boolean; ///< Is the layer to be rendered?
  displayOnly: boolean; ///< Is the layer display only?

  /// Layer should be drawn differentially over lower layers.
  diffLayer: boolean;

  /// Layer should be drawn separately to not delete lower layers.
  hasNegatives: boolean;
  items: VIEW_RTREE; ///< R-tree indexing all items on this layer.
  renderingOrder: number; ///< Rendering order of this layer.
  id: number; ///< Layer ID.
  target: RENDER_TARGET; ///< Where the layer should be rendered.

  ///< Layers that have to be enabled to show the layer.
  requiredLayers: Set<number>;
}

/** `VIEW::Remove`'s `static int s_gcCounter`. */
let s_gcCounter = 0;

/**
 * Hold a (potentially large) number of VIEW_ITEMs and renders them on a graphics device
 * provided by the GAL.
 *
 * VIEWs can exist in two flavors:
 * - dynamic - where items can be added, removed or changed anytime, intended for the main
 *   editing panel. Each VIEW_ITEM can be added to a single dynamic view.
 * - static - where items are added once at the startup and are not linked with the VIEW.
 *   Foreseen for preview windows and printing.
 *
 * Items in a view are grouped in layers (not to be confused with Kicad's PCB layers). Each
 * layer is identified by an integer number. Visibility and rendering order can be set
 * individually for each of the layers. Future versions of the VIEW will also allows one to
 * assign different layers to different rendering targets, which will be composited at the
 * final stage by the GAL.  The VIEW class also provides fast methods for finding all visible
 * objects that are within a given rectangular area, useful for object selection/hit testing.
 */
export class VIEW {
  protected m_preview: VIEW_GROUP;
  protected m_ownedItems: VIEW_ITEM[] = [];

  /// Whether to use rendering order modifier or not.
  protected m_enableOrderModifier: boolean;

  /// The set of possible displayed layers and its properties.
  protected m_layers: Map<number, VIEW_LAYER> = new Map();

  /// Sorted list of pointers to members of m_layers.
  protected m_orderedLayers: VIEW_LAYER[] = [];

  /// Flat list of all items.
  protected m_allItems: (VIEW_ITEM | null)[];

  /// The set of layers that are displayed on the top.
  protected m_topLayers: Set<number> = new Set();

  /// Center point of the VIEW (the point at which we are looking at).
  protected m_center: Vec2 = { x: 0, y: 0 };

  protected m_scale: number;
  protected m_boundary: BOX2D = new BOX2D();
  protected m_minScale: number;
  protected m_maxScale: number;

  protected m_mirrorX: boolean;
  protected m_mirrorY: boolean;

  /// PAINTER contains information how do draw items.
  protected m_painter: PAINTER | null;

  /// Interface to #PAINTER that is used to draw items.
  protected m_gal: GAL | null;

  /// Flag to mark targets as dirty so they have to be redrawn on the next refresh event.
  protected m_dirtyTargets: boolean[] = [];

  /// Flag to respect draw priority when drawing items.
  protected m_useDrawPriority: boolean;

  /// The next sequential drawing priority.
  protected m_nextDrawPriority: number;

  /// Flag to reverse the draw order when using draw priority.
  protected m_reverseDrawOrder: boolean;

  /// True when at least one item has deferred update flags that still need processing.
  protected m_hasPendingItemUpdates: boolean;

  /// Maximum number of layers that may be shown.
  static readonly VIEW_MAX_LAYERS = MAX_LAYERS_FOR_VIEW;

  /// Rendering order modifier for layers that are marked as top layers.
  static readonly TOP_LAYER_MODIFIER = -MAX_LAYERS_FOR_VIEW;

  /**
   * Nasty hack, invoked by the destructor of VIEW_ITEM to auto-remove the item
   * from the owning VIEW if there is any.
   *
   * KiCad relies too much on this mechanism.  This is the only linking dependency now
   * between #EDA_ITEM and VIEW class. In near future I'll replace it with observers.
   */
  static OnDestroy(aItem: VIEW_ITEM): void {
    if (aItem.m_viewPrivData) {
      if (aItem.m_viewPrivData.m_view) aItem.m_viewPrivData.m_view.Remove(aItem);

      aItem.m_viewPrivData = null;
    }
  }

  constructor() {
    this.m_enableOrderModifier = true;
    this.m_scale = 4.0;
    this.m_minScale = 0.2;
    this.m_maxScale = 50000.0;
    this.m_mirrorX = false;
    this.m_mirrorY = false;
    this.m_painter = null;
    this.m_gal = null;
    this.m_useDrawPriority = false;
    this.m_nextDrawPriority = 0;
    this.m_reverseDrawOrder = false;
    this.m_hasPendingItemUpdates = false;

    // Set m_boundary to define the max area size. The default area size
    // is defined here as the max value of a int.
    // this is a default value acceptable for Pcbnew and Gerbview, but too large for Eeschema.
    // So in eeschema a call to SetBoundary() with a smaller value will be needed.
    // coord_limits::lowest() / 2 + coord_limits::epsilon(): an int's epsilon is 0
    const pos = Math.trunc(INT_MIN / 2) + 0;
    const size = INT_MAX - 0;
    this.m_boundary.SetOrigin(pos, pos);
    this.m_boundary.SetSize({ x: size, y: size });

    this.m_allItems = [];

    // Redraw everything at the beginning
    this.MarkDirty();

    // View uses layers to display EDA_ITEMs (item may be displayed on several layers, for example
    // pad may be shown on pad, pad hole and solder paste layers). There are usual copper layers
    // (eg. F.Cu, B.Cu, internal and so on) and layers for displaying objects such as texts,
    // silkscreen, pads, vias, etc.
    for (let ii = 0; ii < VIEW.VIEW_MAX_LAYERS; ++ii) {
      const l: VIEW_LAYER = {
        items: new VIEW_RTREE(),
        id: ii,
        renderingOrder: ii,
        visible: true,
        displayOnly: false,
        diffLayer: false,
        hasNegatives: false,
        target: TARGET_CACHED,
        requiredLayers: new Set(),
      };
      this.m_layers.set(ii, l);
    }

    this.SortOrderedLayers();

    this.m_preview = new VIEW_GROUP();
    this.Add(this.m_preview);
  }

  /**
   * Add a #VIEW_ITEM to the view.
   *
   * Set \a aDrawPriority to -1 to assign sequential priorities.
   *
   * @param aItem: item to be added. No ownership is given
   * @param aDrawPriority: priority to draw this item on its layer, lowest first.
   */
  Add(aItem: VIEW_ITEM, aDrawPriority = -1): void {
    if (aDrawPriority < 0) aDrawPriority = this.m_nextDrawPriority++;

    if (!aItem.m_viewPrivData) aItem.m_viewPrivData = new VIEW_ITEM_DATA();

    wxASSERT(
      aItem.m_viewPrivData.m_view === null || aItem.m_viewPrivData.m_view === this,
      'Already in a different view!',
    );

    aItem.m_viewPrivData.m_view = this;
    aItem.m_viewPrivData.m_drawPriority = aDrawPriority;
    const bbox = aItem.ViewBBox();
    aItem.m_viewPrivData.m_bbox = bbox;
    aItem.m_viewPrivData.m_cachedIndex = this.m_allItems.length;

    const layers = aItem
      .ViewGetLayers()
      .filter((layer) => !(layer < 0 || layer >= VIEW.VIEW_MAX_LAYERS));

    if (layers.length === 0) return;

    aItem.viewPrivData()!.saveLayers(layers);

    this.m_allItems.push(aItem);

    for (const layer of layers) {
      const l = this.m_layers.get(layer)!;
      l.items.InsertItem(aItem, bbox);
      this.MarkTargetDirty(l.target);
    }

    this.SetVisible(aItem, true);
    this.Update(aItem, INITIAL_ADD);
  }

  /**
   * Remove a #VIEW_ITEM from the view.
   *
   * @param aItem: item to be removed. Caller must dispose the removed item if necessary
   */
  Remove(aItem: VIEW_ITEM | null): void {
    if (aItem?.m_viewPrivData) {
      if (aItem.m_viewPrivData.m_view !== null && aItem.m_viewPrivData.m_view !== this) {
        // wxLogDebug( "VIEW::Remove: item %s belongs to a different view", aItem->GetClass() )
        return;
      }

      let item = -1;
      const cachedIndex = aItem.m_viewPrivData.m_cachedIndex;

      if (
        cachedIndex >= 0 &&
        cachedIndex < this.m_allItems.length &&
        this.m_allItems[cachedIndex] === aItem
      ) {
        item = cachedIndex;
      } else {
        item = this.m_allItems.indexOf(aItem);
      }

      if (item !== -1) {
        this.m_allItems[item] = null;
        aItem.m_viewPrivData.clearUpdateFlags();

        s_gcCounter++;

        if (s_gcCounter > 4096) {
          // Perform defragmentation
          this.m_allItems = this.m_allItems.filter((it) => it !== null);

          // Update cached indices
          for (let idx = 0; idx < this.m_allItems.length; idx++)
            this.m_allItems[idx]!.m_viewPrivData!.m_cachedIndex = idx;

          s_gcCounter = 0;
        }
      }

      const bbox = aItem.m_viewPrivData.m_bbox;

      for (const layer of aItem.m_viewPrivData.m_layers) {
        const l = this.m_layers.get(layer)!;
        l.items.RemoveItem(aItem, bbox);
        this.MarkTargetDirty(l.target);

        // Clear the GAL cache
        const prevGroup = aItem.m_viewPrivData.getGroup(layer);

        if (prevGroup >= 0) this.m_gal!.DeleteGroup(prevGroup);
      }

      aItem.m_viewPrivData.deleteGroups();
      aItem.m_viewPrivData.m_view = null;
    }
  }

  /**
   * Find all visible items that touch or are within the rectangle \a aRect.
   *
   * @param aResult result of the search, containing VIEW_ITEMs associated with their layers.
   *                Sorted according to the rendering order (items that are on top of the
   *                rendering stack as first).
   * @return Number of found items.
   */
  Query(aRect: BOX2I, aResult: LAYER_ITEM_PAIR[]): number;
  /**
   * Run a function on all visible items that touch or are within the rectangle \a aRect.
   *
   * @param aRect is the rectangle to search.
   * @param aFunc is the function to run on each item. Return false to stop searching.
   */
  Query(aRect: BOX2I, aFunc: (aItem: VIEW_ITEM) => boolean): void;
  Query(aRect: BOX2I, a: LAYER_ITEM_PAIR[] | ((aItem: VIEW_ITEM) => boolean)): number | undefined {
    if (typeof a === 'function') {
      if (this.m_orderedLayers.length === 0) return;

      for (const i of this.m_orderedLayers) {
        // ignore layers that do not contain actual items (i.e. the selection box, menus, floats)
        if (i.displayOnly || !i.visible) continue;

        i.items.Query(aRect, a);
      }

      return;
    }

    const aResult = a;

    if (this.m_orderedLayers.length === 0) return 0;

    let layer: number = UNDEFINED_LAYER;
    const visitor = (item: VIEW_ITEM): boolean => {
      aResult.push([item, layer]);
      return true;
    };

    // execute queries in reverse direction, so that items that are on the top of
    // the rendering stack are returned first.
    for (let i = this.m_orderedLayers.length - 1; i >= 0; --i) {
      const l = this.m_orderedLayers[i]!;

      // ignore layers that do not contain actual items (i.e. the selection box, menus, floats)
      if (l.displayOnly || !l.visible) continue;

      layer = l.id;
      l.items.Query(aRect, visitor);
    }

    return aResult.length;
  }

  /**
   * Set the item visibility.
   *
   * @param aItem: the item to modify.
   * @param aIsVisible: whether the item is visible (on all layers), or not.
   */
  SetVisible(aItem: VIEW_ITEM | null, aIsVisible = true): void {
    if (!aItem) return;

    const viewData = aItem.viewPrivData();

    if (!viewData) return;

    const cur_visible = (viewData.m_flags & VISIBLE) !== 0;

    if (cur_visible !== aIsVisible) {
      if (aIsVisible) viewData.m_flags |= VISIBLE;
      else viewData.m_flags &= ~VISIBLE;

      this.Update(aItem, APPEARANCE | COLOR);
    }
  }

  /**
   * Temporarily hide the item in the view (e.g. for overlaying).
   *
   * @param aItem: the item to modify.
   * @param aHide: whether the item is hidden (on all layers), or not.
   * @param aHideOverlay: whether the item should also be hidden on overlays.
   */
  Hide(aItem: VIEW_ITEM | null, aHide = true, aHideOverlay = false): void {
    if (!aItem) return;

    const viewData = aItem.viewPrivData();

    if (!viewData) return;

    if (!(viewData.m_flags & VISIBLE)) return;

    if (aHideOverlay) viewData.m_flags |= OVERLAY_HIDDEN;

    if (aHide) viewData.m_flags |= HIDDEN;
    else viewData.m_flags &= ~(HIDDEN | OVERLAY_HIDDEN);

    this.Update(aItem, APPEARANCE);
  }

  /**
   * Return information if the item is visible (or not).
   *
   * @param aItem: the item to test.
   * @return when true, the item is visible (i.e. to be displayed, not visible in the
   * *current* viewport)
   */
  IsVisible(aItem: VIEW_ITEM): boolean {
    const viewData = aItem.viewPrivData();

    return !!viewData && (viewData.m_flags & VISIBLE) !== 0;
  }

  IsHiddenOnOverlay(aItem: VIEW_ITEM): boolean {
    const viewData = aItem.viewPrivData();

    return !!viewData && (viewData.m_flags & OVERLAY_HIDDEN) !== 0;
  }

  /**
   * Return true if the item is currently in the view.
   *
   * @param aItem: the item to test.
   */
  HasItem(aItem: VIEW_ITEM): boolean {
    const viewData = aItem.viewPrivData();

    return !!viewData && viewData.m_view === this;
  }

  /**
   * For dynamic VIEWs, inform the associated VIEW that the graphical representation of
   * this item has changed. For static views calling has no effect.
   *
   * @param aItem: the item to update.
   * @param aUpdateFlags: how much the object has changed.
   */
  Update(aItem: VIEW_ITEM, aUpdateFlags: number = ALL): void {
    const viewData = aItem.viewPrivData();

    if (!viewData) return;

    wxASSERT(aUpdateFlags !== NONE);

    viewData.m_requiredUpdate |= aUpdateFlags;
    this.m_hasPendingItemUpdates = true;
  }

  /**
   * Mark the \a aRequiredId layer as required for the aLayerId layer. In order to display the
   * layer, all of its required layers have to be enabled.
   *
   * @param aLayerId is the id of the layer for which we set the required layers.
   * @param aRequiredId is the id of the required layer.
   * @param aRequired tells if the required layer should be added or removed from the list.
   */
  SetRequired(aLayerId: number, aRequiredId: number, aRequired = true): void {
    // wxCHECK( (unsigned) aLayerId < m_layers.size(), /*void*/ )
    if (!(aLayerId >>> 0 < this.m_layers.size)) return;
    // wxCHECK( (unsigned) aRequiredId < m_layers.size(), /*void*/ )
    if (!(aRequiredId >>> 0 < this.m_layers.size)) return;

    if (aRequired) this.m_layers.get(aLayerId)!.requiredLayers.add(aRequiredId);
    // `m_layers[aLayerId].requiredLayers.erase( aRequired )`: the bool, as written
    else this.m_layers.get(aLayerId)!.requiredLayers.delete(aRequired ? 1 : 0);
  }

  /**
   * Copy layers and visibility settings from another view.
   *
   * @param aOtherView: view from which settings will be copied.
   */
  CopySettings(aOtherView: VIEW): void {
    wxASSERT(false, 'This is not implemented');
  }

  /*
   *  Convenience wrappers for adding multiple items
   *  template <class T> void AddItems( const T& aItems );
   *  template <class T> void RemoveItems( const T& aItems );
   */

  /**
   * Assign a rendering device for the VIEW.
   *
   * @param aGal: pointer to the GAL output device.
   */
  SetGAL(aGal: GAL): void {
    const recacheGroups = this.m_gal !== null; // recache groups only if GAL is reassigned
    this.m_gal = aGal;

    // clear group numbers, so everything is going to be recached
    if (recacheGroups) this.clearGroupCache();

    // every target has to be refreshed
    this.MarkDirty();

    // force the new GAL to display the current viewport.
    this.SetCenter(this.m_center);
    this.SetScale(this.m_scale);
    this.SetMirror(this.m_mirrorX, this.m_mirrorY);
  }

  /**
   * Return the #GAL this view is using to draw graphical elements.
   *
   * @return Pointer to the currently used GAL instance.
   */
  GetGAL(): GAL {
    return this.m_gal!;
  }

  /**
   * Set the painter object used by the view for drawing #VIEW_ITEMS.
   */
  SetPainter(aPainter: PAINTER): void {
    this.m_painter = aPainter;
  }

  /**
   * Return the painter object used by the view for drawing #VIEW_ITEMS.
   *
   * @return Pointer to the currently used Painter instance.
   */
  GetPainter(): PAINTER {
    return this.m_painter!;
  }

  /**
   * Set the visible area of the VIEW.
   *
   * @param aViewport: desired visible area, in world space coordinates.
   */
  SetViewport(aViewport: BOX2D): void {
    const ssize = this.ToWorld(this.m_gal!.GetScreenPixelSize(), false);

    // wxCHECK( fabs(ssize.x) > 0 && fabs(ssize.y) > 0, /*void*/ )
    if (!(Math.abs(ssize.x) > 0 && Math.abs(ssize.y) > 0)) return;

    const centre = aViewport.Centre();
    const vsize = aViewport.GetSize();
    const zoom = 1.0 / Math.max(Math.abs(vsize.x / ssize.x), Math.abs(vsize.y / ssize.y));

    this.SetCenter(centre);
    this.SetScale(this.GetScale() * zoom);
  }

  /**
   * Return the current viewport visible area rectangle.
   *
   * @return Current viewport rectangle.
   */
  GetViewport(): BOX2D {
    const rect = new BOX2D();
    const screenSize = this.m_gal!.GetScreenPixelSize();

    rect.SetOrigin(this.ToWorld({ x: 0, y: 0 }));
    rect.SetEnd(this.ToWorld(screenSize));

    return rect.Normalize();
  }

  /**
   * Control the mirroring of the VIEW.
   *
   * @param aMirrorX: when true, the X axis is mirrored.
   * @param aMirrorY: when true, the Y axis is mirrored.
   */
  SetMirror(aMirrorX: boolean, aMirrorY: boolean): void {
    wxASSERT(!aMirrorY, 'Mirroring for Y axis is not supported yet');

    this.m_mirrorX = aMirrorX;
    this.m_mirrorY = aMirrorY;
    this.m_gal!.SetFlip(aMirrorX, aMirrorY);

    // Redraw everything
    this.MarkDirty();
  }

  /**
   * Return true if view is flipped across the X axis.
   */
  IsMirroredX(): boolean {
    return this.m_mirrorX;
  }

  /**
   * Return true if view is flipped across the Y axis.
   */
  IsMirroredY(): boolean {
    return this.m_mirrorY;
  }

  /**
   * Set the scaling factor, zooming around a given anchor point.
   * (depending on correct GAL unit length & DPI settings).
   *
   * @param aAnchor is the zooming anchor point.
   * @param aScale is the scale factor.
   */
  SetScale(aScale: number, aAnchor: Vec2 = { x: 0, y: 0 }): void {
    if (aAnchor.x === 0 && aAnchor.y === 0) aAnchor = this.m_center;

    const a = this.ToScreen(aAnchor);

    if (aScale < this.m_minScale) this.m_scale = this.m_minScale;
    else if (aScale > this.m_maxScale) this.m_scale = this.m_maxScale;
    else this.m_scale = aScale;

    this.m_gal!.SetZoomFactor(this.m_scale);
    this.m_gal!.ComputeWorldScreenMatrix();

    const w = this.ToWorld(a);
    const delta = { x: w.x - aAnchor.x, y: w.y - aAnchor.y };

    this.SetCenter({ x: this.m_center.x - delta.x, y: this.m_center.y - delta.y });

    // Redraw everything after the viewport has changed
    this.MarkDirty();
  }

  /**
   * @return the current scale factor
   */
  GetScale(): number {
    return this.m_scale;
  }

  /**
   * Set limits for view area.
   *
   * @param aBoundary is the box that limits view area.
   */
  SetBoundary(aBoundary: BOX2D | BOX2I): void {
    if (aBoundary instanceof BOX2D) {
      this.m_boundary = aBoundary;
      return;
    }

    this.m_boundary.SetOrigin(aBoundary.GetOrigin());
    this.m_boundary.SetEnd(aBoundary.GetEnd());
  }

  /**
   * @return Current view area boundary.
   */
  GetBoundary(): BOX2D {
    return this.m_boundary;
  }

  /**
   * Set minimum and maximum values for scale.
   *
   * @param aMaximum is the maximum value for scale.
   * @param aMinimum is the minimum value for scale.
   */
  SetScaleLimits(aMaximum: number, aMinimum: number): void {
    wxASSERT(aMaximum > aMinimum, 'I guess you passed parameters in wrong order');

    this.m_minScale = aMinimum;
    this.m_maxScale = aMaximum;
  }

  /**
   * Set the center point of the VIEW (i.e. the point in world space that will be drawn in
   * the middle of the screen).
   *
   * @param aCenter: the new center point, in world space coordinates.
   */
  SetCenter(aCenter: Vec2): void;
  /**
   * Set the center point of the VIEW, attempting to avoid \a obscuringScreenRects (for
   * instance, the screen rect of a modeless dialog in front of the VIEW).
   *
   * @param aCenter: the new center point, in world space coordinates.
   * @param obscuringScreenRects: the obscuring screen rects, in screen space coordinates.
   */
  SetCenter(aCenter: Vec2, obscuringScreenRects: readonly BOX2D[]): void;
  SetCenter(aCenter: Vec2, obscuringScreenRects?: readonly BOX2D[]): void {
    if (obscuringScreenRects !== undefined) {
      if (obscuringScreenRects.length === 0) {
        this.SetCenter(aCenter);
        return;
      }

      const screenRect = new BOX2D({ x: 0, y: 0 }, this.m_gal!.GetScreenPixelSize());
      const unobscuredPoly = new SHAPE_POLY_SET(screenRect);
      let unobscuredCenter = screenRect.Centre();

      for (const obscuringScreenRect of obscuringScreenRects) {
        const obscuringPoly = new SHAPE_POLY_SET(obscuringScreenRect);
        unobscuredPoly.BooleanSubtract(obscuringPoly);
      }

      /*
       * Perform a step-wise deflate to find the center of the largest unobscured area
       */

      const bbox = unobscuredPoly.BBox();
      let step = Math.trunc(Math.min(bbox.GetWidth(), bbox.GetHeight()) / 10);

      if (step < 20) step = 20;

      while (!unobscuredPoly.IsEmpty()) {
        unobscuredCenter = unobscuredPoly.BBox().Centre();
        unobscuredPoly.Deflate(step, CornerStrategy.ALLOW_ACUTE_CORNERS, ARC_LOW_DEF);
      }

      const c = screenRect.Centre();
      const off = this.ToWorld({ x: unobscuredCenter.x - c.x, y: unobscuredCenter.y - c.y }, false);
      this.SetCenter({ x: aCenter.x - off.x, y: aCenter.y - off.y });
      return;
    }

    const center = { x: aCenter.x, y: aCenter.y };

    if (!this.m_boundary.Contains(aCenter)) {
      if (center.x < this.m_boundary.GetLeft()) center.x = this.m_boundary.GetLeft();
      else if (aCenter.x > this.m_boundary.GetRight()) center.x = this.m_boundary.GetRight();

      if (center.y < this.m_boundary.GetTop()) center.y = this.m_boundary.GetTop();
      else if (center.y > this.m_boundary.GetBottom()) center.y = this.m_boundary.GetBottom();
    }

    this.m_center = center;

    this.m_gal!.SetLookAtPoint(this.m_center);
    this.m_gal!.ComputeWorldScreenMatrix();

    // Redraw everything after the viewport has changed
    this.MarkDirty();
  }

  /**
   * Return the center point of this VIEW (in world space coordinates).
   *
   * @return center point of the view
   */
  GetCenter(): Vec2 {
    return this.m_center;
  }

  /**
   * Converts a screen space point/vector to a point/vector in world space coordinates.
   *
   * @param aCoord is the point/vector to be converted.
   * @param aAbsolute when true, aCoord is treated as a point, otherwise as a direction (vector).
   */
  ToWorld(aCoord: Vec2, aAbsolute?: boolean): Vec2;
  /**
   * Converts a screen space one dimensional size to a one dimensional size in world
   * space coordinates.
   *
   * @param aSize is the size to be converted.
   */
  ToWorld(aSize: number): number;
  ToWorld(a: Vec2 | number, aAbsolute = true): Vec2 | number {
    const matrix = this.m_gal!.GetScreenWorldMatrix();

    if (typeof a === 'number') return Math.abs(matrix.GetScale().x * a);

    if (aAbsolute) return matrix.mulVec2(a);
    return { x: matrix.GetScale().x * a.x, y: matrix.GetScale().y * a.y };
  }

  /**
   * Convert a world space point/vector to a point/vector in screen space coordinates.
   *
   * @param aCoord is the point/vector to be converted.
   * @param aAbsolute when true aCoord is treated as a point, otherwise as a direction (vector).
   */
  ToScreen(aCoord: Vec2, aAbsolute?: boolean): Vec2;
  /**
   * Convert a world space one dimensional size to a one dimensional size in screen space.
   *
   * @param aSize is the size to be transformed.
   */
  ToScreen(aSize: number): number;
  ToScreen(a: Vec2 | number, aAbsolute = true): Vec2 | number {
    const matrix = this.m_gal!.GetWorldScreenMatrix();

    if (typeof a === 'number') return matrix.GetScale().x * a;

    if (aAbsolute) return matrix.mulVec2(a);
    return { x: matrix.GetScale().x * a.x, y: matrix.GetScale().y * a.y };
  }

  /**
   * Return the size of the our rendering area in pixels.
   *
   * @return viewport screen size.
   */
  GetScreenPixelSize(): VECTOR2I {
    return this.m_gal!.GetScreenPixelSize();
  }

  /**
   * Remove all items from the view.
   */
  Clear(): void {
    const r = new BOX2I();
    r.SetMaximum();

    // Invalidate viewPrivData for all items before clearing. This ensures that items
    // which persist outside the view (like selection groups) won't have stale references
    // to this view, which could cause issues if they're later removed and re-added.
    for (const item of this.m_allItems) {
      if (item?.m_viewPrivData) item.m_viewPrivData.m_view = null;
    }

    this.m_allItems = [];

    for (const [, layer] of this.m_layers) layer.items.RemoveAll();

    this.m_nextDrawPriority = 0;

    this.m_gal!.ClearCache();
  }

  /**
   * Control the visibility of a particular layer.
   *
   * @param aLayer is the layer to show/hide.
   * @param aVisible is the layer visibility state.
   */
  SetLayerVisible(aLayer: number, aVisible = true): void {
    const layer = this.m_layers.get(aLayer);

    if (!layer) return;

    if (layer.visible !== aVisible) {
      // Target has to be redrawn after changing its visibility
      this.MarkTargetDirty(layer.target);
      layer.visible = aVisible;
    }
  }

  /**
   * Return information about visibility of a particular layer.
   *
   * @param aLayer true if the layer is visible, false otherwise.
   */
  IsLayerVisible(aLayer: number): boolean {
    const layer = this.m_layers.get(aLayer);

    if (!layer) return false;

    return layer.visible;
  }

  /**
   * Set the whether the layer should drawn differentially.
   *
   * @param aLayer is the layer to set to be draw differentially
   * @param aDiff is the layer diff'ing state.
   */
  SetLayerDiff(aLayer: number, aDiff = true): void {
    const layer = this.m_layers.get(aLayer);

    if (!layer) return;

    if (layer.diffLayer !== aDiff) {
      // Target has to be redrawn after changing its layers' diff status
      this.MarkTargetDirty(layer.target);
      layer.diffLayer = aDiff;
    }
  }

  /**
   * Set the status of negatives presense in a particular layer.
   *
   * @param aLayer is the layer to set as containing negatives (or not).
   * @param aNegatives is the layer negatives state.
   */
  SetLayerHasNegatives(aLayer: number, aNegatives = true): void {
    const layer = this.m_layers.get(aLayer);

    if (!layer) return;

    if (layer.hasNegatives !== aNegatives) {
      // Target has to be redrawn after changing a layers' negatives
      this.MarkTargetDirty(layer.target);
      layer.hasNegatives = aNegatives;
    }
  }

  /**
   * Set a layer display-only (ie: to be rendered but not returned by hit test queries).
   */
  SetLayerDisplayOnly(aLayer: number, aDisplayOnly = true): void {
    const layer = this.m_layers.get(aLayer);

    if (!layer) return;

    layer.displayOnly = aDisplayOnly;
  }

  /**
   * Change the rendering target for a particular layer.
   *
   * @param aLayer is the layer.
   * @param aTarget is the rendering target.
   */
  SetLayerTarget(aLayer: number, aTarget: RENDER_TARGET): void {
    const layer = this.m_layers.get(aLayer);

    if (!layer) return;

    layer.target = aTarget;
  }

  /**
   * Set rendering order of a particular layer. Lower values are rendered first.
   *
   * @param aLayer is the layer.
   * @param aRenderingOrder is an arbitrary number denoting the rendering order.
   * @param aAutoSort set to false to avoid sorting. In that case,
   *                  call SortOrderedLayers() after setting all layer orders.
   */
  SetLayerOrder(aLayer: number, aRenderingOrder: number, aAutoSort = true): void {
    this.m_layers.get(aLayer)!.renderingOrder = aRenderingOrder;

    if (aAutoSort) this.SortOrderedLayers();
  }

  /**
   * Return rendering order of a particular layer. Lower values are rendered first.
   *
   * @param aLayer is the layer.
   * @return Rendering order of a particular layer.
   */
  GetLayerOrder(aLayer: number): number {
    return this.m_layers.get(aLayer)!.renderingOrder;
  }

  /**
   * Sort m_orderedLayers when layer rendering order has changed
   * (m_orderedLayers is sorted by layer rendering order).
   */
  SortOrderedLayers(): void {
    this.m_orderedLayers = [];

    for (const [, layer] of this.m_layers) this.m_orderedLayers.push(layer);

    stdSort(this.m_orderedLayers, VIEW.compareRenderingOrder);

    this.MarkDirty();
  }

  /**
   * Sort the list of layers according to the rendering order.
   *
   * First layer is the one that should be drawn first.
   *
   * @param aLayers stores id of layers to be sorted.
   */
  SortLayers(aLayers: number[]): void {
    stdSort(aLayers, (a, b) => this.GetLayerOrder(a) > this.GetLayerOrder(b));
  }

  /**
   * Remap the data between layer ids without invalidating that data.
   *
   * Used by GerbView for the "Sort by X2" functionality.
   *
   * @param aReorderMap is a mapping of old to new layer ids.
   */
  ReorderLayerData(aReorderMap: Map<number, number>): void {
    // A std::map is ordered by key, so the new map is filled in id order.
    const new_map = new Map<number, VIEW_LAYER>();

    for (const [, layer] of this.m_layers) {
      const reorder_to = aReorderMap.get(layer.id);

      // If the layer is not in the reorder map or if it is mapped to itself,
      // just copy the layer to the new map.
      if (reorder_to === undefined || reorder_to === layer.id) {
        if (!new_map.has(layer.id)) new_map.set(layer.id, { ...layer });
        continue;
      }

      if (!new_map.has(reorder_to)) {
        const copy = { ...layer };
        copy.id = reorder_to;
        new_map.set(reorder_to, copy);
      }
    }

    // Transfer reordered data (using the copy assignment operator ):
    this.m_layers = new Map([...new_map.entries()].sort((a, b) => a[0] - b[0]));

    this.SortOrderedLayers();

    for (const item of this.m_allItems) {
      if (!item) continue;

      const viewData = item.viewPrivData();

      if (!viewData) continue;

      const layers = item.ViewGetLayers();
      viewData.saveLayers(layers);

      viewData.reorderGroups(aReorderMap);

      viewData.m_requiredUpdate |= COLOR;
      this.m_hasPendingItemUpdates = true;
    }

    this.UpdateItems();
  }

  /**
   * Apply the new coloring scheme held by RENDER_SETTINGS in case that it has changed.
   *
   * @param aLayer is a number of the layer to be updated.
   * @see RENDER_SETTINGS
   */
  UpdateLayerColor(aLayer: number): void {
    // There is no point in updating non-cached layers
    if (!this.IsCached(aLayer)) return;

    const r = new BOX2I();

    r.SetMaximum();

    if (this.m_gal!.IsVisible()) {
      GAL_UPDATE_CONTEXT(this.m_gal!, () => {
        // UPDATE_COLOR_VISITOR
        const visitor = (aItem: VIEW_ITEM): boolean => {
          // Obtain the color that should be used for coloring the item
          const color = this.m_painter!.GetSettings().GetColor(aItem, aLayer);
          const group = aItem.viewPrivData()!.getGroup(aLayer);

          if (group >= 0) this.m_gal!.ChangeGroupColor(group, color);

          return true;
        };
        this.m_layers.get(aLayer)!.items.Query(r, visitor);
        this.MarkTargetDirty(this.m_layers.get(aLayer)!.target);
      });
    }
  }

  /**
   * Apply the new coloring scheme to all layers. The used scheme is held by RENDER_SETTINGS.
   *
   * @see RENDER_SETTINGS
   */
  UpdateAllLayersColor(): void {
    if (this.m_gal!.IsVisible()) {
      GAL_UPDATE_CONTEXT(this.m_gal!, () => {
        for (const item of this.m_allItems) {
          if (!item) continue;

          const viewData = item.viewPrivData();

          if (!viewData) continue;

          for (const layer of viewData.m_layers) {
            const color = this.m_painter!.GetSettings().GetColor(item, layer);
            const group = viewData.getGroup(layer);

            if (group >= 0) this.m_gal!.ChangeGroupColor(group, color);
          }
        }
      });
    }

    this.MarkDirty();
  }

  /**
   * Set given layer to be displayed on the top or sets back the default order of layers.
   *
   * @param aEnabled = true to display aLayer on the top.
   * @param aLayer is the layer or -1 in case when no particular layer should be displayed
   *               on the top.
   */
  SetTopLayer(aLayer: number, aEnabled = true): void {
    if (aEnabled) {
      if (this.m_topLayers.has(aLayer)) return;

      this.m_topLayers.add(aLayer);

      // Move the layer closer to front
      if (this.m_enableOrderModifier)
        this.m_layers.get(aLayer)!.renderingOrder += VIEW.TOP_LAYER_MODIFIER;
    } else {
      if (!this.m_topLayers.has(aLayer)) return;

      this.m_topLayers.delete(aLayer);

      // Restore the previous rendering order
      if (this.m_enableOrderModifier)
        this.m_layers.get(aLayer)!.renderingOrder -= VIEW.TOP_LAYER_MODIFIER;
    }
  }

  /**
   * Enable or disable display of the top layer.
   *
   * When disabled - layers are rendered as usual with no influence from SetTopLayer
   * function.  Otherwise on the top there is displayed the layer set previously with
   * SetTopLayer function.
   *
   * @param aEnable whether to enable or disable display of the top layer.
   */
  EnableTopLayer(aEnable: boolean): void {
    if (aEnable === this.m_enableOrderModifier) return;

    this.m_enableOrderModifier = aEnable;

    if (aEnable) {
      for (const it of this.m_topLayers)
        this.m_layers.get(it)!.renderingOrder += VIEW.TOP_LAYER_MODIFIER;
    } else {
      for (const it of this.m_topLayers)
        this.m_layers.get(it)!.renderingOrder -= VIEW.TOP_LAYER_MODIFIER;
    }

    this.UpdateAllLayersOrder();
    this.UpdateAllLayersColor();
  }

  GetTopLayer(): number {
    if (this.m_topLayers.size === 0) return 0;

    return this.m_topLayers.values().next().value!;
  }

  /**
   * Remove all layers from the on-the-top set (they are no longer displayed over the rest of
   * layers).
   */
  ClearTopLayers(): void {
    if (this.m_enableOrderModifier) {
      // Restore the previous rendering order for layers that were marked as top
      for (const it of this.m_topLayers)
        this.m_layers.get(it)!.renderingOrder -= VIEW.TOP_LAYER_MODIFIER;
    }

    this.m_topLayers.clear();
  }

  /**
   * Do everything that is needed to apply the rendering order of layers.
   *
   * It has to be called after modification of renderingOrder field of LAYER.
   */
  UpdateAllLayersOrder(): void {
    this.SortOrderedLayers();

    if (this.m_gal!.IsVisible()) {
      GAL_UPDATE_CONTEXT(this.m_gal!, () => {
        for (const item of this.m_allItems) {
          if (!item) continue;

          const viewData = item.viewPrivData();

          if (!viewData) continue;

          for (const layer of viewData.m_layers) {
            const group = viewData.getGroup(layer);

            if (group >= 0)
              this.m_gal!.ChangeGroupDepth(group, this.m_layers.get(layer)!.renderingOrder);
          }
        }
      });
    }

    this.MarkDirty();
  }

  /**
   * Clear targets that are marked as dirty.
   */
  ClearTargets(): void {
    if (this.IsTargetDirty(TARGET_CACHED) || this.IsTargetDirty(TARGET_NONCACHED)) {
      // TARGET_CACHED and TARGET_NONCACHED have to be redrawn together, as they contain
      // layers that rely on each other (eg. netnames are noncached, but tracks - are cached)
      this.m_gal!.ClearTarget(TARGET_NONCACHED);
      this.m_gal!.ClearTarget(TARGET_CACHED);

      this.MarkDirty();
    }

    if (this.IsTargetDirty(TARGET_OVERLAY)) {
      this.m_gal!.ClearTarget(TARGET_OVERLAY);
    }
  }

  /**
   * Immediately redraw the whole view.
   */
  Redraw(): void {
    const screenSize = this.m_gal!.GetScreenPixelSize();
    const o = this.ToWorld({ x: 0, y: 0 });
    const s = this.ToWorld(screenSize);
    const rect = new BOX2D(o, { x: s.x - o.x, y: s.y - o.y });

    rect.Normalize();
    const recti = BOX2ISafe(rect);

    this.redrawRect(recti);

    // All targets were redrawn, so nothing is dirty
    this.MarkClean();
  }

  /**
   * Rebuild GAL display lists.
   */
  RecacheAllItems(): void {
    const r = new BOX2I();

    r.SetMaximum();

    for (const [, l] of this.m_layers) {
      if (this.IsCached(l.id)) {
        // RECACHE_ITEM_VISITOR
        const visitor = (aItem: VIEW_ITEM): boolean => {
          const viewData = aItem.viewPrivData();

          if (!viewData) return false;

          // Remove previously cached group
          const group = viewData.getGroup(l.id);

          if (group >= 0) this.m_gal!.DeleteGroup(group);

          viewData.setGroup(l.id, -1);
          this.Update(aItem);

          return true;
        };
        l.items.Query(r, visitor);
      }
    }
  }

  /**
   * Return true if any of the VIEW layers needs to be refreshed.
   *
   * @return True in case if any of layers is marked as dirty.
   */
  IsDirty(): boolean {
    for (let i = 0; i < TARGETS_NUMBER; ++i) {
      if (this.IsTargetDirty(i)) return true;
    }

    return false;
  }

  /**
   * Return true if any of layers belonging to the target or the target itself should be
   * redrawn.
   *
   * @return True if the above condition is met.
   */
  IsTargetDirty(aTarget: number): boolean {
    // wxCHECK( aTarget < TARGETS_NUMBER, false )
    if (!(aTarget < TARGETS_NUMBER)) return false;
    return this.m_dirtyTargets[aTarget] ?? false;
  }

  /**
   * Set or clear target 'dirty' flag.
   *
   * @param aTarget is the target to set.
   */
  MarkTargetDirty(aTarget: number): void {
    // wxCHECK( aTarget < TARGETS_NUMBER, /* void */ )
    if (!(aTarget < TARGETS_NUMBER)) return;
    this.m_dirtyTargets[aTarget] = true;
  }

  /// Return true if the layer is cached.
  IsCached(aLayer: number): boolean {
    const layer = this.m_layers.get(aLayer);

    if (!layer) return false;

    return layer.target === TARGET_CACHED;
  }

  /**
   * Force redraw of view on the next rendering.
   */
  MarkDirty(): void {
    for (let i = 0; i < TARGETS_NUMBER; ++i) this.m_dirtyTargets[i] = true;
  }

  /**
   * Clear layer dirty flags.
   */
  MarkClean(): void {
    for (let i = 0; i < TARGETS_NUMBER; ++i) this.m_dirtyTargets[i] = false;
  }

  /**
   * Iterate through the list of items that asked for updating and updates them.
   */
  UpdateItems(): void {
    if (!this.m_gal!.IsVisible() || !this.m_gal!.IsInitialized()) return;

    if (!this.m_hasPendingItemUpdates) return;

    let cntGeomUpdate = 0;
    let anyUpdated = false;

    for (const item of this.m_allItems) {
      if (!item) continue;

      const vpd = item.viewPrivData();

      if (!vpd) continue;

      if (vpd.m_requiredUpdate !== NONE) {
        anyUpdated = true;

        if (vpd.m_requiredUpdate & (GEOMETRY | LAYERS)) {
          cntGeomUpdate++;
        }
      }
    }

    const cntTotal = this.m_allItems.length;

    const ratio = cntGeomUpdate / cntTotal;

    // Optimization to improve view update time. If a lot of items (say, 30%) have their
    // bboxes/geometry changed it's way faster (around 10 times) to rebuild the R-Trees
    // from scratch rather than update the bbox of each changed item. Pcbnew does multiple
    // full geometry updates during file load, this can save a solid 30 seconds on load time
    // for larger designs...

    if (ratio > 0.3) {
      const allItems = [...this.m_allItems];

      // kill all Rtrees
      for (const [, layer] of this.m_layers) layer.items.RemoveAll();

      // and re-insert items from scratch
      for (const item of allItems) {
        if (!item) continue;

        const bbox = item.ViewBBox();
        item.m_viewPrivData!.m_bbox = bbox;

        const layers = item.ViewGetLayers();
        item.viewPrivData()!.saveLayers(layers);

        for (const layer of layers) {
          const l = this.m_layers.get(layer);

          // wxCHECK2_MSG( it != m_layers.end(), continue, "Invalid layer" )
          if (!l) continue;

          l.items.InsertItem(item, bbox);
          this.MarkTargetDirty(l.target);
        }

        item.viewPrivData()!.m_requiredUpdate &= ~(LAYERS | GEOMETRY);
      }
    }

    if (anyUpdated) {
      GAL_UPDATE_CONTEXT(this.m_gal!, () => {
        for (const item of this.m_allItems) {
          if (item?.viewPrivData() && item.viewPrivData()!.m_requiredUpdate !== NONE) {
            this.invalidateItem(item, item.viewPrivData()!.m_requiredUpdate);
            item.viewPrivData()!.m_requiredUpdate = NONE;
          }
        }
      });
    }

    // KI_TRACE( traceGalProfile, "View update: total items %u, geom %u anyUpdated %u\n", ... )

    this.m_hasPendingItemUpdates = false;
  }

  HasPendingItemUpdates(): boolean {
    return this.m_hasPendingItemUpdates;
  }

  /**
   * Update all items in the view according to the given flags.
   *
   * @param aUpdateFlags is is according to KIGFX::VIEW_UPDATE_FLAGS
   */
  UpdateAllItems(aUpdateFlags: number): void {
    if (aUpdateFlags === NONE) return;

    for (const item of this.m_allItems) {
      if (item?.viewPrivData()) {
        item.viewPrivData()!.m_requiredUpdate |= aUpdateFlags;
        this.m_hasPendingItemUpdates = true;
      }
    }
  }

  /**
   * Update items in the view according to the given flags and condition.
   *
   * @param aUpdateFlags is is according to KIGFX::VIEW_UPDATE_FLAGS.
   * @param aCondition is a function returning true if the item should be updated.
   */
  UpdateAllItemsConditionally(
    aUpdateFlags: number,
    aCondition: (aItem: VIEW_ITEM) => boolean,
  ): void;
  /**
   * Update items in the view according to the flags returned by the callback.
   *
   * @param aItemFlagsProvider is a function returning any KIGFX::VIEW_UPDATE_FLAGS
   *                           that should be applied to the VIEW_ITEM.
   */
  UpdateAllItemsConditionally(aItemFlagsProvider: (aItem: VIEW_ITEM) => number): void;
  UpdateAllItemsConditionally(
    a: number | ((aItem: VIEW_ITEM) => number),
    aCondition?: (aItem: VIEW_ITEM) => boolean,
  ): void {
    if (typeof a === 'number') {
      const aUpdateFlags = a;

      if (aUpdateFlags === NONE) return;

      for (const item of this.m_allItems) {
        if (!item) continue;

        if (aCondition!(item)) {
          if (item.viewPrivData()) {
            item.viewPrivData()!.m_requiredUpdate |= aUpdateFlags;
            this.m_hasPendingItemUpdates = true;
          }
        }
      }

      return;
    }

    for (const item of this.m_allItems) {
      if (!item) continue;

      if (item.viewPrivData()) {
        const flags = a(item);
        item.viewPrivData()!.m_requiredUpdate |= flags;

        if (flags !== NONE) this.m_hasPendingItemUpdates = true;
      }
    }
  }

  /**
   * @return true if draw priority is being respected while redrawing.
   */
  IsUsingDrawPriority(): boolean {
    return this.m_useDrawPriority;
  }

  /**
   * @param aFlag is true if draw priority should be respected while redrawing.
   */
  UseDrawPriority(aFlag: boolean): void {
    this.m_useDrawPriority = aFlag;
  }

  /**
   * Only takes effect if UseDrawPriority is true.
   *
   * @param aFlag is true if draw order should be reversed
   */
  ReverseDrawOrder(aFlag: boolean): void {
    this.m_reverseDrawOrder = aFlag;
  }

  MakeOverlay(): VIEW_OVERLAY {
    const overlay = new VIEW_OVERLAY();

    this.Add(overlay);
    return overlay;
  }

  InitPreview(): void {
    this.m_preview = new VIEW_GROUP();
    this.Add(this.m_preview);
  }

  ClearPreview(): void {
    if (!this.m_preview) return;

    this.m_preview.Clear();

    // delete item: the garbage collector's
    this.m_ownedItems = [];
    this.Update(this.m_preview);
  }

  AddToPreview(aItem: VIEW_ITEM, aTakeOwnership = true): void {
    this.Hide(aItem, false);
    this.m_preview.Add(aItem);

    if (aTakeOwnership) this.m_ownedItems.push(aItem);

    this.SetVisible(this.m_preview, true);
    this.Hide(this.m_preview, false);
    this.Update(this.m_preview);
  }

  ShowPreview(aShow = true): void {
    this.SetVisible(this.m_preview, aShow);
  }

  /**
   * Return a new VIEW object that shares the same set of VIEW_ITEMs and LAYERs.
   *
   * GAL, PAINTER and other properties are left uninitialized.
   */
  DataReference(): VIEW {
    const ret = new VIEW();
    ret.m_allItems = this.m_allItems;
    ret.m_layers = this.m_layers;
    ret.m_hasPendingItemUpdates = this.m_hasPendingItemUpdates;
    ret.SortOrderedLayers();
    return ret;
  }

  /// Redraw contents within rectangle \a aRect.
  protected redrawRect(aRect: BOX2I): void {
    for (const l of this.m_orderedLayers) {
      if (l.visible && this.IsTargetDirty(l.target) && this.areRequiredLayersEnabled(l.id)) {
        const drawFunc = new DRAW_ITEM_VISITOR(
          this,
          l.id,
          this.m_useDrawPriority,
          this.m_reverseDrawOrder,
        );

        this.m_gal!.SetTarget(l.target);
        this.m_gal!.SetLayerDepth(l.renderingOrder);

        // Differential layer also work for the negatives, since both special layer types
        // will composite on separate layers (at least in Cairo)
        if (l.diffLayer) this.m_gal!.StartDiffLayer();
        else if (l.hasNegatives) this.m_gal!.StartNegativesLayer();

        l.items.Query(aRect, drawFunc.visit);

        if (this.m_useDrawPriority) drawFunc.deferredDraw();

        if (l.diffLayer) this.m_gal!.EndDiffLayer();
        else if (l.hasNegatives) this.m_gal!.EndNegativesLayer();

        if (drawFunc.foundForcedTransparent) {
          drawFunc.drawForcedTransparent = true;

          this.m_gal!.SetTarget(TARGET_NONCACHED);
          this.m_gal!.EnableDepthTest(true);
          this.m_gal!.SetLayerDepth(l.renderingOrder);

          l.items.Query(aRect, drawFunc.visit);
        }
      }
    }
  }

  protected markTargetClean(aTarget: number): void {
    // wxCHECK( aTarget < TARGETS_NUMBER, /* void */ )
    if (!(aTarget < TARGETS_NUMBER)) return;
    this.m_dirtyTargets[aTarget] = false;
  }

  /**
   * Draw an item, but on a specified layers.
   *
   * It has to be marked that some of drawing settings are based on the layer on which
   * an item is drawn.
   *
   * @param aItem is the item to be drawn.
   * @param aLayer is the layer which should be rendered.
   * @param aImmediate dictates the way of drawing - it allows one to force immediate
   *                   drawing mode for cached items.
   */
  draw(aItem: VIEW_ITEM, aLayer: number, aImmediate?: boolean): void;
  /**
   * Draw an item on all layers that the item uses.
   *
   * @param aItem is the item to be drawn.
   * @param aImmediate dictates the way of drawing - it allows one to force immediate
   *                   drawing mode for cached items.
   */
  draw(aItem: VIEW_ITEM, aImmediate?: boolean): void;
  /**
   * Draw a group of items on all layers that those items use.
   *
   * @param aGroup is the group to be drawn.
   * @param aImmediate dictates the way of drawing - it allows one to force immediate
   *                   drawing mode for cached items.
   */
  draw(aGroup: VIEW_GROUP, aImmediate?: boolean): void;
  draw(aItem: VIEW_ITEM, a?: number | boolean, aImmediate = false): void {
    if (typeof a === 'number') {
      const aLayer = a;
      const viewData = aItem.viewPrivData();

      if (!viewData) return;

      if (this.IsCached(aLayer) && !aImmediate) {
        // Draw using cached information or create one
        const group = viewData.getGroup(aLayer);

        if (group >= 0) this.m_gal!.DrawGroup(group);
        else this.Update(aItem);
      } else {
        // Immediate mode
        if (!this.m_painter!.Draw(aItem, aLayer)) aItem.ViewDraw(aLayer, this); // Alternative drawing method
      }

      return;
    }

    aImmediate = a ?? false;

    if (aItem instanceof VIEW_GROUP) {
      const aGroup = aItem;
      for (let i = 0; i < aGroup.GetSize(); i++) this.draw(aGroup.GetItem(i)!, aImmediate);
      return;
    }

    const layers = aItem.ViewGetLayers();

    // Sorting is needed for drawing order dependent GALs (like Cairo)
    if (!this.m_gal || !this.m_gal.IsOpenGlEngine()) this.SortLayers(layers);

    for (const layer of layers) {
      const it = this.m_layers.get(layer);

      if (!it) continue;

      if (this.m_gal) this.m_gal.SetLayerDepth(it.renderingOrder);

      this.draw(aItem, layer, aImmediate);
    }
  }

  /// Clear cached GAL group numbers (*ONLY* numbers stored in VIEW_ITEMs, not group objects
  /// used by GAL).
  protected clearGroupCache(): void {
    const r = new BOX2I();

    r.SetMaximum();
    // CLEAR_LAYER_CACHE_VISITOR
    const visitor = (aItem: VIEW_ITEM): boolean => {
      aItem.viewPrivData()!.deleteGroups();

      return true;
    };

    for (const [, layer] of this.m_layers) layer.items.Query(r, visitor);
  }

  /**
   * Manage dirty flags & redraw queuing when updating an item.
   *
   * @param aItem is the item to be updated.
   * @param aUpdateFlags determines the way an item is refreshed.
   */
  protected invalidateItem(aItem: VIEW_ITEM, aUpdateFlags: number): void {
    if (aUpdateFlags & INITIAL_ADD) {
      // Don't update layers or bbox, since it was done in VIEW::Add()
      // Now that we have initialized, set flags to ALL for the code below
      aUpdateFlags = ALL;
    } else {
      // updateLayers updates geometry too, so we do not have to update both of them at the
      // same time
      if (aUpdateFlags & LAYERS) this.updateLayers(aItem);
      else if (aUpdateFlags & GEOMETRY) this.updateBbox(aItem);
    }

    const layers = aItem.ViewGetLayers();

    // Iterate through layers used by the item and recache it immediately
    for (const layer of layers) {
      if (this.IsCached(layer)) {
        if (aUpdateFlags & (GEOMETRY | LAYERS | REPAINT)) this.updateItemGeometry(aItem, layer);
        else if (aUpdateFlags & COLOR) this.updateItemColor(aItem, layer);
      }

      // Mark those layers as dirty, so the VIEW will be refreshed
      this.MarkTargetDirty(this.m_layers.get(layer)!.target);
    }

    aItem.viewPrivData()!.clearUpdateFlags();
  }

  /// Update colors that are used for an item to be drawn.
  protected updateItemColor(aItem: VIEW_ITEM, aLayer: number): void {
    const viewData = aItem.viewPrivData();
    // wxCHECK( IsCached( aLayer ), /*void*/ ); // This will check if the layer exists
    if (!this.IsCached(aLayer)) return;

    if (!viewData) return;

    // Obtain the color that should be used for coloring the item on the specific layerId
    const color = this.m_painter!.GetSettings().GetColor(aItem, aLayer);
    const group = viewData.getGroup(aLayer);

    // Change the color, only if it has group assigned
    if (group >= 0) this.m_gal!.ChangeGroupColor(group, color);
  }

  /// Update all information needed to draw an item.
  protected updateItemGeometry(aItem: VIEW_ITEM, aLayer: number): void {
    const viewData = aItem.viewPrivData();

    if (!viewData) return;

    const l = this.m_layers.get(aLayer);

    if (!l) return;

    // Save the extra map lookup in IsCached by open coding here
    if (l.target !== TARGET_CACHED) return;

    this.m_gal!.SetTarget(l.target);
    this.m_gal!.SetLayerDepth(l.renderingOrder);

    // Redraw the item from scratch
    let group = viewData.getGroup(aLayer);

    if (group >= 0) this.m_gal!.DeleteGroup(group);

    group = this.m_gal!.BeginGroup();
    viewData.setGroup(aLayer, group);

    if (!this.m_painter!.Draw(aItem, aLayer)) aItem.ViewDraw(aLayer, this); // Alternative drawing method

    this.m_gal!.EndGroup();
  }

  /// Update bounding box of an item.
  protected updateBbox(aItem: VIEW_ITEM): void {
    const layers = aItem.ViewGetLayers();

    wxASSERT(aItem.m_viewPrivData !== null); //must have a viewPrivData

    const new_bbox = aItem.ViewBBox();

    // The R-tree removal below keys on the bbox the item was inserted with, so it must be
    // copied before the m_bbox overwrite that follows rather than aliased to it.
    const old_bbox = aItem.m_viewPrivData!.m_bbox;
    aItem.m_viewPrivData!.m_bbox = new_bbox;

    for (const layer of layers) {
      const l = this.m_layers.get(layer);

      if (!l) continue;

      l.items.RemoveItem(aItem, old_bbox);
      l.items.InsertItem(aItem, new_bbox);
      this.MarkTargetDirty(l.target);
    }
  }

  /// Update set of layers that an item occupies.
  protected updateLayers(aItem: VIEW_ITEM): void {
    const viewData = aItem.viewPrivData();

    if (!viewData) return;

    // Remove the item from previous layer set
    const old_bbox = aItem.m_viewPrivData!.m_bbox;

    for (const layer of aItem.m_viewPrivData!.m_layers) {
      const l = this.m_layers.get(layer);

      if (!l) continue;

      l.items.RemoveItem(aItem, old_bbox);
      this.MarkTargetDirty(l.target);

      if (this.IsCached(l.id)) {
        // Redraw the item from scratch
        const prevGroup = viewData.getGroup(layer);

        if (prevGroup >= 0) {
          this.m_gal!.DeleteGroup(prevGroup);
          viewData.setGroup(l.id, -1);
        }
      }
    }

    const new_bbox = aItem.ViewBBox();
    aItem.m_viewPrivData!.m_bbox = new_bbox;

    // Add the item to new layer set
    const layers = aItem.ViewGetLayers();
    viewData.saveLayers(layers);

    for (const layer of layers) {
      const l = this.m_layers.get(layer);

      if (!l) continue;

      l.items.InsertItem(aItem, new_bbox);
      this.MarkTargetDirty(l.target);
    }
  }

  /// Determine rendering order of layers. Used in display order sorting function.
  protected static compareRenderingOrder(aI: VIEW_LAYER, aJ: VIEW_LAYER): boolean {
    return aI.renderingOrder > aJ.renderingOrder;
  }

  /// Check if every layer required by the aLayerId layer is enabled.
  protected areRequiredLayersEnabled(aLayerId: number): boolean {
    const it = this.m_layers.get(aLayerId);

    if (!it) return false;

    for (const layer of it.requiredLayers) {
      // That is enough if just one layer is not enabled

      const it2 = this.m_layers.get(layer);

      if (!it2 || !it2.visible) return false;

      if (!this.areRequiredLayersEnabled(layer)) return false;
    }

    return true;
  }
}

/** `VIEW::DRAW_ITEM_VISITOR`. */
class DRAW_ITEM_VISITOR {
  view: VIEW;
  layer: number;
  useDrawPriority: boolean;
  reverseDrawOrder: boolean;
  drawItems: VIEW_ITEM[] = [];
  drawForcedTransparent: boolean;
  foundForcedTransparent: boolean;

  constructor(aView: VIEW, aLayer: number, aUseDrawPriority: boolean, aReverseDrawOrder: boolean) {
    this.view = aView;
    this.layer = aLayer;
    this.useDrawPriority = aUseDrawPriority;
    this.reverseDrawOrder = aReverseDrawOrder;
    this.drawForcedTransparent = false;
    this.foundForcedTransparent = false;
  }

  /** `operator()`. */
  visit = (aItem: VIEW_ITEM): boolean => {
    // wxCHECK( aItem->viewPrivData(), false )
    if (!aItem.viewPrivData()) return false;

    if (aItem.GetForcedTransparency() > 0 && !this.drawForcedTransparent) {
      this.foundForcedTransparent = true;
      return true;
    }

    const itemLOD = aItem.ViewGetLOD(this.layer, this.view);

    // Conditions that have to be fulfilled for an item to be drawn
    const drawCondition = aItem.viewPrivData()!.isRenderable() && itemLOD < this.view.GetScale();

    if (!drawCondition) return true;

    if (this.useDrawPriority) this.drawItems.push(aItem);
    else this.view.draw(aItem, this.layer);

    return true;
  };

  deferredDraw(): void {
    if (this.reverseDrawOrder) {
      stdSort(
        this.drawItems,
        (a, b) => b.viewPrivData()!.m_drawPriority < a.viewPrivData()!.m_drawPriority,
      );
    } else {
      stdSort(
        this.drawItems,
        (a, b) => a.viewPrivData()!.m_drawPriority < b.viewPrivData()!.m_drawPriority,
      );
    }

    for (const item of this.drawItems) this.view.draw(item, this.layer);
  }
}
