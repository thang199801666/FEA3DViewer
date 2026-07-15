// Interaction/Picking/ActorTopology.js
// ---------------------------------------------------------------------------
// Builds and caches topology for one Actor from actor.surface.geometry so
// SelectionHighlighter can outline the picked Surface, Element, Point, Node,
// or Edge. Screen-space pickers may also use queryVerts to find nearby points
// or edges when raycasting does not hit a face.
//
// All returned coordinates (wpos, cornerOf().pos, nodePosition,
// weldedPosition, chain.positions, triCentroid) are in actor-local geometry
// space. SelectionHighlighter attaches overlays to the actor, so actor.matrixWorld
// applies the final transform. This module intentionally does not return world
// coordinates.
//
// Terms:
//   - "raw vertex index" / "corner": direct index into geometry.attributes.position.
//     Picker.js returns the same value as pickResult.localPointIndex, so
//     PickMode.POINT can use it directly.
//   - "cell id" / "node id": physical FEA ids from geometry.userData.cellMap
//     and pointMap. Without those maps, cellId = faceIndex and nodeId = raw vertex index.
//   - "welded vertex": geometry vertices merged by position tolerance. This is
//     independent from FEA node ids and is used for stable boundary and adjacency
//     detection when flat-shaded or imported meshes duplicate vertices.
// ---------------------------------------------------------------------------
import * as THREE from "three";

const _va = new THREE.Vector3();
const _vb = new THREE.Vector3();
const _vc = new THREE.Vector3();
const _vd = new THREE.Vector3();

/** Actor cache. Values are rebuilt when geometry.uuid changes, for example after actor.update(). */
const _cache = new WeakMap();

function edgeKey(u, v) {
    return u < v ? `${u}_${v}` : `${v}_${u}`;
}

const ELEMENT_SHAPES = {
    line: { corners: 2, edges: [[0, 1]], faces: [] },
    triangle: { corners: 3, edges: [[0, 1], [1, 2], [2, 0]], faces: [[0, 1, 2]] },
    quad: { corners: 4, edges: [[0, 1], [1, 2], [2, 3], [3, 0]], faces: [[0, 1, 2, 3]] },
    tetra: { corners: 4, edges: [[0, 1], [1, 2], [2, 0], [0, 3], [1, 3], [2, 3]], faces: [[0, 2, 1], [0, 1, 3], [1, 2, 3], [0, 3, 2]] },
    hexa: { corners: 8, edges: [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]], faces: [[0,3,2,1],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]] },
    voxel: { corners: 8, edges: [[0,1],[1,3],[3,2],[2,0],[4,5],[5,7],[7,6],[6,4],[0,4],[1,5],[2,6],[3,7]], faces: [[0,2,3,1],[4,5,7,6],[0,1,5,4],[1,3,7,5],[3,2,6,7],[2,0,4,6]] },
    wedge: { corners: 6, edges: [[0,1],[1,2],[2,0],[3,4],[4,5],[5,3],[0,3],[1,4],[2,5]], faces: [[0,1,2],[3,5,4],[0,3,4,1],[1,4,5,2],[2,5,3,0]] },
    pyramid: { corners: 5, edges: [[0,1],[1,2],[2,3],[3,0],[0,4],[1,4],[2,4],[3,4]], faces: [[0,3,2,1],[0,1,4],[1,2,4],[2,3,4],[3,0,4]] },
};

function elementShape(type, count) {
    if (type === 1 || type === 2) return { corners: count, edges: [], faces: [] };
    if ([3, 21, 35, 60, 68, 75].includes(type)) return ELEMENT_SHAPES.line;
    if (type === 4) return { corners: count, edges: Array.from({ length: Math.max(0, count - 1) }, (_, i) => [i, i + 1]), faces: [] };
    if ([5, 22, 34, 61, 69, 76].includes(type)) return ELEMENT_SHAPES.triangle;
    if (type === 6) return null;
    if (type === 7 || type === 36) return { corners: type === 36 ? count >> 1 : count, edges: [], faces: [] };
    if (type === 8) return { ...ELEMENT_SHAPES.quad, edges: [[0,1],[1,3],[3,2],[2,0]], faces: [[0,1,3,2]] };
    if ([9, 23, 28, 30, 62, 70, 77].includes(type)) return ELEMENT_SHAPES.quad;
    if ([10, 24, 64, 71, 78].includes(type)) return ELEMENT_SHAPES.tetra;
    if (type === 11) return ELEMENT_SHAPES.voxel;
    if ([12, 25, 29, 33, 67, 72, 79].includes(type)) return ELEMENT_SHAPES.hexa;
    if ([13, 26, 31, 32, 65, 73, 80].includes(type)) return ELEMENT_SHAPES.wedge;
    if ([14, 27, 37, 66, 74, 81].includes(type)) return ELEMENT_SHAPES.pyramid;
    return null;
}

