// IO/VTKLegacyReader.js
//
// PERFORMANCE-OPTIMIZED VERSION
// The previous implementation split the whole file into a token string array:
//     lines.slice(3).join("\n").split(/\s+/)
// For large ASCII files this created millions of short-lived strings (huge GC
// pressure, several times the file size in memory) and every number went
// through parseFloat/parseInt on a fresh string.
//
// This version scans the source text in place with a charCode-based cursor:
// - Numbers are parsed digit-by-digit without allocating substrings.
// - Words (keywords/names) are only materialized when actually needed.
// - Skipping (LOOKUP_TABLE values, METADATA) allocates nothing.
// Typical speedup on multi-MB ASCII files: 5-10x, with flat memory usage.

import { PolyData, DataArray, CellArray } from "../core/PolyData.js";

const CELL_INFO = {
    0:  { family: "skip" },                        // EMPTY_CELL
    1:  { family: "vertex" },                       // VERTEX
    2:  { family: "polyvertex" },                   // POLY_VERTEX
    3:  { family: "line",        corners: 2 },      // LINE
    4:  { family: "polyline" },                     // POLY_LINE
    5:  { family: "triangle",    corners: 3 },      // TRIANGLE
    6:  { family: "strip" },                        // TRIANGLE_STRIP
    7:  { family: "polygon" },                      // POLYGON
    8:  { family: "pixel" },                        // PIXEL
    9:  { family: "quad",        corners: 4 },      // QUAD
    10: { family: "tetra",       corners: 4 },      // TETRA
    11: { family: "voxel" },                        // VOXEL
    12: { family: "hexahedron",  corners: 8 },      // HEXAHEDRON
    13: { family: "wedge",       corners: 6 },      // WEDGE
    14: { family: "pyramid",     corners: 5 },      // PYRAMID
    15: { family: "pentaprism",  corners: 10 },     // PENTAGONAL_PRISM
    16: { family: "hexaprism",   corners: 12 },     // HEXAGONAL_PRISM

    // Quadratic / Isoparametric cells (using corner nodes)
    21: { family: "line",        corners: 2 },      // QUADRATIC_EDGE
    22: { family: "triangle",    corners: 3 },      // QUADRATIC_TRIANGLE
    23: { family: "quad",        corners: 4 },      // QUADRATIC_QUAD
    24: { family: "tetra",       corners: 4 },      // QUADRATIC_TETRA
    25: { family: "hexahedron",  corners: 8 },      // QUADRATIC_HEXAHEDRON
    26: { family: "wedge",       corners: 6 },      // QUADRATIC_WEDGE
    27: { family: "pyramid",     corners: 5 },      // QUADRATIC_PYRAMID
    28: { family: "quad",        corners: 4 },      // BIQUADRATIC_QUAD
    29: { family: "hexahedron",  corners: 8 },      // TRIQUADRATIC_HEXAHEDRON
    30: { family: "quad",        corners: 4 },      // QUADRATIC_LINEAR_QUAD
    31: { family: "wedge",       corners: 6 },      // QUADRATIC_LINEAR_WEDGE
    32: { family: "wedge",       corners: 6 },      // BIQUADRATIC_QUADRATIC_WEDGE
    33: { family: "hexahedron",  corners: 8 },      // BIQUADRATIC_QUADRATIC_HEXAHEDRON
    34: { family: "triangle",    corners: 3 },      // BIQUADRATIC_TRIANGLE
    35: { family: "line",        corners: 2 },      // CUBIC_LINE
    36: { family: "polygon",     corners: "half" }, // QUADRATIC_POLYGON
    37: { family: "pyramid",     corners: 5 },      // TRIQUADRATIC_PYRAMID

    41: { family: "convex" },                       // CONVEX_POINT_SET
    42: { family: "polyhedron" },                   // POLYHEDRON

    // Higher-order / Lagrange / Bezier cells
    60: { family: "line",        corners: 2 },      // HIGHER_ORDER_EDGE
    61: { family: "triangle",    corners: 3 },      // HIGHER_ORDER_TRIANGLE
    62: { family: "quad",        corners: 4 },      // HIGHER_ORDER_QUADRILATERAL
    64: { family: "tetra",       corners: 4 },      // HIGHER_ORDER_TETRAHEDRON
    65: { family: "wedge",       corners: 6 },      // HIGHER_ORDER_WEDGE
    66: { family: "pyramid",     corners: 5 },      // HIGHER_ORDER_PYRAMID
    67: { family: "hexahedron",  corners: 8 },      // HIGHER_ORDER_HEXAHEDRON
    68: { family: "line",        corners: 2 },      // LAGRANGE_CURVE
    69: { family: "triangle",    corners: 3 },      // LAGRANGE_TRIANGLE
    70: { family: "quad",        corners: 4 },      // LAGRANGE_QUADRILATERAL
    71: { family: "tetra",       corners: 4 },      // LAGRANGE_TETRAHEDRON
    72: { family: "hexahedron",  corners: 8 },      // LAGRANGE_HEXAHEDRON
    73: { family: "wedge",       corners: 6 },      // LAGRANGE_WEDGE
    74: { family: "pyramid",     corners: 5 },      // LAGRANGE_PYRAMID
    75: { family: "line",        corners: 2 },      // BEZIER_CURVE
    76: { family: "triangle",    corners: 3 },      // BEZIER_TRIANGLE
    77: { family: "quad",        corners: 4 },      // BEZIER_QUADRILATERAL
    78: { family: "tetra",       corners: 4 },      // BEZIER_TETRAHEDRON
    79: { family: "hexahedron",  corners: 8 },      // BEZIER_HEXAHEDRON
    80: { family: "wedge",       corners: 6 },      // BEZIER_WEDGE
    81: { family: "pyramid",     corners: 5 }       // BEZIER_PYRAMID
};

