// Core/UnstructuredGrid.js

import { DataSet } from "./DataSet.js";
import { PolyData } from "./PolyData.js";
import { DataArray } from "./FieldData.js";
import { Algorithm } from "./Algorithm.js";
import {
    CellType, CELL_FACES, CELL_NUM_CORNERS, isSolidCell, is2DCell,
} from "./CellTypes.js";
import { tryExtractSurfaceWasm } from "../wasm/surfaceExtractorWasm.js";

/**
 * vtkDataSetSurfaceFilter equivalent: extracts external boundary faces of
 * solid volumes and 2D components from an UnstructuredGrid into surface
 * PolyData. Implemented as an Algorithm so repeated extraction with an
 * unchanged input/parameters (the common case — e.g. re-rendering the same
 * mesh every frame) is served from cache instead of re-walking every cell's
 * faces. UnstructuredGrid.extractSurface() below is the convenience
 * entry point that owns one of these per grid.
 */
export class ExtractSurfaceFilter extends Algorithm {
    constructor() {
        super();
        this._passCellData = true;
    }

    setPassCellData(v) {
        if (this._passCellData !== v) {
            this._passCellData = v;
            this.modified();
        }
        return this;
    }

    getPassCellData() {
        return this._passCellData;
    }

    requestData(input) {
        if (!input) throw new Error("ExtractSurfaceFilter: no input set (call setInputData() first)");
        const output = tryExtractSurfaceWasm(input, this._passCellData)
            ?? computeSurface(input, this._passCellData);
        output.userData = output.userData || {};
        output.userData.hasVolumeCells = Array.from(input.cellTypes).some(isSolidCell);
        output.userData.hasSurfaceCells = Array.from(input.cellTypes).some(is2DCell);
        return output;
    }
}

/** Core face-extraction algorithm, factored out of the filter so it can be
 *  unit-tested / called directly without going through the pipeline. */
