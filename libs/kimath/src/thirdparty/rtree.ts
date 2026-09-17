// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
//
//TITLE
//
//    R-TREES: A DYNAMIC INDEX STRUCTURE FOR SPATIAL SEARCHING
//
//DESCRIPTION
//
//    A C++ templated version of the RTree algorithm.
//    For more information please read the comments in RTree.h
//
//AUTHORS
//
//    * 1983 Original algorithm and test code by Antonin Guttman and Michael Stonebraker, UC Berkely
//    * 1994 ANCI C ported from original test code by Melinda Green - melinda@superliminal.com
//    * 1995 Sphere volume fix for degeneracy problem submitted by Paul Brook
//    * 2004 Templated C++ port by Greg Douglas
//    * 2013 CERN (www.cern.ch)
//    * 2020 KiCad Developers - Add std::iterator support for searching
//    * 2020 KiCad Developers - Add container nearest neighbor based on Hjaltason & Samet
//    * 2022 KiCad Developers - Slight optimizations in RectSphericalVolume
//
/**
 * `thirdparty/rtree/geometry/rtree.h`: the R-tree every KiCad spatial index
 * is built on (VIEW_RTREE, CN_RTREE, DRC_RTREE, the PNS index). The
 * algorithm — quadratic split, PickBranch tie-breaks, insertion and search
 * order — is the C++'s, so a query visits the same candidates in the same
 * order. `ASSERT` compiles out of KiCad's release build and is out here too.
 * `ELEMTYPE` is a number here; the integer instantiations round where
 * the C++ does (`MinDist`). The file I/O helper (RTFileStream, Load, Save)
 * and the std::iterator wrapper are not ported: nothing in KiCad saves a tree
 * to disk, and the iterator is `Search` with a full-extent rectangle.
 *
 * Storage is the C++'s too: a `Node` holds `Branch m_branch[MAXNODES]` with
 * each branch's `Rect` inline, so a search reads a node's rectangles from one
 * contiguous block. Here that block is one `Float64Array` per node
 * (`m_rect`, branch `i`'s rectangle at `i * 2 * NUMDIMS`, its `m_min` first
 * and its `m_max` after) beside the children and the data. A standalone
 * rectangle (the one being inserted or searched for, a partition cover) is
 * a `Float64Array` of `2 * NUMDIMS` in the same order. An earlier port kept
 * every rectangle as an object of two arrays: five heap objects per branch,
 * and a search that spent its time in cache misses rather than comparisons.
 */

/**
 * Minimal bounding rectangle (n-dimensional): `2 * NUMDIMS` numbers, the
 * minimums then the maximums. Either a standalone array or a node's block,
 * always addressed with an offset.
 */
export type Rect = Float64Array;

export interface Statistics {
  maxDepth: number;
  avgDepth: number;
  maxNodeLoad: number;
  avgNodeLoad: number;
  totalItems: number;
  totalNodes: number;
}

/// Node for each branch level: `Branch m_branch[MAXNODES]`, each branch's
/// rectangle in `m_rect`, its child in `m_child`, its data in `m_data`.
interface Node<DATATYPE> {
  m_count: number; ///< Count
  m_level: number; ///< Leaf is zero, others positive
  m_rect: Float64Array; ///< MAXNODES rectangles, `2 * NUMDIMS` numbers each
  m_child: (Node<DATATYPE> | null)[]; ///< Child node
  m_data: (DATATYPE | undefined)[]; ///< Data Id
}

function IsInternalNode<D>(node: Node<D>): boolean {
  return node.m_level > 0;
} // Not a leaf, but a internal node
function IsLeaf<D>(node: Node<D>): boolean {
  return node.m_level === 0;
} // A leaf, contains data

/// A link list of nodes for reinsertion after a delete operation
interface ListNode<DATATYPE> {
  m_next: ListNode<DATATYPE> | null; ///< Next in list
  m_node: Node<DATATYPE>; ///< Node
}

/// Variables for finding a split partition: `Branch m_branchBuf[MAXNODES + 1]`
/// is the same three-way storage a node has.
interface PartitionVars<DATATYPE> {
  m_partition: number[];
  m_total: number;
  m_minFill: number;
  m_taken: boolean[];
  m_count: [number, number];
  m_cover: [Rect, Rect];
  m_area: [number, number];
  m_bufRect: Float64Array;
  m_bufChild: (Node<DATATYPE> | null)[];
  m_bufData: (DATATYPE | undefined)[];
  m_branchCount: number;
  m_coverSplit: Rect;
  m_coverSplitArea: number;
}

/// Data structure used for Nearest Neighbor search implementation: a branch
/// is (node, index) here, the C++'s `Branch*` into the node.
interface NNNode<DATATYPE> {
  m_node: Node<DATATYPE>;
  m_index: number;
  minDist: number;
  isLeaf: boolean;
}

// Precomputed volumes of the unit spheres for the first few dimensions
const UNIT_SPHERE_VOLUMES: readonly number[] = [
  0.0,
  2.0,
  3.141593, // Dimension  0,1,2
  4.18879,
  4.934802,
  5.263789, // Dimension  3,4,5
  5.167713,
  4.724766,
  4.058712, // Dimension  6,7,8
  3.298509,
  2.550164,
  1.884104, // Dimension  9,10,11
  1.335263,
  0.910629,
  0.599265, // Dimension  12,13,14
  0.381443,
  0.235331,
  0.140981, // Dimension  15,16,17
  0.082146,
  0.046622,
  0.025807, // Dimension  18,19,20
].map(Math.fround); // a `const float[]`, widened to ELEMTYPEREAL on read

/**
 * `std::priority_queue<NNNode>` with `NNNode::operator<` reversed on purpose:
 * the top is the smallest `minDist`. A binary heap, as libstdc++'s is, so ties
 * pop in the same order.
 */
class NNQueue<D> {
  private c: NNNode<D>[] = [];

  empty(): boolean {
    return this.c.length === 0;
  }

  top(): NNNode<D> {
    return this.c[0]!;
  }

  // std::push_heap
  push(x: NNNode<D>): void {
    const c = this.c;
    c.push(x);
    let holeIndex = c.length - 1;
    const value = x;
    let parent = (holeIndex - 1) >> 1;
    // comp(parent, value): parent < value  ⇔  value.minDist < parent.minDist
    while (holeIndex > 0 && value.minDist < c[parent]!.minDist) {
      c[holeIndex] = c[parent]!;
      holeIndex = parent;
      parent = (holeIndex - 1) >> 1;
    }
    c[holeIndex] = value;
  }

  // std::pop_heap + pop_back
  pop(): void {
    const c = this.c;
    const last = c.pop()!;
    if (c.length === 0) return;
    const len = c.length;
    // __adjust_heap(first, 0, len, value)
    let holeIndex = 0;
    const topIndex = 0;
    const value = last;
    let secondChild = holeIndex;
    while (secondChild < (len - 1) >> 1) {
      secondChild = 2 * (secondChild + 1);
      // comp(first + secondChild, first + (secondChild - 1)): a < b ⇔ b.minDist < a.minDist
      if (c[secondChild - 1]!.minDist < c[secondChild]!.minDist) secondChild--;
      c[holeIndex] = c[secondChild]!;
      holeIndex = secondChild;
    }
    if ((len & 1) === 0 && secondChild === (len - 2) >> 1) {
      secondChild = 2 * (secondChild + 1);
      c[holeIndex] = c[secondChild - 1]!;
      holeIndex = secondChild - 1;
    }
    // __push_heap(first, holeIndex, topIndex, value)
    let parent = (holeIndex - 1) >> 1;
    while (holeIndex > topIndex && value.minDist < c[parent]!.minDist) {
      c[holeIndex] = c[parent]!;
      holeIndex = parent;
      parent = (holeIndex - 1) >> 1;
    }
    c[holeIndex] = value;
  }
}

