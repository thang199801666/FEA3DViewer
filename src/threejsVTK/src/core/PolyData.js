// Core/PolyData.js

import { DataSet } from "./DataSet.js";
import { DataArray, PointData, CellData, FieldData } from "./FieldData.js";

export { DataArray, FieldData as AttributeSet, PointData, CellData };

export class PolyData extends DataSet {
    constructor() {
        super();
        this.verts = [];
        this.lines = [];
        this.polys = [];
        this.strips = [];
        this.cells = [];
    }

    setLines(data) {
        this.lines = _normalizeCells(data, 2);
        this.modified();
        return this;
    }

    setPolys(data) {
        this.polys = _normalizeCells(data, 3);
        this.modified();
        return this;
    }

    setVerts(data) {
        this.verts = _normalizeCells(data, 1);
        this.modified();
        return this;
    }

    getPoints() {
        return this.points;
    }

    getPolys() {
        return Int32Array.from(this.getTriangles());
    }

    getLinesFlat() {
        const out = [];
        for (const l of this.lines) {
            for (let i = 0; i + 1 < l.length; i++) out.push(l[i], l[i + 1]);
        }
        return out;
    }

    getScalars() {
        const s = this.pointData.getScalars();
        return s ? s.values : null;
    }

    addPointDataArray(name, values, numberOfComponents = 1, { setActiveScalar = false } = {}) {
        const da = new DataArray(name, values, numberOfComponents);
        this.pointData.addArray(da, { asScalars: setActiveScalar });
        this.modified();
        return da;
    }

    getNumberOfCells() {
        return this.verts.length + this.lines.length + this.polys.length + this.strips.length;
    }

    getTriangles() {
        const idx = [];
        for (const cell of this.polys) {
            for (let i = 1; i + 1 < cell.length; i++) idx.push(cell[0], cell[i], cell[i + 1]);
        }
        for (const strip of this.strips) {
            for (let i = 0; i + 2 < strip.length; i++) {
                if (i % 2 === 0) idx.push(strip[i], strip[i + 1], strip[i + 2]);
                else idx.push(strip[i + 1], strip[i], strip[i + 2]);
            }
        }
        return idx;
    }

    hasSurface() {
        return this.polys.length > 0 || this.strips.length > 0;
    }

    hasLines() {
        return this.lines.length > 0;
    }

    clone() {
        const out = new PolyData();
        out.setPoints(Float32Array.from(this.points));
        out.verts = this.verts.map(c => [...c]);
        out.lines = this.lines.map(c => [...c]);
        out.polys = this.polys.map(c => [...c]);
        out.strips = this.strips.map(c => [...c]);
        out.pointData = this.pointData.clone();
        out.cellData = this.cellData.clone();
        out.cells = this.cells.map(c => ({
            type: c.type,
            points: [...c.points]
        }));
        return out;
    }
}

function _normalizeCells(data, groupSize) {
    if (!data || data.length === 0) return [];
    if (Array.isArray(data[0])) return data.map(c => [...c]);
    const out = [];
    for (let i = 0; i + groupSize - 1 < data.length; i += groupSize) {
        const cell = [];
        for (let k = 0; k < groupSize; k++) cell.push(data[i + k]);
        out.push(cell);
    }
    return out;
}