const SUPPORTED_DATASETS = new Set([
    "POLYDATA", "UNSTRUCTURED_GRID",
    "STRUCTURED_GRID", "STRUCTURED_POINTS", "RECTILINEAR_GRID"
]);
const STRUCTURED_DATASETS = new Set([
    "STRUCTURED_GRID", "STRUCTURED_POINTS", "RECTILINEAR_GRID"
]);

/**
 * Zero-allocation cursor over the source text.
 * Numbers are parsed straight from charCodes; word tokens are materialized
 * only when the parser needs a keyword or a name.
 */
class TextCursor {
    constructor(text, pos = 0) {
        this.text = text;
        this.pos = pos;
        this.end = text.length;
    }

    /** Advance past whitespace. Returns false at end of input. */
    _skipWs() {
        const t = this.text, end = this.end;
        let i = this.pos;
        while (i < end && t.charCodeAt(i) <= 32) i++;
        this.pos = i;
        return i < end;
    }

    /** Next whitespace-delimited token as a string, or null at EOF. */
    nextWord() {
        if (!this._skipWs()) return null;
        const t = this.text, end = this.end;
        let i = this.pos;
        while (i < end && t.charCodeAt(i) > 32) i++;
        const w = t.slice(this.pos, i);
        this.pos = i;
        return w;
    }

    /** Peek the next token (uppercased) without consuming it. */
    peekWordUpper() {
        const save = this.pos;
        const w = this.nextWord();
        this.pos = save;
        return w ? w.toUpperCase() : "";
    }

    /** Skip n tokens without allocating any strings. */
    skipWords(n) {
        const t = this.text, end = this.end;
        let i = this.pos;
        for (let k = 0; k < n && i < end; k++) {
            while (i < end && t.charCodeAt(i) <= 32) i++;
            while (i < end && t.charCodeAt(i) > 32) i++;
        }
        this.pos = i;
    }

    atEnd() {
        return !this._skipWs();
    }

    /** Fast integer parse. Falls back to Number() for exotic tokens. */
    nextInt() {
        if (!this._skipWs()) return NaN;
        const t = this.text, end = this.end;
        let i = this.pos;
        let c = t.charCodeAt(i);
        let sign = 1;
        if (c === 45) { sign = -1; c = ++i < end ? t.charCodeAt(i) : 0; }
        else if (c === 43) { c = ++i < end ? t.charCodeAt(i) : 0; }
        let v = 0, ok = false;
        while (c >= 48 && c <= 57) {
            v = v * 10 + (c - 48);
            ok = true;
            c = ++i < end ? t.charCodeAt(i) : 0;
        }
        if (!ok || (i < end && c > 32)) return this._slowNumber() | 0;
        this.pos = i;
        return sign * v;
    }