/// \class RTree
/// Implementation of RTree, a multidimensional bounding rectangle tree.
/// Example usage: For a 3-dimensional tree use RTree<Object*, float, 3> myTree;
///
/// This modified, templated C++ version by Greg Douglas at Auran (http://www.auran.com)
///
/// DATATYPE Referenced data, should be int, void*, obj* etc. no larger than sizeof<void*> and simple type
/// ELEMTYPE Type of element such as int or float
/// NUMDIMS Number of dimensions such as 2 or 3
/// ELEMTYPEREAL Type of element that allows fractional and large values such as float or double, for use in volume calcs
///
/// NOTES: Inserting and removing data requires the knowledge of its constant Minimal Bounding Rectangle.
///        This version uses new/delete for nodes, I recommend using a fixed size allocator for efficiency.
///        Instead of using a callback function for returned results, I recommend and efficient pre-sized, grow-only memory
///        array similar to MFC CArray or STL Vector for returning search query result.
///
export class RTree<DATATYPE> {
  readonly NUMDIMS: number;
  readonly MAXNODES: number; ///< Max elements in node
  readonly MINNODES: number; ///< Min elements in node
  /** `2 * NUMDIMS`: the numbers one rectangle takes. */
  protected readonly RECT: number;

  protected m_root: Node<DATATYPE>; ///< Root of tree
  protected m_unitSphereVolume: number; ///< Unit sphere constant for required number of dimensions
  /** The partition variables, a member reused by every split (see SplitNode). */
  private m_parVars: PartitionVars<DATATYPE>;

  constructor(aNumDims = 2, aMaxNodes = 8, aMinNodes = aMaxNodes / 2) {
    this.NUMDIMS = aNumDims;
    this.MAXNODES = aMaxNodes;
    this.MINNODES = aMinNodes;
    this.RECT = 2 * aNumDims;

    this.m_root = this.AllocNode();
    this.m_root.m_level = 0;
    this.m_unitSphereVolume = UNIT_SPHERE_VOLUMES[this.NUMDIMS]!;
    this.m_parVars = {
      m_partition: [],
      m_total: 0,
      m_minFill: 0,
      m_taken: [],
      m_count: [0, 0],
      m_cover: [this.InitRect(), this.InitRect()],
      m_area: [0, 0],
      m_bufRect: new Float64Array((this.MAXNODES + 1) * this.RECT),
      m_bufChild: new Array(this.MAXNODES + 1).fill(null),
      m_bufData: new Array(this.MAXNODES + 1).fill(undefined),
      m_branchCount: 0,
      m_coverSplit: this.InitRect(),
      m_coverSplitArea: 0,
    };
  }

  /** A standalone rectangle from the caller's min and max arrays. */
  protected makeRect(a_min: readonly number[], a_max: readonly number[]): Rect {
    const rect = new Float64Array(this.RECT);

    for (let axis = 0; axis < this.NUMDIMS; ++axis) {
      rect[axis] = a_min[axis]!;
      rect[this.NUMDIMS + axis] = a_max[axis]!;
    }

    return rect;
  }

  /// Insert entry
  /// \param a_min Min of bounding rect
  /// \param a_max Max of bounding rect
  /// \param a_dataId Positive Id of data.  Maybe zero, but negative numbers not allowed.
  Insert(a_min: readonly number[], a_max: readonly number[], a_dataId: DATATYPE): void {
    const rect = this.makeRect(a_min, a_max);

    this.InsertRect(rect, null, a_dataId, 0);
  }

  /// Remove entry
  /// \param a_min Min of bounding rect
  /// \param a_max Max of bounding rect
  /// \param a_dataId Positive Id of data.  Maybe zero, but negative numbers not allowed.
  /// \return  1 if record not found, 0 if success.
  Remove(a_min: readonly number[], a_max: readonly number[], a_dataId: DATATYPE): boolean {
    const rect = this.makeRect(a_min, a_max);

    return this.RemoveRect(rect, a_dataId);
  }

  /// Find all within search rectangle
  /// \param a_min Min of search bounding rect
  /// \param a_max Max of search bounding rect
  /// \param a_callback Callback function to return result.  Callback should return 'true' to continue searching
  /// \param aFinished This is set to true if the search completed and false if it was interupted
  /// \return Returns the number of entries found
  Search(
    a_min: readonly number[],
    a_max: readonly number[],
    a_callback: ((id: DATATYPE) => boolean) | null,
    aFinished?: { value: boolean },
  ): number {
    const rect = this.makeRect(a_min, a_max);

    // NOTE: May want to return search result another way, perhaps returning the number of found elements here.
    const foundCount = { value: 0 };
    const finished = this.searchRec(this.m_root, rect, foundCount, a_callback);
    if (aFinished) aFinished.value = finished;
    return foundCount.value;
  }

  /// Calculate Statistics
  CalcStats(): Statistics {
    // Not in the C++ either: declared, never defined.
    throw new Error('RTree::CalcStats is declared but not defined in rtree.h');
  }

  /// Remove all entries from tree
  RemoveAll(): void {
    // Delete all existing nodes
    this.Reset();

    this.m_root = this.AllocNode();
    this.m_root.m_level = 0;
  }

  /// Count the data elements in this container.  This is slow as no internal counter is maintained.
  Count(): number {
    const count = { value: 0 };
    this.CountRec(this.m_root, count);
    return count.value;
  }

  /**
   * Gets an ordered vector of the nearest data elements to a specified point
   * @param aPoint coordinate to measure against
   * @param aTerminate Callback routine to check when we have gathered sufficient elements
   * @param aFilter Callback routine to remove specific elements from the query results
   * @param aSquaredDist Callback routine to measure the distance from the point to the data element
   * @return vector of matching elements and their distance to the point
   */
  NearestNeighbors(
    a_point: readonly number[],
    aTerminate: (aNumResults: number, aMinDist: number) => boolean,
    aFilter: (aElement: DATATYPE) => boolean,
    aSquaredDist: (a_point: readonly number[], a_data: DATATYPE) => number,
  ): [number, DATATYPE][] {
    const result: [number, DATATYPE][] = [];
    const search_q = new NNQueue<DATATYPE>();

    for (let i = 0; i < this.m_root.m_count; ++i) {
      if (IsLeaf(this.m_root)) {
        search_q.push({
          m_node: this.m_root,
          m_index: i,
          minDist: aSquaredDist(a_point, this.m_root.m_data[i] as DATATYPE),
          isLeaf: IsLeaf(this.m_root),
        });
      } else {
        search_q.push({
          m_node: this.m_root,
          m_index: i,
          minDist: this.MinDist(a_point, this.m_root.m_rect, i * this.RECT),
          isLeaf: IsLeaf(this.m_root),
        });
      }
    }

    while (!search_q.empty()) {
      const curNode = search_q.top();

      if (aTerminate(result.length, curNode.minDist)) break;

      search_q.pop();

      if (curNode.isLeaf) {
        const data = curNode.m_node.m_data[curNode.m_index] as DATATYPE;
        if (aFilter(data)) result.push([curNode.minDist, data]);
      } else {
        const node = curNode.m_node.m_child[curNode.m_index]!;

        for (let i = 0; i < node.m_count; ++i) {
          const newNode: NNNode<DATATYPE> = {
            isLeaf: IsLeaf(node),
            m_node: node,
            m_index: i,
            minDist: 0,
          };

          if (newNode.isLeaf) newNode.minDist = aSquaredDist(a_point, node.m_data[i] as DATATYPE);
          else newNode.minDist = this.MinDist(a_point, node.m_rect, i * this.RECT);

          search_q.push(newNode);
        }
      }
    }

    return result;
  }