function computeSurface(grid, passCellData) {
    const faceMap = new Map();
    const surfacePolys = [];
    const surfaceStrips = [];

    // Reused scratch buffer for the sorted-vertex hash key (max 4 verts/face
    // across all supported solid cell types). Avoids allocating + spreading
    // + Array.prototype.sort()'ing a new array for every single face.
    const keyBuf = new Int32Array(4);

    const nCells = grid.getNumberOfCells();
    for (let ci = 0; ci < nCells; ci++) {
        const type = grid.cellTypes[ci];
        const start = grid.offsets[ci];
        const conn = grid.connectivity;

        if (type === CellType.TRIANGLE_STRIP) {
            const nC = grid.offsets[ci + 1] - start;
            const verts = new Array(nC);
            for (let k = 0; k < nC; k++) verts[k] = conn[start + k];
            surfaceStrips.push({ verts, srcCell: ci });
            continue;
        }

        if (is2DCell(type)) {
            const nC = grid.offsets[ci + 1] - start;
            const verts = new Array(nC);
            for (let k = 0; k < nC; k++) verts[k] = conn[start + k];
            surfacePolys.push({ verts, srcCell: ci });
            continue;
        }
        if (!isSolidCell(type)) continue;

        const faces = CELL_FACES[type];
        const nCorner = CELL_NUM_CORNERS[type] ?? (grid.offsets[ci + 1] - start);

        for (const face of faces) {
            const fn = face.length;
            let skip = false;
            for (let k = 0; k < fn; k++) {
                if (face[k] >= nCorner) { skip = true; break; }
                keyBuf[k] = conn[start + face[k]];
            }
            if (skip) continue;

            // Manual insertion sort over <=4 elements: for this size it beats
            // Array.prototype.sort()'s comparator-call overhead, and operates
            // in place on a reused buffer instead of a fresh array per face.
            for (let a = 1; a < fn; a++) {
                const v = keyBuf[a];
                let b = a - 1;
                while (b >= 0 && keyBuf[b] > v) { keyBuf[b + 1] = keyBuf[b]; b--; }
                keyBuf[b + 1] = v;
            }
            let key = keyBuf[0];
            for (let k = 1; k < fn; k++) key = key + "," + keyBuf[k];

            const existing = faceMap.get(key);
            if (existing) {
                existing.count++;
            } else {
                // Winding order matters for the output normal, so this copy
                // (unlike keyBuf) must preserve the original face ordering.
                const verts = new Array(fn);
                for (let k = 0; k < fn; k++) verts[k] = conn[start + face[k]];
                faceMap.set(key, { count: 1, verts, srcCell: ci });
            }
        }
    }

    for (const f of faceMap.values()) {
        if (f.count === 1) surfacePolys.push({ verts: f.verts, srcCell: f.srcCell });
    }

    const out = new PolyData();
    out.setPoints(Float32Array.from(grid.points));
    out.setPolys(surfacePolys.map(p => p.verts));
    out.setStrips(surfaceStrips.map(p => p.verts));

    // `cells` reconstructs full source-cell connectivity per surface face —
    // useful for some picking/inspection workflows, but expensive to build
    // and frequently never read. Compute it lazily, on first access, so the
    // common case (just rendering the surface) doesn't pay for it.
    let cellsCache = null;
    const srcConn = grid.connectivity, srcOffsets = grid.offsets, srcTypes = grid.cellTypes;
    Object.defineProperty(out, "cells", {
        configurable: true,
        enumerable: true,
        get() {
            if (!cellsCache) {
                cellsCache = surfacePolys.map(p => ({
                    type: srcTypes[p.srcCell],
                    points: Array.from(srcConn.subarray(srcOffsets[p.srcCell], srcOffsets[p.srcCell + 1])),
                }));
            }
            return cellsCache;
        },
        set(v) { cellsCache = v; },
    });

    out.userData = out.userData || {};
    out.userData.surfaceCellMap = [...surfacePolys, ...surfaceStrips].map(p => p.srcCell);
    out.userData.polySourceCellMap = Int32Array.from(surfacePolys.map(p => p.srcCell));
    out.userData.stripSourceCellMap = Int32Array.from(surfaceStrips.map(p => p.srcCell));

    for (const a of grid.pointData.arrays.values()) {
        out.pointData.addArray(a.clone(), {
            asScalars: grid.pointData.activeScalars === a.name,
            asVectors: grid.pointData.activeVectors === a.name,
        });
    }

    if (passCellData && grid.cellData.arrays.size) {
        for (const a of grid.cellData.arrays.values()) {
            const nc = a.numberOfComponents;
            const vals = new Float32Array(surfacePolys.length * nc);
            surfacePolys.forEach((p, i) => {
                for (let c = 0; c < nc; c++) vals[i * nc + c] = a.getComponent(p.srcCell, c);
            });
            out.cellData.addArray(new DataArray(a.name, vals, nc), {
                asScalars: grid.cellData.activeScalars === a.name,
            });
        }
    }
    return out;
}

export class UnstructuredGrid extends DataSet {
    constructor() {
        super();
        this.connectivity = new Int32Array(0);
        this.offsets = new Int32Array(1);
        this.cellTypes = new Uint8Array(0);
        this._surfaceFilter = null;
    }

    getNumberOfCells() {
        return this.cellTypes.length;
    }

    setCells(connectivity, offsets, types) {
        this.connectivity = connectivity instanceof Int32Array ? connectivity : Int32Array.from(connectivity);
        this.offsets = offsets instanceof Int32Array ? offsets : Int32Array.from(offsets);
        this.cellTypes = types instanceof Uint8Array ? types : Uint8Array.from(types);
        this.modified();
        return this;
    }

    setCellsFromList(cells) {
        const offsets = [0];
        const conn = [];
        const types = [];
        for (const c of cells) {
            conn.push(...c.points);
            offsets.push(conn.length);
            types.push(c.type);
        }
        return this.setCells(conn, offsets, types);
    }

    getCell(i) {
        const start = this.offsets[i];
        const end = this.offsets[i + 1];
        return {
            type: this.cellTypes[i],
            points: this.connectivity.subarray(start, end),
        };
    }