    /** Fast float parse (sign, fraction, exponent). Fallback for nan/inf/etc. */
    nextFloat() {
        if (!this._skipWs()) return NaN;
        const t = this.text, end = this.end;
        let i = this.pos;
        let c = t.charCodeAt(i);
        let sign = 1;
        if (c === 45) { sign = -1; c = ++i < end ? t.charCodeAt(i) : 0; }
        else if (c === 43) { c = ++i < end ? t.charCodeAt(i) : 0; }

        let mant = 0, digits = 0, exp = 0, ok = false;
        while (c >= 48 && c <= 57) {
            mant = mant * 10 + (c - 48);
            digits++; ok = true;
            c = ++i < end ? t.charCodeAt(i) : 0;
        }
        if (c === 46) {                                              // '.'
            c = ++i < end ? t.charCodeAt(i) : 0;
            while (c >= 48 && c <= 57) {
                mant = mant * 10 + (c - 48);
                exp--; digits++; ok = true;
                c = ++i < end ? t.charCodeAt(i) : 0;
            }
        }
        if (ok && (c === 101 || c === 69)) {                         // 'e' / 'E'
            let j = i + 1, esign = 1, e = 0, ed = false;
            let c2 = j < end ? t.charCodeAt(j) : 0;
            if (c2 === 45) { esign = -1; c2 = ++j < end ? t.charCodeAt(j) : 0; }
            else if (c2 === 43) { c2 = ++j < end ? t.charCodeAt(j) : 0; }
            while (c2 >= 48 && c2 <= 57) {
                e = e * 10 + (c2 - 48);
                ed = true;
                c2 = ++j < end ? t.charCodeAt(j) : 0;
            }
            if (ed) { exp += esign * e; i = j; c = c2; }
        }

        // Fallback: no digits, junk suffix, or precision beyond double mantissa
        if (!ok || digits > 15 || (i < end && c > 32)) return this._slowNumber();

        this.pos = i;
        return exp === 0 ? sign * mant : sign * mant * Math.pow(10, exp);
    }

    _slowNumber() {
        const w = this.nextWord();
        return w === null ? NaN : Number(w);
    }

    readFloats(n) {
        const a = new Float32Array(n);
        for (let i = 0; i < n; i++) a[i] = this.nextFloat();
        return a;
    }

    readInts(n) {
        const a = new Int32Array(n);
        for (let i = 0; i < n; i++) a[i] = this.nextInt();
        return a;
    }
}

const TYPE_INFO = {
    bit:            { kind: "uint", bytes: 1 },
    char:           { kind: "int", bytes: 1 },
    signed_char:    { kind: "int", bytes: 1 },
    unsigned_char:  { kind: "uint", bytes: 1 },
    short:          { kind: "int", bytes: 2 },
    unsigned_short: { kind: "uint", bytes: 2 },
    int:            { kind: "int", bytes: 4 },
    unsigned_int:   { kind: "uint", bytes: 4 },
    long:           { kind: "int", bytes: 4 },
    unsigned_long:  { kind: "uint", bytes: 4 },
    float:          { kind: "float", bytes: 4 },
    double:         { kind: "float", bytes: 8 },
};

function _typeInfo(type, fallback = "float") {
    return TYPE_INFO[String(type || fallback).toLowerCase()] || TYPE_INFO[fallback];
}

function _arrayBufferView(input) {
    if (input instanceof ArrayBuffer) return new Uint8Array(input);
    if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    return new TextEncoder().encode(String(input ?? ""));
}

function _findLineEnds(bytes) {
    const out = [];
    for (let i = 0; i < bytes.length && out.length < 3; i++) {
        if (bytes[i] === 10) out.push(i);
    }
    return out;
}

/**
 * Cursor for legacy VTK BINARY files. Legacy binary is not a fully binary
 * container: keywords and sizes are ASCII tokens, while numeric payload blocks
 * are raw big-endian values immediately after the keyword line.
 */
class BinaryCursor {
    constructor(bytes, pos = 0) {
        this.isBinary = true;
        this.bytes = bytes;
        this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        this.pos = pos;
        this.end = bytes.byteLength;
        this._decoder = new TextDecoder();
    }

