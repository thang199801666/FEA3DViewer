// Filters/WarpFilter.js
// CỰC KỲ QUAN TRỌNG (FEA): biến dạng lưới theo vector chuyển vị (Deformed shape).
//   point' = point + scaleFactor * displacement
// Hoạt động với CẢ PolyData lẫn UnstructuredGrid (giữ nguyên topology & mọi data array).
// Tương đương vtkWarpVector.

import { Filter } from "./Filter.js";

export class WarpFilter extends Filter {
    constructor() {
        super();
        this.scaleFactor = 1.0;
        this.vectorArrayName = null; // null = dùng activeVectors của pointData
    }

    setScaleFactor(s) { this.scaleFactor = s; return this; }
    setVectorArrayName(name) { this.vectorArrayName = name; return this; }

    _resolveVectors(input) {
        const pd = input.pointData;
        return this.vectorArrayName ? pd.getArray(this.vectorArrayName) : pd.getVectors();
    }

    getOutputData() {
        const input = this.input;
        if (!input) throw new Error("WarpFilter: chưa có input (setInputData)");

        const vec = this._resolveVectors(input);
        if (!vec || vec.numberOfComponents < 3) {
            console.warn("[WarpFilter] Không tìm thấy vector 3 thành phần để biến dạng — trả về bản sao.");
            return input.clone();
        }

        const out = input.clone();               // giữ nguyên topology + data
        const src = input.points;
        const dst = out.points;                  // clone đã tạo Float32Array riêng
        const s = this.scaleFactor;
        const n = input.getNumberOfPoints();

        for (let i = 0; i < n; i++) {
            dst[i * 3]     = src[i * 3]     + s * vec.getComponent(i, 0);
            dst[i * 3 + 1] = src[i * 3 + 1] + s * vec.getComponent(i, 1);
            dst[i * 3 + 2] = src[i * 3 + 2] + s * vec.getComponent(i, 2);
        }
        out.modified();
        return out;
    }
}
