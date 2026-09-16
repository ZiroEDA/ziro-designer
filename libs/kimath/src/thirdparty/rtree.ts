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
 */

/// Minimal bounding rectangle (n-dimensional)
export interface Rect {
  m_min: number[]; ///< Min dimensions of bounding box
  m_max: number[]; ///< Max dimensions of bounding box
}

export interface Statistics {
  maxDepth: number;
  avgDepth: number;
  maxNodeLoad: number;
  avgNodeLoad: number;
  totalItems: number;
}

/// May be data or may be another subtree
/// The parents level determines this.
/// If the parents level is 0, then this is data
interface Branch<DATATYPE> {
  m_rect: Rect; ///< Bounds
  m_child: Node<DATATYPE> | null; ///< Child node
  m_data: DATATYPE | undefined; ///< Data Id or Ptr
}

/// Node for each branch level
interface Node<DATATYPE> {
  m_count: number; ///< Count
  m_level: number; ///< Leaf is zero, others positive
  m_branch: Branch<DATATYPE>[]; ///< Branch
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

/// Variables for finding a split partition
interface PartitionVars<DATATYPE> {
  m_partition: number[];
  m_total: number;
  m_minFill: number;
  m_taken: boolean[];
  m_count: [number, number];
  m_cover: [Rect, Rect];
  m_area: [number, number];
  m_branchBuf: Branch<DATATYPE>[];
  m_branchCount: number;
  m_coverSplit: Rect;
  m_coverSplitArea: number;
}

/// Data structure used for Nearest Neighbor search implementation
interface NNNode<DATATYPE> {
  m_branch: Branch<DATATYPE>;
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

function copyRect(r: Rect): Rect {
  return { m_min: r.m_min.slice(), m_max: r.m_max.slice() };
}

function copyBranch<D>(b: Branch<D>): Branch<D> {
  return { m_rect: copyRect(b.m_rect), m_child: b.m_child, m_data: b.m_data };
}

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

  protected m_root: Node<DATATYPE>; ///< Root of tree
  protected m_unitSphereVolume: number; ///< Unit sphere constant for required number of dimensions

  constructor(aNumDims = 2, aMaxNodes = 8, aMinNodes = aMaxNodes / 2) {
    this.NUMDIMS = aNumDims;
    this.MAXNODES = aMaxNodes;
    this.MINNODES = aMinNodes;

    this.m_root = this.AllocNode();
    this.m_root.m_level = 0;
    this.m_unitSphereVolume = UNIT_SPHERE_VOLUMES[this.NUMDIMS]!;
  }

  /// Insert entry
  /// \param a_min Min of bounding rect
  /// \param a_max Max of bounding rect
  /// \param a_dataId Positive Id of data.  Maybe zero, but negative numbers not allowed.
  Insert(a_min: readonly number[], a_max: readonly number[], a_dataId: DATATYPE): void {
    const rect: Rect = { m_min: [], m_max: [] };

    for (let axis = 0; axis < this.NUMDIMS; ++axis) {
      rect.m_min[axis] = a_min[axis]!;
      rect.m_max[axis] = a_max[axis]!;
    }

    this.InsertRect(rect, a_dataId, 0);
  }

