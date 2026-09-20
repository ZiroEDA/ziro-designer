// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/connectivity/connectivity_items.h` + `.cpp`: the connectivity
 * system's view of a BOARD_CONNECTED_ITEM — its anchors, its layer span, the
 * items it physically touches — and the cluster the search groups them into.
 *
 * The C++ orders CN_ITEMs by pointer in three places (`Connect`'s sorted
 * list, the visitor's "search only one side" tie-break, the cluster search's
 * `std::set`). A pointer order is arbitrary but fixed for a run; `m_id`, a
 * creation counter, is that order here. The locks and atomics are dropped:
 * the search is sequential.
 */
import { PCB_LAYER_ID, ToLAYER_ID } from '@ziroeda/common/src/layer_ids.js';
import { KICAD_T } from '@ziroeda/core/src/typeinfo.js';
import type { SHAPE } from '@ziroeda/kimath/src/geometry/shape.js';
import { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import { TRIANGULATED_POLYGON } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import { EuclideanNormI, sub, VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { RTree } from '@ziroeda/kimath/src/thirdparty/rtree.js';
import type { BOARD_CONNECTED_ITEM } from '../board_connected_item.js';
import { PAD } from '../pad.js';
import { PAD_ATTRIB } from '../padstack.js';
import type { PCB_SHAPE } from '../pcb_shape.js';
import type { PCB_ARC, PCB_TRACK, PCB_VIA } from '../pcb_track.js';
import type { ZONE } from '../zone.js';
import { CN_RTREE, INT_MAX } from './connectivity_rtree.js';

let g_nextItemId = 0;

/**
 * CN_ANCHOR represents a physical location that can be connected: a pad or a track/arc/via
 * endpoint.
 */
export class CN_ANCHOR {
  private m_pos: VECTOR2I; ///< Position of the anchor.
  private m_item: CN_ITEM | null; ///< Pad or track/arc/via owning the anchor.
  private m_tag = -1; ///< Tag for quick connection resolution.
  private m_noline = false; ///< Whether it the node can be a target for ratsnest lines.
  private m_cluster: CN_CLUSTER | null = null; ///< Cluster to which the anchor belongs.

  // Tag used for unconnected items.
  static readonly TAG_UNCONNECTED = -1;

  constructor(aPos: VECTOR2I, aItem: CN_ITEM | null) {
    this.m_pos = VECTOR2I(aPos.x, aPos.y);
    this.m_item = aItem;
  }

  Valid(): boolean {
    if (!this.m_item) return false;

    return this.m_item.Valid();
  }

  Dirty(): boolean {
    return !this.Valid() || this.m_item!.Dirty();
  }

  Item(): CN_ITEM | null {
    return this.m_item;
  }

  SetItem(aItem: CN_ITEM | null): void {
    this.m_item = aItem;
  }

  Parent(): BOARD_CONNECTED_ITEM {
    console.assert(this.m_item!.Valid());
    return this.m_item!.Parent();
  }

  Pos(): VECTOR2I {
    return this.m_pos;
  }

  Move(aPos: VECTOR2I): void {
    this.m_pos = VECTOR2I(this.m_pos.x + aPos.x, this.m_pos.y + aPos.y);
  }

  Dist(aSecond: CN_ANCHOR): number {
    return EuclideanNormI(sub(this.m_pos, aSecond.Pos()));
  }

  ///< @return tag, a common identifier for connected nodes.
  GetTag(): number {
    return this.m_tag;
  }

  SetTag(aTag: number): void {
    this.m_tag = aTag;
  }

  ///< @return true if this node can be a target for ratsnest lines.
  GetNoLine(): boolean {
    return this.m_noline;
  }

  SetNoLine(aEnable: boolean): void {
    this.m_noline = aEnable;
  }

  GetCluster(): CN_CLUSTER | null {
    return this.m_cluster;
  }

  SetCluster(aCluster: CN_CLUSTER | null): void {
    this.m_cluster = aCluster;
  }

  /**
   * The anchor point is dangling if the parent is a track and this anchor point is not
   * connected to another item ( track, vias pad or zone) or if the parent is a via and
   * this anchor point is connected to only one track and not to another item.
   *
   * @return true if this anchor is dangling.
   */
  IsDangling(): boolean {
    let accuracy = 0;

    if (!this.m_cluster) return true;

    // the minimal number of items connected to item_ref
    // at this anchor point to decide the anchor is *not* dangling
    const minimal_count = 1;
    let connected_count = this.m_item!.ConnectedItems().length;

    // a via can be removed if connected to only one other item.
    if (this.Parent().Type() === KICAD_T.PCB_VIA_T) return connected_count < 2;

    if (this.m_item!.AnchorCount() === 1) return connected_count < minimal_count;

    if (this.Parent().Type() === KICAD_T.PCB_TRACE_T || this.Parent().Type() === KICAD_T.PCB_ARC_T)
      accuracy = KiROUND((this.Parent() as PCB_TRACK).GetWidth() / 2.0);
    else if (this.Parent().Type() === KICAD_T.PCB_SHAPE_T)
      accuracy = KiROUND((this.Parent() as PCB_SHAPE).GetWidth() / 2.0);

    // Items with multiple anchors have usually items connected to each anchor.
    // We want only the item count of this anchor point
    connected_count = 0;

    for (const item of this.m_item!.ConnectedItems()) {
      if (item.Parent().Type() === KICAD_T.PCB_ZONE_T) {
        const zone = item.Parent() as ZONE;

        if (zone.HitTestFilledArea(item.GetBoardLayer(), this.Pos(), accuracy)) connected_count++;
      } else if (item.Parent().HitTest(this.Pos(), accuracy)) {
        connected_count++;
      }
    }

    return connected_count < minimal_count;
  }

  /**
   * @return the count of tracks and vias connected to this anchor.
   */
  ConnectedItemsCount(): number {
    if (!this.m_cluster) return 0;

    let connected_count = 0;

    for (const item of this.m_item!.ConnectedItems()) {
      if (item.Parent().Type() === KICAD_T.PCB_ZONE_T) {
        const zone = item.Parent() as ZONE;

        if (zone.HitTestFilledArea(item.GetBoardLayer(), this.Pos())) connected_count++;
      } else if (item.Parent().HitTest(this.Pos())) {
        connected_count++;
      }
    }

    return connected_count;
  }
}

/**
 * CN_ITEM represents a BOARD_CONNETED_ITEM in the connectivity system (ie: a pad, track/arc/via,
 * or zone).
 */
export class CN_ITEM {
  /** The pointer order the C++ sorts by, fixed at creation. */
  readonly m_id: number = g_nextItemId++;

  protected m_dirty: boolean; ///< used to identify recently added item not yet
  ///< scanned into the connectivity search
  protected m_start_layer: number; ///< start layer of the item N.B. B_Cu is set to INT_MAX
  protected m_end_layer: number; ///< end layer of the item N.B. B_Cu is set to INT_MAX
  protected m_bbox: BOX2I = new BOX2I(); ///< bounding box for the item

  private m_parent: BOARD_CONNECTED_ITEM;
  private m_connected: CN_ITEM[] = []; ///< list of physically touching items
  private m_anchors: CN_ANCHOR[] = [];
  private m_canChangeNet: boolean; ///< can the net propagator modify the netcode?
  private m_valid: boolean; ///< used to identify garbage items (we use lazy removal)

  constructor(aParent: BOARD_CONNECTED_ITEM, aCanChangeNet: boolean, _aAnchorCount = 2) {
    this.m_parent = aParent;
    this.m_canChangeNet = aCanChangeNet;
    this.m_valid = true;
    this.m_dirty = true;
    this.m_start_layer = 0;
    this.m_end_layer = INT_MAX;
  }

  /** `~CN_ITEM`: the anchors outlive the item (the ratsnest holds them). */
  destroy(): void {
    for (const anchor of this.m_anchors) anchor.SetItem(null);
  }

  AddAnchor(aPos: VECTOR2I): CN_ANCHOR {
    const anchor = new CN_ANCHOR(aPos, this);
    this.m_anchors.push(anchor);
    return anchor;
  }

  Anchors(): CN_ANCHOR[] {
    return this.m_anchors;
  }

  SetValid(aValid: boolean): void {
    this.m_valid = aValid;
  }

  Valid(): boolean {
    return this.m_valid;
  }

  SetDirty(aDirty: boolean): void {
    this.m_dirty = aDirty;
  }

  Dirty(): boolean {
    return this.m_dirty;
  }

  /**
   * Set the layers spanned by the item to aStartLayer and aEndLayer.
   */
  SetLayers(aStartLayer: number, aEndLayer: number): void {
    // B_Cu is nominally layer 2 but we reset it to INT_MAX to ensure that it is
    // always greater than any other layer in the RTree
    let start = aStartLayer;
    let end = aEndLayer;

    if (start === PCB_LAYER_ID.B_Cu) start = INT_MAX;

    if (end === PCB_LAYER_ID.B_Cu) end = INT_MAX;

    this.m_start_layer = start;
    this.m_end_layer = end;
  }

  /**
   * Set the layers spanned by the item to a single layer aLayer.
   */
  SetLayer(aLayer: number): void {
    this.SetLayers(aLayer, aLayer);
  }

  /**
   * Return the contiguous set of layers spanned by the item.
   */
  StartLayer(): number {
    return this.m_start_layer;
  }

  EndLayer(): number {
    return this.m_end_layer;
  }

  /**
   * Return the item's layer, for single-layered items only.
   * N.B. This should only be used inside connectivity as B_Cu
   * is mapped to a large int
   */
  Layer(): number {
    return this.StartLayer();
  }

  /**
   * When using CN_ITEM layers to compare against board items,
   * use this function which correctly remaps the B_Cu layer
   */
  GetBoardLayer(): PCB_LAYER_ID {
    let layer = this.Layer();

    if (layer === INT_MAX) layer = PCB_LAYER_ID.B_Cu;

    return ToLAYER_ID(layer);
  }

  BBox(): BOX2I {
    if (this.m_dirty && this.m_valid) {
      this.m_bbox = this.m_parent.GetBoundingBox();
      this.m_dirty = false;
    }

    return this.m_bbox;
  }

  Parent(): BOARD_CONNECTED_ITEM {
    return this.m_parent;
  }

  ConnectedItems(): readonly CN_ITEM[] {
    return this.m_connected;
  }

  ClearConnections(): void {
    this.m_connected.length = 0;
  }

  CanChangeNet(): boolean {
    return this.m_canChangeNet;
  }

  Connect(b: CN_ITEM): void {
    // std::lower_bound over the pointer-sorted list
    const c = this.m_connected;
    let lo = 0;
    let hi = c.length;

    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (c[mid]!.m_id < b.m_id) lo = mid + 1;
      else hi = mid;
    }

    if (lo < c.length && c[lo] === b) return;

    c.splice(lo, 0, b);
  }

  RemoveInvalidRefs(): void {
    this.m_connected = this.m_connected.filter((it) => it.Valid());
  }

  AnchorCount(): number {
    if (!this.m_valid) return 0;

    switch (this.m_parent.Type()) {
      case KICAD_T.PCB_TRACE_T:
      case KICAD_T.PCB_ARC_T:
        return 2; // start and end

      case KICAD_T.PCB_SHAPE_T:
        return this.m_anchors.length;

      default:
        return 1;
    }
  }

  GetAnchor(n: number): VECTOR2I {
    if (!this.m_valid) return VECTOR2I();

    switch (this.m_parent.Type()) {
      case KICAD_T.PCB_PAD_T:
        return (this.m_parent as PAD).GetPosition();

      case KICAD_T.PCB_TRACE_T:
      case KICAD_T.PCB_ARC_T:
        if (n === 0) return (this.m_parent as PCB_TRACK).GetStart();
        return (this.m_parent as PCB_TRACK).GetEnd();

      case KICAD_T.PCB_VIA_T:
        return (this.m_parent as PCB_VIA).GetStart();

      case KICAD_T.PCB_SHAPE_T:
        return n < this.m_anchors.length ? this.m_anchors[n]!.Pos() : VECTOR2I();

      default:
        throw new Error(`UNIMPLEMENTED_FOR( ${this.m_parent.GetClass()} )`);
    }
  }

  Net(): number {
    return !this.m_parent || !this.m_valid ? -1 : this.m_parent.GetNetCode();
  }

  Dump(): void {
    // wxLogTrace( "CN", ... )
  }
}

/*
 * Represents a single outline of a zone fill on a particular layer.  \a aSubpolyIndex indicates
 * which outline in the fill's SHAPE_POLY_SET.
 */
export class CN_ZONE_LAYER extends CN_ITEM {
  private m_zone: ZONE;
  private m_subpolyIndex: number;
  private m_layer: PCB_LAYER_ID;
  private m_outline: SHAPE_LINE_CHAIN = new SHAPE_LINE_CHAIN(); ///< Cached copy of the zone outline

  ///< Owned deep copies of triangulated polygons (includes vertex storage that TRI references)
  private m_triangulatedPolys: TRIANGULATED_POLYGON[] = [];
  private m_rTree = new RTree<SHAPE>(2);

  constructor(aParent: ZONE, aLayer: PCB_LAYER_ID, aSubpolyIndex: number) {
    super(aParent, false);
    this.m_zone = aParent;
    this.m_subpolyIndex = aSubpolyIndex;
    this.m_layer = aLayer;

    const fillPoly = aParent.GetFilledPolysList(aLayer);

    if (fillPoly && aSubpolyIndex < fillPoly.OutlineCount())
      this.m_outline = new SHAPE_LINE_CHAIN(fillPoly.Outline(aSubpolyIndex));

    this.SetLayers(aLayer, aLayer);
  }

  BuildRTree(): void {
    if (this.m_zone.IsTeardropArea()) return;

    this.m_triangulatedPolys.length = 0;
    this.m_rTree.RemoveAll();

    const fillPoly = this.m_zone.GetFilledPolysList(this.m_layer);

    if (!fillPoly) return;

    for (let ii = 0; ii < fillPoly.TriangulatedPolyCount(); ++ii) {
      const triangleSet = fillPoly.TriangulatedPolygon(ii);

      if (triangleSet.GetSourceOutlineIndex() !== this.m_subpolyIndex) continue;

      // Deep copy the triangulated polygon. The copy constructor copies the vertex storage
      // and updates all TRI parent pointers to reference our owned copy. This ensures the
      // triangles remain valid even if the zone is refilled on another thread.
      this.m_triangulatedPolys.push(new TRIANGULATED_POLYGON(triangleSet));
    }

    for (const triPoly of this.m_triangulatedPolys) {
      for (const tri of triPoly.Triangles()) {
        const bbox = tri.BBox();
        const mmin = [bbox.GetX(), bbox.GetY()];
        const mmax = [bbox.GetRight(), bbox.GetBottom()];

        this.m_rTree.Insert(mmin, mmax, tri);
      }
    }
  }

  SubpolyIndex(): number {
    return this.m_subpolyIndex;
  }

  GetLayer(): PCB_LAYER_ID {
    return this.m_layer;
  }

  ContainsPoint(p: VECTOR2I): boolean {
    if (this.m_outline.PointCount() === 0) return false;

    if (this.m_zone.IsTeardropArea()) return this.m_outline.Collide(p);

    const min = [p.x, p.y];
    const max = [p.x, p.y];
    let collision = false;

    const visitor = (aShape: SHAPE): boolean => {
      if (aShape.Collide(p)) {
        collision = true;
        return false;
      }

      return true;
    };

    this.m_rTree.Search(min, max, visitor);

    return collision;
  }

  override AnchorCount(): number {
    if (!this.Valid() || !this.HasValidOutline()) return 0;

    return this.GetOutline().PointCount() ? 1 : 0;
  }

  override GetAnchor(_n: number): VECTOR2I {
    if (!this.Valid() || !this.HasValidOutline()) return VECTOR2I();

    return this.GetOutline().CPoint(0);
  }

  HasValidOutline(): boolean {
    return this.m_outline.PointCount() > 0;
  }

  GetOutline(): SHAPE_LINE_CHAIN {
    return this.m_outline;
  }

  OutlinePointCount(): number {
    return this.m_outline.PointCount();
  }

  OutlinePoint(aIndex: number): VECTOR2I {
    return this.m_outline.CPoint(aIndex);
  }

  Collide(aRefShape: SHAPE): boolean {
    if (this.m_outline.PointCount() === 0) return false;

    if (this.m_zone.IsTeardropArea()) return aRefShape.Collide(this.m_outline, 0);

    const bbox = aRefShape.BBox();
    const min = [bbox.GetX(), bbox.GetY()];
    const max = [bbox.GetRight(), bbox.GetBottom()];
    let collision = false;

    const visitor = (aShape: SHAPE): boolean => {
      if (aRefShape.Collide(aShape)) {
        collision = true;
        return false;
      }

      return true;
    };

    this.m_rTree.Search(min, max, visitor);

    return collision;
  }

  HasSingleConnection(): boolean {
    let count = 0;

    for (const item of this.ConnectedItems()) {
      if (item.Valid()) count++;

      if (count > 1) break;
    }

    return count === 1;
  }
}

export class CN_LIST {
  protected m_items: CN_ITEM[] = [];

  private m_dirty = false;
  private m_hasInvalid = false;
  private m_index = new CN_RTREE<CN_ITEM>();

  Clear(): void {
    for (const item of this.m_items) item.destroy();

    this.m_items.length = 0;
    this.m_index.RemoveAll();
  }

  [Symbol.iterator](): IterableIterator<CN_ITEM> {
    return this.m_items[Symbol.iterator]();
  }

  at(aIndex: number): CN_ITEM {
    return this.m_items[aIndex]!;
  }

  FindNearby(aItem: CN_ITEM, aFunc: (aCandidate: CN_ITEM) => boolean): void {
    this.m_index.Query(aItem.BBox(), aItem.StartLayer(), aItem.EndLayer(), aFunc);
  }

  SetHasInvalid(aInvalid = true): void {
    this.m_hasInvalid = aInvalid;
  }

  SetDirty(aDirty = true): void {
    this.m_dirty = aDirty;
  }

  IsDirty(): boolean {
    return this.m_dirty;
  }

  RemoveInvalidItems(aGarbage: CN_ITEM[]): void {
    if (!this.m_hasInvalid) return;

    this.m_items = this.m_items.filter((item) => {
      if (!item.Valid()) {
        aGarbage.push(item);
        return false;
      }

      return true;
    });

    for (const item of aGarbage) this.m_index.Remove(item);

    this.m_hasInvalid = false;
  }

  ClearDirtyFlags(): void {
    for (const item of this.m_items) item.SetDirty(false);

    this.SetDirty(false);
  }

  Size(): number {
    return this.m_items.length;
  }

  AddPad(pad: PAD): CN_ITEM | null {
    if (!pad.IsOnCopperLayer()) return null;

    const item = new CN_ITEM(pad, false, 1);

    // std::set<VECTOR2I>: VECTOR2::operator< orders by squared norm, so two
    // positions at the same distance from the origin are one entry.
    const uniqueAnchors = new Map<number, VECTOR2I>();

    pad.Padstack().ForEachUniqueLayer((aLayer: PCB_LAYER_ID) => {
      const p = pad.ShapePos(aLayer);
      const key = p.x * p.x + p.y * p.y;
      if (!uniqueAnchors.has(key)) uniqueAnchors.set(key, p);
    });

    for (const anchor of [...uniqueAnchors.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]))
      item.AddAnchor(anchor);

    item.SetLayers(PCB_LAYER_ID.F_Cu, PCB_LAYER_ID.B_Cu);

    switch (pad.GetAttribute()) {
      case PAD_ATTRIB.SMD:
      case PAD_ATTRIB.NPTH:
      case PAD_ATTRIB.CONN: {
        const lmsk = pad.GetLayerSet().CuStack();

        if (lmsk.length > 0) item.SetLayer(lmsk[0]!);

        break;
      }

      default:
        break;
    }

    this.addItemtoTree(item);
    this.m_items.push(item);
    // Re-mark dirty after tree insertion since BBox() clears the dirty flag
    item.SetDirty(true);
    this.SetDirty();
    return item;
  }

  AddTrack(track: PCB_TRACK): CN_ITEM {
    const item = new CN_ITEM(track, true);
    this.m_items.push(item);
    item.AddAnchor(track.GetStart());
    item.AddAnchor(track.GetEnd());
    item.SetLayer(track.GetLayer());
    this.addItemtoTree(item);
    // Re-mark dirty after tree insertion since BBox() clears the dirty flag
    item.SetDirty(true);
    this.SetDirty();
    return item;
  }

  AddArc(aArc: PCB_ARC): CN_ITEM {
    const item = new CN_ITEM(aArc, true);
    this.m_items.push(item);
    item.AddAnchor(aArc.GetStart());
    item.AddAnchor(aArc.GetEnd());
    item.SetLayer(aArc.GetLayer());
    this.addItemtoTree(item);
    // Re-mark dirty after tree insertion since BBox() clears the dirty flag
    item.SetDirty(true);
    this.SetDirty();
    return item;
  }

  AddVia(via: PCB_VIA): CN_ITEM {
    const item = new CN_ITEM(via, !via.GetIsFree(), 1);
    this.m_items.push(item);
    item.AddAnchor(via.GetStart());
    item.SetLayers(via.TopLayer(), via.BottomLayer());
    this.addItemtoTree(item);
    // Re-mark dirty after tree insertion since BBox() clears the dirty flag
    item.SetDirty(true);
    this.SetDirty();
    return item;
  }

  AddZone(zone: ZONE, aLayer: PCB_LAYER_ID): CN_ITEM[] {
    const polys = zone.GetFilledPolysList(aLayer);
    const rv: CN_ITEM[] = [];

    for (let j = 0; j < polys.OutlineCount(); j++) {
      const zitem = new CN_ZONE_LAYER(zone, aLayer, j);

      zitem.BuildRTree();

      for (const pt of zone.GetFilledPolysList(aLayer).COutline(j).CPoints()) zitem.AddAnchor(pt);

      rv.push(this.AddZoneLayer(zitem));
    }

    return rv;
  }

  AddZoneLayer(zitem: CN_ZONE_LAYER): CN_ITEM {
    this.m_items.push(zitem);
    this.addItemtoTree(zitem);
    // Re-mark dirty after tree insertion since BBox() clears the dirty flag
    zitem.SetDirty(true);
    this.SetDirty();
    return zitem;
  }

  AddShape(shape: PCB_SHAPE): CN_ITEM {
    const item = new CN_ITEM(shape, true);
    this.m_items.push(item);

    for (const point of shape.GetConnectionPoints()) item.AddAnchor(point);

    item.SetLayer(shape.GetLayer());
    this.addItemtoTree(item);
    // Re-mark dirty after tree insertion since BBox() clears the dirty flag
    item.SetDirty(true);
    this.SetDirty();
    return item;
  }

  protected addItemtoTree(item: CN_ITEM): void {
    this.m_index.Insert(item);
  }
}

