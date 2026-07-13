// Core/PolyData.js

import { DataSet } from "./DataSet.js";
import { DataArray, PointData, CellData, FieldData } from "./FieldData.js";
import { CellArray } from "./CellArray.js";

export { DataArray, FieldData as AttributeSet, PointData, CellData, CellArray };

// Defines an accessor property (e.g. "polys") on PolyData's prototype backed
// by a private field. Reading always returns a CellArray; writing accepts a
// CellArray, a ragged array of arrays, or (for fixed-size cell types) a flat
// typed/plain array which is grouped into `groupSize`-sized cells first.
// Centralizing this here means every entry point — direct property
// assignment (`pd.polys = cells`, still used by callers migrating
// incrementally) as well as the setPolys()-style methods below — normalizes
// to the same CellArray-backed storage and always calls modified(), instead
// of only the explicit setters doing so (a real bug in the previous version:
// readers assigning `pd.polys = cells` directly skipped modified()
// entirely, silently invalidating the mtime-based caches on this class).
function _defineCellArrayProperty(proto, propName, privateName, groupSize) {
    Object.defineProperty(proto, propName, {
        configurable: true,
        enumerable: true,
        get() {
            return this[privateName];
        },
        set(data) {
            this[privateName] = data instanceof CellArray
                ? data
                : CellArray.fromRaggedArray(_normalizeCells(data, groupSize));
            this.modified();
        },
    });
}

export class PolyData extends DataSet {
    constructor() {
        super();
        this._verts = CellArray.empty();
        this._lines = CellArray.empty();
        this._polys = CellArray.empty();
        this._strips = CellArray.empty();
        this.cells = [];
        this._triCache = null;   // { mtime, arr } for getTriangles()
        this._polysCache = null; // { mtime, arr } for getPolys()
    }

    setLines(data) {
        this.lines = data;
        return this;
    }

    setPolys(data) {
        this.polys = data;
        return this;
    }

    setVerts(data) {
        this.verts = data;
        return this;
    }

    setStrips(data) {
        this.strips = data;
        return this;
    }

    getVerts() { return this.verts; }
    getLines() { return this.lines; }
    getPolys() {
        const mtime = this.getMTime();
        if (this._polysCache && this._polysCache.mtime === mtime) return this._polysCache.arr;
        const arr = Int32Array.from(this.getTriangles());
        this._polysCache = { mtime, arr };
        return arr;
    }
    getStrips() { return this.strips; }

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
        const mtime = this.getMTime();
        if (this._triCache && this._triCache.mtime === mtime) return this._triCache.arr;

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
        this._triCache = { mtime, arr: idx };
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
        out.verts = this._verts.clone();
        out.lines = this._lines.clone();
        out.polys = this._polys.clone();
        out.strips = this._strips.clone();
        out.pointData = this.pointData.clone();
        out.cellData = this.cellData.clone();
        out.cells = this.cells.map(c => ({
            type: c.type,
            points: [...c.points]
        }));
        return out;
    }
}

_defineCellArrayProperty(PolyData.prototype, "verts", "_verts", 1);
_defineCellArrayProperty(PolyData.prototype, "lines", "_lines", 2);
_defineCellArrayProperty(PolyData.prototype, "polys", "_polys", 3);
// Triangle strips have no fixed group size (a strip is a variable-length fan);
// only ragged-array or CellArray input makes sense, hence groupSize=null.
_defineCellArrayProperty(PolyData.prototype, "strips", "_strips", null);

function _normalizeCells(data, groupSize) {
    if (!data || data.length === 0) return [];
    if (Array.isArray(data[0]) || ArrayBuffer.isView(data[0])) return data;
    if (!groupSize) return data; // strips: already expected to be ragged
    const out = [];
    for (let i = 0; i + groupSize - 1 < data.length; i += groupSize) {
        const cell = [];
        for (let k = 0; k < groupSize; k++) cell.push(data[i + k]);
        out.push(cell);
    }
    return out;
}


















