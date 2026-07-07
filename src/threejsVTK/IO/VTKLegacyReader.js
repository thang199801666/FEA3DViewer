// IO/VTKLegacyReader.js
// Đọc file VTK legacy (*.vtk) định dạng ASCII.
// Hỗ trợ đầy đủ các DATASET:
//   - POLYDATA (POINTS, VERTICES, LINES, POLYGONS, TRIANGLE_STRIPS)
//   - UNSTRUCTURED_GRID (CELLS + CELL_TYPES) — hỗ trợ TOÀN BỘ cell type:
//       • tuyến tính: vertex, line, poly, tam/tứ giác, tetra, voxel, hexa,
//         wedge, pyramid, lăng trụ ngũ giác & lục giác, polyhedron, convex set
//       • bậc cao (quadratic/cubic/Lagrange/Bézier): lấy các đỉnh góc đầu
//         danh sách rồi dựng mặt phẳng (xấp xỉ, không tessellate mặt cong)
//   - STRUCTURED_GRID   (DIMENSIONS + POINTS tường minh)
//   - STRUCTURED_POINTS (DIMENSIONS + ORIGIN + SPACING; điểm suy ra ngầm)
//   - RECTILINEAR_GRID  (DIMENSIONS + X/Y/Z_COORDINATES)
//     → với 3 kiểu structured, reader trích BỀ MẶT BIÊN (6 mặt ngoài) để
//       hiển thị, giống vtkGeometryFilter (nhẹ hơn việc dựng toàn bộ cell).
//   - POINT_DATA / CELL_DATA: SCALARS, VECTORS, NORMALS, FIELD
//   - Cả 2 kiểu ghi cell: kiểu cổ điển và kiểu OFFSETS/CONNECTIVITY (VTK >= 5.1)
// Chưa hỗ trợ: định dạng BINARY (hãy export ASCII hoặc dùng .vtp).

import { PolyData, DataArray } from "../Core/PolyData.js";

// Bảng tra cách hiển thị theo VTK cell type (vtkCellType.h).
//   family : hình khối cơ sở để dựng mặt.
//   corners: số đỉnh GÓC lấy từ đầu danh sách điểm (cell bậc cao đặt đỉnh
//            góc lên trước). "half" = nửa đầu (quadratic polygon). Bỏ trống
//            = dùng toàn bộ điểm (polygon/polyline/polyvertex...).
// VTK bảo đảm các đỉnh góc nằm ở đầu, nên cùng một `family` dùng chung được
// cho cả biến thể tuyến tính lẫn bậc cao.
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

    // Quadratic / isoparametric — chỉ dựng theo đỉnh góc
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

    // Đặc biệt
    41: { family: "convex" },                       // CONVEX_POINT_SET
    42: { family: "polyhedron" },                   // POLYHEDRON

    // Higher-order / Lagrange / Bézier — dựng theo đỉnh góc đầu danh sách
    60: { family: "line",        corners: 2 },      // HIGHER_ORDER_EDGE / CURVE
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
    // 51–56 (parametric, deprecated), 63 (higher-order polygon: không rõ số
    // đỉnh góc) và 82 (sentinel) → rơi vào default: cảnh báo & bỏ qua.
};

// Các DATASET legacy có hình học mà reader hỗ trợ.
const SUPPORTED_DATASETS = new Set([
    "POLYDATA", "UNSTRUCTURED_GRID",
    "STRUCTURED_GRID", "STRUCTURED_POINTS", "RECTILINEAR_GRID"
]);
const STRUCTURED_DATASETS = new Set([
    "STRUCTURED_GRID", "STRUCTURED_POINTS", "RECTILINEAR_GRID"
]);