function inferredOrder(type, count, shape) {
    if ([21,22,23,24,25,26,27,28,30,31,32,33,34].includes(type)) return 2;
    if (type === 35) return 3;
    if ([60,68,75].includes(type)) return Math.max(1, count - 1);
    if ([61,69,76].includes(type)) {
        const p = Math.round((Math.sqrt(8 * count + 1) - 3) / 2);
        return (p + 1) * (p + 2) / 2 === count ? p : 1;
    }
    if ([62,70,77].includes(type)) {
        const p = Math.round(Math.sqrt(count) - 1);
        return (p + 1) ** 2 === count ? p : 1;
    }
    if ([64,71,78].includes(type)) {
        for (let p = 1; p < 20; p++) if ((p + 1) * (p + 2) * (p + 3) / 6 === count) return p;
    }
    if ([67,72,79].includes(type)) {
        const p = Math.round(Math.cbrt(count) - 1);
        if ((p + 1) ** 3 === count) return p;
    }
    if ([65,73,80].includes(type)) {
        for (let p = 1; p < 20; p++) if ((p + 1) ** 2 * (p + 2) / 2 === count) return p;
    }
    if ([66,74,81].includes(type)) {
        for (let p = 1; p < 20; p++) if ((p + 1) * (p + 2) * (2 * p + 3) / 6 === count) return p;
    }
    return count >= shape.corners + shape.edges.length ? 2 : 1;
}

/** Builds a simple spatial hash to weld coincident or near-coincident vertices. */
function buildWeldMap(posAttr, tolerance) {
    const n = posAttr.count;
    const cell = Math.max(tolerance, 1e-12);
    const buckets = new Map(); // "ix_iy_iz" -> [weldedId, ...] candidates in the same cell
    const rawToWelded = new Int32Array(n);
    const weldedFirstRaw = []; // weldedId -> representative raw index used for position lookup

    const quantize = (v) => Math.round(v / cell);
    const p = new THREE.Vector3();

    for (let i = 0; i < n; i++) {
        p.fromBufferAttribute(posAttr, i);
        const qx = quantize(p.x), qy = quantize(p.y), qz = quantize(p.z);

        let found = -1;
        // Scan the current cell and its 26 neighbors because cell size equals tolerance.
        for (let dx = -1; dx <= 1 && found < 0; dx++) {
            for (let dy = -1; dy <= 1 && found < 0; dy++) {
                for (let dz = -1; dz <= 1 && found < 0; dz++) {
                    const key = `${qx + dx}_${qy + dy}_${qz + dz}`;
                    const candidates = buckets.get(key);
                    if (!candidates) continue;
                    for (const weldedId of candidates) {
                        const rawRef = weldedFirstRaw[weldedId];
                        _va.fromBufferAttribute(posAttr, rawRef);
                        if (_va.distanceToSquared(p) <= tolerance * tolerance) {
                            found = weldedId;
                            break;
                        }
                    }
                }
            }
        }

        if (found < 0) {
            found = weldedFirstRaw.length;
            weldedFirstRaw.push(i);
            const ownKey = `${qx}_${qy}_${qz}`;
            if (!buckets.has(ownKey)) buckets.set(ownKey, []);
            buckets.get(ownKey).push(found);
        }
        rawToWelded[i] = found;
    }

    return { rawToWelded, weldedFirstRaw };
}

