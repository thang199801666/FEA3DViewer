// Core/CellTypes.js
// Hằng số loại phần tử (cell type) theo chuẩn VTK + bảng topology các mặt/cạnh.
// Đây là nền tảng để UnstructuredGrid render solid element (tet/hex/wedge/pyramid)
// bằng cách trích BỀ MẶT NGOÀI (external faces) — chỉ giữ mặt xuất hiện đúng 1 lần.

export const CellType = Object.freeze({
    // Linear cells
    VERTEX: 1,
    POLY_VERTEX: 2,
    LINE: 3,
    POLY_LINE: 4,
    TRIANGLE: 5,
    TRIANGLE_STRIP: 6,
    POLYGON: 7,
    PIXEL: 8,
    QUAD: 9,
    TETRA: 10,
    VOXEL: 11,
    HEXAHEDRON: 12,
    WEDGE: 13,
    PYRAMID: 14,
    PENTAGONAL_PRISM: 15,
    HEXAGONAL_PRISM: 16,
    // Quadratic (bậc 2) — thường gặp trong Abaqus/Ansys (C3D10, C3D20...)
    QUADRATIC_EDGE: 21,
    QUADRATIC_TRIANGLE: 22,
    QUADRATIC_QUAD: 23,
    QUADRATIC_TETRA: 24,
    QUADRATIC_HEXAHEDRON: 25,
    QUADRATIC_WEDGE: 26,
    QUADRATIC_PYRAMID: 27,
});

// Số đỉnh (đỉnh góc/tuyến tính) cho mỗi loại — dùng khi cần suy ra nếu offsets thiếu.
export const CELL_NUM_POINTS = {
    [CellType.VERTEX]: 1,
    [CellType.LINE]: 2,
    [CellType.TRIANGLE]: 3,
    [CellType.QUAD]: 4,
    [CellType.PIXEL]: 4,
    [CellType.TETRA]: 4,
    [CellType.VOXEL]: 8,
    [CellType.HEXAHEDRON]: 8,
    [CellType.WEDGE]: 6,
    [CellType.PYRAMID]: 5,
    [CellType.QUADRATIC_TETRA]: 10,
    [CellType.QUADRATIC_HEXAHEDRON]: 20,
    [CellType.QUADRATIC_WEDGE]: 15,
    [CellType.QUADRATIC_PYRAMID]: 13,
};

// Bảng mặt (face) cho từng loại solid — mỗi mặt là danh sách chỉ số LOCAL trong cell.
// Thứ tự đỉnh theo quy ước VTK (pháp tuyến hướng ra ngoài khi dùng right-hand rule).
export const CELL_FACES = {
    [CellType.TETRA]: [
        [0, 1, 3], [1, 2, 3], [2, 0, 3], [0, 2, 1],
    ],
    [CellType.HEXAHEDRON]: [
        [0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4],
        [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7],
    ],
    // VOXEL: thứ tự đỉnh khác HEXAHEDRON (0,1,2,3 / 4,5,6,7 với 2<->3 hoán vị hình học)
    [CellType.VOXEL]: [
        [0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4],
        [1, 3, 7, 5], [3, 2, 6, 7], [2, 0, 4, 6],
    ],
    [CellType.WEDGE]: [
        [0, 1, 2], [3, 5, 4],
        [0, 3, 4, 1], [1, 4, 5, 2], [2, 5, 3, 0],
    ],
    [CellType.PYRAMID]: [
        [0, 3, 2, 1],
        [0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4],
    ],
};

// Quadratic solids: chỉ dùng 8 (hoặc 4/6) đỉnh góc đầu tiên để trích mặt tuyến tính.
// Đủ tốt cho hiển thị bề mặt (bỏ qua đỉnh giữa cạnh).
CELL_FACES[CellType.QUADRATIC_TETRA] = CELL_FACES[CellType.TETRA];
CELL_FACES[CellType.QUADRATIC_HEXAHEDRON] = CELL_FACES[CellType.HEXAHEDRON];
CELL_FACES[CellType.QUADRATIC_WEDGE] = CELL_FACES[CellType.WEDGE];
CELL_FACES[CellType.QUADRATIC_PYRAMID] = CELL_FACES[CellType.PYRAMID];

// Số đỉnh GÓC (corner) dùng cho topology mặt — quadratic map về linear tương ứng.
export const CELL_NUM_CORNERS = {
    [CellType.TETRA]: 4, [CellType.QUADRATIC_TETRA]: 4,
    [CellType.HEXAHEDRON]: 8, [CellType.VOXEL]: 8, [CellType.QUADRATIC_HEXAHEDRON]: 8,
    [CellType.WEDGE]: 6, [CellType.QUADRATIC_WEDGE]: 6,
    [CellType.PYRAMID]: 5, [CellType.QUADRATIC_PYRAMID]: 5,
};

export function isSolidCell(type) {
    return CELL_FACES[type] !== undefined;
}

export function is2DCell(type) {
    return type === CellType.TRIANGLE || type === CellType.QUAD ||
           type === CellType.POLYGON || type === CellType.PIXEL ||
           type === CellType.QUADRATIC_TRIANGLE || type === CellType.QUADRATIC_QUAD;
}