  /**
   * `begin( aRect )` .. `end()`: the Iterator over the leaves overlapping a
   * rectangle. Its depth-first walk in branch order is the order `Search`
   * visits them, so this is that search collected first (the iterator is
   * not remove safe there either).
   */
  *Iterate(a_min: readonly number[], a_max: readonly number[]): IterableIterator<DATATYPE> {
    const rect = this.makeRect(a_min, a_max);
    const out: DATATYPE[] = [];
    this.searchRec(this.m_root, rect, { value: 0 }, (d) => {
      out.push(d);
      return true;
    });
    yield* out;
  }

  /**
   * `begin()` / `end()`: the iterator over every leaf, a search of the full
   * extent (INT_MIN..INT_MAX in the C++; the number line here).
   */
  [Symbol.iterator](): IterableIterator<DATATYPE> {
    const min: number[] = [];
    const max: number[] = [];
    for (let i = 0; i < this.NUMDIMS; ++i) {
      min[i] = Number.NEGATIVE_INFINITY;
      max[i] = Number.POSITIVE_INFINITY;
    }
    return this.Iterate(min, max);
  }

  protected CountRec(a_node: Node<DATATYPE>, a_count: { value: number }): void {
    if (IsInternalNode(a_node)) {
      // not a leaf node
      for (let index = 0; index < a_node.m_count; ++index) {
        this.CountRec(a_node.m_child[index]!, a_count);
      }
    } // A leaf node
    else {
      a_count.value += a_node.m_count;
    }
  }

  protected Reset(): void {
    // Delete all existing nodes
    this.RemoveAllRec(this.m_root);
  }

  protected RemoveAllRec(a_node: Node<DATATYPE>): void {
    if (IsInternalNode(a_node)) {
      // This is an internal node in the tree
      for (let index = 0; index < a_node.m_count; ++index) {
        this.RemoveAllRec(a_node.m_child[index]!);
      }
    }

    this.FreeNode(a_node);
  }

  protected AllocNode(): Node<DATATYPE> {
    const newNode: Node<DATATYPE> = {
      m_count: 0,
      m_level: -1,
      m_rect: new Float64Array(this.MAXNODES * this.RECT),
      m_child: new Array(this.MAXNODES).fill(null),
      m_data: new Array(this.MAXNODES).fill(undefined),
    };
    this.InitNode(newNode);
    return newNode;
  }

  protected FreeNode(a_node: Node<DATATYPE>): void {
    a_node.m_child.fill(null);
    a_node.m_data.fill(undefined);
    a_node.m_count = 0;
  }

  protected InitNode(a_node: Node<DATATYPE>): void {
    a_node.m_count = 0;
    a_node.m_level = -1;
  }

  protected InitRect(): Rect {
    return new Float64Array(this.RECT);
  }

  /** Copy the rectangle at `a_srcOff` of `a_src` to `a_dstOff` of `a_dst`. */
  protected copyRect(
    a_src: Float64Array,
    a_srcOff: number,
    a_dst: Float64Array,
    a_dstOff: number,
  ): void {
    for (let i = 0; i < this.RECT; ++i) a_dst[a_dstOff + i] = a_src[a_srcOff + i]!;
  }

  // Inserts a new data rectangle into the index structure.
  // Recursively descends tree, propagates splits back up.
  // Returns 0 if node was not split.  Old node updated.
  // If node was split, returns 1 and sets the pointer pointed to by
  // new_node to point to the new node.  Old node updated to become one of two.
  // The level argument specifies the number of steps up from the leaf
  // level to insert; e.g. a data rectangle goes in at level = 0.
  protected InsertRectRec(
    a_rect: Rect,
    a_child: Node<DATATYPE> | null,
    a_id: DATATYPE | undefined,
    a_node: Node<DATATYPE>,
    a_newNode: { value: Node<DATATYPE> | null },
    a_level: number,
  ): boolean {
    // Still above level for insertion, go down tree recursively
    if (a_node.m_level > a_level) {
      const index = this.PickBranch(a_rect, a_node);
      const otherNode: { value: Node<DATATYPE> | null } = { value: null };

      if (
        !this.InsertRectRec(a_rect, a_child, a_id, a_node.m_child[index]!, otherNode, a_level)
      ) {
        // Child was not split
        this.CombineRect(
          a_rect,
          0,
          a_node.m_rect,
          index * this.RECT,
          a_node.m_rect,
          index * this.RECT,
        );
        return false;
      }
      // Child was split
      this.NodeCover(a_node.m_child[index]!, a_node.m_rect, index * this.RECT);
      const cover = this.InitRect();
      this.NodeCover(otherNode.value!, cover, 0);
      return this.AddBranch(cover, 0, otherNode.value, undefined, a_node, a_newNode);
    }
    if (a_node.m_level === a_level) {
      // Have reached level for insertion. Add rect, split if necessary
      // Child field of leaves contains id of data record; the union is one
      // field in the C++, so a reinserted subtree (level > 0) arrives here as
      // its node.
      return this.AddBranch(a_rect, 0, a_child, a_id, a_node, a_newNode);
    }
    // Should never occur
    return false;
  }

  // Insert a data rectangle into an index structure.
  // InsertRect provides for splitting the root;
  // returns 1 if root was split, 0 if it was not.
  // The level argument specifies the number of steps up from the leaf
  // level to insert; e.g. a data rectangle goes in at level = 0.
  // InsertRect2 does the recursion.
  //
  protected InsertRect(
    a_rect: Rect,
    a_child: Node<DATATYPE> | null,
    a_id: DATATYPE | undefined,
    a_level: number,
  ): boolean {
    const newNode: { value: Node<DATATYPE> | null } = { value: null };

    if (this.InsertRectRec(a_rect, a_child, a_id, this.m_root, newNode, a_level)) {
      // Root split
      const newRoot = this.AllocNode(); // Grow tree taller and new root
      newRoot.m_level = this.m_root.m_level + 1;
      const cover = this.InitRect();
      this.NodeCover(this.m_root, cover, 0);
      this.AddBranch(cover, 0, this.m_root, undefined, newRoot, null);
      this.NodeCover(newNode.value!, cover, 0);
      this.AddBranch(cover, 0, newNode.value, undefined, newRoot, null);
      this.m_root = newRoot;
      return true;
    }

    return false;
  }

  // Find the smallest rectangle that includes all rectangles in branches of a node.
  protected NodeCover(a_node: Node<DATATYPE>, a_out: Float64Array, a_outOff: number): void {
    let firstTime = true;

    for (let index = 0; index < a_node.m_count; ++index) {
      if (firstTime) {
        this.copyRect(a_node.m_rect, index * this.RECT, a_out, a_outOff);
        firstTime = false;
      } else {
        this.CombineRect(a_out, a_outOff, a_node.m_rect, index * this.RECT, a_out, a_outOff);
      }
    }

    if (firstTime) a_out.fill(0, a_outOff, a_outOff + this.RECT); // InitRect()
  }