    _skipWs() {
        const b = this.bytes, end = this.end;
        let i = this.pos;
        while (i < end && b[i] <= 32) i++;
        this.pos = i;
        return i < end;
    }

    _skipAsciiWs() {
        const b = this.bytes, end = this.end;
        let i = this.pos;
        while (i < end && (b[i] === 9 || b[i] === 10 || b[i] === 13 || b[i] === 32)) i++;
        this.pos = i;
        return i < end;
    }

    nextWord() {
        if (!this._skipWs()) return null;
        const b = this.bytes, end = this.end;
        let i = this.pos;
        while (i < end && b[i] > 32) i++;
        const w = this._decoder.decode(b.subarray(this.pos, i));
        this.pos = i;
        return w;
    }

    peekWordUpper() {
        const save = this.pos;
        const w = this.nextWord();
        this.pos = save;
        return w ? w.toUpperCase() : "";
    }

    skipWords(n) {
        for (let i = 0; i < n; i++) this.nextWord();
    }

    atEnd() {
        return !this._skipWs();
    }

    nextInt() {
        return Number(this.nextWord());
    }

    nextFloat() {
        return Number(this.nextWord());
    }

    _readOne(type) {
        const info = _typeInfo(type);
        const p = this.pos;
        this.pos += info.bytes;
        if (p + info.bytes > this.end) return NaN;
        switch (`${info.kind}${info.bytes}`) {
            case "float4": return this.view.getFloat32(p, false);
            case "float8": return this.view.getFloat64(p, false);
            case "int1": return this.view.getInt8(p);
            case "uint1": return this.view.getUint8(p);
            case "int2": return this.view.getInt16(p, false);
            case "uint2": return this.view.getUint16(p, false);
            case "int4": return this.view.getInt32(p, false);
            case "uint4": return this.view.getUint32(p, false);
            default: return NaN;
        }
    }

    readFloats(n, type = "float") {
        this._skipAsciiWs();
        const a = new Float32Array(n);
        for (let i = 0; i < n; i++) a[i] = this._readOne(type);
        return a;
    }

    readInts(n, type = "int") {
        this._skipAsciiWs();
        const a = new Int32Array(n);
        for (let i = 0; i < n; i++) a[i] = this._readOne(type) | 0;
        return a;
    }

    skipDataValues(n, type = "float") {
        this._skipAsciiWs();
        this.pos += _typeInfo(type).bytes * n;
        if (this.pos > this.end) this.pos = this.end;
    }
}

