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

/** Actor cache. Values are rebuilt when geometry.uuid changes, for example after actor.update(). */
const _cache = new WeakMap();

function edgeKey(u, v) {
    return u < v ? `${u}_${v}` : `${v}_${u}`;
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
    constructor(actor, { weldTolerance } = {}) {
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
        if (index) {
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
        const surfaceMap = geometry.userData?.surfaceMap ?? null;
        const groups = geometry.groups && geometry.groups.length ? geometry.groups : null;

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

            let surfaceId;
            if (surfaceMap) {
                surfaceId = surfaceMap[t];
            } else if (groups) {
                const vStart = t * 3;
                const g = groups.find((gr) => vStart >= gr.start && vStart < gr.start + gr.count);
                surfaceId = g ? (g.materialIndex ?? 0) : 0;
            } else {
                surfaceId = 0; // Actor currently has one surface, so all triangles belong to surface 0.
            }
            this._triSurfaceOf[t] = surfaceId;
            if (!this.surfaces.has(surfaceId)) this.surfaces.set(surfaceId, []);
            this.surfaces.get(surfaceId).push(t);
        }

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

    chainOf(edgeId) { return this.chains.get(edgeId) ?? null; }

    // ------------------------------------------------------ id -> triangles

    trianglesOfCell(cellId) { return this.cellTris.get(cellId) ?? []; }
    trianglesOfSurface(surfaceId) { return this.surfaces.get(surfaceId) ?? []; }

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
        const pos = this.corners;
        for (let i = 0; i < pos.count; i++) {
            _va.fromBufferAttribute(pos, i);
            if (_va.distanceToSquared(point) <= r2) out.push(i);
        }
        return out;
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
            "cellOf", "surfaceOf", "nodeOf", "chainOf",
            "trianglesOfCell", "trianglesOfSurface",
            "cornerOf", "nodePosition", "weldedPosition", "triCentroid", "queryVerts",
        ];
    }
}

export default ActorTopology;