export class VTKLegacyReader {
    /**
     * @param {string|ArrayBuffer} input nội dung file .vtk
     * @returns {PolyData}
     */
    parse(input) {
        const text = typeof input === "string" ? input : new TextDecoder().decode(input);
        const lines = text.split(/\r?\n/);
        if (lines.length < 4 || !/^#\s*vtk/i.test(lines[0])) {
            throw new Error("File không phải định dạng VTK legacy hợp lệ");
        }
        const format = (lines[2] || "").trim().toUpperCase();
        if (format === "BINARY") {
            throw new Error("VTKLegacyReader chưa hỗ trợ VTK legacy BINARY — hãy export ASCII hoặc dùng file .vtp");
        }

        // Tokenize toàn bộ phần thân (bỏ 3 dòng header: version, title, format)
        const tokens = lines.slice(3).join("\n").split(/\s+/).filter(Boolean);
        let p = 0;
        const peek = () => tokens[p];
        const next = () => tokens[p++];
        const nextInt = () => parseInt(next(), 10);
        const nextFloat = () => parseFloat(next());
        const readFloats = (n) => {
            const a = new Float32Array(n);
            for (let i = 0; i < n; i++) a[i] = parseFloat(tokens[p++]);
            return a;
        };
        const readInts = (n) => {
            const a = new Int32Array(n);
            for (let i = 0; i < n; i++) a[i] = parseInt(tokens[p++], 10);
            return a;
        };

        // Đọc 1 khối cell — hỗ trợ cả kiểu cổ điển lẫn kiểu OFFSETS/CONNECTIVITY
        const readCellBlock = (n, size) => {
            if ((peek() || "").toUpperCase() === "OFFSETS") {
                next(); next(); // "OFFSETS" + kiểu dữ liệu
                const offsets = readInts(n);          // n ở đây là numOffsets
                next(); next(); // "CONNECTIVITY" + kiểu dữ liệu
                const conn = readInts(size);
                const cells = [];
                for (let i = 0; i + 1 < n; i++) {
                    cells.push(Array.from(conn.slice(offsets[i], offsets[i + 1])));
                }
                return cells;
            }
            // Kiểu cổ điển: [m, i0..i(m-1)] lặp lại, tổng cộng `size` số
            const cells = [];
            let read = 0;
            while (read < size) {
                const m = nextInt();
                const cell = new Array(m);
                for (let j = 0; j < m; j++) cell[j] = nextInt();
                read += m + 1;
                cells.push(cell);
            }
            return cells;
        };

        const pd = new PolyData();
        let currentAttr = pd.pointData;
        let currentN = 0;
        let rawCells = null; // dành cho UNSTRUCTURED_GRID

        // Thông tin cho các lưới có cấu trúc (dựng hình sau khi đọc xong).
        let datasetType = null;
        let dims = null;                 // [nx, ny, nz]
        let origin = [0, 0, 0];          // STRUCTURED_POINTS
        let spacing = [1, 1, 1];         // STRUCTURED_POINTS
        const rectCoords = { x: null, y: null, z: null }; // RECTILINEAR_GRID

        while (p < tokens.length) {
            const kw = next().toUpperCase();
            switch (kw) {
                case "DATASET": {
                    datasetType = next().toUpperCase();
                    if (!SUPPORTED_DATASETS.has(datasetType)) {
                        throw new Error(
                            `Chưa hỗ trợ DATASET ${datasetType} ` +
                            `(hỗ trợ: ${[...SUPPORTED_DATASETS].join(", ")})`
                        );
                    }
                    break;
                }
                case "DIMENSIONS": {
                    dims = [nextInt(), nextInt(), nextInt()];
                    break;
                }
                case "ORIGIN": {
                    origin = [nextFloat(), nextFloat(), nextFloat()];
                    break;
                }
                case "SPACING":
                case "ASPECT_RATIO": { // ASPECT_RATIO = tên cũ của SPACING
                    spacing = [nextFloat(), nextFloat(), nextFloat()];
                    break;
                }
                case "X_COORDINATES": {
                    const n = nextInt(); next(); // n + kiểu dữ liệu
                    rectCoords.x = readFloats(n);
                    break;
                }
                case "Y_COORDINATES": {
                    const n = nextInt(); next();
                    rectCoords.y = readFloats(n);
                    break;
                }
                case "Z_COORDINATES": {
                    const n = nextInt(); next();
                    rectCoords.z = readFloats(n);
                    break;
                }
                case "POINTS": {
                    const n = nextInt();
                    next(); // kiểu dữ liệu (float/double) — luôn parse về Float32
                    pd.setPoints(readFloats(n * 3));
                    break;
                }
                case "VERTICES":
                case "LINES":
                case "POLYGONS":
                case "TRIANGLE_STRIPS": {
                    const n = nextInt();
                    const size = nextInt();
                    const cells = readCellBlock(n, size);
                    if (kw === "VERTICES") pd.verts = cells;
                    else if (kw === "LINES") pd.lines = cells;
                    else if (kw === "POLYGONS") pd.polys = cells;
                    else pd.strips = cells;
                    break;
                }
                case "CELLS": {
                    const n = nextInt();
                    const size = nextInt();
                    rawCells = readCellBlock(n, size);
                    break;
                }
                case "CELL_TYPES": {
                    const n = nextInt();
                    const types = readInts(n);
                    this._convertUnstructured(pd, rawCells, types);
                    break;
                }
                case "POINT_DATA": {
                    currentN = nextInt();
                    currentAttr = pd.pointData;
                    break;
                }
                case "CELL_DATA": {
                    currentN = nextInt();
                    currentAttr = pd.cellData;
                    break;
                }
                case "SCALARS": {
                    const name = next();
                    next(); // kiểu dữ liệu
                    let nComp = 1;
                    if (/^\d+$/.test(peek() || "")) nComp = nextInt();
                    if ((peek() || "").toUpperCase() === "LOOKUP_TABLE") { next(); next(); }
                    const vals = readFloats(currentN * nComp);
                    currentAttr.addArray(new DataArray(name, vals, nComp), { asScalars: true });
                    break;
                }
                case "VECTORS":
                case "NORMALS": {
                    const name = next();
                    next(); // kiểu dữ liệu
                    const vals = readFloats(currentN * 3);
                    currentAttr.addArray(new DataArray(name, vals, 3), { asVectors: kw === "VECTORS" });
                    break;
                }
                case "TENSORS": {
                    // Tensor 3x3 = 9 thành phần / tuple. Lưu lại như DataArray thường.
                    const name = next();
                    next(); // kiểu dữ liệu
                    const vals = readFloats(currentN * 9);
                    currentAttr.addArray(new DataArray(name, vals, 9));
                    break;
                }
                case "FIELD": {
                    next(); // tên field
                    const numArrays = nextInt();
                    for (let k = 0; k < numArrays; k++) {
                        const name = next();
                        const nComp = nextInt();
                        const nTuples = nextInt();
                        next(); // kiểu dữ liệu
                        const vals = readFloats(nComp * nTuples);
                        currentAttr.addArray(new DataArray(name, vals, nComp));
                    }
                    break;
                }
                case "LOOKUP_TABLE": {
                    // Bảng màu nhúng trong file: bỏ qua (n dòng x 4 giá trị RGBA)
                    next(); // tên bảng
                    const n = nextInt();
                    p += n * 4;
                    break;
                }
                case "METADATA": {
                    this._skipMetadata(tokens, () => p, (v) => { p = v; });
                    break;
                }
                default:
                    console.warn(`VTKLegacyReader: bỏ qua từ khóa không hỗ trợ "${kw}"`);
            }
        }

        // Dựng điểm (nếu ngầm định) và bề mặt cho các lưới có cấu trúc.
        this._finalizeStructured(pd, datasetType, dims, origin, spacing, rectCoords);
        return pd;
    }

