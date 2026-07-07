// Sources/BoxSource.js
// Source sinh PolyData khối hộp có chia lưới (segments) — thay cho việc tô màu
// thủ công trên THREE.BoxGeometry. Tận dụng chính THREE.BoxGeometry rồi chuyển
// sang PolyData để đi qua pipeline (gán scalar, contour, clip, mapper...).

import * as THREE from "three";
import { geometryToPolyData } from "../Core/Conversion.js";
import { DataArray } from "../Core/PolyData.js";

export class BoxSource {
    constructor(options = {}) {
        this.xLength = options.xLength ?? 1;
        this.yLength = options.yLength ?? 1;
        this.zLength = options.zLength ?? 1;
        this.segments = options.segments ?? 20;
    }

    getOutputData() {
        const g = new THREE.BoxGeometry(
            this.xLength, this.yLength, this.zLength,
            this.segments, this.segments, this.segments
        );
        const pd = geometryToPolyData(g);
        g.dispose();
        return pd;
    }

    /**
     * Tiện ích: sinh box kèm 1 scalar field tính từ tọa độ mỗi đỉnh.
     * @param {string} name tên array (vd: "stress")
     * @param {(x:number,y:number,z:number)=>number} fn hàm giá trị
     */
    getOutputDataWithScalars(name, fn) {
        const pd = this.getOutputData();
        const n = pd.getNumberOfPoints();
        const vals = new Float32Array(n);
        for (let i = 0; i < n; i++) {
            vals[i] = fn(pd.points[i * 3], pd.points[i * 3 + 1], pd.points[i * 3 + 2]);
        }
        pd.pointData.addArray(new DataArray(name, vals, 1), { asScalars: true });
        return pd;
    }
}