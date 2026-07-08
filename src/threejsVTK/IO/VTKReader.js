// IO/VTKReader.js
// Reader hợp nhất: tự nhận diện định dạng và ủy quyền cho reader phù hợp.
//   .vtk (legacy ASCII/binary)  -> VTKLegacyReader
//   .vtp (XML PolyData)         -> VTPReader
//   .vtu (XML UnstructuredGrid) -> VTPReader (cùng cơ chế XML DataArray; xem ghi chú)
//
//   const reader = new VTKReader();
//   const dataset = reader.parse(text, { format: "vtk" });   // hoặc parseFile(file)

import { VTKLegacyReader } from "./VTKLegacyReader.js";
import { VTPReader } from "./VTPReader.js";

export class VTKReader {
    constructor(options = {}) {
        this.options = options;
        this._legacy = new VTKLegacyReader(options);
        this._vtp = new VTPReader(options);
    }

    /** Đoán format từ tên file hoặc nội dung. */
    detectFormat(input, fileName = "") {
        const ext = fileName.split(".").pop()?.toLowerCase();
        if (ext === "vtp") return "vtp";
        if (ext === "vtu") return "vtu";
        if (ext === "vtk") return "vtk";
        const head = typeof input === "string" ? input.slice(0, 512) : "";
        if (head.includes("<VTKFile")) {
            if (head.includes('type="PolyData"')) return "vtp";
            if (head.includes('type="UnstructuredGrid"')) return "vtu";
            return "vtp";
        }
        if (head.startsWith("# vtk DataFile")) return "vtk";
        return "vtk";
    }

    parse(input, { format = null, fileName = "" } = {}) {
        const fmt = format ?? this.detectFormat(input, fileName);
        switch (fmt) {
            case "vtp":
            case "vtu":
                return this._vtp.parse(input);
            case "vtk":
            default:
                return this._legacy.parse(input);
        }
    }

    /** Đọc từ File/Blob (trình duyệt). Trả về Promise<DataSet>. */
    async parseFile(file) {
        const name = file.name || "";
        const fmt = this.detectFormat("", name);
        // XML text vs legacy có thể nhị phân -> đọc theo cách an toàn
        if (fmt === "vtk") {
            const buf = await file.arrayBuffer();
            return this.parse(buf, { format: "vtk", fileName: name });
        }
        const text = await file.text();
        return this.parse(text, { format: fmt, fileName: name });
    }
}
