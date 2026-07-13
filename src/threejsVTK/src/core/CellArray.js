// Core/CellArray.js
//
// Mirrors the internal storage of native VTK's vtkCellArray (VTK 9+): a single
// Offsets typed array (length nCells+1) plus a single Connectivity typed array,
// instead of a JS array holding one small JS array per cell. This replaces the
// "array of arrays" cell representation that PolyData previously used for
// verts/lines/polys/strips.
//
// Why this matters:
// - One allocation for N cells instead of N+1 allocations (the outer array
//   plus one small array per cell) — large meshes previously created millions
//   of short-lived arrays during parsing and surface extraction.
// - Cell point-ids live contiguously in memory, so iterating all cells is a
//   single linear scan instead of chasing N separate array objects (better
//   cache behavior, less GC pressure).
// - getCell() returns a zero-copy subarray view rather than allocating.
//
// Consumers that only ever did `for (const cell of polyData.polys)` and read
// `cell.length` / `cell[i]` keep working unchanged: Int32Array subarrays
// support the same indexing/length/iteration surface as a plain JS array.

export class CellArray {
    constructor(offsets, connectivity) {
        this.offsets = offsets instanceof Int32Array ? offsets : Int32Array.from(offsets || [0]);
        this.connectivity = connectivity instanceof Int32Array ? connectivity : Int32Array.from(connectivity || []);
    }

    static empty() {
        return new CellArray(new Int32Array([0]), new Int32Array(0));
    }

    /** Build from a ragged array of arrays/typed-array-views, e.g. [[0,1,2],[3,4,5,6]]. */
    static fromRaggedArray(cells) {
        if (cells instanceof CellArray) return cells;
        if (!cells || cells.length === 0) return CellArray.empty();
        const n = cells.length;
        const offsets = new Int32Array(n + 1);
        let total = 0;
        for (let i = 0; i < n; i++) {
            total += cells[i].length;
            offsets[i + 1] = total;
        }
        const conn = new Int32Array(total);
        let w = 0;
        for (let i = 0; i < n; i++) {
            const c = cells[i];
            for (let k = 0; k < c.length; k++) conn[w++] = c[k];
        }
        return new CellArray(offsets, conn);
    }

    /** Zero-copy construction from already-flat offsets+connectivity (e.g. VTK
     *  5.1+ legacy OFFSETS/CONNECTIVITY blocks, which are already in this layout). */
    static fromOffsetsConnectivity(offsets, connectivity) {
        return new CellArray(offsets, connectivity);
    }

    get length() {
        return this.offsets.length - 1;
    }

    getNumberOfCells() {
        return this.length;
    }

    getCellSize(cellId) {
        return this.offsets[cellId + 1] - this.offsets[cellId];
    }

    /** Zero-copy view of a single cell's point ids. */
    getCell(cellId) {
        return this.connectivity.subarray(this.offsets[cellId], this.offsets[cellId + 1]);
    }

    getConnectivityArray() {
        return this.connectivity;
    }

    getOffsetsArray() {
        return this.offsets;
    }

    *[Symbol.iterator]() {
        const n = this.length;
        for (let i = 0; i < n; i++) yield this.getCell(i);
    }

    map(fn) {
        const out = [];
        let i = 0;
        for (const c of this) out.push(fn(c, i++));
        return out;
    }

    toRaggedArray() {
        return this.map((c) => Array.from(c));
    }

    clone() {
        return new CellArray(Int32Array.from(this.offsets), Int32Array.from(this.connectivity));
    }
}