export class ActorTopology {
    constructor(actor, { weldTolerance, surfaceFeatureAngle = actor?.featureEdgeAngle ?? 20 } = {}) {
        this.actor = actor;

        const mesh = actor.surface;
        const geometry = mesh?.geometry;
        if (!geometry) throw new Error("ActorTopology: actor.surface.geometry is missing");
        this.geometry = geometry;
        this._geometryUuid = geometry.uuid;

        const posAttr = geometry.getAttribute("position");
        if (!posAttr) throw new Error("ActorTopology: geometry has no position attribute");

        // ---- bbox / diag used for weld epsilon, overlay offsets, and similar scales ----
        this.bbox = new THREE.Box3().setFromBufferAttribute(posAttr);
        const size = this.bbox.getSize(new THREE.Vector3());
        this.diag = size.length() || 1;

        // ---- triRaw: raw vertex indices, directly indexing the position attribute ----
        const index = geometry.getIndex();
        let triRaw;
        const isSurface = geometry.userData?.primitiveType !== "line" && geometry.userData?.primitiveType !== "point";
        if (!isSurface) {
            triRaw = new Uint32Array(0);
        } else if (index) {
            triRaw = index.array instanceof Uint32Array
                ? index.array.slice()
                : Uint32Array.from(index.array);
        } else {
            triRaw = new Uint32Array(posAttr.count);
            for (let i = 0; i < triRaw.length; i++) triRaw[i] = i;
        }
        this.triRaw = triRaw;
        this.triCount = triRaw.length / 3;

        // ---- weld vertices by position -> tri (welded indices), wpos, wcount ----
        const tol = weldTolerance ?? Math.max(1e-6, this.diag * 1e-5);
        const { rawToWelded, weldedFirstRaw } = buildWeldMap(posAttr, tol);
        this.wcount = weldedFirstRaw.length;

        const wpos = new Float32Array(this.wcount * 3);
        for (let w = 0; w < this.wcount; w++) {
            const raw = weldedFirstRaw[w];
            wpos[w * 3] = posAttr.getX(raw);
            wpos[w * 3 + 1] = posAttr.getY(raw);
            wpos[w * 3 + 2] = posAttr.getZ(raw);
        }
        this.wpos = wpos;

        const tri = new Uint32Array(triRaw.length);
        for (let i = 0; i < triRaw.length; i++) tri[i] = rawToWelded[triRaw[i]];
        this.tri = tri;

        /** @type {Map<number, number[]>} weldedId -> raw vertex indices merged into it */
        this.weldedToCorner = new Map();
        for (let raw = 0; raw < rawToWelded.length; raw++) {
            const w = rawToWelded[raw];
            if (!this.weldedToCorner.has(w)) this.weldedToCorner.set(w, []);
            this.weldedToCorner.get(w).push(raw);
        }
        this._rawToWelded = rawToWelded;

        // ---- corners: direct position attribute access by raw vertex index ----
        this.corners = posAttr;

        // ---- cell / surface mapping, matching Picker.js._cellId logic ----
        const cellMap = geometry.userData?.cellMap ?? null;
        const pointMap = geometry.userData?.pointMap ?? null;

        this._cellMap = cellMap;
        this._pointMap = pointMap;

        /** @type {Map<*, number[]>} cellId -> triangle indices */
        this.cellTris = new Map();
        /** @type {Map<*, number[]>} surfaceId -> triangle indices */
        this.surfaces = new Map();
        /** @type {Array<*>} Fast triIndex -> surfaceId lookup. */
        this._triSurfaceOf = new Array(this.triCount);

        for (let t = 0; t < this.triCount; t++) {
            const cellId = cellMap ? cellMap[t] : t;
            if (!this.cellTris.has(cellId)) this.cellTris.set(cellId, []);
            this.cellTris.get(cellId).push(t);
        }

        // A selectable Surface is a geometric feature region, not an input
        // polygon/cell group. Always grow it across adjacent triangles using
        // the requested feature angle so it can span the entire model.
        const generatedSurfaceIds = this._buildFeatureSurfaces(surfaceFeatureAngle);

        for (let t = 0; t < this.triCount; t++) {
            const surfaceId = generatedSurfaceIds[t] ?? 0;
            this._triSurfaceOf[t] = surfaceId;
            if (!this.surfaces.has(surfaceId)) {
                this.surfaces.set(surfaceId, []);
            }
            this.surfaces.get(surfaceId).push(t);
        }

        // Full source-element topology. The render mesh contains only the
        // external shell, while mapper.input still contains every emitted face
        // of each volume cell. Keeping raw point indices here lets Element mode
        // highlight the complete original cell instead of one render triangle.
        this.elements = this._buildSourceElements();
        this.elementTriangles = new Map();
        for (const [id, element] of this.elements) this.elementTriangles.set(id, element.triangles);

        // Part selection uses only geometric boundary/feature edges. Coplanar
        // mesh subdivisions are intentionally excluded.
        this.partOutlinePositions = this._buildFeatureEdgePositions(surfaceFeatureAngle);

        // ---- node reverse lookup: nodeId -> one representative raw vertex ----
        this._nodeToRaw = new Map();
        if (pointMap) {
            for (let raw = 0; raw < pointMap.length; raw++) {
                const nodeId = pointMap[raw];
                if (!this._nodeToRaw.has(nodeId)) this._nodeToRaw.set(nodeId, raw);
            }
        }
        // Without pointMap, nodeId is the raw vertex index and no map is needed.

        // ---- boundary edge chains used by PickMode.EDGE ----
        // A boundary edge belongs to exactly one triangle in welded-vertex space.
        // Each boundary edge is stored as an independent two-vertex chain. This is
        // sufficient for highlighting; continuous polylines can be added later with
        // a graph-walk merge step.
        const edgeTriCount = new Map();
        for (let t = 0; t < this.triCount; t++) {
            const o = t * 3;
            const a = tri[o], b = tri[o + 1], c = tri[o + 2];
            for (const [u, v] of [[a, b], [b, c], [c, a]]) {
                const k = edgeKey(u, v);
                edgeTriCount.set(k, (edgeTriCount.get(k) || 0) + 1);
            }
        }
        /** @type {Map<string, {verts:number[], positions:Float32Array}>} */
        this.chains = new Map();
        for (const [k, count] of edgeTriCount) {
            if (count !== 1) continue;
            const [u, v] = k.split("_").map(Number);
            const positions = new Float32Array([
                wpos[u * 3], wpos[u * 3 + 1], wpos[u * 3 + 2],
                wpos[v * 3], wpos[v * 3 + 1], wpos[v * 3 + 2],
            ]);
            this.chains.set(k, { verts: [u, v], positions });
        }
    }