export class CN_CLUSTER {
  private m_conflicting = false;
  private m_originNet = -1;
  private m_originPad: CN_ITEM | null = null;
  private m_items: CN_ITEM[] = [];
  private m_netRanks = new Map<number, number>();

  HasValidNet(): boolean {
    return this.m_originNet > 0;
  }

  OriginNet(): number {
    return this.m_originNet;
  }

  OriginNetName(): string {
    if (!this.m_originPad || !this.m_originPad.Valid()) return '<none>';
    return this.m_originPad.Parent().GetNetname();
  }

  Contains(aItem: CN_ITEM | BOARD_CONNECTED_ITEM): boolean {
    if (aItem instanceof CN_ITEM) return this.m_items.includes(aItem);

    return this.m_items.some((item) => item.Valid() && item.Parent() === aItem);
  }

  Dump(): void {}

  Size(): number {
    return this.m_items.length;
  }

  IsOrphaned(): boolean {
    return this.m_originPad === null;
  }

  IsConflicting(): boolean {
    return this.m_conflicting;
  }

  Add(item: CN_ITEM): void {
    this.m_items.push(item);

    const netCode = item.Net();

    if (netCode <= 0) return;

    if (this.m_originNet <= 0) {
      this.m_originNet = netCode;
      this.m_netRanks.set(this.m_originNet, 0);
    }

    if (item.Parent().Type() === KICAD_T.PCB_PAD_T && !(item.Parent() as PAD).IsFreePad()) {
      let rank: number;
      const it = this.m_netRanks.get(netCode);

      if (it === undefined) {
        this.m_netRanks.set(netCode, 1);
        rank = 1;
      } else {
        rank = it + 1;
        this.m_netRanks.set(netCode, rank);
      }

      if (!this.m_originPad || rank > (this.m_netRanks.get(this.m_originNet) ?? 0)) {
        this.m_originPad = item;
        this.m_originNet = netCode;
      }

      if (this.m_originPad && item.Net() !== this.m_originNet) this.m_conflicting = true;
    }
  }

  [Symbol.iterator](): IterableIterator<CN_ITEM> {
    return this.m_items[Symbol.iterator]();
  }

  Items(): readonly CN_ITEM[] {
    return this.m_items;
  }
}
