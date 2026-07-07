// Core/Conversion.js
// Chuyển đổi THREE.BufferGeometry -> PolyData (chiều ngược lại do PolyDataMapper đảm nhiệm)

import { PolyData } from "./PolyData.js";

/**
 * Chuyển 1 THREE.BufferGeometry (mesh tam giác) thành PolyData
 * để có thể đưa vào pipeline Filter/Mapper của threejsVTK.
 */
export function geometryToPolyData(geometry) {
    const pd = new PolyData();
    const pos = geometry.getAttribute("position");
    if (!pos) throw new Error("Geometry không có attribute 'position'");

    pd.setPoints(new Float32Array(pos.array.slice(0, pos.count * 3)));

    if (geometry.index) {
        const idx = geometry.index.array;
        for (let i = 0; i + 2 < idx.length; i += 3) {
            pd.polys.push([idx[i], idx[i + 1], idx[i + 2]]);
        }
    } else {
        // non-indexed: mỗi 3 đỉnh liên tiếp là 1 tam giác
        const n = pos.count;
        for (let i = 0; i + 2 < n; i += 3) {
            pd.polys.push([i, i + 1, i + 2]);
        }
    }
    return pd;
}