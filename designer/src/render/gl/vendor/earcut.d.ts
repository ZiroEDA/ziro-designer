/**
 * Triangulate a polygon given as a flat array of vertex coordinates.
 *
 * @param {ArrayLike<number>} data flat array of vertex coordinates
 * @param {ArrayLike<number> | null} [holeIndices] indices (in vertices, not coordinates) where each hole ring starts
 * @param {number} [dim=2] number of coordinates per vertex in `data`
 * @returns {number[]} triangles as triplets of vertex indices into `data`
 * @example earcut([10,0, 0,50, 60,60, 70,10]); // [1,0,3, 3,2,1]
 */
export default function earcut(data: ArrayLike<number>, holeIndices?: ArrayLike<number> | null, dim?: number): number[];
/**
 * Return the relative difference between the polygon area and the area of its triangulation —
 * a value near 0 means a correct triangulation. Useful for verifying output in tests.
 *
 * @param {ArrayLike<number>} data
 * @param {ArrayLike<number> | null} holeIndices
 * @param {number} dim number of coordinates per vertex in `data`
 * @param {ArrayLike<number>} triangles output of {@link earcut}
 * @returns {number}
 * @example deviation(data, holes, dim, earcut(data, holes, dim)); // ~0 if correct
 */
export function deviation(data: ArrayLike<number>, holeIndices: ArrayLike<number> | null, dim: number, triangles: ArrayLike<number>): number;
/**
 * Turn a polygon in multi-dimensional array form (e.g. as in GeoJSON) into the flat form Earcut accepts.
 *
 * @param {ReadonlyArray<ReadonlyArray<ArrayLike<number>>>} data array of rings; the first ring is the outer contour, the rest are holes
 * @returns {{vertices: number[], holes: number[], dimensions: number}}
 * @example const {vertices, holes, dimensions} = flatten(geojson.coordinates);
 */
export function flatten(data: ReadonlyArray<ReadonlyArray<ArrayLike<number>>>): {
    vertices: number[];
    holes: number[];
    dimensions: number;
};
/**
 * Refine a triangulation toward the constrained Delaunay triangulation by legalizing every
 * interior edge in place with Lawson flips — maximizing the minimum angle and removing most
 * slivers. An optional post-pass for {@link earcut} output, or any manifold triangle-index array
 * indexing into `coords`. Adapted from delaunator's edge legalization.
 *
 * Uses non-robust predicates: float input is fine, and the worst case is a not-quite-Delaunay
 * edge, never an invalid mesh.
 *
 * @param {number[]} triangles triangle indices, as returned by {@link earcut}; mutated in place
 * @param {ArrayLike<number>} coords the flat vertex coordinates passed to {@link earcut}
 * @param {number} [dim=2] number of coordinates per vertex in `coords`
 * @example refine(earcut(data), data);
 */
export function refine(triangles: number[], coords: ArrayLike<number>, dim?: number): void;
/**
 * A vertex in a circular doubly linked list representing a polygon ring.
 * `prev`/`next` are always linked (set immediately after {@link createNode}), so they're typed
 * non-null; `prevZ`/`nextZ` are the z-order list links and are null at the ends.
 */
export type Node = {
    /**
     * vertex index in the coordinates array
     */
    i: number;
    /**
     * vertex x coordinate
     */
    x: number;
    /**
     * vertex y coordinate
     */
    y: number;
    /**
     * previous vertex node in the polygon ring
     */
    prev: Node;
    /**
     * next vertex node in the polygon ring
     */
    next: Node;
    /**
     * z-order curve value; doubles as the owning block index during eliminateHoles
     */
    z: number;
    /**
     * previous node in z-order
     */
    prevZ: Node | null;
    /**
     * next node in z-order
     */
    nextZ: Node | null;
};