  /// Remove entry
  /// \param a_min Min of bounding rect
  /// \param a_max Max of bounding rect
  /// \param a_dataId Positive Id of data.  Maybe zero, but negative numbers not allowed.
  /// \return  1 if record not found, 0 if success.
  Remove(a_min: readonly number[], a_max: readonly number[], a_dataId: DATATYPE): boolean {
    const rect: Rect = { m_min: [], m_max: [] };

    for (let axis = 0; axis < this.NUMDIMS; ++axis) {
      rect.m_min[axis] = a_min[axis]!;
      rect.m_max[axis] = a_max[axis]!;
    }

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
    const rect: Rect = { m_min: [], m_max: [] };

    for (let axis = 0; axis < this.NUMDIMS; ++axis) {
      rect.m_min[axis] = a_min[axis]!;
      rect.m_max[axis] = a_max[axis]!;
    }

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
          m_branch: this.m_root.m_branch[i]!,
          minDist: aSquaredDist(a_point, this.m_root.m_branch[i]!.m_data as DATATYPE),
          isLeaf: IsLeaf(this.m_root),
        });
      } else {
        search_q.push({
          m_branch: this.m_root.m_branch[i]!,
          minDist: this.MinDist(a_point, this.m_root.m_branch[i]!.m_rect),
          isLeaf: IsLeaf(this.m_root),
        });
      }
    }

    while (!search_q.empty()) {
      const curNode = search_q.top();

      if (aTerminate(result.length, curNode.minDist)) break;

      search_q.pop();

      if (curNode.isLeaf) {
        if (aFilter(curNode.m_branch.m_data as DATATYPE))
          result.push([curNode.minDist, curNode.m_branch.m_data as DATATYPE]);
      } else {
        const node = curNode.m_branch.m_child!;

        for (let i = 0; i < node.m_count; ++i) {
          const newNode: NNNode<DATATYPE> = {
            isLeaf: IsLeaf(node),
            m_branch: node.m_branch[i]!,
            minDist: 0,
          };

          if (newNode.isLeaf)
            newNode.minDist = aSquaredDist(a_point, newNode.m_branch.m_data as DATATYPE);
          else newNode.minDist = this.MinDist(a_point, node.m_branch[i]!.m_rect);

          search_q.push(newNode);
        }
      }
    }

    return result;
  }

  /**
   * `begin()` / `end()`: the iterator over every leaf, which is a search of
   * the full extent in the same order.
   */
  *[Symbol.iterator](): IterableIterator<DATATYPE> {
    const out: DATATYPE[] = [];
    const full: Rect = { m_min: [], m_max: [] };
    for (let i = 0; i < this.NUMDIMS; ++i) {
      full.m_min[i] = Number.NEGATIVE_INFINITY;
      full.m_max[i] = Number.POSITIVE_INFINITY;
    }
    this.searchRec(this.m_root, full, { value: 0 }, (d) => {
      out.push(d);
      return true;
    });
    yield* out;
  }

  protected CountRec(a_node: Node<DATATYPE>, a_count: { value: number }): void {
    if (IsInternalNode(a_node)) {
      // not a leaf node
      for (let index = 0; index < a_node.m_count; ++index) {
        this.CountRec(a_node.m_branch[index]!.m_child!, a_count);
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
        this.RemoveAllRec(a_node.m_branch[index]!.m_child!);
      }
    }

    this.FreeNode(a_node);
  }

  protected AllocNode(): Node<DATATYPE> {
    const newNode: Node<DATATYPE> = { m_count: 0, m_level: -1, m_branch: [] };
    this.InitNode(newNode);
    return newNode;
  }

  protected FreeNode(a_node: Node<DATATYPE>): void {
    a_node.m_branch.length = 0;
  }

  protected InitNode(a_node: Node<DATATYPE>): void {
    a_node.m_count = 0;
    a_node.m_level = -1;
  }

  protected InitRect(): Rect {
    const a_rect: Rect = { m_min: [], m_max: [] };
    for (let index = 0; index < this.NUMDIMS; ++index) {
      a_rect.m_min[index] = 0;
      a_rect.m_max[index] = 0;
    }
    return a_rect;
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
    a_id: DATATYPE,
    a_node: Node<DATATYPE>,
    a_newNode: { value: Node<DATATYPE> | null },
    a_level: number,
  ): boolean {
    // Still above level for insertion, go down tree recursively
    if (a_node.m_level > a_level) {
      const index = this.PickBranch(a_rect, a_node);
      const otherNode: { value: Node<DATATYPE> | null } = { value: null };

      if (!this.InsertRectRec(a_rect, a_id, a_node.m_branch[index]!.m_child!, otherNode, a_level)) {
        // Child was not split
        a_node.m_branch[index]!.m_rect = this.CombineRect(a_rect, a_node.m_branch[index]!.m_rect);
        return false;
      }
      // Child was split
      a_node.m_branch[index]!.m_rect = this.NodeCover(a_node.m_branch[index]!.m_child!);
      const branch: Branch<DATATYPE> = {
        m_child: otherNode.value,
        m_rect: this.NodeCover(otherNode.value!),
        m_data: undefined,
      };
      return this.AddBranch(branch, a_node, a_newNode);
    }
    if (a_node.m_level === a_level) {
      // Have reached level for insertion. Add rect, split if necessary
      // Child field of leaves contains id of data record; the union is one
      // field in the C++, so a reinserted subtree (level > 0) arrives here as
      // its node.
      const branch: Branch<DATATYPE> = {
        m_rect: copyRect(a_rect),
        m_child: a_level > 0 ? (a_id as unknown as Node<DATATYPE>) : null,
        m_data: a_level > 0 ? undefined : a_id,
      };
      return this.AddBranch(branch, a_node, a_newNode);
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
  protected InsertRect(a_rect: Rect, a_id: DATATYPE, a_level: number): boolean {
    const newNode: { value: Node<DATATYPE> | null } = { value: null };

    if (this.InsertRectRec(a_rect, a_id, this.m_root, newNode, a_level)) {
      // Root split
      const newRoot = this.AllocNode(); // Grow tree taller and new root
      newRoot.m_level = this.m_root.m_level + 1;
      let branch: Branch<DATATYPE> = {
        m_rect: this.NodeCover(this.m_root),
        m_child: this.m_root,
        m_data: undefined,
      };
      this.AddBranch(branch, newRoot, null);
      branch = {
        m_rect: this.NodeCover(newNode.value!),
        m_child: newNode.value,
        m_data: undefined,
      };
      this.AddBranch(branch, newRoot, null);
      this.m_root = newRoot;
      return true;
    }

    return false;
  }

  // Find the smallest rectangle that includes all rectangles in branches of a node.
  protected NodeCover(a_node: Node<DATATYPE>): Rect {
    let firstTime = true;
    let rect = this.InitRect();

    for (let index = 0; index < a_node.m_count; ++index) {
      if (firstTime) {
        rect = copyRect(a_node.m_branch[index]!.m_rect);
        firstTime = false;
      } else {
        rect = this.CombineRect(rect, a_node.m_branch[index]!.m_rect);
      }
    }

    return rect;
  }

  // Add a branch to a node.  Split the node if necessary.
  // Returns 0 if node not split.  Old node updated.
  // Returns 1 if node split, sets *new_node to address of new node.
  // Old node updated, becomes one of two.
  protected AddBranch(
    a_branch: Branch<DATATYPE>,
    a_node: Node<DATATYPE>,
    a_newNode: { value: Node<DATATYPE> | null } | null,
  ): boolean {
    if (a_node.m_count < this.MAXNODES) {
      // Split won't be necessary
      a_node.m_branch[a_node.m_count] = copyBranch(a_branch);
      ++a_node.m_count;
      return false;
    }
    this.SplitNode(a_node, a_branch, a_newNode!);
    return true;
  }

  // Disconnect a dependent node.
  // Caller must return (or stop using iteration index) after this as count has changed
  protected DisconnectBranch(a_node: Node<DATATYPE>, a_index: number): void {
    // Remove element by swapping with the last element to prevent gaps in array
    a_node.m_branch[a_index] = a_node.m_branch[a_node.m_count - 1]!;
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
    let tempRect: Rect;

    for (let index = 0; index < a_node.m_count; ++index) {
      const curRect = a_node.m_branch[index]!.m_rect;
      area = this.CalcRectVolume(curRect);
      tempRect = this.CombineRect(a_rect, curRect);
      increase = this.CalcRectVolume(tempRect) - area;

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

  // Combine two rectangles into larger one containing both
  protected CombineRect(a_rectA: Rect, a_rectB: Rect): Rect {
    const newRect: Rect = { m_min: [], m_max: [] };

    for (let index = 0; index < this.NUMDIMS; ++index) {
      newRect.m_min[index] = Math.min(a_rectA.m_min[index]!, a_rectB.m_min[index]!);
      newRect.m_max[index] = Math.max(a_rectA.m_max[index]!, a_rectB.m_max[index]!);
    }

    return newRect;
  }

  // Split a node.
  // Divides the nodes branches and the extra one between two nodes.
  // Old node is one of the new ones, and one really new one is created.
  // Tries more than one method for choosing a partition, uses best result.
  protected SplitNode(
    a_node: Node<DATATYPE>,
    a_branch: Branch<DATATYPE>,
    a_newNode: { value: Node<DATATYPE> | null },
  ): void {
    // Could just use local here, but member or external is faster since it is reused
    const parVars: PartitionVars<DATATYPE> = {
      m_partition: [],
      m_total: 0,
      m_minFill: 0,
      m_taken: [],
      m_count: [0, 0],
      m_cover: [this.InitRect(), this.InitRect()],
      m_area: [0, 0],
      m_branchBuf: [],
      m_branchCount: 0,
      m_coverSplit: this.InitRect(),
      m_coverSplitArea: 0,
    };

    // Load all the branches into a buffer, initialize old node
    const level = a_node.m_level;
    this.GetBranches(a_node, a_branch, parVars);

    // Find partition
    this.ChoosePartition(parVars, this.MINNODES);

    // Put branches from buffer into 2 nodes according to chosen partition
    a_newNode.value = this.AllocNode();
    a_newNode.value.m_level = a_node.m_level = level;
    this.LoadNodes(a_node, a_newNode.value, parVars);
  }

  // Calculate the n-dimensional volume of a rectangle
  protected RectVolume(a_rect: Rect): number {
    let volume = 1;

    for (let index = 0; index < this.NUMDIMS; ++index) {
      volume *= a_rect.m_max[index]! - a_rect.m_min[index]!;
    }
    return volume;
  }

  // The exact volume of the bounding sphere for the given Rect
  protected RectSphericalVolume(a_rect: Rect): number {
    let sumOfSquares = 0;

    for (let index = 0; index < this.NUMDIMS; ++index) {
      const halfExtent = (a_rect.m_max[index]! - a_rect.m_min[index]!) * 0.5;
      sumOfSquares += halfExtent * halfExtent;
    }

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
  protected CalcRectVolume(a_rect: Rect): number {
    // RTREE_USE_SPHERICAL_VOLUME
    return this.RectSphericalVolume(a_rect); // Slower but helps certain merge cases
  }

  // Load branch buffer with branches from full node plus the extra branch.
  protected GetBranches(
    a_node: Node<DATATYPE>,
    a_branch: Branch<DATATYPE>,
    a_parVars: PartitionVars<DATATYPE>,
  ): void {
    // Load the branch buffer
    for (let index = 0; index < this.MAXNODES; ++index) {
      a_parVars.m_branchBuf[index] = a_node.m_branch[index]!;
    }

    a_parVars.m_branchBuf[this.MAXNODES] = copyBranch(a_branch);
    a_parVars.m_branchCount = this.MAXNODES + 1;

    // Calculate rect containing all in the set
    a_parVars.m_coverSplit = copyRect(a_parVars.m_branchBuf[0]!.m_rect);

    for (let index = 1; index < this.MAXNODES + 1; ++index) {
      a_parVars.m_coverSplit = this.CombineRect(
        a_parVars.m_coverSplit,
        a_parVars.m_branchBuf[index]!.m_rect,
      );
    }

    a_parVars.m_coverSplitArea = this.CalcRectVolume(a_parVars.m_coverSplit);

    this.InitNode(a_node);
    a_node.m_branch = [];
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
          const curRect = a_parVars.m_branchBuf[index]!.m_rect;
          const rect0 = this.CombineRect(curRect, a_parVars.m_cover[0]);
          const rect1 = this.CombineRect(curRect, a_parVars.m_cover[1]);
          const growth0 = this.CalcRectVolume(rect0) - a_parVars.m_area[0];
          const growth1 = this.CalcRectVolume(rect1) - a_parVars.m_area[1];
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
      if (a_parVars.m_partition[index] === 0) {
        this.AddBranch(a_parVars.m_branchBuf[index]!, a_nodeA, null);
      } else if (a_parVars.m_partition[index] === 1) {
        this.AddBranch(a_parVars.m_branchBuf[index]!, a_nodeB, null);
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
      area[index] = this.CalcRectVolume(a_parVars.m_branchBuf[index]!.m_rect);
    }

    worst = -a_parVars.m_coverSplitArea - 1;

    for (let indexA = 0; indexA < a_parVars.m_total - 1; ++indexA) {
      for (let indexB = indexA + 1; indexB < a_parVars.m_total; ++indexB) {
        const oneRect = this.CombineRect(
          a_parVars.m_branchBuf[indexA]!.m_rect,
          a_parVars.m_branchBuf[indexB]!.m_rect,
        );
        waste = this.CalcRectVolume(oneRect) - area[indexA]! - area[indexB]!;

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

    if (a_parVars.m_count[a_group] === 0) {
      a_parVars.m_cover[a_group] = copyRect(a_parVars.m_branchBuf[a_index]!.m_rect);
    } else {
      a_parVars.m_cover[a_group] = this.CombineRect(
        a_parVars.m_branchBuf[a_index]!.m_rect,
        a_parVars.m_cover[a_group]!,
      );
    }

    a_parVars.m_area[a_group] = this.CalcRectVolume(a_parVars.m_cover[a_group]!);
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
          const b = tempNode.m_branch[index]!;
          this.InsertRect(
            b.m_rect,
            (IsLeaf(tempNode) ? b.m_data : b.m_child) as DATATYPE,
            tempNode.m_level,
          );
        }

        const remLNode = reInsertList.value;
        reInsertList.value = reInsertList.value.m_next;

        this.FreeNode(remLNode.m_node);
      }

      // Check for redundant root (not leaf, 1 child) and eliminate
      if (this.m_root.m_count === 1 && IsInternalNode(this.m_root)) {
        const tempNode = this.m_root.m_branch[0]!.m_child!;
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
        if (RTree.Overlap(a_rect, a_node.m_branch[index]!.m_rect)) {
          if (!this.RemoveRectRec(a_rect, a_id, a_node.m_branch[index]!.m_child!, a_listNode)) {
            if (a_node.m_branch[index]!.m_child!.m_count >= this.MINNODES) {
              // child removed, just resize parent rect
              a_node.m_branch[index]!.m_rect = this.NodeCover(a_node.m_branch[index]!.m_child!);
            } else {
              // child removed, not enough entries in node, eliminate node
              this.ReInsert(a_node.m_branch[index]!.m_child!, a_listNode);
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
      if (a_node.m_branch[index]!.m_data === a_id) {
        this.DisconnectBranch(a_node, index); // Must return after this call as count has changed
        return false;
      }
    }

    return true;
  }

  // Decide whether two rectangles overlap.
  static Overlap(a_rectA: Rect, a_rectB: Rect): boolean {
    const n = a_rectA.m_min.length;
    for (let index = 0; index < n; ++index) {
      if (
        a_rectA.m_min[index]! > a_rectB.m_max[index]! ||
        a_rectB.m_min[index]! > a_rectA.m_max[index]!
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
    if (IsInternalNode(a_node)) {
      // This is an internal node in the tree
      for (let index = 0; index < a_node.m_count; ++index) {
        if (RTree.Overlap(a_rect, a_node.m_branch[index]!.m_rect)) {
          if (!this.searchRec(a_node.m_branch[index]!.m_child!, a_rect, a_foundCount, a_callback)) {
            return false; // Don't continue searching
          }
        }
      }
    } // This is a leaf node
    else {
      for (let index = 0; index < a_node.m_count; ++index) {
        if (RTree.Overlap(a_rect, a_node.m_branch[index]!.m_rect)) {
          const id = a_node.m_branch[index]!.m_data as DATATYPE;
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
  protected MinDist(a_point: readonly number[], a_rect: Rect): number {
    const q = a_point;
    const s = a_rect.m_min;
    const t = a_rect.m_max;

    let minDist = 0.0;

    for (let index = 0; index < this.NUMDIMS; index++) {
      let r = Math.trunc(q[index]!); // `int r`

      if (q[index]! < s[index]!) {
        r = s[index]!;
      } else if (q[index]! > t[index]!) {
        r = t[index]!;
      }

      const addend = q[index]! - r;
      minDist += addend * addend;
    }

    return Math.round(Math.sqrt(minDist)); // std::lround
  }
}