// // Core/PolyData.js

// import { DataSet } from "./DataSet.js";
// import { DataArray, PointData, CellData, FieldData } from "./FieldData.js";

// export { DataArray, FieldData as AttributeSet, PointData, CellData };

// export class PolyData extends DataSet {
//     constructor() {
//         super();
//         this.verts = [];
//         this.lines = [];
//         this.polys = [];
//         this.strips = [];
//         this.cells = [];
//         this._triCache = null;   // { mtime, arr } for getTriangles()
//         this._polysCache = null; // { mtime, arr } for getPolys()
//     }

//     setLines(data) {
//         this.lines = _normalizeCells(data, 2);
//         this.modified();
//         return this;
//     }

//     setPolys(data) {
//         this.polys = _normalizeCells(data, 3);
//         this.modified();
//         return this;
//     }

//     setVerts(data) {
//         this.verts = _normalizeCells(data, 1);
//         this.modified();
//         return this;
//     }

//     getPoints() {
//         return this.points;
//     }

//     getPolys() {
//         const mtime = this.getMTime();
//         if (this._polysCache && this._polysCache.mtime === mtime) return this._polysCache.arr;
//         const arr = Int32Array.from(this.getTriangles());
//         this._polysCache = { mtime, arr };
//         return arr;
//     }

//     getLinesFlat() {
//         const out = [];
//         for (const l of this.lines) {
//             for (let i = 0; i + 1 < l.length; i++) out.push(l[i], l[i + 1]);
//         }
//         return out;
//     }

//     getScalars() {
//         const s = this.pointData.getScalars();
//         return s ? s.values : null;
//     }

//     addPointDataArray(name, values, numberOfComponents = 1, { setActiveScalar = false } = {}) {
//         const da = new DataArray(name, values, numberOfComponents);
//         this.pointData.addArray(da, { asScalars: setActiveScalar });
//         this.modified();
//         return da;
//     }

//     getNumberOfCells() {
//         return this.verts.length + this.lines.length + this.polys.length + this.strips.length;
//     }

//     getTriangles() {
//         const mtime = this.getMTime();
//         if (this._triCache && this._triCache.mtime === mtime) return this._triCache.arr;

//         const idx = [];
//         for (const cell of this.polys) {
//             for (let i = 1; i + 1 < cell.length; i++) idx.push(cell[0], cell[i], cell[i + 1]);
//         }
//         for (const strip of this.strips) {
//             for (let i = 0; i + 2 < strip.length; i++) {
//                 if (i % 2 === 0) idx.push(strip[i], strip[i + 1], strip[i + 2]);
//                 else idx.push(strip[i + 1], strip[i], strip[i + 2]);
//             }
//         }
//         this._triCache = { mtime, arr: idx };
//         return idx;
//     }

//     hasSurface() {
//         return this.polys.length > 0 || this.strips.length > 0;
//     }

//     hasLines() {
//         return this.lines.length > 0;
//     }

//     clone() {
//         const out = new PolyData();
//         out.setPoints(Float32Array.from(this.points));
//         out.verts = this.verts.map(c => [...c]);
//         out.lines = this.lines.map(c => [...c]);
//         out.polys = this.polys.map(c => [...c]);
//         out.strips = this.strips.map(c => [...c]);
//         out.pointData = this.pointData.clone();
//         out.cellData = this.cellData.clone();
//         out.cells = this.cells.map(c => ({
//             type: c.type,
//             points: [...c.points]
//         }));
//         return out;
//     }
// }

// function _normalizeCells(data, groupSize) {
//     if (!data || data.length === 0) return [];
//     if (Array.isArray(data[0])) return data.map(c => [...c]);
//     const out = [];
//     for (let i = 0; i + groupSize - 1 < data.length; i += groupSize) {
//         const cell = [];
//         for (let k = 0; k < groupSize; k++) cell.push(data[i + k]);
//         out.push(cell);
//     }
//     return out;
// }