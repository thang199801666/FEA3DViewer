// Filters/GeometryFilter.js
import * as THREE from "three";

/**
 * GeometryFilter - Rút mặt ngoài (External Surface) của cấu trúc hình học
 * Tiếp cận theo kiến trúc topo và thuật toán gốc của VTK (vtkGeometryFilter).
 */
export class GeometryFilter {
    constructor() {
        this.inputData = null;
        this.outputData = null;

        // Các thuộc tính cấu hình chuẩn VTK
        this.removeInternalWalls = true;
        this.weldTolerance = 1e-6; // Định vị point bucket cực kỳ chính xác
        this.recomputeNormals = true;
    }

    // ------------------------------------------------------------------
    // VTK Pipeline Methods
    // ------------------------------------------------------------------

    setInputData(geometry) {
        if (geometry && geometry.isBufferGeometry) {
            this.inputData = geometry;
        } else {
            this.inputData = null;
        }
        this.outputData = null; // Reset output khi đầu vào thay đổi
        return this;
    }

    setRemoveInternalWalls(enabled) {
        this.removeInternalWalls = !!enabled;
        return this;
    }

    setWeldTolerance(tolerance) {
        this.weldTolerance = Array.isArray(tolerance) ? tolerance[0] : Number(tolerance);
        return this;
    }

    setRecomputeNormals(enabled) {
        this.recomputeNormals = !!enabled;
        return this;
    }

    /**
     * Thực thi filter và trả về kết quả hình học bao ngoài sạch vách trong
     */
    getOutputData() {
        if (this.outputData) {
            return this.outputData;
        }

        if (!this.inputData) {
            console.warn("[GeometryFilter] No input geometry data available.");
            return null;
        }

        this._update();
        return this.outputData;
    }

    // Alias giống cách gọi hàm của một số bộ lọc khác
    update() {
        return this.getOutputData();
    }

    // ------------------------------------------------------------------
    // Core VTK Algorithm Core
    // ------------------------------------------------------------------

    _update() {
        const geometry = this.inputData;
        const posAttr = geometry.getAttribute("position");

        // Trường hợp lỗi dữ liệu đầu vào hoặc hình học rỗng
        if (!posAttr || posAttr.count < 3) {
            this.outputData = geometry;
            return;
        }

        const indexAttr = geometry.getIndex();
        const triCount = indexAttr ? (indexAttr.count / 3) : (posAttr.count / 3);

        // --- BƯỚC 1: VTK Point Bucket / Vertex Clustering ---
        // Ép số thực (float) về lưới số nguyên tương ứng dựa trên dung sai để gom đỉnh trùng khít
        const precision = 1 / this.weldTolerance;
        const vertexMap = new Map(); // Key chuỗi tọa độ làm tròn -> Unique Point ID
        const pointIdArray = new Int32Array(posAttr.count);
        let uniqueVertexCount = 0;

        for (let i = 0; i < posAttr.count; i++) {
            const rx = Math.round(posAttr.getX(i) * precision) / precision;
            const ry = Math.round(posAttr.getY(i) * precision) / precision;
            const rz = Math.round(posAttr.getZ(i) * precision) / precision;

            // Sử dụng template string có độ chính xác cao làm khóa băm
            const key = `${rx}_${ry}_${rz}`;

            if (!vertexMap.has(key)) {
                vertexMap.set(key, uniqueVertexCount);
                pointIdArray[i] = uniqueVertexCount;
                uniqueVertexCount++;
            } else {
                pointIdArray[i] = vertexMap.get(key);
            }
        }

        // --- BƯỚC 2: VTK Face Hashing & Counting ---
        // Quét qua từng mặt tam giác (hoặc Cell face), gộp ID đỉnh tăng dần để tạo khóa Topo băm
        const faceMap = new Map(); // FaceKey -> { count, t0 }
        const getGlobalVertId = indexAttr 
            ? (t, k) => pointIdArray[indexAttr.getX(t * 3 + k)] 
            : (t, k) => pointIdArray[t * 3 + k];

        for (let t = 0; t < triCount; t++) {
            const v0 = getGlobalVertId(t, 0);
            const v1 = getGlobalVertId(t, 1);
            const v2 = getGlobalVertId(t, 2);

            // Bỏ qua các phần tử tam giác bị thoái hóa dạng đường/điểm (degenerated)
            if (v0 === v1 || v1 === v2 || v0 === v2) continue;

            // Sắp xếp ID tăng dần (Nhà sản xuất khóa không phụ thuộc chiều Winding)
            let a = v0, b = v1, c = v2, tmp;
            if (a > b) { tmp = a; a = b; b = tmp; }
            if (b > c) { tmp = b; b = c; c = tmp; }
            if (a > b) { tmp = a; a = b; b = tmp; }

            const faceKey = `${a}_${b}_${c}`;

            let faceData = faceMap.get(faceKey);
            if (!faceData) {
                faceData = { count: 0, t0: t };
                faceMap.set(faceKey, faceData);
            }
            faceData.count++;
        }

        // --- BƯỚC 3: Loại bỏ vách trong (Internal Cell Face Elimination) ---
        // Mặt biên ngoài (Boundary) chỉ thuộc 1 phần tử khối -> count = 1.
        // Mặt nội bộ (Internal) nằm giữa 2 phần tử kề nhau -> count = 2 -> Loại bỏ.
        const keptIndices = [];
        const origIndexGetter = indexAttr 
            ? (t, k) => indexAttr.getX(t * 3 + k) 
            : (t, k) => t * 3 + k;

        for (const [key, data] of faceMap.entries()) {
            if (this.removeInternalWalls) {
                if (data.count === 1) {
                    const t = data.t0;
                    keptIndices.push(origIndexGetter(t, 0), origIndexGetter(t, 1), origIndexGetter(t, 2));
                }
            } else {
                const t = data.t0;
                keptIndices.push(origIndexGetter(t, 0), origIndexGetter(t, 1), origIndexGetter(t, 2));
            }
        }

        // Nếu không có vách trong nào bị triệt tiêu, tái sử dụng luôn để tối ưu bộ nhớ
        if (keptIndices.length === triCount * 3) {
            this.outputData = geometry;
            return;
        }

        // --- BƯỚC 4: Tạo dữ liệu đầu ra PolyData/BufferGeometry mới ---
        const outGeometry = new THREE.BufferGeometry();

        // Sao chép nguyên vẹn tất cả dữ liệu mảng thuộc tính đi kèm (uv, color, scalars,...)
        for (const attrName of Object.keys(geometry.attributes)) {
            outGeometry.setAttribute(attrName, geometry.attributes[attrName].clone());
        }

        // Đổ danh sách Index các mặt ngoài cùng vào geometry mới
        outGeometry.setIndex(new THREE.BufferAttribute(new Uint32Array(keptIndices), 1));

        if (this.recomputeNormals) {
            outGeometry.computeVertexNormals();
        }

        this.outputData = outGeometry;
    }
}