  // Add a branch to a node.  Split the node if necessary.
  // Returns 0 if node not split.  Old node updated.
  // Returns 1 if node split, sets *new_node to address of new node.
  // Old node updated, becomes one of two.
  protected AddBranch(
    a_rect: Float64Array,
    a_rectOff: number,
    a_child: Node<DATATYPE> | null,
    a_data: DATATYPE | undefined,
    a_node: Node<DATATYPE>,
    a_newNode: { value: Node<DATATYPE> | null } | null,
  ): boolean {
    if (a_node.m_count < this.MAXNODES) {
      // Split won't be necessary
      this.copyRect(a_rect, a_rectOff, a_node.m_rect, a_node.m_count * this.RECT);
      a_node.m_child[a_node.m_count] = a_child;
      a_node.m_data[a_node.m_count] = a_data;
      ++a_node.m_count;
      return false;
    }
    this.SplitNode(a_node, a_rect, a_rectOff, a_child, a_data, a_newNode!);
    return true;
  }

  // Disconnect a dependent node.
  // Caller must return (or stop using iteration index) after this as count has changed
  protected DisconnectBranch(a_node: Node<DATATYPE>, a_index: number): void {
    // Remove element by swapping with the last element to prevent gaps in array
    const last = a_node.m_count - 1;
    this.copyRect(a_node.m_rect, last * this.RECT, a_node.m_rect, a_index * this.RECT);
    a_node.m_child[a_index] = a_node.m_child[last]!;
    a_node.m_data[a_index] = a_node.m_data[last];
    --a_node.m_count;
  }

  // Pick a branch.  Pick the one that will need the smallest increase
  // in area to accomodate the new rectangle.  This will result in the
  // least total area for the covering rectangles in the current node.
  // In case of a tie, pick the one which was smaller before, to get
  // the best resolution when searching.
  protected PickBranch(a_rect: Rect, a_node: Node<DATATYPE>): number {
    let firstTime = true;
    let increase: number;
    let bestIncr = -1;
    let area: number;
    let bestArea = 0;
    let best = 0;

    for (let index = 0; index < a_node.m_count; ++index) {
      const off = index * this.RECT;
      area = this.CalcRectVolume(a_node.m_rect, off);
      increase = this.CombinedRectVolume(a_rect, 0, a_node.m_rect, off) - area;

      if (increase < bestIncr || firstTime) {
        best = index;
        bestArea = area;
        bestIncr = increase;
        firstTime = false;
      } else if (increase === bestIncr && area < bestArea) {
        best = index;
        bestArea = area;
        bestIncr = increase;
      }
    }

    return best;
  }

  // Combine two rectangles into larger one containing both. The result goes
  // to `a_out` at `a_outOff`, which may be either input: the C++ assigns the
  // returned value over one of them, and each element is read before it is
  // written.
  protected CombineRect(
    a_rectA: Float64Array,
    a_offA: number,
    a_rectB: Float64Array,
    a_offB: number,
    a_out: Float64Array,
    a_outOff: number,
  ): void {
    const N = this.NUMDIMS;
    for (let index = 0; index < N; ++index) {
      a_out[a_outOff + index] = Math.min(a_rectA[a_offA + index]!, a_rectB[a_offB + index]!);
      a_out[a_outOff + N + index] = Math.max(
        a_rectA[a_offA + N + index]!,
        a_rectB[a_offB + N + index]!,
      );
    }
  }

  // Split a node.
  // Divides the nodes branches and the extra one between two nodes.
  // Old node is one of the new ones, and one really new one is created.
  // Tries more than one method for choosing a partition, uses best result.
  protected SplitNode(
    a_node: Node<DATATYPE>,
    a_rect: Float64Array,
    a_rectOff: number,
    a_child: Node<DATATYPE> | null,
    a_data: DATATYPE | undefined,
    a_newNode: { value: Node<DATATYPE> | null },
  ): void {
    // Could just use local here, but member or external is faster since it is reused
    const parVars = this.m_parVars;

    // Load all the branches into a buffer, initialize old node
    const level = a_node.m_level;
    this.GetBranches(a_node, a_rect, a_rectOff, a_child, a_data, parVars);

    // Find partition
    this.ChoosePartition(parVars, this.MINNODES);

    // Put branches from buffer into 2 nodes according to chosen partition
    a_newNode.value = this.AllocNode();
    a_newNode.value.m_level = a_node.m_level = level;
    this.LoadNodes(a_node, a_newNode.value, parVars);
  }

  // Calculate the n-dimensional volume of a rectangle
  protected RectVolume(a_rect: Float64Array, a_off: number): number {
    let volume = 1;

    for (let index = 0; index < this.NUMDIMS; ++index) {
      volume *= a_rect[a_off + this.NUMDIMS + index]! - a_rect[a_off + index]!;
    }
    return volume;
  }

  // The exact volume of the bounding sphere for the given Rect
  protected RectSphericalVolume(a_rect: Float64Array, a_off: number): number {
    let sumOfSquares = 0;

    for (let index = 0; index < this.NUMDIMS; ++index) {
      const halfExtent = (a_rect[a_off + this.NUMDIMS + index]! - a_rect[a_off + index]!) * 0.5;
      sumOfSquares += halfExtent * halfExtent;
    }

    return this.sphericalVolume(sumOfSquares);
  }

  // CalcRectVolume( CombineRect( a_rectA, a_rectB ) ) without building the
  // rectangle: the same arithmetic over the combined extents. The C++ builds
  // the temporary on the stack for free; here every one was a heap object,
  // and PickBranch makes MAXNODES of them per level of every insert.
  protected CombinedRectVolume(
    a_rectA: Float64Array,
    a_offA: number,
    a_rectB: Float64Array,
    a_offB: number,
  ): number {
    const N = this.NUMDIMS;
    let sumOfSquares = 0;

    for (let index = 0; index < N; ++index) {
      const halfExtent =
        (Math.max(a_rectA[a_offA + N + index]!, a_rectB[a_offB + N + index]!) -
          Math.min(a_rectA[a_offA + index]!, a_rectB[a_offB + index]!)) *
        0.5;
      sumOfSquares += halfExtent * halfExtent;
    }

    return this.sphericalVolume(sumOfSquares);
  }

  // The tail of RectSphericalVolume: the sphere's volume from the sum of the
  // squared half extents.
  private sphericalVolume(sumOfSquares: number): number {
    // Pow maybe slow, so test for common dims like 2,3 and just use x*x, x*x*x.
    if (this.NUMDIMS === 2) {
      return sumOfSquares * this.m_unitSphereVolume;
    }
    if (this.NUMDIMS === 3) {
      const radius = Math.sqrt(sumOfSquares);
      return radius * radius * radius * this.m_unitSphereVolume;
    }
    const radius = Math.sqrt(sumOfSquares);
    return radius ** this.NUMDIMS * this.m_unitSphereVolume;
  }

  // Use one of the methods to calculate retangle volume
  protected CalcRectVolume(a_rect: Float64Array, a_off: number): number {
    // RTREE_USE_SPHERICAL_VOLUME
    return this.RectSphericalVolume(a_rect, a_off); // Slower but helps certain merge cases
  }