    // -------------------------------------------------------------- mapping

    cellOf(triIndex) { return this._cellMap ? this._cellMap[triIndex] : triIndex; }

    surfaceOf(triIndex) { return this._triSurfaceOf[triIndex] ?? null; }

    nodeOf(rawVertexIndex) {
        return this._pointMap ? this._pointMap[rawVertexIndex] : rawVertexIndex;
    }

    nodeOfWelded(weldedId) {
        const raw = this.weldedToCorner.get(weldedId)?.[0];
        return raw == null ? weldedId : this.nodeOf(raw);
    }

    chainOf(edgeId) { return this.chains.get(edgeId) ?? null; }

    // ------------------------------------------------------ id -> triangles

    trianglesOfCell(cellId) { return this.cellTris.get(cellId) ?? []; }
    rawTrianglesOfCell(cellId) { return this.elementTriangles.get(cellId) ?? null; }
    elementOfCell(cellId) { return this.elements.get(cellId) ?? null; }
    trianglesOfSurface(surfaceId) { return this.surfaces.get(surfaceId) ?? []; }

    surfaceEntries() { return Array.from(this.surfaces.entries()); }

    // --------------------------------------------------------- id -> position

    /** Local-space position of one raw vertex/corner, used by PickMode.POINT. */
    cornerOf(rawVertexIndex) {
        if (rawVertexIndex == null || rawVertexIndex < 0 || rawVertexIndex >= this.corners.count) return null;
        return { pos: new THREE.Vector3().fromBufferAttribute(this.corners, rawVertexIndex) };
    }

    /** Local-space position of one physical node id from pointMap, used by PickMode.NODE. */
    nodePosition(nodeId, target = new THREE.Vector3()) {
        const raw = this._pointMap ? (this._nodeToRaw.get(nodeId) ?? nodeId) : nodeId;
        return target.fromBufferAttribute(this.corners, raw);
    }

    /** Local-space position of one welded vertex id from tri/wpos. */
    weldedPosition(weldedId, target = new THREE.Vector3()) {
        return target.set(
            this.wpos[weldedId * 3],
            this.wpos[weldedId * 3 + 1],
            this.wpos[weldedId * 3 + 2]
        );
    }

