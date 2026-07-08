// Mappers/DataSetMapper.js
// Mapper chung cho MỌI DataSet (tương đương vtkDataSetMapper).
// Nếu input là UnstructuredGrid -> tự trích bề mặt ngoài rồi map như PolyData.
// Giữ nguyên toàn bộ API của PolyDataMapper (setLookupTable, setColorBy, buildGeometry...).

import { PolyDataMapper } from "./PolyDataMapper.js";
import { PolyData } from "../Core/PolyData.js";
import { UnstructuredGrid } from "../Core/UnstructuredGrid.js";

export class DataSetMapper extends PolyDataMapper {
    constructor() {
        super();
        this.isDataSetMapper = true;
        this._rawInput = null;
    }

    setInputData(dataSet) {
        this._rawInput = dataSet;
        // Chuẩn hóa mọi thứ về PolyData bề mặt cho pipeline hiển thị.
        if (dataSet instanceof UnstructuredGrid) {
            super.setInputData(dataSet.extractSurface());
        } else if (dataSet instanceof PolyData) {
            super.setInputData(dataSet);
        } else if (dataSet && dataSet.points) {
            const pd = new PolyData();
            pd.setPoints(Float32Array.from(dataSet.points));
            super.setInputData(pd);
        } else {
            throw new Error("DataSetMapper: input không phải DataSet hợp lệ");
        }
        return this;
    }

    /** DataSet gốc (chưa trích bề mặt) — hữu ích khi cần warp/clip trên khối. */
    getRawInput() { return this._rawInput; }
}