  // Load branch buffer with branches from full node plus the extra branch.
  protected GetBranches(
    a_node: Node<DATATYPE>,
    a_rect: Float64Array,
    a_rectOff: number,
    a_child: Node<DATATYPE> | null,
    a_data: DATATYPE | undefined,
    a_parVars: PartitionVars<DATATYPE>,
  ): void {
    // Load the branch buffer
    a_parVars.m_bufRect.set(a_node.m_rect, 0);
    for (let index = 0; index < this.MAXNODES; ++index) {
      a_parVars.m_bufChild[index] = a_node.m_child[index]!;
      a_parVars.m_bufData[index] = a_node.m_data[index];
    }

    this.copyRect(a_rect, a_rectOff, a_parVars.m_bufRect, this.MAXNODES * this.RECT);
    a_parVars.m_bufChild[this.MAXNODES] = a_child;
    a_parVars.m_bufData[this.MAXNODES] = a_data;
    a_parVars.m_branchCount = this.MAXNODES + 1;

    // Calculate rect containing all in the set
    this.copyRect(a_parVars.m_bufRect, 0, a_parVars.m_coverSplit, 0);

    for (let index = 1; index < this.MAXNODES + 1; ++index) {
      this.CombineRect(
        a_parVars.m_coverSplit,
        0,
        a_parVars.m_bufRect,
        index * this.RECT,
        a_parVars.m_coverSplit,
        0,
      );
    }

    a_parVars.m_coverSplitArea = this.CalcRectVolume(a_parVars.m_coverSplit, 0);

    this.InitNode(a_node);
    a_node.m_child.fill(null);
    a_node.m_data.fill(undefined);
  }

  // Method #0 for choosing a partition:
  // As the seeds for the two groups, pick the two rects that would waste the
  // most area if covered by a single rectangle, i.e. evidently the worst pair
  // to have in the same group.
  // Of the remaining, one at a time is chosen to be put in one of the two groups.
  // The one chosen is the one with the greatest difference in area expansion
  // depending on which group - the rect most strongly attracted to one group
  // and repelled from the other.
  // If one group gets too full (more would force other group to violate min
  // fill requirement) then other group gets the rest.
  // These last are the ones that can go in either group most easily.
  protected ChoosePartition(a_parVars: PartitionVars<DATATYPE>, a_minFill: number): void {
    let biggestDiff: number;
    let group: number;
    let chosen = 0;
    let betterGroup = 0;

    this.InitParVars(a_parVars, a_parVars.m_branchCount, a_minFill);
    this.PickSeeds(a_parVars);

    while (
      a_parVars.m_count[0] + a_parVars.m_count[1] < a_parVars.m_total &&
      a_parVars.m_count[0] < a_parVars.m_total - a_parVars.m_minFill &&
      a_parVars.m_count[1] < a_parVars.m_total - a_parVars.m_minFill
    ) {
      biggestDiff = -1;

      for (let index = 0; index < a_parVars.m_total; ++index) {
        if (!a_parVars.m_taken[index]) {
          const off = index * this.RECT;
          const growth0 =
            this.CombinedRectVolume(a_parVars.m_bufRect, off, a_parVars.m_cover[0], 0) -
            a_parVars.m_area[0];
          const growth1 =
            this.CombinedRectVolume(a_parVars.m_bufRect, off, a_parVars.m_cover[1], 0) -
            a_parVars.m_area[1];
          let diff = growth1 - growth0;

          if (diff >= 0) {
            group = 0;
          } else {
            group = 1;
            diff = -diff;
          }

          if (diff > biggestDiff) {
            biggestDiff = diff;
            chosen = index;
            betterGroup = group;
          } else if (
            diff === biggestDiff &&
            a_parVars.m_count[group]! < a_parVars.m_count[betterGroup]!
          ) {
            chosen = index;
            betterGroup = group;
          }
        }
      }

      this.Classify(chosen, betterGroup, a_parVars);
    }

    // If one group too full, put remaining rects in the other
    if (a_parVars.m_count[0] + a_parVars.m_count[1] < a_parVars.m_total) {
      if (a_parVars.m_count[0] >= a_parVars.m_total - a_parVars.m_minFill) {
        group = 1;
      } else {
        group = 0;
      }

      for (let index = 0; index < a_parVars.m_total; ++index) {
        if (!a_parVars.m_taken[index]) {
          this.Classify(index, group, a_parVars);
        }
      }
    }
  }

  // Copy branches from the buffer into two nodes according to the partition.
  protected LoadNodes(
    a_nodeA: Node<DATATYPE>,
    a_nodeB: Node<DATATYPE>,
    a_parVars: PartitionVars<DATATYPE>,
  ): void {
    for (let index = 0; index < a_parVars.m_total; ++index) {
      const off = index * this.RECT;
      if (a_parVars.m_partition[index] === 0) {
        this.AddBranch(
          a_parVars.m_bufRect,
          off,
          a_parVars.m_bufChild[index]!,
          a_parVars.m_bufData[index],
          a_nodeA,
          null,
        );
      } else if (a_parVars.m_partition[index] === 1) {
        this.AddBranch(
          a_parVars.m_bufRect,
          off,
          a_parVars.m_bufChild[index]!,
          a_parVars.m_bufData[index],
          a_nodeB,
          null,
        );
      }
    }
  }

  // Initialize a PartitionVars structure.
  protected InitParVars(
    a_parVars: PartitionVars<DATATYPE>,
    a_maxRects: number,
    a_minFill: number,
  ): void {
    a_parVars.m_count[0] = a_parVars.m_count[1] = 0;
    a_parVars.m_area[0] = a_parVars.m_area[1] = 0;
    a_parVars.m_total = a_maxRects;
    a_parVars.m_minFill = a_minFill;

    for (let index = 0; index < a_maxRects; ++index) {
      a_parVars.m_taken[index] = false;
      a_parVars.m_partition[index] = -1;
    }
  }

  protected PickSeeds(a_parVars: PartitionVars<DATATYPE>): void {
    let seed0 = 0;
    let seed1 = 0;
    let worst: number;
    let waste: number;
    const area: number[] = [];

    for (let index = 0; index < a_parVars.m_total; ++index) {
      area[index] = this.CalcRectVolume(a_parVars.m_bufRect, index * this.RECT);
    }

    worst = -a_parVars.m_coverSplitArea - 1;

    for (let indexA = 0; indexA < a_parVars.m_total - 1; ++indexA) {
      for (let indexB = indexA + 1; indexB < a_parVars.m_total; ++indexB) {
        waste =
          this.CombinedRectVolume(
            a_parVars.m_bufRect,
            indexA * this.RECT,
            a_parVars.m_bufRect,
            indexB * this.RECT,
          ) -
          area[indexA]! -
          area[indexB]!;

        if (waste >= worst) {
          worst = waste;
          seed0 = indexA;
          seed1 = indexB;
        }
      }
    }

    this.Classify(seed0, 0, a_parVars);
    this.Classify(seed1, 1, a_parVars);
  }

  // Put a branch in one of the groups.
  protected Classify(a_index: number, a_group: number, a_parVars: PartitionVars<DATATYPE>): void {
    a_parVars.m_partition[a_index] = a_group;
    a_parVars.m_taken[a_index] = true;

    const cover = a_parVars.m_cover[a_group]!;
    if (a_parVars.m_count[a_group] === 0) {
      this.copyRect(a_parVars.m_bufRect, a_index * this.RECT, cover, 0);
    } else {
      this.CombineRect(a_parVars.m_bufRect, a_index * this.RECT, cover, 0, cover, 0);
    }

    a_parVars.m_area[a_group] = this.CalcRectVolume(cover, 0);
    a_parVars.m_count[a_group] = a_parVars.m_count[a_group]! + 1;
  }