    /** Local-space centroid of one triangle using triRaw indices. */
    triCentroid(triIndex, target = new THREE.Vector3()) {
        const o = triIndex * 3;
        const a = this.triRaw[o], b = this.triRaw[o + 1], c = this.triRaw[o + 2];
        _va.fromBufferAttribute(this.corners, a);
        _vb.fromBufferAttribute(this.corners, b);
        _vc.fromBufferAttribute(this.corners, c);
        return target.copy(_va).add(_vb).add(_vc).multiplyScalar(1 / 3);
    }

    /**
     * Finds raw vertex indices inside `radius` around `point` in local space.
     * Screen-space pickers can use this for EDGE/POINT/NODE modes when raycasting
     * misses the surface mesh.
     * @param {THREE.Vector3} point Query point in local space.
     * @param {number} radius Query radius in local space.
     * @returns {number[]} Raw vertex indices inside the radius.
     */
    queryVerts(point, radius) {
        const out = [];
        const r2 = radius * radius;
        for (let w = 0; w < this.wcount; w++) {
            this.weldedPosition(w, _va);
            if (_va.distanceToSquared(point) <= r2) out.push(w);
        }
        return out;
    }

    _buildFeatureSurfaces(featureAngleDeg) {
        const normals = new Array(this.triCount);
        const edgeToTris = new Map();
        const cosLimit = Math.cos(THREE.MathUtils.degToRad(featureAngleDeg));

        for (let t = 0; t < this.triCount; t++) {
            const o = t * 3;
            const a = this.tri[o], b = this.tri[o + 1], c = this.tri[o + 2];

            _va.set(this.wpos[a * 3], this.wpos[a * 3 + 1], this.wpos[a * 3 + 2]);
            _vb.set(this.wpos[b * 3], this.wpos[b * 3 + 1], this.wpos[b * 3 + 2]);
            _vc.set(this.wpos[c * 3], this.wpos[c * 3 + 1], this.wpos[c * 3 + 2]);
            normals[t] = _vd.subVectors(_vb, _va).cross(_vc.sub(_va)).normalize().clone();

            for (const [u, v] of [[a, b], [b, c], [c, a]]) {
                const k = edgeKey(u, v);
                if (!edgeToTris.has(k)) edgeToTris.set(k, []);
                edgeToTris.get(k).push(t);
            }
        }

        const adjacency = Array.from({ length: this.triCount }, () => []);
        for (const tris of edgeToTris.values()) {
            if (tris.length < 2) continue;
            // FEA surface meshes can be non-manifold after volume faces are
            // triangulated or coincident vertices are welded. Connect every
            // compatible pair around the edge instead of requiring exactly
            // two incident triangles.
            for (let i = 0; i < tris.length; i++) {
                for (let j = i + 1; j < tris.length; j++) {
                    const t0 = tris[i], t1 = tris[j];
                    if (Math.abs(normals[t0].dot(normals[t1])) < cosLimit) continue;
                    adjacency[t0].push(t1);
                    adjacency[t1].push(t0);
                }
            }
        }

        const surfaceIds = new Array(this.triCount).fill(-1);
        let nextSurfaceId = 0;
        for (let seed = 0; seed < this.triCount; seed++) {
            if (surfaceIds[seed] !== -1) continue;
            const stack = [seed];
            surfaceIds[seed] = nextSurfaceId;
            while (stack.length) {
                const t = stack.pop();
                for (const n of adjacency[t]) {
                    if (surfaceIds[n] !== -1) continue;
                    surfaceIds[n] = nextSurfaceId;
                    stack.push(n);
                }
            }
            nextSurfaceId++;
        }

        return surfaceIds;
    }

