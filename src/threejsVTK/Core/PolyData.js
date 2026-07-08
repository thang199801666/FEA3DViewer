// Core/PolyData.js
// Lưới bề mặt/đường/điểm (tương đương vtkPolyData), nay kế thừa DataSet.
// GIỮ NGUYÊN toàn bộ API cũ (points/verts/lines/polys/strips, getTriangles...)
// và BỔ SUNG helper (setLines/setPolys/addPointDataArray/getScalars...) để mọi
// filter dùng chung một convention.

import { DataSet } from "./DataSet.js";
import { DataArray, PointData, CellData, FieldData } from "./FieldData.js";

// Re-export để code cũ `import { DataArray, AttributeSet } from "./PolyData.js"` vẫn chạy.
export { DataArray, FieldData as AttributeSet, PointData, CellData };

export class PolyData extends DataSet {
    constructor() {
        super();
        this.verts = [];    // [[i], ...]
        this.lines = [];    // [[i0,i1,...], ...] polyline
        this.polys = [];    // [[i0,i1,i2,...], ...] đa giác
        this.strips = [];   // triangle strips
    }

    // ---- Setters tiện dụng (dùng bởi ContourFilter và các reader) ----
    /** lines phẳng [a,b, c,d, ...] HOẶC mảng các polyline [[..],[..]]. */
    setLines(data) {
        this.lines = _normalizeCells(data, 2);
        this.modified(); return this;
    }
    /** polys phẳng tam giác [a,b,c, ...] HOẶC mảng đa giác [[..],..]. */
    setPolys(data) {
        this.polys = _normalizeCells(data, 3);
        this.modified(); return this;
    }
    setVerts(data) { this.verts = _normalizeCells(data, 1); this.modified(); return this; }

    // ---- Getters "phẳng" tiện cho thuật toán (ContourFilter cần) ----
    getPoints() { return this.points; }
    /** Tam giác phẳng [a,b,c,...] của toàn bộ polys+strips. */
    getPolys() { return Int32Array.from(this.getTriangles()); }
    getLinesFlat() {
        const out = [];
        for (const l of this.lines) for (let i = 0; i + 1 < l.length; i++) out.push(l[i], l[i + 1]);
        return out;
    }
    getScalars() {
        const s = this.pointData.getScalars();
        return s ? s.values : null;
    }

    /** Thêm nhanh 1 point-array (values phẳng). */
    addPointDataArray(name, values, numberOfComponents = 1, { setActiveScalar = false } = {}) {
        const da = new DataArray(name, values, numberOfComponents);
        this.pointData.addArray(da, { asScalars: setActiveScalar });
        this.modified();
        return da;
    }

    getNumberOfCells() {
        return this.verts.length + this.lines.length + this.polys.length + this.strips.length;
    }

    /** Tam giác phẳng [a,b,c, ...]: polys fan-triangulate, strips xen kẽ chiều. */
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

    hasSurface() { return this.polys.length > 0 || this.strips.length > 0; }
    hasLines() { return this.lines.length > 0; }

    clone() {
        const out = new PolyData();
        out.setPoints(Float32Array.from(this.points));
        out.verts = this.verts.map(c => [...c]);
        out.lines = this.lines.map(c => [...c]);
        out.polys = this.polys.map(c => [...c]);
        out.strips = this.strips.map(c => [...c]);
        out.pointData = this.pointData.clone();
        out.cellData = this.cellData.clone();
        return out;
    }
}

// Chấp nhận cả mảng phẳng (nhóm theo groupSize) lẫn mảng-các-mảng.
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
