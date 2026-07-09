// Actors/FeatureEdges.js
import * as THREE from "three";

/**
 * FeatureEdges - Extracts feature edges from a BufferGeometry, mimicking vtkFeatureEdges.
 *
 * Edge classification definitions (after vertex welding):
 * - Boundary edges:     Belongs to exactly 1 triangle.
 * - Feature edges:      Belongs to 2 triangles with a dihedral angle >= featureAngle.
 * - Non-manifold edges: Belongs to > 2 triangles.
 * - Manifold edges:     Belongs to 2 triangles with a dihedral angle < featureAngle.
 */
export class FeatureEdges {
    constructor(options = {}) {
        this._input = options.input ?? null;
        this._featureAngle = options.featureAngle ?? 30; 
        this._boundaryEdges = options.boundaryEdges ?? true; 
        this._featureEdges = options.featureEdges ?? true;
        this._nonManifoldEdges = options.nonManifoldEdges ?? true;
        this._manifoldEdges = options.manifoldEdges ?? false;
        
        // Use |dot(n0, n1)| so tests are independent of face winding alignment
        this._windingIndependent = options.windingIndependent ?? true;
        
        // Remove interior shared faces before extracting edges (similar to vtkGeometryFilter)
        this._removeInteriorFaces = options.removeInteriorFaces ?? true;
        this._weldTolerance = options.weldTolerance ?? null;
        this._output = null;
        this._classified = null;
    }

    // ------------------------------------------------------------------
    // VTK-style API
    // ------------------------------------------------------------------

    setInputGeometry(geometry) { this._input = geometry; return this; }
    getInputGeometry() { return this._input; }

    setFeatureAngle(deg) { this._featureAngle = deg; return this; }
    getFeatureAngle() { return this._featureAngle; }

    setWeldTolerance(tol) { this._weldTolerance = tol; return this; }
    setWindingIndependent(on) { this._windingIndependent = !!on; return this; }
    setRemoveInteriorFaces(on) { this._removeInteriorFaces = !!on; return this; }

    setBoundaryEdges(on) { this._boundaryEdges = !!on; return this; }
    setFeatureEdges(on) { this._featureEdges = !!on; return this; }
    setNonManifoldEdges(on) { this._nonManifoldEdges = !!on; return this; }
    setManifoldEdges(on) { this._manifoldEdges = !!on; return this; }

    boundaryEdgesOn() { return this.setBoundaryEdges(true); }
    boundaryEdgesOff() { return this.setBoundaryEdges(false); }
    featureEdgesOn() { return this.setFeatureEdges(true); }
    featureEdgesOff() { return this.setFeatureEdges(false); }
    nonManifoldEdgesOn() { return this.setNonManifoldEdges(true); }
    nonManifoldEdgesOff() { return this.setNonManifoldEdges(false); }
    manifoldEdgesOn() { return this.setManifoldEdges(true); }
    manifoldEdgesOff() { return this.setManifoldEdges(false); }

    update() {
        if (!this._input || !this._input.getAttribute("position")) {
            this._output = new THREE.BufferGeometry();
            this._classified = null;
            return this;
        }
        this._output = this._extract(this._input);
        return this;
    }

    getOutput() {
        if (!this._output) this.update();
        return this._output;
    }

    getClassifiedEdges() { return this._classified; }

    static extract(geometry, options = {}) {
        return new FeatureEdges({ ...options, input: geometry }).update().getOutput();
    }

    // ------------------------------------------------------------------
    // Core Algorithm Logic
    // ------------------------------------------------------------------