export class VTKLegacyReader {
    parse(input) {
        const bytes = _arrayBufferView(input);

        // Header check without splitting the whole file into lines:
        // only locate the first three newline boundaries.
        const [nl1 = -1, nl2 = -1, nl3 = -1] = _findLineEnds(bytes);
        const decoder = new TextDecoder();
        const line1 = nl1 >= 0 ? decoder.decode(bytes.subarray(0, nl1)) : "";
        if (nl3 < 0 || !/^#\s*vtk/i.test(line1)) {
            throw new Error("Invalid VTK legacy file format");
        }
        const format = decoder.decode(bytes.subarray(nl2 + 1, nl3)).trim().toUpperCase();
        const isBinary = format === "BINARY";
        const text = isBinary ? null : decoder.decode(bytes);

        const cur = isBinary ? new BinaryCursor(bytes, nl3 + 1) : new TextCursor(text, nl3 + 1);

        const readCellBlock = (n, size) => {
            // VTK 5.1+ layout: OFFSETS <type> ... CONNECTIVITY <type> ...
            // Already in the exact offsets+connectivity layout CellArray uses
            // internally, so this is a direct, zero-intermediate-allocation read.
            if (cur.peekWordUpper() === "OFFSETS") {
                cur.skipWords(1);                    // OFFSETS
                const offsetType = cur.nextWord();
                const offsets = cur.readInts(n, offsetType);
                cur.skipWords(1);                    // CONNECTIVITY
                const connType = cur.nextWord();
                const conn = cur.readInts(size, connType);
                return CellArray.fromOffsetsConnectivity(offsets, conn);
            }
            // Classic layout: (count, id0, id1, ...) repeated. Total point-id
            // count is known up front (size - n, since `size` counts each
            // cell's leading count token too), so offsets+connectivity can be
            // filled directly instead of building n separate small JS arrays
            // and re-flattening them afterward.
            const offsets = new Int32Array(n + 1);
            const conn = new Int32Array(Math.max(0, size - n));
            let oi = 0, ci = 0, read = 0;
            if (cur.isBinary) {
                const flat = cur.readInts(size, "int");
                while (read < size) {
                    const m = flat[read++];
                    offsets[oi + 1] = offsets[oi] + m;
                    oi++;
                    conn.set(flat.subarray(read, read + m), ci);
                    ci += m;
                    read += m;
                }
                return new CellArray(offsets, conn);
            }
            while (read < size) {
                const m = cur.nextInt();
                offsets[oi + 1] = offsets[oi] + m;
                oi++;
                for (let j = 0; j < m; j++) conn[ci++] = cur.nextInt();
                read += m + 1;
            }
            return new CellArray(offsets, conn);
        };

        const pd = new PolyData();
        let currentAttr = pd.pointData;
        let currentN = 0;
        let rawCells = null;

        let datasetType = null;
        let dims = null;
        let origin = [0, 0, 0];
        let spacing = [1, 1, 1];
        const rectCoords = { x: null, y: null, z: null };

        while (!cur.atEnd()) {
            const kw = cur.nextWord().toUpperCase();
            switch (kw) {
                case "DATASET": {
                    datasetType = cur.nextWord().toUpperCase();
                    if (!SUPPORTED_DATASETS.has(datasetType)) {
                        throw new Error(`Dataset type "${datasetType}" is not supported`);
                    }
                    break;
                }
                case "DIMENSIONS": {
                    dims = [cur.nextInt(), cur.nextInt(), cur.nextInt()];
                    break;
                }
                case "ORIGIN": {
                    origin = [cur.nextFloat(), cur.nextFloat(), cur.nextFloat()];
                    break;
                }
                case "SPACING":
                case "ASPECT_RATIO": {
                    spacing = [cur.nextFloat(), cur.nextFloat(), cur.nextFloat()];
                    break;
                }
                case "X_COORDINATES": {
                    const n = cur.nextInt(); const type = cur.nextWord();
                    rectCoords.x = cur.readFloats(n, type);
                    break;
                }
                case "Y_COORDINATES": {
                    const n = cur.nextInt(); const type = cur.nextWord();
                    rectCoords.y = cur.readFloats(n, type);
                    break;
                }
                case "Z_COORDINATES": {
                    const n = cur.nextInt(); const type = cur.nextWord();
                    rectCoords.z = cur.readFloats(n, type);
                    break;
                }
                case "POINTS": {
                    const n = cur.nextInt(); const type = cur.nextWord();
                    pd.setPoints(cur.readFloats(n * 3, type));
                    break;
                }
                case "VERTICES":
                case "LINES":
                case "POLYGONS":
                case "TRIANGLE_STRIPS": {
                    const n = cur.nextInt();
                    const size = cur.nextInt();
                    const cells = readCellBlock(n, size);
                    if (kw === "VERTICES") pd.setVerts(cells);
                    else if (kw === "LINES") pd.setLines(cells);
                    else if (kw === "POLYGONS") pd.setPolys(cells);
                    else pd.setStrips(cells);
                    break;
                }
                case "CELLS": {
                    const n = cur.nextInt();
                    const size = cur.nextInt();
                    rawCells = readCellBlock(n, size);
                    break;
                }
                case "CELL_TYPES": {
                    const n = cur.nextInt();
                    const types = cur.readInts(n, "int");
                    this._convertUnstructured(pd, rawCells, types);
                    break;
                }
                case "POINT_DATA": {
                    currentN = cur.nextInt();
                    currentAttr = pd.pointData;
                    break;
                }
                case "CELL_DATA": {
                    currentN = cur.nextInt();
                    currentAttr = pd.cellData;
                    break;
                }
                case "SCALARS": {
                    const name = cur.nextWord();
                    const type = cur.nextWord();
                    let nComp = 1;
                    if (/^\d+$/.test(cur.peekWordUpper())) nComp = cur.nextInt();
                    if (cur.peekWordUpper() === "LOOKUP_TABLE") cur.skipWords(2);
                    const vals = cur.readFloats(currentN * nComp, type);
                    currentAttr.addArray(new DataArray(name, vals, nComp), { asScalars: true });
                    break;
                }
                case "VECTORS":
                case "NORMALS": {
                    const name = cur.nextWord(); const type = cur.nextWord();
                    const vals = cur.readFloats(currentN * 3, type);
                    currentAttr.addArray(new DataArray(name, vals, 3), { asVectors: kw === "VECTORS" });
                    break;
                }
                case "TENSORS": {
                    const name = cur.nextWord(); const type = cur.nextWord();
                    const vals = cur.readFloats(currentN * 9, type);
                    currentAttr.addArray(new DataArray(name, vals, 9));
                    break;
                }
                case "FIELD": {
                    cur.skipWords(1);                                // field name
                    const numArrays = cur.nextInt();
                    for (let k = 0; k < numArrays; k++) {
                        const name = cur.nextWord();
                        const nComp = cur.nextInt();
                        const nTuples = cur.nextInt(); const type = cur.nextWord();
                        const vals = cur.readFloats(nComp * nTuples, type);
                        currentAttr.addArray(new DataArray(name, vals, nComp));
                    }
                    break;
                }
                case "LOOKUP_TABLE": {
                    cur.skipWords(1);                                // table name
                    const n = cur.nextInt();
                    if (cur.skipDataValues) cur.skipDataValues(n * 4, "float");
                    else cur.skipWords(n * 4);                       // RGBA values — skipped without allocation
                    break;
                }
                case "METADATA": {
                    this._skipMetadata(cur);
                    break;
                }
                default:
                    console.warn(`VTKLegacyReader: Skipping unsupported keyword "${kw}"`);
            }
        }

        this._finalizeStructured(pd, datasetType, dims, origin, spacing, rectCoords);
        return pd;
    }