    /** Bỏ qua khối METADATA / INFORMATION (VTK >= 8 hay chèn sau POINTS). */
    _skipMetadata(tokens, getP, setP) {
        let p = getP();
        if ((tokens[p] || "").toUpperCase() === "INFORMATION") {
            p++;
            const nInfo = parseInt(tokens[p++], 10) || 0;
            for (let i = 0; i < nInfo; i++) {
                // Dạng: NAME <name> LOCATION <loc>  rồi  DATA <m> <m giá trị>
                while (p < tokens.length && tokens[p].toUpperCase() !== "DATA") p++;
                if (p < tokens.length) {
                    p++; // DATA
                    const m = parseInt(tokens[p++], 10) || 0;
                    p += m;
                }
            }
        }
        setP(p);
    }

    // ---------------------------------------------------------------------
    //  Lưới có cấu trúc (STRUCTURED_GRID / STRUCTURED_POINTS / RECTILINEAR_GRID)
    // ---------------------------------------------------------------------

    /**
     * Sau khi đọc xong file: với các dataset có cấu trúc, dựng điểm (nếu cần)
     * và trích bề mặt biên để hiển thị.
     */
    _finalizeStructured(pd, datasetType, dims, origin, spacing, rectCoords) {
        if (!datasetType || !STRUCTURED_DATASETS.has(datasetType)) return;
        if (!dims) throw new Error(`${datasetType} thiếu từ khóa DIMENSIONS`);

        if (datasetType === "STRUCTURED_POINTS") {
            pd.setPoints(this._buildImagePoints(dims, origin, spacing));
        } else if (datasetType === "RECTILINEAR_GRID") {
            pd.setPoints(this._buildRectilinearPoints(dims, rectCoords));
        }
        // STRUCTURED_GRID đã có POINTS tường minh.

        this._buildStructuredSurface(pd, dims);
    }