    /**
     * Extracts external boundary faces of solid volumes and 2D components into surface PolyData.
     * Shares the original points array and handles continuous mapping of PointData and CellData attributes.
     *
     * Backed by a cached ExtractSurfaceFilter pipeline stage: as long as this
     * grid isn't modified (setCells/setPoints/...) and passCellData doesn't
     * change, repeated calls return the same cached PolyData instead of
     * re-extracting — matching how a native VTK pipeline behaves when
     * Update() is called on an already up-to-date filter.
     */
    extractSurface({ passCellData = true } = {}) {
        if (!this._surfaceFilter) this._surfaceFilter = new ExtractSurfaceFilter();
        this._surfaceFilter.setInputData(this);
        this._surfaceFilter.setPassCellData(passCellData);
        return this._surfaceFilter.getOutputData();
    }

    clone() {
        const out = new UnstructuredGrid();
        out.setPoints(Float32Array.from(this.points));
        out.setCells(Int32Array.from(this.connectivity), Int32Array.from(this.offsets), Uint8Array.from(this.cellTypes));
        out.pointData = this.pointData.clone();
        out.cellData = this.cellData.clone();
        return out;
    }
}




























// // Core/UnstructuredGrid.js

// import { DataSet } from "./DataSet.js";
// import { PolyData } from "./PolyData.js";
// import { DataArray } from "./FieldData.js";
// import {
//     CellType, CELL_FACES, CELL_NUM_CORNERS, isSolidCell, is2DCell,
// } from "./CellTypes.js";

// export class UnstructuredGrid extends DataSet {
//     constructor() {
//         super();
//         this.connectivity = new Int32Array(0);
//         this.offsets = new Int32Array(1);
//         this.cellTypes = new Uint8Array(0);
//     }

//     getNumberOfCells() {
//         return this.cellTypes.length;
//     }

//     setCells(connectivity, offsets, types) {
//         this.connectivity = connectivity instanceof Int32Array ? connectivity : Int32Array.from(connectivity);
//         this.offsets = offsets instanceof Int32Array ? offsets : Int32Array.from(offsets);
//         this.cellTypes = types instanceof Uint8Array ? types : Uint8Array.from(types);
//         this.modified();
//         return this;
//     }

//     setCellsFromList(cells) {
//         const offsets = [0];
//         const conn = [];
//         const types = [];
//         for (const c of cells) {
//             conn.push(...c.points);
//             offsets.push(conn.length);
//             types.push(c.type);
//         }
//         return this.setCells(conn, offsets, types);
//     }

//     getCell(i) {
//         const start = this.offsets[i];
//         const end = this.offsets[i + 1];
//         return {
//             type: this.cellTypes[i],
//             points: this.connectivity.subarray(start, end),
//         };
//     }

//     /**
//      * Extracts external boundary faces of solid volumes and 2D components into surface PolyData.
//      * Shares the original points array and handles continuous mapping of PointData and CellData attributes.
//      */
//     extractSurface({ passCellData = true } = {}) {
//         const faceMap = new Map();
//         const surfacePolys = [];

//         // Reused scratch buffer for the sorted-vertex hash key (max 4 verts/face
//         // across all supported solid cell types). Avoids allocating + spreading
//         // + Array.prototype.sort()'ing a new array for every single face.
//         const keyBuf = new Int32Array(4);

//         const nCells = this.getNumberOfCells();
//         for (let ci = 0; ci < nCells; ci++) {
//             const type = this.cellTypes[ci];
//             const start = this.offsets[ci];
//             const conn = this.connectivity;

//             if (is2DCell(type)) {
//                 const nC = this.offsets[ci + 1] - start;
//                 const verts = new Array(nC);
//                 for (let k = 0; k < nC; k++) verts[k] = conn[start + k];
//                 surfacePolys.push({ verts, srcCell: ci });
//                 continue;
//             }
//             if (!isSolidCell(type)) continue;

//             const faces = CELL_FACES[type];
//             const nCorner = CELL_NUM_CORNERS[type] ?? (this.offsets[ci + 1] - start);

