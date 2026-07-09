// Core/UnstructuredGrid.js

import { DataSet } from "./DataSet.js";
import { PolyData } from "./PolyData.js";
import { DataArray } from "./FieldData.js";
import {
    CellType, CELL_FACES, CELL_NUM_CORNERS, isSolidCell, is2DCell,
} from "./CellTypes.js";

export class UnstructuredGrid extends DataSet {
    constructor() {
        super();
        this.connectivity = new Int32Array(0);
        this.offsets = new Int32Array(1);
        this.cellTypes = new Uint8Array(0);
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
     */
    extractSurface({ passCellData = true } = {}) {
        const faceMap = new Map();
        const surfacePolys = [];

        const nCells = this.getNumberOfCells();
        for (let ci = 0; ci < nCells; ci++) {
            const type = this.cellTypes[ci];
            const start = this.offsets[ci];
            const conn = this.connectivity;

            if (is2DCell(type)) {
                const nC = this.offsets[ci + 1] - start;
                const verts = [];
                for (let k = 0; k < nC; k++) verts.push(conn[start + k]);
                surfacePolys.push({ verts, srcCell: ci });
                continue;
            }
            if (!isSolidCell(type)) continue;

            const faces = CELL_FACES[type];
            const nCorner = CELL_NUM_CORNERS[type] ?? (this.offsets[ci + 1] - start);
            for (const face of faces) {
                const verts = face.map(local => conn[start + local]);
                if (face.some(local => local >= nCorner)) continue;
                
                const key = [...verts].sort((a, b) => a - b).join(",");
                if (faceMap.has(key)) {
                    faceMap.get(key).count++;
                } else {
                    faceMap.set(key, { count: 1, verts, srcCell: ci });
                }
            }
        }

        for (const f of faceMap.values()) {
            if (f.count === 1) surfacePolys.push({ verts: f.verts, srcCell: f.srcCell });
        }

        const out = new PolyData();
        out.setPoints(Float32Array.from(this.points));
        
        out.polys = surfacePolys.map(p => p.verts);

        // NEW
        out.cells = surfacePolys.map(p => ({
            type: this.cellTypes[p.srcCell],
            points: Array.from(
                this.connectivity.subarray(
                    this.offsets[p.srcCell],
                    this.offsets[p.srcCell + 1]
                )
            )
        }));

        out.userData = out.userData || {};
        out.userData.surfaceCellMap = surfacePolys.map(p => p.srcCell);

        for (const a of this.pointData.arrays.values()) {
            out.pointData.addArray(a.clone(), {
                asScalars: this.pointData.activeScalars === a.name,
                asVectors: this.pointData.activeVectors === a.name,
            });
        }

        if (passCellData && this.cellData.arrays.size) {
            for (const a of this.cellData.arrays.values()) {
                const nc = a.numberOfComponents;
                const vals = new Float32Array(surfacePolys.length * nc);
                surfacePolys.forEach((p, i) => {
                    for (let c = 0; c < nc; c++) vals[i * nc + c] = a.getComponent(p.srcCell, c);
                });
                out.cellData.addArray(new DataArray(a.name, vals, nc), {
                    asScalars: this.cellData.activeScalars === a.name,
                });
            }
        }
        return out;
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