// Filters/DataSetSurfaceFilter.js
// Chuyển mọi DataSet -> PolyData bề mặt để render (tương đương vtkDataSetSurfaceFilter/vtkGeometryFilter).
//   - UnstructuredGrid  : trích mặt ngoài (external faces)
//   - PolyData          : trả về chính nó (đã là bề mặt)
// Đặt filter này TRƯỚC mapper khi làm việc với solid FEA.

import { Filter } from "./Filter.js";
import { PolyData } from "../Core/PolyData.js";
import { UnstructuredGrid } from "../Core/UnstructuredGrid.js";

export class DataSetSurfaceFilter extends Filter {
    constructor() {
        super();
        this.passCellData = true;
    }

    getOutputData() {
        const input = this.input;
        if (!input) throw new Error("DataSetSurfaceFilter: chưa có input");
        if (input instanceof UnstructuredGrid) {
            return input.extractSurface({ passCellData: this.passCellData });
        }
        if (input instanceof PolyData) return input;
        // DataSet lạ: cố gắng dựng point cloud tối thiểu
        const pd = new PolyData();
        pd.setPoints(Float32Array.from(input.points));
        return pd;
    }
}