  // Delete a data rectangle from an index structure.
  // Pass in a pointer to a Rect, the tid of the record, ptr to ptr to root node.
  // Returns 1 if record not found, 0 if success.
  // RemoveRect provides for eliminating the root.
  protected RemoveRect(a_rect: Rect, a_id: DATATYPE): boolean {
    const reInsertList: { value: ListNode<DATATYPE> | null } = { value: null };

    if (!this.RemoveRectRec(a_rect, a_id, this.m_root, reInsertList)) {
      // Found and deleted a data item

      // Reinsert any branches from eliminated nodes
      while (reInsertList.value) {
        const tempNode = reInsertList.value.m_node;

        for (let index = 0; index < tempNode.m_count; ++index) {
          // The C++ reinserts `m_data` of the union, which for an internal
          // node is the child pointer: the branch goes back in whole.
          const rect = this.InitRect();
          this.copyRect(tempNode.m_rect, index * this.RECT, rect, 0);
          this.InsertRect(
            rect,
            IsLeaf(tempNode) ? null : tempNode.m_child[index]!,
            IsLeaf(tempNode) ? tempNode.m_data[index] : undefined,
            tempNode.m_level,
          );
        }

        const remLNode = reInsertList.value;
        reInsertList.value = reInsertList.value.m_next;

        this.FreeNode(remLNode.m_node);
      }

      // Check for redundant root (not leaf, 1 child) and eliminate
      if (this.m_root.m_count === 1 && IsInternalNode(this.m_root)) {
        const tempNode = this.m_root.m_child[0]!;
        this.FreeNode(this.m_root);
        this.m_root = tempNode;
      }

      return false;
    }
    return true;
  }

  // Delete a rectangle from non-root part of an index structure.
  // Called by RemoveRect.  Descends tree recursively,
  // merges branches on the way back up.
  // Returns 1 if record not found, 0 if success.
  protected RemoveRectRec(
    a_rect: Rect,
    a_id: DATATYPE,
    a_node: Node<DATATYPE>,
    a_listNode: { value: ListNode<DATATYPE> | null },
  ): boolean {
    if (IsInternalNode(a_node)) {
      // not a leaf node
      for (let index = 0; index < a_node.m_count; ++index) {
        const off = index * this.RECT;
        if (this.Overlap(a_rect, 0, a_node.m_rect, off)) {
          if (!this.RemoveRectRec(a_rect, a_id, a_node.m_child[index]!, a_listNode)) {
            if (a_node.m_child[index]!.m_count >= this.MINNODES) {
              // child removed, just resize parent rect
              this.NodeCover(a_node.m_child[index]!, a_node.m_rect, off);
            } else {
              // child removed, not enough entries in node, eliminate node
              this.ReInsert(a_node.m_child[index]!, a_listNode);
              this.DisconnectBranch(a_node, index); // Must return after this call as count has changed
            }

            return false;
          }
        }
      }

      return true;
    }
    // A leaf node
    for (let index = 0; index < a_node.m_count; ++index) {
      if (a_node.m_data[index] === a_id) {
        this.DisconnectBranch(a_node, index); // Must return after this call as count has changed
        return false;
      }
    }

    return true;
  }

  // Decide whether two rectangles overlap.
  protected Overlap(
    a_rectA: Float64Array,
    a_offA: number,
    a_rectB: Float64Array,
    a_offB: number,
  ): boolean {
    const N = this.NUMDIMS;
    for (let index = 0; index < N; ++index) {
      if (
        a_rectA[a_offA + index]! > a_rectB[a_offB + N + index]! ||
        a_rectB[a_offB + index]! > a_rectA[a_offA + N + index]!
      ) {
        return false;
      }
    }

    return true;
  }

  // Add a node to the reinsertion list.  All its branches will later
  // be reinserted into the index structure.
  protected ReInsert(
    a_node: Node<DATATYPE>,
    a_listNode: { value: ListNode<DATATYPE> | null },
  ): void {
    const newListNode: ListNode<DATATYPE> = { m_node: a_node, m_next: a_listNode.value };
    a_listNode.value = newListNode;
  }

  // Search in an index tree or subtree for all data rectangles that overlap the argument rectangle.
  protected searchRec(
    a_node: Node<DATATYPE>,
    a_rect: Rect,
    a_foundCount: { value: number },
    a_callback: ((id: DATATYPE) => boolean) | null,
  ): boolean {
    if (this.NUMDIMS === 2) return this.searchRec2(a_node, a_rect, a_foundCount, a_callback);
    if (this.NUMDIMS === 3) return this.searchRec3(a_node, a_rect, a_foundCount, a_callback);
    const rects = a_node.m_rect;
    if (IsInternalNode(a_node)) {
      // This is an internal node in the tree
      for (let index = 0; index < a_node.m_count; ++index) {
        if (this.Overlap(a_rect, 0, rects, index * this.RECT)) {
          if (!this.searchRec(a_node.m_child[index]!, a_rect, a_foundCount, a_callback)) {
            return false; // Don't continue searching
          }
        }
      }
    } // This is a leaf node
    else {
      for (let index = 0; index < a_node.m_count; ++index) {
        if (this.Overlap(a_rect, 0, rects, index * this.RECT)) {
          const id = a_node.m_data[index] as DATATYPE;
          ++a_foundCount.value;

          if (a_callback && !a_callback(id)) {
            return false; // Don't continue searching
          }
        }
      }
    }

    return true; // Continue searching
  }

  // searchRec with NUMDIMS == 2: the same walk with Overlap unrolled over the
  // two axes, which the C++ template does at compile time for every NUMDIMS.
  private searchRec2(
    a_node: Node<DATATYPE>,
    a_rect: Rect,
    a_foundCount: { value: number },
    a_callback: ((id: DATATYPE) => boolean) | null,
  ): boolean {
    const rects = a_node.m_rect;
    const x0 = a_rect[0]!;
    const y0 = a_rect[1]!;
    const x1 = a_rect[2]!;
    const y1 = a_rect[3]!;
    if (IsInternalNode(a_node)) {
      // This is an internal node in the tree
      for (let index = 0; index < a_node.m_count; ++index) {
        const off = index * 4;
        if (
          !(x0 > rects[off + 2]! || rects[off]! > x1 || y0 > rects[off + 3]! || rects[off + 1]! > y1)
        ) {
          if (!this.searchRec2(a_node.m_child[index]!, a_rect, a_foundCount, a_callback)) {
            return false; // Don't continue searching
          }
        }
      }
    } // This is a leaf node
    else {
      for (let index = 0; index < a_node.m_count; ++index) {
        const off = index * 4;
        if (
          !(x0 > rects[off + 2]! || rects[off]! > x1 || y0 > rects[off + 3]! || rects[off + 1]! > y1)
        ) {
          const id = a_node.m_data[index] as DATATYPE;
          ++a_foundCount.value;

          if (a_callback && !a_callback(id)) {
            return false; // Don't continue searching
          }
        }
      }
    }

    return true; // Continue searching
  }

