// Sources/Source.js
// Base class cho nguồn dữ liệu mẫu (tương đương vtkPolyDataAlgorithm nguồn).
// Lớp con override getOutputData() để trả về PolyData.

export class Source {
    constructor() { this._output = null; }
    getOutputData() { throw new Error("Source con phải override getOutputData()"); }
}
