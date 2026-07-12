// geometry/surfaceTopology.js
import * as THREE from "three";
import { weldVertices } from "./weld.js";

/**
 * Extracts the external surface of a geometry using topological parity analysis.
 *
 * @param {THREE.BufferGeometry} geometry - Input geometry (not modified).
 * @param {object} [opts]
 * @param {boolean} [opts.removeInternalWalls=true] - If true, discards shared internal faces.
 * @param {boolean} [opts.keepOuterShell=false] - If true, retains only the largest connected component.
 * @param {number|null} [opts.weldTolerance=null] - Tolerance for vertex welding.
 * @param {boolean} [opts.recomputeNormals=true] - If true, updates vertex normals on output mesh.
 * @returns {THREE.BufferGeometry} New extracted surface geometry, or original if no modifications occurred.
 */

export function extractByTopology(geometry, opts = {}) {
    const {
        removeInternalWalls = true,
        keepOuterShell = false,
        weldTolerance = null,
        recomputeNormals = true,
    } = opts;

    const pos = geometry.getAttribute("position");
    if (!pos || pos.count < 3) return geometry;
    if (!removeInternalWalls && !keepOuterShell) return geometry;

    // --- FIX: ESCAPE IF GEOMETRY IS EXPLICITLY LINE/POINT DATA ---
    if (
        geometry.isLineSegments2 || 
        geometry.isLineSegments || 
        geometry.userData?.primitiveType === "line" ||
        geometry.userData?.isLine === true
    ) {
        return geometry;
    }
    // -------------------------------------------------------------

    const index = geometry.getIndex();
    const triCount = Math.floor(index ? index.count / 3 : pos.count / 3);
    const vertOf = index ? (t, k) => index.getX(t * 3 + k) : (t, k) => t * 3 + k;

    if (!geometry.boundingBox) geometry.computeBoundingBox();
    const { canon, count: canonCount } = weldVertices(pos, {
        tolerance: weldTolerance,
        boundingBox: geometry.boundingBox,
    });

    // Count face occurrences using unique canonical IDs (winding independent)
    const faceCount = new Map();
    const faceKey = new Array(triCount);
    const triCanon = new Array(triCount);

    for (let t = 0; t < triCount; t++) {
        const a = canon[vertOf(t, 0)];
        const b = canon[vertOf(t, 1)];
        const c = canon[vertOf(t, 2)];
        
        // Skip degenerate triangles
        if (a === b || b === c || a === c) {
            faceKey[t] = null;
            triCanon[t] = null;
            continue;
        }
        
        triCanon[t] = [a, b, c];
        let x = a, y = b, z = c, s;
        if (x > y) { s = x; x = y; y = s; }
        if (y > z) { s = y; y = z; z = s; }
        if (x > y) { s = x; x = y; y = s; }
        
        const key = `${x}_${y}_${z}`;
        faceKey[t] = key;
        faceCount.set(key, (faceCount.get(key) || 0) + 1);
    }

    // Keep faces that appear an ODD number of times (boundary faces)
    let kept = [];
    if (removeInternalWalls) {
        const emitted = new Set();
        for (let t = 0; t < triCount; t++) {
            const key = faceKey[t];
            if (!key) continue;
            if ((faceCount.get(key) & 1) !== 1) continue;
            if (emitted.has(key)) continue; 
            emitted.add(key);
            kept.push(t);
        }
    } else {
        for (let t = 0; t < triCount; t++) {
            if (faceKey[t]) kept.push(t);
        }
    }

    if (keepOuterShell && kept.length > 0) {
        kept = filterOutermostShell(kept, triCanon, vertOf, pos, canonCount);
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

/** Union-find on canonical vertices to retain the connected component with the largest bounding box. */
function filterOutermostShell(kept, triCanon, vertOf, pos, canonCount) {
    const parent = new Int32Array(canonCount);
    for (let i = 0; i < canonCount; i++) parent[i] = i;
    
    const find = (x) => { 
        while (parent[x] !== x) { 
            parent[x] = parent[parent[x]]; 
            x = parent[x]; 
        } 
        return x; 
    };
    
    const union = (a, b) => { 
        const ra = find(a), rb = find(b); 
        if (ra !== rb) parent[ra] = rb; 
    };

    for (const t of kept) {
        const c = triCanon[t];
        if (!c) continue;
        union(c[0], c[1]);
        union(c[1], c[2]);
    }

    const boxes = new Map();
    const expand = (root, vi) => {
        const x = pos.getX(vi), y = pos.getY(vi), z = pos.getZ(vi);
        let b = boxes.get(root);
        if (!b) { 
            boxes.set(root, { minX: x, minY: y, minZ: z, maxX: x, maxY: y, maxZ: z }); 
            return; 
        }
        if (x < b.minX) b.minX = x; if (y < b.minY) b.minY = y; if (z < b.minZ) b.minZ = z;
        if (x > b.maxX) b.maxX = x; if (y > b.maxY) b.maxY = y; if (z > b.maxZ) b.maxZ = z;
    };
    
    for (const t of kept) {
        const c = triCanon[t];
        if (!c) continue;
        const root = find(c[0]);
        expand(root, vertOf(t, 0));
        expand(root, vertOf(t, 1));
        expand(root, vertOf(t, 2));
    }

    let bestRoot = -1, bestDiag = -1;
    for (const [root, b] of boxes) {
        const d = (b.maxX - b.minX) ** 2 + (b.maxY - b.minY) ** 2 + (b.maxZ - b.minZ) ** 2;
        if (d > bestDiag) { 
            bestDiag = d; 
            bestRoot = root; 
        }
    }
    
    if (bestRoot === -1) return kept;
    return kept.filter((t) => triCanon[t] && find(triCanon[t][0]) === bestRoot);
}