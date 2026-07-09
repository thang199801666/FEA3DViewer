// geometry/surfaceVisibility.js
import * as THREE from "three";
import { MeshBVH } from "three-mesh-bvh";
import { weldVertices } from "./weld.js";

/** Generates N uniformly distributed points on a sphere using a Fibonacci lattice. */
function fibonacciSphere(n) {
    const pts = [];
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < n; i++) {
        const y = n === 1 ? 0 : 1 - (i / (n - 1)) * 2;
        const r = Math.sqrt(Math.max(0, 1 - y * y));
        const th = golden * i;
        pts.push(new THREE.Vector3(Math.cos(th) * r, y, Math.sin(th) * r).normalize());
    }
    return pts;
}

/**
 * Extracts the visible external surface by raycasting outward from triangle centroids.
 *
 * @param {THREE.BufferGeometry} geometry
 * @param {object} [opts]
 * @param {number|null} [opts.weldTolerance=null]
 * @param {boolean} [opts.dedupeCoincident=true] - Merges perfectly overlapping triangles.
 * @param {number} [opts.rayCount=64] - Number of ray samples per triangle.
 * @param {number} [opts.escapeConeAngle=72] - Sampling cone angle around the normal (degrees).
 * @param {boolean} [opts.testBothSides=true] - Retains face if visible from either front or back side.
 * @param {boolean} [opts.recomputeNormals=true]
 * @returns {THREE.BufferGeometry}
 */
export function extractByVisibility(geometry, opts = {}) {
    const {
        weldTolerance = null,
        dedupeCoincident = true,
        rayCount = 64,
        escapeConeAngle = 72,
        testBothSides = true,
        recomputeNormals = true,
        rayEpsScale = 1e-4,
    } = opts;

    const pos = geometry.getAttribute("position");
    if (!pos || pos.count < 3) return geometry;

    const index = geometry.getIndex();
    const triCount = index ? index.count / 3 : pos.count / 3;
    const vertOf = index ? (t, k) => index.getX(t * 3 + k) : (t, k) => t * 3 + k;

    if (!geometry.boundingBox) geometry.computeBoundingBox();
    const { canon } = weldVertices(pos, {
        tolerance: weldTolerance,
        boundingBox: geometry.boundingBox,
    });

    // Deduplicate perfectly coincident triangles (keeping 1 instance)
    const candidates = [];
    if (dedupeCoincident) {
        const seen = new Set();
        for (let t = 0; t < triCount; t++) {
            let a = canon[vertOf(t, 0)], b = canon[vertOf(t, 1)], c = canon[vertOf(t, 2)], s;
            if (a === b || b === c || a === c) continue;
            if (a > b) { s = a; a = b; b = s; }
            if (b > c) { s = b; b = c; c = s; }
            if (a > b) { s = a; a = b; b = s; }
            const fk = `${a}_${b}_${c}`;
            if (seen.has(fk)) continue;
            seen.add(fk);
            candidates.push(t);
        }
    } else {
        for (let t = 0; t < triCount; t++) candidates.push(t);
    }

    // Build BVH Occluder Mesh
    const occIndex = new Uint32Array(candidates.length * 3);
    for (let i = 0; i < candidates.length; i++) {
        const t = candidates[i];
        occIndex[i * 3] = vertOf(t, 0);
        occIndex[i * 3 + 1] = vertOf(t, 1);
        occIndex[i * 3 + 2] = vertOf(t, 2);
    }
    const occGeom = new THREE.BufferGeometry();
    occGeom.setAttribute("position", pos);
    occGeom.setIndex(new THREE.BufferAttribute(occIndex, 1));
    const bvh = new MeshBVH(occGeom);

    occGeom.computeBoundingSphere();
    const R = occGeom.boundingSphere.radius || 1;
    const escapeDist = R * 2.2;
    const eps = R * rayEpsScale;
    const cosCone = Math.cos(THREE.MathUtils.degToRad(escapeConeAngle));
    const dirs = fibonacciSphere(Math.max(8, rayCount | 0));

    const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
    const centroid = new THREE.Vector3(), normal = new THREE.Vector3();
    const e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
    const originBase = new THREE.Vector3(), origin = new THREE.Vector3();
    const ray = new THREE.Ray();

    const kept = [];
    const sides = testBothSides ? [1, -1] : [1];

    for (const t of candidates) {
        A.fromBufferAttribute(pos, vertOf(t, 0));
        B.fromBufferAttribute(pos, vertOf(t, 1));
        C.fromBufferAttribute(pos, vertOf(t, 2));
        centroid.copy(A).add(B).add(C).multiplyScalar(1 / 3);
        e1.subVectors(B, A); e2.subVectors(C, A);
        normal.crossVectors(e1, e2);
        if (normal.lengthSq() < 1e-20) continue;
        normal.normalize();

        let visible = false;
        for (const s of sides) {
            const nx = normal.x * s, ny = normal.y * s, nz = normal.z * s;
            originBase.set(centroid.x + nx * eps, centroid.y + ny * eps, centroid.z + nz * eps);
            for (const dir of dirs) {
                if (dir.x * nx + dir.y * ny + dir.z * nz < cosCone) continue; // Outside sampling cone
                origin.copy(dir).multiplyScalar(eps).add(originBase);
                ray.origin.copy(origin);
                ray.direction.copy(dir);
                
                const hit = bvh.raycastFirst(ray, THREE.DoubleSide);
                if (!hit || hit.distance > escapeDist) { 
                    visible = true; 
                    break; 
                }
            }
            if (visible) break;
        }
        if (visible) kept.push(t);
    }

    if (kept.length === triCount) return geometry;

    const out = new THREE.BufferGeometry();
    for (const name of Object.keys(geometry.attributes)) {
        out.setAttribute(name, geometry.attributes[name].clone());
    }
    
    const newIndex = new Uint32Array(kept.length * 3);
    for (let i = 0; i < kept.length; i++) {
        const t = kept[i];
        newIndex[i * 3] = vertOf(t, 0);
        newIndex[i * 3 + 1] = vertOf(t, 1);
        newIndex[i * 3 + 2] = vertOf(t, 2);
    }
    out.setIndex(new THREE.BufferAttribute(newIndex, 1));
    out.userData.keptTriangles = Uint32Array.from(kept);
    out.userData.sourceCellMap = geometry.userData?.cellMap ?? null;
    
    if (recomputeNormals) out.computeVertexNormals();
    return out;
}