    _extract(srcGeom) {
        const tol = this._weldTolerance ?? FeatureEdges.computeWeldTolerance(srcGeom);
        const welded = this._weld(srcGeom, tol);
        const positions = welded.positions;

        const triangles = this._removeInteriorFaces
            ? this._extractSurfaceTriangles(welded.triangles, positions)
            : welded.triangles;

        const edgeMap = new Map(); // key "i_j" (i<j) -> { i, j, normals: [] }

        const vA = new THREE.Vector3();
        const vB = new THREE.Vector3();
        const vC = new THREE.Vector3();
        const cb = new THREE.Vector3();
        const ab = new THREE.Vector3();

        const addEdge = (i, j, normal) => {
            if (i === j) return;
            const key = i < j ? `${i}_${j}` : `${j}_${i}`;
            let rec = edgeMap.get(key);
            if (!rec) {
                rec = { i: Math.min(i, j), j: Math.max(i, j), normals: [] };
                edgeMap.set(key, rec);
            }
            rec.normals.push(normal);
        };

        for (let t = 0; t < triangles.length; t += 3) {
            const a = triangles[t];
            const b = triangles[t + 1];
            const c = triangles[t + 2];

            if (a === b || b === c || c === a) continue;

            vA.fromArray(positions, a * 3);
            vB.fromArray(positions, b * 3);
            vC.fromArray(positions, c * 3);

            cb.subVectors(vC, vB);
            ab.subVectors(vA, vB);
            const n = new THREE.Vector3().crossVectors(cb, ab);

            const lenSq = n.lengthSq();
            if (lenSq < 1e-20) continue;
            n.multiplyScalar(1 / Math.sqrt(lenSq));

            addEdge(a, b, n);
            addEdge(b, c, n);
            addEdge(c, a, n);
        }

        const cosFeature = Math.cos(THREE.MathUtils.degToRad(this._featureAngle));

        const boundary = [];
        const feature = [];
        const nonManifold = [];
        const manifold = [];

        for (const rec of edgeMap.values()) {
            const n = rec.normals.length;
            if (n === 1) {
                boundary.push(rec.i, rec.j);
            } else if (n === 2) {
                let dot = rec.normals[0].dot(rec.normals[1]);
                if (this._windingIndependent) dot = Math.abs(dot);
                if (dot <= cosFeature) feature.push(rec.i, rec.j);
                else manifold.push(rec.i, rec.j);
            } else {
                nonManifold.push(rec.i, rec.j);
            }
        }

        this._classified = { positions, boundary, feature, nonManifold, manifold };

        const selected = [];
        if (this._boundaryEdges) selected.push(boundary);
        if (this._featureEdges) selected.push(feature);
        if (this._nonManifoldEdges) selected.push(nonManifold);
        if (this._manifoldEdges) selected.push(manifold);

        let total = 0;
        for (const arr of selected) total += arr.length;

        const outPositions = new Float32Array(total * 3);
        let w = 0;
        for (const arr of selected) {
            for (let k = 0; k < arr.length; k++) {
                const vi = arr[k] * 3;
                outPositions[w++] = positions[vi];
                outPositions[w++] = positions[vi + 1];
                outPositions[w++] = positions[vi + 2];
            }
        }

        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.BufferAttribute(outPositions, 3));
        return g;
    }

    // ------------------------------------------------------------------
    // Interior Face Removal (Solid Mesh Outer Shell Extraction)
    // ------------------------------------------------------------------

    _extractSurfaceTriangles(triangles, positions) {
        const sort3Key = (a, b, c) => {
            let lo = a, mid = b, hi = c, t;
            if (lo > mid) { t = lo; lo = mid; mid = t; }
            if (mid > hi) { t = mid; mid = hi; hi = t; }
            if (lo > mid) { t = lo; lo = mid; mid = t; }
            return `${lo}_${mid}_${hi}`;
        };

        // Pass 1: Deduplicate matching triangle topologies
        const faceCount = new Map();
        for (let t = 0; t < triangles.length; t += 3) {
            const key = sort3Key(triangles[t], triangles[t + 1], triangles[t + 2]);
            faceCount.set(key, (faceCount.get(key) || 0) + 1);
        }

        const kept = [];
        for (let t = 0; t < triangles.length; t += 3) {
            const a = triangles[t], b = triangles[t + 1], c = triangles[t + 2];
            if (faceCount.get(sort3Key(a, b, c)) === 1) kept.push([a, b, c]);
        }

        // Pass 2: Deduplicate overlapping quads with different diagonal cuts
        const vA = new THREE.Vector3(), vB = new THREE.Vector3(), vC = new THREE.Vector3();
        const cb = new THREE.Vector3(), ab = new THREE.Vector3();
        const normals = new Array(kept.length);
        for (let i = 0; i < kept.length; i++) {
            const [a, b, c] = kept[i];
            vA.fromArray(positions, a * 3);
            vB.fromArray(positions, b * 3);
            vC.fromArray(positions, c * 3);
            cb.subVectors(vC, vB);
            ab.subVectors(vA, vB);
            const n = new THREE.Vector3().crossVectors(cb, ab);
            const lenSq = n.lengthSq();
            normals[i] = lenSq > 1e-20 ? n.multiplyScalar(1 / Math.sqrt(lenSq)) : null;
        }

        const edgeMap = new Map();
        for (let i = 0; i < kept.length; i++) {
            const [a, b, c] = kept[i];
            for (const [p, q] of [[a, b], [b, c], [c, a]]) {
                const key = p < q ? `${p}_${q}` : `${q}_${p}`;
                let arr = edgeMap.get(key);
                if (!arr) { arr = []; edgeMap.set(key, arr); }
                arr.push(i);
            }
        }

        const COPLANAR_DOT = 1 - 1e-4;
        const quadMap = new Map();
        const oppositeVertex = (tri, i, j) => {
            for (const v of tri) if (v !== i && v !== j) return v;
            return -1;
        };

        for (const [key, tris] of edgeMap) {
            if (tris.length !== 2) continue;
            const n0 = normals[tris[0]], n1 = normals[tris[1]];
            if (!n0 || !n1) continue;
            if (Math.abs(n0.dot(n1)) < COPLANAR_DOT) continue;

            const [iStr, jStr] = key.split("_");
            const ei = +iStr, ej = +jStr;
            const o0 = oppositeVertex(kept[tris[0]], ei, ej);
            const o1 = oppositeVertex(kept[tris[1]], ei, ej);
            if (o0 < 0 || o1 < 0 || o0 === o1) continue;

            const quad = [ei, ej, o0, o1].sort((x, y) => x - y);
            const quadKey = quad.join("_");
            let arr = quadMap.get(quadKey);
            if (!arr) { arr = []; quadMap.set(quadKey, arr); }
            arr.push(tris);
        }

        const removed = new Set();
        for (const pairs of quadMap.values()) {
            if (pairs.length >= 2) {
                for (const pair of pairs) {
                    removed.add(pair[0]);
                    removed.add(pair[1]);
                }
            }
        }

        const out = [];
        for (let i = 0; i < kept.length; i++) {
            if (removed.has(i)) continue;
            out.push(kept[i][0], kept[i][1], kept[i][2]);
        }
        return Uint32Array.from(out);
    }

    // ------------------------------------------------------------------
    // Vertex Welding (Spatial Hashing)
    // ------------------------------------------------------------------

    static computeWeldTolerance(geom) {
        if (!geom.boundingBox) geom.computeBoundingBox();
        const size = new THREE.Vector3();
        geom.boundingBox.getSize(size);
        const diag = size.length();
        return diag > 0 ? diag * 1e-4 : 1e-4;
    }

    _weld(src, tol) {
        const pos = src.getAttribute("position");
        const srcIndex = src.getIndex();
        const count = srcIndex ? srcIndex.count : pos.count;

        const cellSize = tol > 0 ? tol : 1e-4;
        const tolSq = cellSize * cellSize;
        const spatialHash = new Map();

        const uniquePositions = [];
        const triangles = new Uint32Array(count);
        const vertexCache = srcIndex ? new Int32Array(pos.count).fill(-1) : null;

        const findExisting = (x, y, z) => {
            const cx = Math.floor(x / cellSize);
            const cy = Math.floor(y / cellSize);
            const cz = Math.floor(z / cellSize);
            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dz = -1; dz <= 1; dz++) {
                        const bucket = spatialHash.get(`${cx + dx}_${cy + dy}_${cz + dz}`);
                        if (!bucket) continue;
                        for (const idx of bucket) {
                            const px = uniquePositions[idx * 3];
                            const py = uniquePositions[idx * 3 + 1];
                            const pz = uniquePositions[idx * 3 + 2];
                            const dSq = (x - px) ** 2 + (y - py) ** 2 + (z - pz) ** 2;
                            if (dSq <= tolSq) return idx;
                        }
                    }
                }
            }
            return -1;
        };

        for (let k = 0; k < count; k++) {
            const i = srcIndex ? srcIndex.getX(k) : k;

            if (vertexCache && vertexCache[i] !== -1) {
                triangles[k] = vertexCache[i];
                continue;
            }

            const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);

            let idx = findExisting(x, y, z);
            if (idx === -1) {
                idx = uniquePositions.length / 3;
                uniquePositions.push(x, y, z);

                const key = `${Math.floor(x / cellSize)}_${Math.floor(y / cellSize)}_${Math.floor(z / cellSize)}`;
                let bucket = spatialHash.get(key);
                if (!bucket) { bucket = []; spatialHash.set(key, bucket); }
                bucket.push(idx);
            }

            if (vertexCache) vertexCache[i] = idx;
            triangles[k] = idx;
        }

        return {
            positions: Float32Array.from(uniquePositions),
            triangles
        };
    }
}