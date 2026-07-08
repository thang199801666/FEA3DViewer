// Filters/externalSurfaceGeometry.js
import * as THREE from "three";

/**
 * Rút "mặt bao ngoài" (external / body surface) từ một geometry tam giác.
 *
 * @param {THREE.BufferGeometry} geometry                geometry đầu vào (không bị chỉnh sửa).
 * @param {object}  [opts]
 * @param {boolean} [opts.removeInternalWalls=true]      Bỏ mặt bị chia sẻ (vách trong / mặt nội bộ).
 * @param {boolean} [opts.keepOuterShell=false]          Chỉ giữ vỏ NGOÀI CÙNG (bỏ vỏ con rỗng bên trong).
 * @param {number|null} [opts.weldTolerance=null]        Dung sai hàn đỉnh theo vị trí; null => tự tính theo bbox.
 * @param {boolean} [opts.recomputeNormals=true]         Tính lại normal cho body mới.
 * @returns {THREE.BufferGeometry}                       geometry mới. Nếu không loại được gì -> trả nguyên bản.
 */
export function extractExternalSurfaceGeometry(geometry, opts = {}) {
    const {
        removeInternalWalls = true,
        keepOuterShell = false,
        weldTolerance = null,
        recomputeNormals = true,
    } = opts;

    const pos = geometry.getAttribute("position");
    if (!pos || pos.count < 3) return geometry;
    if (!removeInternalWalls && !keepOuterShell) return geometry;

    // ------------------------------------------------------------------
    // 1) Danh sách tam giác theo chỉ số đỉnh GỐC
    // ------------------------------------------------------------------
    const index = geometry.getIndex();
    const triCount = index ? (index.count / 3) : (pos.count / 3);
    const getVert = index ? (t, k) => index.getX(t * 3 + k) : (t, k) => t * 3 + k;

    // ------------------------------------------------------------------
    // 2) HÀN ĐỈNH CHUẨN XÁC: Duyệt 27 ô lân cận (Sửa lỗi Math.round làm sót vách)
    // ------------------------------------------------------------------
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    const bb = geometry.boundingBox;
    const diag = bb.min.distanceTo(bb.max) || 1;
    // Tăng dung sai hàn lên một chút (1e-5) để gom sạch các mặt trùng của phần tử FEA
    const tol = (weldTolerance != null && weldTolerance > 0) ? weldTolerance : diag * 1e-5;
    const tolSq = tol * tol;

    const cellSize = tol;
    const buckets = new Map();
    const vertCanon = new Int32Array(pos.count).fill(-1);
    let uniqueCanonCount = 0;

    const getCellKey = (x, y, z) => {
        return `${Math.floor(x / cellSize)},${Math.floor(y / cellSize)},${Math.floor(z / cellSize)}`;
    };

    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const z = pos.getZ(i);

        const cx = Math.floor(x / cellSize);
        const cy = Math.floor(y / cellSize);
        const cz = Math.floor(z / cellSize);

        let matchedId = -1;

        // Quét cấu trúc ô 3x3x3 xung quanh để tránh ranh giới làm tròn số float
        for (let dx = -1; dx <= 1 && matchedId < 0; dx++) {
            for (let dy = -1; dy <= 1 && matchedId < 0; dy++) {
                for (let dz = -1; dz <= 1 && matchedId < 0; dz++) {
                    const key = `${cx + dx},${cy + dy},${cz + dz}`;
                    const bucket = buckets.get(key);
                    if (!bucket) continue;

                    for (const otherId of bucket) {
                        const ox = pos.getX(otherId);
                        const oy = pos.getY(otherId);
                        const oz = pos.getZ(otherId);

                        const distSq = (x - ox) * (x - ox) + (y - oy) * (y - oy) + (z - oz) * (z - oz);
                        if (distSq <= tolSq) {
                            matchedId = vertCanon[otherId];
                            break;
                        }
                    }
                }
            }
        }

        // Nếu chưa từng có đỉnh nào gần tọa độ này, tạo một nhóm đỉnh Canonical mới
        if (matchedId < 0) {
            matchedId = uniqueCanonCount++;
            const currentKey = getCellKey(x, y, z);
            if (!buckets.has(currentKey)) buckets.set(currentKey, []);
            buckets.get(currentKey).push(i);
        }

        vertCanon[i] = matchedId;
    }

    // ------------------------------------------------------------------
    // 3) Đếm số lần xuất hiện diện tích tam giác theo Canonical ID mới
    // ------------------------------------------------------------------
    const faceCount = new Map();
    const faceKeys = new Array(triCount);
    const triCanon = new Array(triCount);

    for (let t = 0; t < triCount; t++) {
        const a = vertCanon[getVert(t, 0)];
        const b = vertCanon[getVert(t, 1)];
        const c = vertCanon[getVert(t, 2)];

        if (a === b || b === c || a === c) { faceKeys[t] = null; triCanon[t] = null; continue; }
        triCanon[t] = [a, b, c];

        let x = a, y = b, z = c, s;
        if (x > y) { s = x; x = y; y = s; }
        if (y > z) { s = y; y = z; z = s; }
        if (x > y) { s = x; x = y; y = s; }
        const key = x + "_" + y + "_" + z;
        faceKeys[t] = key;
        faceCount.set(key, (faceCount.get(key) || 0) + 1);
    }

    // ------------------------------------------------------------------
    // 4) Lọc bỏ vách trùng (Chỉ giữ mặt xuất hiện lẻ lần = mặt ngoài)
    // ------------------------------------------------------------------
    let keptTris = [];
    if (removeInternalWalls) {
        for (let t = 0; t < triCount; t++) {
            const key = faceKeys[t];
            if (!key) continue;
            if ((faceCount.get(key) & 1) === 1) keptTris.push(t);
        }
    } else {
        for (let t = 0; t < triCount; t++) if (faceKeys[t]) keptTris.push(t);
    }

    if (!keepOuterShell && keptTris.length === triCount) return geometry;

    // ------------------------------------------------------------------
    // 5) Tách vỏ liên thông (Nếu có bật)
    // ------------------------------------------------------------------
    if (keepOuterShell && keptTris.length > 0) {
        keptTris = filterOutermostShell(keptTris, triCanon, getVert, pos, uniqueCanonCount);
    }

    // ------------------------------------------------------------------
    // 6) Tái cấu trúc cấu trúc BufferGeometry mới sạch sẽ
    // ------------------------------------------------------------------
    const out = new THREE.BufferGeometry();
    for (const name of Object.keys(geometry.attributes)) {
        out.setAttribute(name, geometry.attributes[name].clone());
    }

    const newIndex = new Uint32Array(keptTris.length * 3);
    for (let i = 0; i < keptTris.length; i++) {
        const t = keptTris[i];
        newIndex[i * 3 + 0] = getVert(t, 0);
        newIndex[i * 3 + 1] = getVert(t, 1);
        newIndex[i * 3 + 2] = getVert(t, 2);
    }
    out.setIndex(new THREE.BufferAttribute(newIndex, 1));

    if (recomputeNormals) out.computeVertexNormals();

    return out;
}