    /** Sinh tọa độ điểm cho STRUCTURED_POINTS (image data) từ origin + spacing. */
    _buildImagePoints(dims, origin, spacing) {
        const [nx, ny, nz] = dims;
        const pts = new Float32Array(nx * ny * nz * 3);
        let o = 0;
        for (let k = 0; k < nz; k++)
            for (let j = 0; j < ny; j++)
                for (let i = 0; i < nx; i++) {
                    pts[o++] = origin[0] + i * spacing[0];
                    pts[o++] = origin[1] + j * spacing[1];
                    pts[o++] = origin[2] + k * spacing[2];
                }
        return pts;
    }

    /** Sinh tọa độ điểm cho RECTILINEAR_GRID từ 3 mảng tọa độ trục. */
    _buildRectilinearPoints(dims, rc) {
        const [nx, ny, nz] = dims;
        const xc = rc.x || new Float32Array(nx);
        const yc = rc.y || new Float32Array(ny);
        const zc = rc.z || new Float32Array(nz);
        const pts = new Float32Array(nx * ny * nz * 3);
        let o = 0;
        for (let k = 0; k < nz; k++)
            for (let j = 0; j < ny; j++)
                for (let i = 0; i < nx; i++) {
                    pts[o++] = xc[i];
                    pts[o++] = yc[j];
                    pts[o++] = zc[k];
                }
        return pts;
    }

