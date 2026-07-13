// core/conversion.js

import * as THREE from "three";
import { PolyData } from "./PolyData.js";
import { UnstructuredGrid } from "./UnstructuredGrid.js";

/**
 * Normalizes any supported DataSet type to a surface PolyData representation.
 */
export function toSurfacePolyData(dataSet, { passCellData = true } = {}) {
    if (dataSet instanceof PolyData) return dataSet;
    if (dataSet instanceof UnstructuredGrid) return dataSet.extractSurface({ passCellData });
    if (dataSet && dataSet.points) {
        const pd = new PolyData();
        pd.setPoints(Float32Array.from(dataSet.points));
        return pd;
    }
    throw new TypeError(
        `toSurfacePolyData: Unrecognized DataSet type (${dataSet?.constructor?.name ?? dataSet})`
    );
}

/**
 * Converts PolyData into THREE.BufferGeometry (positions and indices).
 * Maps original cell IDs to triangles via userData.cellMap for picking support.
 */
export function polyDataToGeometry(polyData) {
    const g = new THREE.BufferGeometry();
    const points = polyData.points instanceof Float32Array
        ? polyData.points
        : Float32Array.from(polyData.points);
    g.setAttribute("position", new THREE.BufferAttribute(points, 3));

    // Size the output up front (VTK-style preallocate-then-fill) instead of
    // push-growing a plain array and converting to typed arrays afterward —
    // avoids repeated backing-store reallocation for large meshes.
    let triCount = 0;
    for (const cell of polyData.polys) triCount += Math.max(0, cell.length - 2);
    for (const strip of polyData.strips) triCount += Math.max(0, strip.length - 2);

    const idx = new Uint32Array(triCount * 3);
    const cellMap = new Int32Array(triCount);
    let w = 0, ci = 0, cellId = 0;

    for (const cell of polyData.polys) {
        for (let i = 1; i + 1 < cell.length; i++) {
            idx[w++] = cell[0]; idx[w++] = cell[i]; idx[w++] = cell[i + 1];
            cellMap[ci++] = cellId;
        }
        cellId++;
    }

    for (const strip of polyData.strips) {
        for (let i = 0; i + 2 < strip.length; i++) {
            if (i % 2 === 0) { idx[w++] = strip[i]; idx[w++] = strip[i + 1]; idx[w++] = strip[i + 2]; }
            else { idx[w++] = strip[i + 1]; idx[w++] = strip[i]; idx[w++] = strip[i + 2]; }
            cellMap[ci++] = cellId;
        }
        cellId++;
    }

    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.userData.cellMap = cellMap;
    return g;
}

/**
 * Builds the resulting PolyData from extracted geometry data, mapping original attributes.
 */
export function polyDataFromExtracted(source, geometry) {
    if (!geometry.userData?.keptTriangles) return source;

    const out = new PolyData();
    out.setPoints(Float32Array.from(source.points));

    const index = geometry.getIndex();
    const triCount = index.count / 3;
    const polys = new Array(triCount);
    for (let t = 0; t < triCount; t++) {
        polys[t] = [index.getX(t * 3), index.getX(t * 3 + 1), index.getX(t * 3 + 2)];
    }
    out.setPolys(polys);

    out.pointData = source.pointData.clone();

    const srcCellMap = geometry.userData.sourceCellMap;
    const kept = geometry.userData.keptTriangles;
    if (srcCellMap && source.cellData?.getArrayNames?.().length) {
        out.cellData = remapCellData(source.cellData, kept, srcCellMap);
    }
    return out;
}

function remapCellData(cellData, keptTriangles, sourceCellMap) {
    const out = cellData.clone();
    for (const name of cellData.getArrayNames()) {
        const src = cellData.getArray(name);
        const nc = src.numberOfComponents;
        const values = new src.values.constructor(keptTriangles.length * nc);
        for (let i = 0; i < keptTriangles.length; i++) {
            const cell = sourceCellMap[keptTriangles[i]];
            for (let c = 0; c < nc; c++) values[i * nc + c] = src.values[cell * nc + c];
        }
        out.getArray(name).values = values;
    }
    return out;
}

/**
 * Converts THREE.BufferGeometry into PolyData.
 */
export function geometryToPolyData(geometry) {
    const pd = new PolyData();
    const pos = geometry.getAttribute("position");
    if (!pos) throw new Error("Geometry is missing 'position' attribute");
    pd.setPoints(pos.array.slice(0, pos.count * 3));

    const polys = [];
    if (geometry.index) {
        const idx = geometry.index.array;
        for (let i = 0; i + 2 < idx.length; i += 3) polys.push([idx[i], idx[i + 1], idx[i + 2]]);
    } else {
        for (let i = 0; i + 2 < pos.count; i += 3) polys.push([i, i + 1, i + 2]);
    }
    pd.setPolys(polys);
    return pd;
}



























// // core/conversion.js

// import * as THREE from "three";
// import { PolyData } from "./PolyData.js";
// import { UnstructuredGrid } from "./UnstructuredGrid.js";