    _buildSourceElements() {
        const pd = this.actor?.mapper?.input;
        const sourceCells = pd?.userData?.sourceCells;
        const sourceTypes = pd?.userData?.sourceCellTypes;
        if (sourceCells && sourceTypes) {
            const elements = new Map();
            const n = Math.min(sourceCells.length, sourceTypes.length);
            for (let cellId = 0; cellId < n; cellId++) {
                const conn = Array.from(sourceCells.getCell(cellId));
                const type = sourceTypes[cellId];
                const shape = elementShape(type, conn.length);
                if (!shape) continue;

                if (type === 1 || type === 2) {
                    elements.set(cellId, { triangles: [], edges: [], points: conn, type });
                    continue;
                }

                if (type === 7 || type === 36) {
                    shape.edges = Array.from({ length: shape.corners }, (_, i) => [i, (i + 1) % shape.corners]);
                    shape.faces = [Array.from({ length: shape.corners }, (_, i) => i)];
                }

                const triangles = [];
                for (const face of shape.faces) {
                    for (let i = 1; i + 1 < face.length; i++) {
                        triangles.push(conn[face[0]], conn[face[i]], conn[face[i + 1]]);
                    }
                }

                const order = inferredOrder(type, conn.length, shape);
                const internalPerEdge = Math.max(0, order - 1);
                const hasEdgeNodes = conn.length >= shape.corners + shape.edges.length * internalPerEdge;
                const partialQuadratic = type === 30
                    ? [[4], [], [5], []]
                    : type === 31
                    ? [[6], [7], [8], [9], [10], [11], [], [], []]
                    : null;
                const edges = shape.edges.map(([a, b], edgeId) => {
                    const chain = [conn[a]];
                    if (partialQuadratic) {
                        for (const local of partialQuadratic[edgeId] ?? []) chain.push(conn[local]);
                    } else if (hasEdgeNodes) {
                        const start = shape.corners + edgeId * internalPerEdge;
                        for (let j = 0; j < internalPerEdge; j++) chain.push(conn[start + j]);
                    }
                    chain.push(conn[b]);
                    return chain;
                });
                elements.set(cellId, { triangles, edges, points: conn, type });
            }
            return elements;
        }

        const polys = pd?.polys;
        if (!polys) return new Map();

        const polySource = pd.userData?.polySourceCellMap ?? pd.userData?.surfaceCellMap ?? null;
        const groups = new Map();
        let faceId = 0;
        for (const cell of polys) {
            const cellId = polySource ? polySource[faceId] : faceId;
            let raw = groups.get(cellId);
            if (!raw) { raw = []; groups.set(cellId, raw); }
            for (let i = 1; i + 1 < cell.length; i++) {
                raw.push(cell[0], cell[i], cell[i + 1]);
            }
            faceId++;
        }

        const strips = pd.strips;
        const stripSource = pd.userData?.stripSourceCellMap ?? null;
        if (strips) {
            let stripId = 0;
            for (const strip of strips) {
                const cellId = stripSource
                    ? stripSource[stripId]
                    : (pd.userData?.surfaceCellMap?.[faceId + stripId] ?? faceId + stripId);
                let raw = groups.get(cellId);
                if (!raw) { raw = []; groups.set(cellId, raw); }
                for (let i = 0; i + 2 < strip.length; i++) {
                    if ((i & 1) === 0) raw.push(strip[i], strip[i + 1], strip[i + 2]);
                    else raw.push(strip[i + 1], strip[i], strip[i + 2]);
                }
                stripId++;
            }
        }
        const elements = new Map();
        for (const [id, triangles] of groups) {
            elements.set(id, { triangles, edges: [], points: [...new Set(triangles)], type: null });
        }
        return elements;
    }