  // searchRec with NUMDIMS == 3 (CN_RTREE, the layer span its third axis).
  private searchRec3(
    a_node: Node<DATATYPE>,
    a_rect: Rect,
    a_foundCount: { value: number },
    a_callback: ((id: DATATYPE) => boolean) | null,
  ): boolean {
    const rects = a_node.m_rect;
    const x0 = a_rect[0]!;
    const y0 = a_rect[1]!;
    const z0 = a_rect[2]!;
    const x1 = a_rect[3]!;
    const y1 = a_rect[4]!;
    const z1 = a_rect[5]!;
    if (IsInternalNode(a_node)) {
      for (let index = 0; index < a_node.m_count; ++index) {
        const off = index * 6;
        if (
          !(
            x0 > rects[off + 3]! ||
            rects[off]! > x1 ||
            y0 > rects[off + 4]! ||
            rects[off + 1]! > y1 ||
            z0 > rects[off + 5]! ||
            rects[off + 2]! > z1
          )
        ) {
          if (!this.searchRec3(a_node.m_child[index]!, a_rect, a_foundCount, a_callback)) {
            return false; // Don't continue searching
          }
        }
      }
    } else {
      for (let index = 0; index < a_node.m_count; ++index) {
        const off = index * 6;
        if (
          !(
            x0 > rects[off + 3]! ||
            rects[off]! > x1 ||
            y0 > rects[off + 4]! ||
            rects[off + 1]! > y1 ||
            z0 > rects[off + 5]! ||
            rects[off + 2]! > z1
          )
        ) {
          const id = a_node.m_data[index] as DATATYPE;
          ++a_foundCount.value;

          if (a_callback && !a_callback(id)) {
            return false; // Don't continue searching
          }
        }
      }
    }

    return true; // Continue searching
  }

  //calculate the minimum distance between a point and a rectangle as defined by Manolopoulos et al.
  // returns Euclidean norm to ensure value fits in ELEMTYPE
  protected MinDist(a_point: readonly number[], a_rect: Float64Array, a_off: number): number {
    const q = a_point;
    const N = this.NUMDIMS;

    let minDist = 0.0;

    for (let index = 0; index < N; index++) {
      let r = Math.trunc(q[index]!); // `int r`
      const s = a_rect[a_off + index]!;
      const t = a_rect[a_off + N + index]!;

      if (q[index]! < s) {
        r = s;
      } else if (q[index]! > t) {
        r = t;
      }

      const addend = q[index]! - r;
      minDist += addend * addend;
    }

    return Math.round(Math.sqrt(minDist)); // std::lround
  }
}

/**
 * An int64 of the integer R-tree: a double while it is an exact integer,
 * a BigInt from 2^53 on. Every intermediate the tree forms is checked
 * against `INT64_EXACT_LIMIT` before it is kept as a double.
 */
type INT64 = number | bigint;

/** 2^53: every integer below it is one double; from it on, not. */
const INT64_EXACT_LIMIT = 9007199254740992;

/**
 * floor( sqrt( 2^53 ) ): a half-extent no larger than this squares exactly
 * in a double. Belt and braces: a half-extent is `trunc( float * 0.5f )`, so
 * it never has more than 24 significant bits and its square never more than
 * 48, exact at any magnitude. What does round is the sum of two squares of
 * different magnitude, and the product by 3 -- `addSquare` and
 * `sphericalVolumeInt` check those.
 */
const HALF_EXTENT_EXACT_LIMIT = 94906265;

/**
 * `sumOfSquares += halfExtent * halfExtent` in int64: exact in a double while
 * the square and the running sum stay below 2^53, a BigInt past that. Strict
 * comparisons, because a true sum of 2^53 + 1 rounds down to 2^53.
 */
function addSquare(sum: INT64, halfExtent: number): INT64 {
  if (
    typeof sum === 'number' &&
    halfExtent <= HALF_EXTENT_EXACT_LIMIT &&
    halfExtent >= -HALF_EXTENT_EXACT_LIMIT
  ) {
    const s = sum + halfExtent * halfExtent;
    if (s < INT64_EXACT_LIMIT) return s;
  }
  return BigInt(sum) + BigInt(halfExtent) * BigInt(halfExtent);
}

/**
 * `a - b` in int64. Two doubles here are non-negative volumes or their
 * differences, all below 2^53 in magnitude, so their difference is exact.
 */
function int64Sub(a: INT64, b: INT64): INT64 {
  return typeof a === 'number' && typeof b === 'number' ? a - b : BigInt(a) - BigInt(b);
}

/** `a == b` in int64 (`===` between a number and a BigInt is always false). */
function int64Eq(a: INT64, b: INT64): boolean {
  return typeof a === typeof b ? a === b : BigInt(a) === BigInt(b);
}

/**
 * `RTree<DATATYPE, intptr_t, NUMDIMS, intptr_t>`: the instantiation whose
 * ELEMTYPEREAL is a 64-bit integer (`SHAPE_POLY_SET::splitCollinearOutlines`).
 * Every volume, growth and waste is then integer arithmetic — `halfExtent`
 * is `int64 * 0.5f` truncated back to int64, the unit sphere constant is
 * `(intptr_t) 3.141593f == 3` — and the split heuristics tie differently
 * from the double tree. Every value is a non-negative integer, so it is held
 * in a double while it is below 2^53 -- where a double IS an int64 -- and
 * promoted to a BigInt only past that, so a board-sized node compares as the
 * C++ does without every leaf paying for an allocation. Mixed `<` and `>=`
 * compare a number and a BigInt mathematically in JS; subtraction and
 * equality go through `int64Sub` / `int64Eq`.
 */
export class RTreeIntReal<DATATYPE> extends RTree<DATATYPE> {
  private readonly m_unitSphereVolumeInt: bigint;
  private readonly m_unitSphereVolumeIntNum: number;
  private m_areaInt: [INT64, INT64] = [0, 0];
  private m_coverSplitAreaInt: INT64 = 0;

  constructor(aNumDims = 2, aMaxNodes = 8, aMinNodes = aMaxNodes / 2) {
    super(aNumDims, aMaxNodes, aMinNodes);
    // m_unitSphereVolume = (ELEMTYPEREAL) UNIT_SPHERE_VOLUMES[NUMDIMS]
    this.m_unitSphereVolumeIntNum = Math.trunc(UNIT_SPHERE_VOLUMES[this.NUMDIMS]!);
    this.m_unitSphereVolumeInt = BigInt(this.m_unitSphereVolumeIntNum);
  }

  protected RectVolumeInt(a_rect: Float64Array, a_off: number): bigint {
    let volume = 1n;

    for (let index = 0; index < this.NUMDIMS; ++index) {
      volume *= BigInt(a_rect[a_off + this.NUMDIMS + index]! - a_rect[a_off + index]!);
    }
    return volume;
  }

  protected RectSphericalVolumeInt(a_rect: Float64Array, a_off: number): INT64 {
    let sumOfSquares: INT64 = 0;

    for (let index = 0; index < this.NUMDIMS; ++index) {
      // ( (int64) max - (int64) min ) * 0.5f: the int64 difference converts to
      // float, the float product converts back to int64 by truncation.
      const halfExtent = Math.trunc(
        Math.fround(a_rect[a_off + this.NUMDIMS + index]! - a_rect[a_off + index]!) * 0.5,
      );
      sumOfSquares = addSquare(sumOfSquares, halfExtent);
    }

    return this.sphericalVolumeInt(sumOfSquares);
  }

