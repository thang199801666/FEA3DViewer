// Core/FieldData.js
// DataArray + FieldData (container thuộc tính). PointData/CellData kế thừa FieldData.
// Thay thế/hợp nhất AttributeSet cũ — GIỮ NGUYÊN API cũ để không phá code hiện có.

/** Một mảng dữ liệu thuộc tính (tương đương vtkDataArray). */
export class DataArray {
    constructor(name, values, numberOfComponents = 1) {
        this.name = name || "unnamed";
        this.values = (values instanceof Float32Array || values instanceof Float64Array)
            ? values
            : Float32Array.from(values || []);
        this.numberOfComponents = numberOfComponents;
        this._rangeCache = new Map(); // component -> [min,max]
    }

    getNumberOfTuples() { return this.values.length / this.numberOfComponents; }

    getComponent(tupleIdx, comp = 0) {
        return this.values[tupleIdx * this.numberOfComponents + comp];
    }

    setComponent(tupleIdx, comp, v) {
        this.values[tupleIdx * this.numberOfComponents + comp] = v;
        this._rangeCache.clear();
    }

    /** Độ lớn (L2 norm) của tuple — dùng tô màu theo magnitude vector. */
    getMagnitude(tupleIdx) {
        const n = this.numberOfComponents;
        let s = 0;
        for (let c = 0; c < n; c++) {
            const v = this.values[tupleIdx * n + c];
            s += v * v;
        }
        return Math.sqrt(s);
    }

    /** [min,max] của 1 component; component = -1 nghĩa là magnitude. Có cache. */
    getRange(component = 0) {
        if (this._rangeCache.has(component)) return this._rangeCache.get(component);
        let min = Infinity, max = -Infinity;
        const n = this.getNumberOfTuples();
        for (let i = 0; i < n; i++) {
            const v = component === -1 ? this.getMagnitude(i) : this.getComponent(i, component);
            if (Number.isNaN(v)) continue;
            if (v < min) min = v;
            if (v > max) max = v;
        }
        if (!Number.isFinite(min)) { min = 0; max = 1; }
        const r = [min, max];
        this._rangeCache.set(component, r);
        return r;
    }

    clone() {
        return new DataArray(this.name, Float32Array.from(this.values), this.numberOfComponents);
    }
}

/** Container thuộc tính chung (tương đương vtkFieldData). */
export class FieldData {
    constructor() {
        this.arrays = new Map();     // name -> DataArray
        this.activeScalars = null;
        this.activeVectors = null;
    }

    addArray(dataArray, { asScalars = false, asVectors = false } = {}) {
        this.arrays.set(dataArray.name, dataArray);
        if (asScalars || (this.activeScalars === null && dataArray.numberOfComponents === 1)) {
            this.activeScalars = dataArray.name;
        }
        if (asVectors || (this.activeVectors === null && dataArray.numberOfComponents === 3)) {
            if (asVectors || this.activeVectors === null) this.activeVectors = dataArray.name;
        }
        return dataArray;
    }

    getArray(name) { return this.arrays.get(name) || null; }
    getArrayNames() { return [...this.arrays.keys()]; }
    removeArray(name) { this.arrays.delete(name); return this; }

    setActiveScalars(name) {
        if (!this.arrays.has(name)) return false;
        this.activeScalars = name; return true;
    }
    setActiveVectors(name) {
        if (!this.arrays.has(name)) return false;
        this.activeVectors = name; return true;
    }

    getScalars() { return this.activeScalars ? this.arrays.get(this.activeScalars) : null; }
    getVectors() { return this.activeVectors ? this.arrays.get(this.activeVectors) : null; }

    /** Bản sao rỗng cùng loại — filter dùng để tạo output. */
    cloneStructure() {
        const c = new this.constructor();
        c.activeScalars = this.activeScalars;
        c.activeVectors = this.activeVectors;
        return c;
    }

    /** Deep-copy toàn bộ mảng. */
    clone() {
        const c = this.cloneStructure();
        for (const a of this.arrays.values()) c.arrays.set(a.name, a.clone());
        return c;
    }
}

/** Thuộc tính tại NÚT (nodal): stress/displacement per-point. */
export class PointData extends FieldData {}

/** Thuộc tính tại PHẦN TỬ (element): stress/strain per-cell. */
export class CellData extends FieldData {}

// Alias tương thích ngược: code cũ dùng AttributeSet.
export { FieldData as AttributeSet };