    _buildFeatureEdgePositions(featureAngleDeg) {
        const cosLimit = Math.cos(THREE.MathUtils.degToRad(featureAngleDeg));
        const edges = new Map();
        const normals = new Array(this.triCount);

        for (let t = 0; t < this.triCount; t++) {
            const o = t * 3;
            const a = this.tri[o], b = this.tri[o + 1], c = this.tri[o + 2];
            _va.set(this.wpos[a * 3], this.wpos[a * 3 + 1], this.wpos[a * 3 + 2]);
            _vb.set(this.wpos[b * 3], this.wpos[b * 3 + 1], this.wpos[b * 3 + 2]);
            _vc.set(this.wpos[c * 3], this.wpos[c * 3 + 1], this.wpos[c * 3 + 2]);
            normals[t] = _vd.subVectors(_vb, _va).cross(_vc.sub(_va)).normalize().clone();
            for (const [u, v] of [[a, b], [b, c], [c, a]]) {
                const k = edgeKey(u, v);
                if (!edges.has(k)) edges.set(k, { u, v, tris: [] });
                edges.get(k).tris.push(t);
            }
        }

        const selected = [];
        for (const { u, v, tris } of edges.values()) {
            let keep = tris.length === 1;
            // For manifold and non-manifold edges alike, retain the edge only
            // when at least one pair of incident faces forms a feature angle.
            // Coplanar mesh subdivisions (even duplicated ones) are excluded.
            for (let i = 0; !keep && i < tris.length; i++) {
                for (let j = i + 1; j < tris.length; j++) {
                    if (Math.abs(normals[tris[i]].dot(normals[tris[j]])) <= cosLimit) {
                        keep = true;
                        break;
                    }
                }
            }
            if (!keep) continue;
            selected.push({ u, v });
        }

        // Merge collinear feature segments into their maximal geometric edge.
        // A meshed cuboid then produces 12 boundary edges regardless of how
        // many elements subdivide each edge.
        const adjacency = new Map();
        selected.forEach((e, i) => {
            if (!adjacency.has(e.u)) adjacency.set(e.u, []);
            if (!adjacency.has(e.v)) adjacency.set(e.v, []);
            adjacency.get(e.u).push(i);
            adjacency.get(e.v).push(i);
        });
        const other = (edgeId, vertex) => {
            const e = selected[edgeId];
            return e.u === vertex ? e.v : e.u;
        };
        const direction = (from, to, target) => target.set(
            this.wpos[to * 3] - this.wpos[from * 3],
            this.wpos[to * 3 + 1] - this.wpos[from * 3 + 1],
            this.wpos[to * 3 + 2] - this.wpos[from * 3 + 2]
        ).normalize();
        const visited = new Uint8Array(selected.length);
        const pts = [];
        const d0 = new THREE.Vector3(), d1 = new THREE.Vector3();
        for (let seed = 0; seed < selected.length; seed++) {
            if (visited[seed]) continue;
            const edge = selected[seed];
            let start = adjacency.get(edge.u).length === 2 && adjacency.get(edge.v).length !== 2
                ? edge.v : edge.u;
            let previous = start;
            let currentEdge = seed;
            let current = other(currentEdge, start);
            visited[currentEdge] = 1;

            while (adjacency.get(current)?.length === 2) {
                const pair = adjacency.get(current);
                const nextEdge = pair[0] === currentEdge ? pair[1] : pair[0];
                if (visited[nextEdge]) break;
                const next = other(nextEdge, current);
                direction(previous, current, d0);
                direction(current, next, d1);
                if (Math.abs(d0.dot(d1)) < 1 - 1e-6) break;
                visited[nextEdge] = 1;
                previous = current;
                current = next;
                currentEdge = nextEdge;
            }

            pts.push(
                this.wpos[start * 3], this.wpos[start * 3 + 1], this.wpos[start * 3 + 2],
                this.wpos[current * 3], this.wpos[current * 3 + 1], this.wpos[current * 3 + 2]
            );
        }
        return Float32Array.from(pts);
    }

    // ------------------------------------------------------------- lifecycle

    /** Returns true when the actor geometry changed since this topology was built. */
    isStale() {
        return this.geometry !== this.actor.surface?.geometry
            || this._geometryUuid !== this.actor.surface?.geometry?.uuid;
    }

    /**
     * Gets and caches topology for one actor. Rebuilds automatically when geometry changes.
     * @param {THREE.Object3D} actor
     * @param {Object} [options]
     * @param {number} [options.weldTolerance]  Overrides the default vertex weld tolerance.
     */
    static get(actor, options) {
        if (!actor?.surface?.geometry) {
            throw new Error("ActorTopology.get: actor does not have a valid surface.geometry");
        }
        let topo = _cache.get(actor);
        if (!topo || topo.isStale()) {
            topo = new ActorTopology(actor, options);
            _cache.set(actor, topo);
        }
        return topo;
    }

    /** Clears cached topology for one actor, for example before actor.dispose(). */
    static invalidate(actor) {
        _cache.delete(actor);
    }

    static get REQUIRED_INTERFACE() {
        return [
            "triRaw", "tri", "wpos", "triCount", "wcount", "bbox", "diag",
            "cellTris", "surfaces", "corners", "chains", "weldedToCorner",
            "cellOf", "surfaceOf", "nodeOf", "nodeOfWelded", "chainOf",
            "trianglesOfCell", "rawTrianglesOfCell", "trianglesOfSurface", "surfaceEntries",
            "cornerOf", "nodePosition", "weldedPosition", "triCentroid", "queryVerts",
        ];
    }
}

export default ActorTopology;