// /**
//  * Normalizes any supported DataSet type to a surface PolyData representation.
//  */
// export function toSurfacePolyData(dataSet, { passCellData = true } = {}) {
//     if (dataSet instanceof PolyData) return dataSet;
//     if (dataSet instanceof UnstructuredGrid) return dataSet.extractSurface({ passCellData });
//     if (dataSet && dataSet.points) {
//         const pd = new PolyData();
//         pd.setPoints(Float32Array.from(dataSet.points));
//         return pd;
//     }
//     throw new TypeError(
//         `toSurfacePolyData: Unrecognized DataSet type (${dataSet?.constructor?.name ?? dataSet})`
//     );
// }

// /**
//  * Converts PolyData into THREE.BufferGeometry (positions and indices).
//  * Maps original cell IDs to triangles via userData.cellMap for picking support.
//  */
// export function polyDataToGeometry(polyData) {
//     const g = new THREE.BufferGeometry();
//     const points = polyData.points instanceof Float32Array
//         ? polyData.points
//         : Float32Array.from(polyData.points);
//     g.setAttribute("position", new THREE.BufferAttribute(points, 3));

//     // Size the output up front (VTK-style preallocate-then-fill) instead of
//     // push-growing a plain array and converting to typed arrays afterward —
//     // avoids repeated backing-store reallocation for large meshes.
//     let triCount = 0;
//     for (const cell of polyData.polys) triCount += Math.max(0, cell.length - 2);
//     for (const strip of polyData.strips) triCount += Math.max(0, strip.length - 2);

//     const idx = new Uint32Array(triCount * 3);
//     const cellMap = new Int32Array(triCount);
//     let w = 0, ci = 0, cellId = 0;

//     for (const cell of polyData.polys) {
//         for (let i = 1; i + 1 < cell.length; i++) {
//             idx[w++] = cell[0]; idx[w++] = cell[i]; idx[w++] = cell[i + 1];
//             cellMap[ci++] = cellId;
//         }
//         cellId++;
//     }

//     for (const strip of polyData.strips) {
//         for (let i = 0; i + 2 < strip.length; i++) {
//             if (i % 2 === 0) { idx[w++] = strip[i]; idx[w++] = strip[i + 1]; idx[w++] = strip[i + 2]; }
//             else { idx[w++] = strip[i + 1]; idx[w++] = strip[i]; idx[w++] = strip[i + 2]; }
//             cellMap[ci++] = cellId;
//         }
//         cellId++;
//     }

//     g.setIndex(new THREE.BufferAttribute(idx, 1));
//     g.userData.cellMap = cellMap;
//     return g;
// }

// /**
//  * Builds the resulting PolyData from extracted geometry data, mapping original attributes.
//  */
// export function polyDataFromExtracted(source, geometry) {
//     if (!geometry.userData?.keptTriangles) return source;

//     const out = new PolyData();
//     out.setPoints(Float32Array.from(source.points));

//     const index = geometry.getIndex();
//     const triCount = index.count / 3;
//     out.polys = [];
//     for (let t = 0; t < triCount; t++) {
//         out.polys.push([index.getX(t * 3), index.getX(t * 3 + 1), index.getX(t * 3 + 2)]);
//     }

//     out.pointData = source.pointData.clone();

//     const srcCellMap = geometry.userData.sourceCellMap;
//     const kept = geometry.userData.keptTriangles;
//     if (srcCellMap && source.cellData?.getArrayNames?.().length) {
//         out.cellData = remapCellData(source.cellData, kept, srcCellMap);
//     }
//     return out;
// }

// function remapCellData(cellData, keptTriangles, sourceCellMap) {
//     const out = cellData.clone();
//     for (const name of cellData.getArrayNames()) {
//         const src = cellData.getArray(name);
//         const nc = src.numberOfComponents;
//         const values = new src.values.constructor(keptTriangles.length * nc);
//         for (let i = 0; i < keptTriangles.length; i++) {
//             const cell = sourceCellMap[keptTriangles[i]];
//             for (let c = 0; c < nc; c++) values[i * nc + c] = src.values[cell * nc + c];
//         }
//         out.getArray(name).values = values;
//     }
//     return out;
// }

// /**
//  * Converts THREE.BufferGeometry into PolyData.
//  */
// export function geometryToPolyData(geometry) {
//     const pd = new PolyData();
//     const pos = geometry.getAttribute("position");
//     if (!pos) throw new Error("Geometry is missing 'position' attribute");
//     pd.setPoints(pos.array.slice(0, pos.count * 3));

//     if (geometry.index) {
//         const idx = geometry.index.array;
//         for (let i = 0; i + 2 < idx.length; i += 3) pd.polys.push([idx[i], idx[i + 1], idx[i + 2]]);
//     } else {
//         for (let i = 0; i + 2 < pos.count; i += 3) pd.polys.push([i, i + 1, i + 2]);
//     }
//     return pd;
// }