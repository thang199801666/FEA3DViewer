// IO/VTKReader.js

import { VTKLegacyReader } from "./VTKLegacyReader.js";
import { VTPReader } from "./VTPReader.js";

export class VTKReader {
    constructor(options = {}) {
        this.options = options;
        this._legacy = new VTKLegacyReader(options);
        this._vtp = new VTPReader(options);
    }

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
        const fmt = format ?? this.detectFormat(
            typeof input === "string"
                ? input
                : new TextDecoder().decode(new Uint8Array(input, 0, Math.min(512, input.byteLength))),
            fileName
        );
        switch (fmt) {
            case "vtp":
            case "vtu":
                return this._vtp.parse(input);
            case "vtk":
            default:
                return this._legacy.parse(input);
        }
    }

    async parseFile(file) {
        const name = file.name || "";

        // PERFORMANCE + CORRECTNESS FIX:
        // The previous implementation read the file twice (a 512-byte head via
        // slice().text(), then the full body via text() or arrayBuffer()), and
        // routed .vtp/.vtu through file.text(). Decoding the whole file as
        // UTF-8 text is slower for large files AND silently corrupts binary
        // payloads in <AppendedData encoding="raw"> (invalid UTF-8 sequences
        // are replaced). Reading the ArrayBuffer once fixes both: VTPReader
        // accepts ArrayBuffer natively and only decodes the XML head to text.
        const buf = await file.arrayBuffer();
        const headLen = Math.min(512, buf.byteLength);
        const head = new TextDecoder().decode(new Uint8Array(buf, 0, headLen));
        const fmt = this.detectFormat(head, name);

        return this.parse(buf, { format: fmt, fileName: name });
    }
}