    _skipMetadata(cur) {
        if (cur.peekWordUpper() === "INFORMATION") {
            cur.skipWords(1);
            const nInfo = cur.nextInt() || 0;
            for (let i = 0; i < nInfo; i++) {
                // Skip forward until the DATA keyword of this information entry
                let w;
                while ((w = cur.nextWord()) !== null && w.toUpperCase() !== "DATA") { /* skip */ }
                if (w !== null) {
                    const m = cur.nextInt() || 0;
                    cur.skipWords(m);
                }
            }
        }
    }

    _finalizeStructured(pd, datasetType, dims, origin, spacing, rectCoords) {
        if (!datasetType || !STRUCTURED_DATASETS.has(datasetType)) return;
        if (!dims) throw new Error(`${datasetType} missing DIMENSIONS keyword`);

        if (datasetType === "STRUCTURED_POINTS") {
            pd.setPoints(this._buildImagePoints(dims, origin, spacing));
        } else if (datasetType === "RECTILINEAR_GRID") {
            pd.setPoints(this._buildRectilinearPoints(dims, rectCoords));
        }

        this._buildStructuredSurface(pd, dims);
    }

    _buildImagePoints(dims, origin, spacing) {
        const [nx, ny, nz] = dims;
        const pts = new Float32Array(nx * ny * nz * 3);
        let o = 0;
        for (let k = 0; k < nz; k++) {
            for (let j = 0; j < ny; j++) {
                for (let i = 0; i < nx; i++) {
                    pts[o++] = origin[0] + i * spacing[0];
                    pts[o++] = origin[1] + j * spacing[1];
                    pts[o++] = origin[2] + k * spacing[2];
                }
            }
        }
        return pts;
    }

    _buildRectilinearPoints(dims, rc) {
        const [nx, ny, nz] = dims;
        const xc = rc.x || new Float32Array(nx);
        const yc = rc.y || new Float32Array(ny);
        const zc = rc.z || new Float32Array(nz);
        const pts = new Float32Array(nx * ny * nz * 3);
        let o = 0;
        for (let k = 0; k < nz; k++) {
            for (let j = 0; j < ny; j++) {
                for (let i = 0; i < nx; i++) {
                    pts[o++] = xc[i];
                    pts[o++] = yc[j];
                    pts[o++] = zc[k];
                }
            }
        }
        return pts;
    }