//             for (const face of faces) {
//                 const fn = face.length;
//                 let skip = false;
//                 for (let k = 0; k < fn; k++) {
//                     if (face[k] >= nCorner) { skip = true; break; }
//                     keyBuf[k] = conn[start + face[k]];
//                 }
//                 if (skip) continue;

//                 // Manual insertion sort over <=4 elements: for this size it beats
//                 // Array.prototype.sort()'s comparator-call overhead, and operates
//                 // in place on a reused buffer instead of a fresh array per face.
//                 for (let a = 1; a < fn; a++) {
//                     const v = keyBuf[a];
//                     let b = a - 1;
//                     while (b >= 0 && keyBuf[b] > v) { keyBuf[b + 1] = keyBuf[b]; b--; }
//                     keyBuf[b + 1] = v;
//                 }
//                 let key = keyBuf[0];
//                 for (let k = 1; k < fn; k++) key = key + "," + keyBuf[k];

//                 const existing = faceMap.get(key);
//                 if (existing) {
//                     existing.count++;
//                 } else {
//                     // Winding order matters for the output normal, so this copy
//                     // (unlike keyBuf) must preserve the original face ordering.
//                     const verts = new Array(fn);
//                     for (let k = 0; k < fn; k++) verts[k] = conn[start + face[k]];
//                     faceMap.set(key, { count: 1, verts, srcCell: ci });
//                 }
//             }
//         }

//         for (const f of faceMap.values()) {
//             if (f.count === 1) surfacePolys.push({ verts: f.verts, srcCell: f.srcCell });
//         }

//         const out = new PolyData();
//         out.setPoints(Float32Array.from(this.points));

//         out.polys = surfacePolys.map(p => p.verts);

//         // `cells` reconstructs full source-cell connectivity per surface face —
//         // useful for some picking/inspection workflows, but expensive to build
//         // and frequently never read. Compute it lazily, on first access, so the
//         // common case (just rendering the surface) doesn't pay for it.
//         let cellsCache = null;
//         const srcConn = this.connectivity, srcOffsets = this.offsets, srcTypes = this.cellTypes;
//         Object.defineProperty(out, "cells", {
//             configurable: true,
//             enumerable: true,
//             get() {
//                 if (!cellsCache) {
//                     cellsCache = surfacePolys.map(p => ({
//                         type: srcTypes[p.srcCell],
//                         points: Array.from(srcConn.subarray(srcOffsets[p.srcCell], srcOffsets[p.srcCell + 1])),
//                     }));
//                 }
//                 return cellsCache;
//             },
//             set(v) { cellsCache = v; },
//         });

//         out.userData = out.userData || {};
//         out.userData.surfaceCellMap = surfacePolys.map(p => p.srcCell);

//         for (const a of this.pointData.arrays.values()) {
//             out.pointData.addArray(a.clone(), {
//                 asScalars: this.pointData.activeScalars === a.name,
//                 asVectors: this.pointData.activeVectors === a.name,
//             });
//         }

//         if (passCellData && this.cellData.arrays.size) {
//             for (const a of this.cellData.arrays.values()) {
//                 const nc = a.numberOfComponents;
//                 const vals = new Float32Array(surfacePolys.length * nc);
//                 surfacePolys.forEach((p, i) => {
//                     for (let c = 0; c < nc; c++) vals[i * nc + c] = a.getComponent(p.srcCell, c);
//                 });
//                 out.cellData.addArray(new DataArray(a.name, vals, nc), {
//                     asScalars: this.cellData.activeScalars === a.name,
//                 });
//             }
//         }
//         return out;
//     }

//     clone() {
//         const out = new UnstructuredGrid();
//         out.setPoints(Float32Array.from(this.points));
//         out.setCells(Int32Array.from(this.connectivity), Int32Array.from(this.offsets), Uint8Array.from(this.cellTypes));
//         out.pointData = this.pointData.clone();
//         out.cellData = this.cellData.clone();
//         return out;
//     }
// }