    /**
     * Trích bề mặt của lưới có cấu trúc kích thước [nx, ny, nz]:
     *   - Khối 3D: 6 mặt biên ngoài (mỗi mặt là lưới quad).
     *   - Tấm 2D (một chiều = 1): toàn bộ quad trên mặt phẳng đó.
     *   - Đường 1D (hai chiều = 1): một polyline.
     * Chỉ số điểm theo quy ước VTK: idx = i + nx*(j + ny*k).
     */
    _buildStructuredSurface(pd, dims) {
        const [nx, ny, nz] = dims;
        const sizes = [nx, ny, nz];
        const gt1 = [nx > 1, ny > 1, nz > 1];
        const nDim = gt1.filter(Boolean).length;

        // Sinh các quad cho mặt cố định trục `fAxis` tại giá trị `fVal`.
        // `flip` để đảo winding cho pháp tuyến hướng ra ngoài.
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
                    pd.polys.push(quad);
                }
            }
        };

        if (nDim === 3) {
            faceQuads(0, 0, true);      faceQuads(0, nx - 1, false); // mặt X
            faceQuads(1, 0, false);     faceQuads(1, ny - 1, true);  // mặt Y
            faceQuads(2, 0, true);      faceQuads(2, nz - 1, false); // mặt Z
        } else if (nDim === 2) {
            // Tấm phẳng: trục bị "dẹt" (size = 1) làm trục cố định.
            const f = gt1.indexOf(false);
            faceQuads(f, 0, false);
        } else if (nDim === 1) {
            // Đường thẳng: nối các điểm dọc trục còn lại thành polyline.
            const axis = gt1.indexOf(true);
            const coord = [0, 0, 0];
            const line = [];
            for (let i = 0; i < sizes[axis]; i++) {
                coord[axis] = i;
                line.push(coord[0] + nx * (coord[1] + ny * coord[2]));
            }
            pd.lines.push(line);
        }
        // nDim === 0: chỉ một điểm — không sinh hình.
    }

    /**
     * Chuyển các cell của UNSTRUCTURED_GRID thành verts/lines/polys/strips để
     * hiển thị. Dùng bảng CELL_INFO nên phủ toàn bộ cell type (kể cả bậc cao).
     */
    _convertUnstructured(pd, cells, types) {
        if (!cells) return;
        for (let i = 0; i < types.length; i++) {
            const c = cells[i];
            if (!c || c.length === 0) continue;
            const t = types[i];
            const info = CELL_INFO[t];
            if (!info) {
                console.warn(`VTKLegacyReader: bỏ qua cell type ${t} chưa hỗ trợ`);
                continue;
            }

            // Với cell bậc cao, chỉ giữ các đỉnh góc ở đầu danh sách.
            let v = c;
            if (info.corners === "half") v = c.slice(0, c.length >> 1);
            else if (typeof info.corners === "number" && c.length > info.corners) {
                v = c.slice(0, info.corners);
            }

            switch (info.family) {
                case "skip": break;
                case "vertex":     pd.verts.push([c[0]]); break;
                case "polyvertex": for (const idx of c) pd.verts.push([idx]); break;
                case "line":       pd.lines.push([v[0], v[1]]); break;
                case "polyline":   pd.lines.push(c.slice()); break;
                case "strip":      pd.strips.push(c.slice()); break;
                case "triangle":
                case "quad":
                case "polygon":    pd.polys.push(v.slice()); break;
                case "pixel":      pd.polys.push([c[0], c[1], c[3], c[2]]); break;
                case "tetra":       this._emitTetra(pd, v); break;
                case "voxel":       this._emitVoxel(pd, c); break;
                case "hexahedron":  this._emitHexahedron(pd, v); break;
                case "wedge":       this._emitWedge(pd, v); break;
                case "pyramid":     this._emitPyramid(pd, v); break;
                case "pentaprism":  this._emitPentaPrism(pd, v); break;
                case "hexaprism":   this._emitHexaPrism(pd, v); break;
                case "polyhedron":  this._emitPolyhedron(pd, c); break;
                case "convex":
                    // Không rõ topology mặt → vẽ tập điểm.
                    for (const idx of c) pd.verts.push([idx]);
                    console.warn("VTKLegacyReader: CONVEX_POINT_SET chỉ hiển thị dạng điểm");
                    break;
                default:
                    console.warn(`VTKLegacyReader: family "${info.family}" chưa xử lý`);
            }
        }
    }

    // --- Các hàm dựng mặt cho khối 3D (v = mảng đỉnh góc theo thứ tự VTK) ---

    _emitTetra(pd, v) {
        pd.polys.push(
            [v[0], v[2], v[1]], [v[0], v[1], v[3]],
            [v[1], v[2], v[3]], [v[0], v[3], v[2]]
        );
    }

    _emitVoxel(pd, c) { // voxel: thứ tự đỉnh khác hexahedron
        pd.polys.push(
            [c[0], c[1], c[3], c[2]], [c[4], c[6], c[7], c[5]],
            [c[0], c[4], c[5], c[1]], [c[2], c[3], c[7], c[6]],
            [c[0], c[2], c[6], c[4]], [c[1], c[5], c[7], c[3]]
        );
    }

    _emitHexahedron(pd, v) {
        pd.polys.push(
            [v[0], v[3], v[2], v[1]], [v[4], v[5], v[6], v[7]],
            [v[0], v[1], v[5], v[4]], [v[2], v[3], v[7], v[6]],
            [v[0], v[4], v[7], v[3]], [v[1], v[2], v[6], v[5]]
        );
    }

    _emitWedge(pd, v) {
        pd.polys.push(
            [v[0], v[1], v[2]], [v[3], v[5], v[4]],
            [v[0], v[3], v[4], v[1]], [v[1], v[4], v[5], v[2]], [v[0], v[2], v[5], v[3]]
        );
    }

    _emitPyramid(pd, v) {
        pd.polys.push(
            [v[0], v[3], v[2], v[1]],
            [v[0], v[1], v[4]], [v[1], v[2], v[4]], [v[2], v[3], v[4]], [v[3], v[0], v[4]]
        );
    }

    _emitPentaPrism(pd, v) { // 2 đáy ngũ giác + 5 mặt bên
        pd.polys.push(
            [v[0], v[4], v[3], v[2], v[1]], [v[5], v[6], v[7], v[8], v[9]],
            [v[0], v[1], v[6], v[5]], [v[1], v[2], v[7], v[6]], [v[2], v[3], v[8], v[7]],
            [v[3], v[4], v[9], v[8]], [v[4], v[0], v[5], v[9]]
        );
    }

    _emitHexaPrism(pd, v) { // 2 đáy lục giác + 6 mặt bên
        pd.polys.push(
            [v[0], v[5], v[4], v[3], v[2], v[1]], [v[6], v[7], v[8], v[9], v[10], v[11]],
            [v[0], v[1], v[7], v[6]], [v[1], v[2], v[8], v[7]], [v[2], v[3], v[9], v[8]],
            [v[3], v[4], v[10], v[9]], [v[4], v[5], v[11], v[10]], [v[5], v[0], v[6], v[11]]
        );
    }

    /**
     * POLYHEDRON: connectivity dạng face-stream
     *   [numFaces, n0, p0_0..p0_(n0-1), n1, p1_0.., ...]
     * (định dạng CELLS cổ điển). Mỗi mặt >= 3 đỉnh được đẩy thành 1 polygon.
     * Lưu ý: kiểu OFFSETS/CONNECTIVITY (VTK >= 5.1) lưu mặt ở khối FACES riêng
     * mà reader chưa đọc — polyhedron kiểu đó sẽ không dựng được mặt.
     */
    _emitPolyhedron(pd, c) {
        let idx = 0;
        const numFaces = c[idx++];
        for (let f = 0; f < numFaces && idx < c.length; f++) {
            const np = c[idx++];
            if (np >= 3) pd.polys.push(c.slice(idx, idx + np));
            idx += np;
        }
    }
}