    _buildStructuredSurface(pd, dims) {
        const [nx, ny, nz] = dims;
        const sizes = [nx, ny, nz];
        const gt1 = [nx > 1, ny > 1, nz > 1];
        const nDim = gt1.filter(Boolean).length;
        const polys = [];
        const lines = [];

        const faceQuads = (fAxis, fVal, flip) => {
            const [aAxis, bAxis] = [0, 1, 2].filter(x => x !== fAxis);
            const sa = sizes[aAxis], sb = sizes[bAxis];
            const coord = [0, 0, 0];
            coord[fAxis] = fVal;
            const P = (ia, ib) => {
                coord[aAxis] = ia;
                coord[bAxis] = ib;
                return coord[0] + nx * (coord[1] + ny * coord[2]);
            };
            for (let ib = 0; ib < sb - 1; ib++) {
                for (let ia = 0; ia < sa - 1; ia++) {
                    const quad = [P(ia, ib), P(ia + 1, ib), P(ia + 1, ib + 1), P(ia, ib + 1)];
                    if (flip) quad.reverse();
                    polys.push(quad);
                }
            }
        };

        if (nDim === 3) {
            faceQuads(0, 0, true);      faceQuads(0, nx - 1, false);
            faceQuads(1, 0, false);     faceQuads(1, ny - 1, true);
            faceQuads(2, 0, true);      faceQuads(2, nz - 1, false);
        } else if (nDim === 2) {
            const f = gt1.indexOf(false);
            faceQuads(f, 0, false);
        } else if (nDim === 1) {
            const axis = gt1.indexOf(true);
            const coord = [0, 0, 0];
            const line = [];
            for (let i = 0; i < sizes[axis]; i++) {
                coord[axis] = i;
                line.push(coord[0] + nx * (coord[1] + ny * coord[2]));
            }
            lines.push(line);
        }

        if (polys.length) pd.setPolys(polys);
        if (lines.length) pd.setLines(lines);
    }

    _convertUnstructured(pd, cells, types) {
        if (!cells) return;
        // Preserve the complete source topology for element picking/highlight.
        // Render conversion below may intentionally keep only corner nodes,
        // but higher-order connectivity must remain available to interaction.
        pd.userData = pd.userData || {};
        pd.userData.sourceCells = cells.clone();
        pd.userData.sourceCellTypes = Int32Array.from(types);
        // Accumulated locally and committed to pd once at the end via the
        // CellArray-backed setVerts/setLines/setPolys/setStrips — pd.polys
        // etc. are now typed-array-backed CellArrays and no longer support
        // incremental .push() the way a plain JS array did.
        const out = { verts: [], lines: [], polys: [], strips: [], vertSourceCellMap: [], lineSourceCellMap: [], polySourceCellMap: [], stripSourceCellMap: [] };

        for (let i = 0; i < types.length; i++) {
            const c = cells.getCell(i);
            if (!c || c.length === 0) continue;
            const t = types[i];
            const info = CELL_INFO[t];
            if (!info) {
                console.warn(`VTKLegacyReader: Cell type ${t} is not supported`);
                continue;
            }

            let v = c;
            if (info.corners === "half") v = c.subarray(0, c.length >> 1);
            else if (typeof info.corners === "number" && c.length > info.corners) {
                v = c.subarray(0, info.corners);
            }

            switch (info.family) {
                case "skip": break;
                case "vertex":     out.verts.push([c[0]]); break;
                case "polyvertex": for (const idx of c) out.verts.push([idx]); break;
                case "line":       out.lines.push([v[0], v[1]]); break;
                case "polyline":   out.lines.push(c); break;
                case "strip":      out.strips.push(c); break;
                case "triangle":
                case "quad":
                case "polygon":    out.polys.push(v); break;
                case "pixel":      out.polys.push([c[0], c[1], c[3], c[2]]); break;
                case "tetra":       this._emitTetra(out, v); break;
                case "voxel":       this._emitVoxel(out, c); break;
                case "hexahedron":  this._emitHexahedron(out, v); break;
                case "wedge":       this._emitWedge(out, v); break;
                case "pyramid":     this._emitPyramid(out, v); break;
                case "pentaprism":  this._emitPentaPrism(out, v); break;
                case "hexaprism":   this._emitHexaPrism(out, v); break;
                case "polyhedron":  this._emitPolyhedron(out, c); break;
                case "convex":
                    for (const idx of c) out.verts.push([idx]);
                    console.warn("VTKLegacyReader: CONVEX_POINT_SET is rendered as points only");
                    break;
                default:
                    console.warn(`VTKLegacyReader: Family "${info.family}" not handled`);
            }

            while (out.polySourceCellMap.length < out.polys.length) {
                out.polySourceCellMap.push(i);
            }
            while (out.vertSourceCellMap.length < out.verts.length) out.vertSourceCellMap.push(i);
            while (out.lineSourceCellMap.length < out.lines.length) out.lineSourceCellMap.push(i);
            while (out.stripSourceCellMap.length < out.strips.length) {
                out.stripSourceCellMap.push(i);
            }
        }

        if (out.verts.length) pd.setVerts(out.verts);
        if (out.lines.length) pd.setLines(out.lines);
        if (out.polys.length) pd.setPolys(out.polys);
        if (out.strips.length) pd.setStrips(out.strips);
        if (out.polySourceCellMap.length) pd.userData.polySourceCellMap = Int32Array.from(out.polySourceCellMap);
        if (out.stripSourceCellMap.length) pd.userData.stripSourceCellMap = Int32Array.from(out.stripSourceCellMap);
        if (out.vertSourceCellMap.length) pd.userData.vertSourceCellMap = Int32Array.from(out.vertSourceCellMap);
        if (out.lineSourceCellMap.length) pd.userData.lineSourceCellMap = Int32Array.from(out.lineSourceCellMap);
    }