function filterOutermostShell(keptTris, triCanon, getVert, pos, canonCount) {
    const parent = new Int32Array(canonCount);
    for (let i = 0; i < canonCount; i++) parent[i] = i;
    const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };

    for (const t of keptTris) {
        const c = triCanon[t];
        if (!c) continue;
        union(c[0], c[1]);
        union(c[1], c[2]);
    }

    const boxes = new Map();
    const expand = (root, vi) => {
        const x = pos.getX(vi), y = pos.getY(vi), z = pos.getZ(vi);
        let b = boxes.get(root);
        if (!b) { b = { minX: x, minY: y, minZ: z, maxX: x, maxY: y, maxZ: z }; boxes.set(root, b); return; }
        if (x < b.minX) b.minX = x; if (y < b.minY) b.minY = y; if (z < b.minZ) b.minZ = z;
        if (x > b.maxX) b.maxX = x; if (y > b.maxY) b.maxY = y; if (z > b.maxZ) b.maxZ = z;
    };

    for (const t of keptTris) {
        const c = triCanon[t];
        if (!c) continue;
        const root = find(c[0]);
        expand(root, getVert(t, 0));
        expand(root, getVert(t, 1));
        expand(root, getVert(t, 2));
    }

    let bestRoot = -1, bestDiag = -1;
    for (const [root, b] of boxes) {
        const dx = b.maxX - b.minX, dy = b.maxY - b.minY, dz = b.maxZ - b.minZ;
        const d = dx * dx + dy * dy + dz * dz;
        if (d > bestDiag) { bestDiag = d; bestRoot = root; }
    }
    if (bestRoot === -1) return keptTris;

    return keptTris.filter((t) => {
        const c = triCanon[t];
        return c && find(c[0]) === bestRoot;
    });
}