  // CalcRectVolumeInt( CombineRect( a_rectA, a_rectB ) ) without the rectangle
  protected CombinedRectVolumeInt(
    a_rectA: Float64Array,
    a_offA: number,
    a_rectB: Float64Array,
    a_offB: number,
  ): INT64 {
    const N = this.NUMDIMS;
    let sumOfSquares: INT64 = 0;

    for (let index = 0; index < N; ++index) {
      const halfExtent = Math.trunc(
        Math.fround(
          Math.max(a_rectA[a_offA + N + index]!, a_rectB[a_offB + N + index]!) -
            Math.min(a_rectA[a_offA + index]!, a_rectB[a_offB + index]!),
        ) * 0.5,
      );
      sumOfSquares = addSquare(sumOfSquares, halfExtent);
    }

    return this.sphericalVolumeInt(sumOfSquares);
  }

  private sphericalVolumeInt(sumOfSquares: INT64): INT64 {
    if (this.NUMDIMS === 2) {
      if (typeof sumOfSquares === 'number') {
        const v = sumOfSquares * this.m_unitSphereVolumeIntNum;
        if (v < INT64_EXACT_LIMIT) return v;
      }
      return BigInt(sumOfSquares) * this.m_unitSphereVolumeInt;
    }
    // (ELEMTYPEREAL) std::sqrt( sumOfSquares ): the root truncated to int64
    const radius = BigInt(Math.trunc(Math.sqrt(Number(sumOfSquares))));
    if (this.NUMDIMS === 3) {
      return radius * radius * radius * this.m_unitSphereVolumeInt;
    }
    return radius ** BigInt(this.NUMDIMS) * this.m_unitSphereVolumeInt;
  }

  protected CalcRectVolumeInt(a_rect: Float64Array, a_off: number): INT64 {
    // RTREE_USE_SPHERICAL_VOLUME
    return this.RectSphericalVolumeInt(a_rect, a_off);
  }

  protected override PickBranch(a_rect: Rect, a_node: Node<DATATYPE>): number {
    let firstTime = true;
    let increase: INT64;
    let bestIncr: INT64 = -1;
    let area: INT64;
    let bestArea: INT64 = 0;
    let best = 0;

    for (let index = 0; index < a_node.m_count; ++index) {
      const off = index * this.RECT;
      area = this.CalcRectVolumeInt(a_node.m_rect, off);
      increase = int64Sub(this.CombinedRectVolumeInt(a_rect, 0, a_node.m_rect, off), area);

      if (increase < bestIncr || firstTime) {
        best = index;
        bestArea = area;
        bestIncr = increase;
        firstTime = false;
      } else if (int64Eq(increase, bestIncr) && area < bestArea) {
        best = index;
        bestArea = area;
        bestIncr = increase;
      }
    }

    return best;
  }

  protected override GetBranches(
    a_node: Node<DATATYPE>,
    a_rect: Float64Array,
    a_rectOff: number,
    a_child: Node<DATATYPE> | null,
    a_data: DATATYPE | undefined,
    a_parVars: PartitionVars<DATATYPE>,
  ): void {
    super.GetBranches(a_node, a_rect, a_rectOff, a_child, a_data, a_parVars);
    this.m_coverSplitAreaInt = this.CalcRectVolumeInt(a_parVars.m_coverSplit, 0);
  }

  protected override ChoosePartition(a_parVars: PartitionVars<DATATYPE>, a_minFill: number): void {
    let biggestDiff: INT64;
    let group: number;
    let chosen = 0;
    let betterGroup = 0;

    this.InitParVars(a_parVars, a_parVars.m_branchCount, a_minFill);
    this.PickSeeds(a_parVars);

    while (
      a_parVars.m_count[0] + a_parVars.m_count[1] < a_parVars.m_total &&
      a_parVars.m_count[0] < a_parVars.m_total - a_parVars.m_minFill &&
      a_parVars.m_count[1] < a_parVars.m_total - a_parVars.m_minFill
    ) {
      biggestDiff = -1;

      for (let index = 0; index < a_parVars.m_total; ++index) {
        if (!a_parVars.m_taken[index]) {
          const off = index * this.RECT;
          const growth0 = int64Sub(
            this.CombinedRectVolumeInt(a_parVars.m_bufRect, off, a_parVars.m_cover[0], 0),
            this.m_areaInt[0],
          );
          const growth1 = int64Sub(
            this.CombinedRectVolumeInt(a_parVars.m_bufRect, off, a_parVars.m_cover[1], 0),
            this.m_areaInt[1],
          );
          let diff = int64Sub(growth1, growth0);

          if (diff >= 0) {
            group = 0;
          } else {
            group = 1;
            diff = -diff;
          }

          if (diff > biggestDiff) {
            biggestDiff = diff;
            chosen = index;
            betterGroup = group;
          } else if (
            int64Eq(diff, biggestDiff) &&
            a_parVars.m_count[group]! < a_parVars.m_count[betterGroup]!
          ) {
            chosen = index;
            betterGroup = group;
          }
        }
      }

      this.Classify(chosen, betterGroup, a_parVars);
    }

    // If one group too full, put remaining rects in the other
    if (a_parVars.m_count[0] + a_parVars.m_count[1] < a_parVars.m_total) {
      if (a_parVars.m_count[0] >= a_parVars.m_total - a_parVars.m_minFill) {
        group = 1;
      } else {
        group = 0;
      }
      for (let index = 0; index < a_parVars.m_total; ++index) {
        if (!a_parVars.m_taken[index]) {
          this.Classify(index, group, a_parVars);
        }
      }
    }
  }

  protected override InitParVars(
    a_parVars: PartitionVars<DATATYPE>,
    a_maxRects: number,
    a_minFill: number,
  ): void {
    super.InitParVars(a_parVars, a_maxRects, a_minFill);
    this.m_areaInt = [0, 0];
  }

  protected override PickSeeds(a_parVars: PartitionVars<DATATYPE>): void {
    let seed0 = 0;
    let seed1 = 0;
    let worst: INT64;
    let waste: INT64;
    const area: INT64[] = [];

    for (let index = 0; index < a_parVars.m_total; ++index) {
      area[index] = this.CalcRectVolumeInt(a_parVars.m_bufRect, index * this.RECT);
    }

    worst = int64Sub(-this.m_coverSplitAreaInt, 1);

    for (let indexA = 0; indexA < a_parVars.m_total - 1; ++indexA) {
      for (let indexB = indexA + 1; indexB < a_parVars.m_total; ++indexB) {
        waste = int64Sub(
          int64Sub(
            this.CombinedRectVolumeInt(
              a_parVars.m_bufRect,
              indexA * this.RECT,
              a_parVars.m_bufRect,
              indexB * this.RECT,
            ),
            area[indexA]!,
          ),
          area[indexB]!,
        );

        if (waste >= worst) {
          worst = waste;
          seed0 = indexA;
          seed1 = indexB;
        }
      }
    }

    this.Classify(seed0, 0, a_parVars);
    this.Classify(seed1, 1, a_parVars);
  }

  protected override Classify(
    a_index: number,
    a_group: number,
    a_parVars: PartitionVars<DATATYPE>,
  ): void {
    a_parVars.m_partition[a_index] = a_group;
    a_parVars.m_taken[a_index] = true;

    const cover = a_parVars.m_cover[a_group]!;
    if (a_parVars.m_count[a_group] === 0) {
      this.copyRect(a_parVars.m_bufRect, a_index * this.RECT, cover, 0);
    } else {
      this.CombineRect(a_parVars.m_bufRect, a_index * this.RECT, cover, 0, cover, 0);
    }

    this.m_areaInt[a_group] = this.CalcRectVolumeInt(cover, 0);
    a_parVars.m_count[a_group] = a_parVars.m_count[a_group]! + 1;
  }
}
