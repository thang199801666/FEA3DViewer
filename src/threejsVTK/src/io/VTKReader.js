// IO/VTKReader.js

import { VTKLegacyReader } from "./VTKLegacyReader.js";
import { VTPReader } from "./VTPReader.js";
import { Algorithm } from "../core/Algorithm.js";
import { canUseVTKWorker, parseVTKInWorker } from "./vtkWorkerClient.js";
import { recordPerformance } from "../performance/telemetry.js";

/**
 * VTKReader is now an Algorithm (mirrors native VTK's vtkReader family:
 * vtkXMLPolyDataReader, vtkPolyDataReader, etc. all expose SetFileName() +
 * Update() + GetOutput()). setFileName()/setInputSource() mark the reader
 * modified (so a stale cached output is invalidated); getOutputData()/
 * getOutput() lazily (re-)parses only when needed, exactly once per unique
 * input, then serves the cached PolyData.
 *
 * parse()/parseFile() are unchanged and still usable directly for
 * synchronous/one-off parsing without going through the pipeline API.
 */
export class VTKReader extends Algorithm {
    constructor(options = {}) {
        super();
        this.options = options;
        this._legacy = new VTKLegacyReader(options);
        this._vtp = new VTPReader(options);
        this._fileName = "";
        this._sourceInput = null;
        this._detectedFormat = null;
    }

    /** VTK-style SetFileName(): identifies the input for the next Update(),
     *  without itself supplying the file's contents (see setInputSource()). */
    setFileName(name) {
        if (this._fileName !== name) {
            this._fileName = name || "";
            this._detectedFormat = null;
            this.modified();
        }
        return this;
    }

    getFileName() {
        return this._fileName;
    }

    /** Provide the raw text/ArrayBuffer to parse on the next Update() —
     *  the in-memory equivalent of SetFileName() for readers with no
     *  upstream pipeline stage feeding them. */
    setInputSource(data, fileName = "") {
        if (this._sourceInput !== data) {
            this._sourceInput = data;
            if (fileName) this._fileName = fileName;
            this._detectedFormat = null;
            this.modified();
        }
        return this;
    }

    requestData() {
        if (this._sourceInput == null) {
            throw new Error("VTKReader: no input set (call setInputSource() or parseFile() first)");
        }
        return this.parse(this._sourceInput, { format: this._detectedFormat ?? null, fileName: this._fileName });
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
        const headSlice = file.slice(0, 512);
        const headBuffer = typeof headSlice?.arrayBuffer === "function"
            ? await headSlice.arrayBuffer()
            : await file.arrayBuffer();
        const head = new TextDecoder().decode(new Uint8Array(headBuffer));
        const fmt = this.detectFormat(head, name);

        if (this.options.worker !== false && canUseVTKWorker()) {
            // Structured-clone the File handle; its full payload is read inside the worker.
            // This avoids retaining a second full-file ArrayBuffer on the UI thread.
            return parseVTKInWorker(file, {
                format: fmt,
                fileName: name,
                onProgress: this.options.onProgress,
                signal: this.options.signal,
            });
        }

        const buf = await file.arrayBuffer();
        const started = performance.now();
        this.setInputSource(buf, name);
        this._detectedFormat = fmt;
        const output = this.getOutputData();
        recordPerformance({
            operation: "vtk-import",
            backend: "main-thread",
            fileName: name,
            parseMs: performance.now() - started,
            inputBytes: buf.byteLength,
            pointCount: output.getNumberOfPoints(),
            cellCount: output.getNumberOfCells(),
        });
        return output;
    }
}