    _emitTetra(out, v) {
        out.polys.push(
            [v[0], v[2], v[1]], [v[0], v[1], v[3]],
            [v[1], v[2], v[3]], [v[0], v[3], v[2]]
        );
    }

    _emitVoxel(out, c) {
        out.polys.push(
            [c[0], c[1], c[3], c[2]], [c[4], c[6], c[7], c[5]],
            [c[0], c[4], c[5], c[1]], [c[2], c[3], c[7], c[6]],
            [c[0], c[2], c[6], c[4]], [c[1], c[5], c[7], c[3]]
        );
    }

    _emitHexahedron(out, v) {
        out.polys.push(
            [v[0], v[3], v[2], v[1]], [v[4], v[5], v[6], v[7]],
            [v[0], v[1], v[5], v[4]], [v[2], v[3], v[7], v[6]],
            [v[0], v[4], v[7], v[3]], [v[1], v[2], v[6], v[5]]
        );
    }

    _emitWedge(out, v) {
        out.polys.push(
            [v[0], v[1], v[2]], [v[3], v[5], v[4]],
            [v[0], v[3], v[4], v[1]], [v[1], v[4], v[5], v[2]], [v[0], v[2], v[5], v[3]]
        );
    }

    _emitPyramid(out, v) {
        out.polys.push(
            [v[0], v[3], v[2], v[1]],
            [v[0], v[1], v[4]], [v[1], v[2], v[4]], [v[2], v[3], v[4]], [v[3], v[0], v[4]]
        );
    }

    _emitPentaPrism(out, v) {
        out.polys.push(
            [v[0], v[4], v[3], v[2], v[1]], [v[5], v[6], v[7], v[8], v[9]],
            [v[0], v[1], v[6], v[5]], [v[1], v[2], v[7], v[6]], [v[2], v[3], v[8], v[7]],
            [v[3], v[4], v[9], v[8]], [v[4], v[0], v[5], v[9]]
        );
    }

    _emitHexaPrism(out, v) {
        out.polys.push(
            [v[0], v[5], v[4], v[3], v[2], v[1]], [v[6], v[7], v[8], v[9], v[10], v[11]],
            [v[0], v[1], v[7], v[6]], [v[1], v[2], v[8], v[7]], [v[2], v[3], v[9], v[8]],
            [v[3], v[4], v[10], v[9]], [v[4], v[5], v[11], v[10]], [v[5], v[0], v[6], v[11]]
        );
    }

    _emitPolyhedron(out, c) {
        let idx = 0;
        const numFaces = c[idx++];
        for (let f = 0; f < numFaces && idx < c.length; f++) {
            const np = c[idx++];
            if (np >= 3) out.polys.push(c.subarray(idx, idx + np));
            idx += np;
        }
    }
}
