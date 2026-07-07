// Core/PolyData.js
// Cấu trúc dữ liệu trung tâm, mô phỏng vtkPolyData của VTK:
//   - points   : Float32Array phẳng [x0,y0,z0, x1,y1,z1, ...]
//   - verts / lines / polys / strips : mảng các cell, mỗi cell là mảng chỉ số điểm
//   - pointData / cellData : tập các DataArray (scalars, vectors, normals, field...)

/** Một mảng dữ liệu thuộc tính, tương đương vtkDataArray. */
export class DataArray {
    constructor(name, values, numberOfComponents = 1) {
        this.name = name || "unnamed";
        this.values = (values instanceof Float32Array || values instanceof Float64Array)
            ? values
            : Float32Array.from(values || []);
        this.numberOfComponents = numberOfComponents;
    }

    getNumberOfTuples() {
        return this.values.length / this.numberOfComponents;
    }

    getComponent(tupleIdx, comp = 0) {
        return this.values[tupleIdx * this.numberOfComponents + comp];
    }

    /** Độ lớn (L2 norm) của tuple — dùng để tô màu theo magnitude của vector. */
    getMagnitude(tupleIdx) {
        const n = this.numberOfComponents;
        let s = 0;
        for (let c = 0; c < n; c++) {
            const v = this.values[tupleIdx * n + c];
            s += v * v;
        }
        return Math.sqrt(s);
    }

    /** [min, max] của 1 component. component = -1 nghĩa là magnitude. */
    getRange(component = 0) {
        let min = Infinity, max = -Infinity;
        const n = this.getNumberOfTuples();
        for (let i = 0; i < n; i++) {
            const v = component === -1 ? this.getMagnitude(i) : this.getComponent(i, component);
            if (Number.isNaN(v)) continue;
            if (v < min) min = v;
            if (v > max) max = v;
        }
        if (!Number.isFinite(min)) { min = 0; max = 1; }
        return [min, max];
    }
}

/** Tập thuộc tính (pointData hoặc cellData), tương đương vtkPointData/vtkCellData. */
export class AttributeSet {
    constructor() {
        this.arrays = new Map();       // name -> DataArray
        this.activeScalars = null;     // tên array đang là scalars
        this.activeVectors = null;
    }

    addArray(dataArray, { asScalars = false, asVectors = false } = {}) {
        this.arrays.set(dataArray.name, dataArray);
        // Nếu chưa có scalars active và đây là mảng 1 component thì tự đặt làm active
        if (asScalars || (this.activeScalars === null && dataArray.numberOfComponents === 1)) {
            this.activeScalars = dataArray.name;
        }
        if (asVectors) this.activeVectors = dataArray.name;
        return dataArray;
    }

    getArray(name) { return this.arrays.get(name) || null; }
    getArrayNames() { return [...this.arrays.keys()]; }

    setActiveScalars(name) {
        if (!this.arrays.has(name)) return false;
        this.activeScalars = name;
        return true;
    }

    getScalars() { return this.activeScalars ? this.arrays.get(this.activeScalars) : null; }
    getVectors() { return this.activeVectors ? this.arrays.get(this.activeVectors) : null; }

    /** Bản sao rỗng cùng cấu trúc — dùng cho filter tạo output. */
    cloneStructure() { return new AttributeSet(); }
}

export class PolyData {
    constructor() {
        this.points = new Float32Array(0);
        this.verts = [];    // [[i], [i], ...]
        this.lines = [];    // [[i0,i1,...], ...] polyline
        this.polys = [];    // [[i0,i1,i2,...], ...] đa giác
        this.strips = [];   // triangle strips
        this.pointData = new AttributeSet();
        this.cellData = new AttributeSet();
    }

    setPoints(flatArray) {
        this.points = flatArray instanceof Float32Array ? flatArray : Float32Array.from(flatArray);
        return this;
    }

    getNumberOfPoints() { return this.points.length / 3; }
    getNumberOfCells() {
        return this.verts.length + this.lines.length + this.polys.length + this.strips.length;
    }

    getPoint(i, out = [0, 0, 0]) {
        out[0] = this.points[i * 3];
        out[1] = this.points[i * 3 + 1];
        out[2] = this.points[i * 3 + 2];
        return out;
    }

    /** [minX,minY,minZ,maxX,maxY,maxZ] */
    getBounds() {
        const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
        const p = this.points;
        for (let i = 0; i < p.length; i += 3) {
            if (p[i] < b[0]) b[0] = p[i];
            if (p[i + 1] < b[1]) b[1] = p[i + 1];
            if (p[i + 2] < b[2]) b[2] = p[i + 2];
            if (p[i] > b[3]) b[3] = p[i];
            if (p[i + 1] > b[4]) b[4] = p[i + 1];
            if (p[i + 2] > b[5]) b[5] = p[i + 2];
        }
        return b;
    }

    /**
     * Trả về mảng index tam giác phẳng [a,b,c, a,b,c, ...]
     * - polys: tam giác hóa kiểu quạt (fan) — đúng cho đa giác lồi (tri, quad, ...)
     * - strips: tách strip thành các tam giác xen kẽ chiều
     */
    getTriangles() {
        const idx = [];
        for (const cell of this.polys) {
            for (let i = 1; i + 1 < cell.length; i++) {
                idx.push(cell[0], cell[i], cell[i + 1]);
            }
        }
        for (const strip of this.strips) {
            for (let i = 0; i + 2 < strip.length + 0; i++) {
                if (i % 2 === 0) idx.push(strip[i], strip[i + 1], strip[i + 2]);
                else idx.push(strip[i + 1], strip[i], strip[i + 2]);
            }
        }
        return idx;
    }

    /** Có dữ liệu bề mặt (tam giác) hay chỉ là line/point cloud. */
    hasSurface() { return this.polys.length > 0 || this.strips.length > 0; }
    hasLines() { return this.lines.length > 0; }
}