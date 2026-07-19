import { VTKLegacyReader } from "./VTKLegacyReader.js";
import { VTKLegacyStreamReader } from "./VTKLegacyStreamReader.js";
import { VTPReader } from "./VTPReader.js";
import { VTPStreamReader } from "./VTPStreamReader.js";
import { collectTransferables, serializeDataSet } from "./datasetTransfer.js";
import { initializeSurfaceWasm } from "../wasm/surfaceExtractorWasm.js";
import { DataSetSurfaceFilter } from "../filters/DataSetSurfaceFilter.js";
import { WarpFilter } from "../filters/WarpFilter.js";
import { SmoothFilter } from "../filters/SmoothFilter.js";
import { ClipFilter } from "../filters/ClipFilter.js";
import { ClipClosedSurfaceFilter } from "../filters/ClipClosedSurfaceFilter.js";
import { ContourFilter } from "../filters/ContourFilter.js";
import { CutterFilter } from "../filters/CutterFilter.js";
import { tryWarpPointsParallelWasm } from "../wasm/surfaceExtractorWasm.js";

const wasmReady = initializeSurfaceWasm();
const dataSets = new Map();
let nextHandle = 1;

async function readFileInChunks(file, id) {
    if (!file?.stream) return file.arrayBuffer();
    const output = new Uint8Array(file.size);
    const reader = file.stream().getReader();
    let offset = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        output.set(value, offset);
        offset += value.byteLength;
        self.postMessage({
            id, type: "progress", stage: "read",
            progress: file.size ? 0.04 + 0.04 * (offset / file.size) : 0.08,
            loadedBytes: offset, totalBytes: file.size,
        });
    }
    return output.buffer;
}

function parseBuffer(buffer, format) {
    return format === "vtk"
        ? new VTKLegacyReader().parse(buffer)
        : new VTPReader().parse(buffer);
}

async function runPipeline(input, stages, progress) {
    let output = input;
    let capSource = input;
    const total = Math.max(1, stages.length);
    for (let index = 0; index < stages.length; ++index) {
        const stage = stages[index];
        progress(stage.type, index / total);
        switch (stage.type) {
            case "surface":
                output = new DataSetSurfaceFilter({ passCellData: stage.passCellData ?? true })
                    .setInputData(output).getOutputData();
                break;
            case "warp": {
                const vectors = stage.arrayName
                    ? output.pointData.getArray(stage.arrayName)
                    : output.pointData.getVectors();
                const parallel = vectors ? await tryWarpPointsParallelWasm(
                    output.points, vectors.values, vectors.numberOfComponents, stage.scaleFactor ?? 1,
                ) : null;
                if (parallel) {
                    output = output.clone();
                    output.setPoints(parallel);
                } else {
                    output = new WarpFilter()
                        .setVectorArrayName(stage.arrayName ?? null)
                        .setScaleFactor(stage.scaleFactor ?? 1)
                        .setInputData(output).getOutputData();
                }
                capSource = output;
                break;
            }
            case "smooth":
                output = new SmoothFilter()
                    .setIterations(stage.iterations ?? 20)
                    .setRelaxationFactor(stage.relaxationFactor ?? 0.1)
                    .setInputData(output).getOutputData();
                break;
            case "clip":
                output = new ClipFilter()
                    .setPlane(stage.normal ?? [1, 0, 0], stage.origin ?? [0, 0, 0])
                    .setInsideOut(stage.insideOut ?? false)
                    .setInputData(output).getOutputData();
                break;
            case "clipClosed":
                output = new ClipClosedSurfaceFilter()
                    .setInputData(output)
                    .setCapInputData(capSource)
                    .setPlane(stage.normal ?? [1, 0, 0], stage.origin ?? [0, 0, 0])
                    .setInsideOut(stage.insideOut ?? false)
                    .setCapping(stage.capping ?? true)
                    .getOutputData();
                capSource = new ClipFilter()
                    .setInputData(capSource)
                    .setPlane(stage.normal ?? [1, 0, 0], stage.origin ?? [0, 0, 0])
                    .setInsideOut(stage.insideOut ?? false)
                    .getOutputData();
                break;
            case "contour": {
                const filter = new ContourFilter().setInputData(output);
                if (stage.arrayName) filter.setScalarArrayName(stage.arrayName);
                filter.setValues(stage.values ?? [0.5]);
                output = filter.getOutputData();
                break;
            }
            case "cutter":
                output = new CutterFilter()
                    .setPlane(stage.normal ?? [1, 0, 0], stage.origin ?? [0, 0, 0])
                    .setFill(stage.fill ?? true)
                    .setPassData(stage.passData ?? true)
                    .setEdges(stage.edges ?? true)
                    .setInputData(output).getOutputData();
                break;
            default:
                throw new Error(`Unknown worker pipeline stage: ${stage.type}`);
        }
    }
    progress("complete", 1);
    return output;
}

self.onmessage = async (event) => {
    const { id, action = "parseTransfer", file, format } = event.data;
    let { buffer } = event.data;
    try {
        if (action === "release") {
            self.postMessage({ id, type: "result", released: dataSets.delete(event.data.handle) });
            return;
        }
        if (action === "fork") {
            const input = dataSets.get(event.data.handle);
            if (!input) throw new Error(`Unknown dataset handle: ${event.data.handle}`);
            const handle = nextHandle++;
            dataSets.set(handle, input.clone());
            self.postMessage({ id, type: "result", handle });
            return;
        }
        if (action === "pipeline") {
            await wasmReady;
            const input = dataSets.get(event.data.handle);
            if (!input) throw new Error(`Unknown dataset handle: ${event.data.handle}`);
            const started = performance.now();
            const output = await runPipeline(input, event.data.stages ?? [], (stage, progress) => {
                self.postMessage({ id, type: "progress", stage, progress });
            });
            dataSets.set(event.data.handle, output);
            self.postMessage({ id, type: "result", handle: event.data.handle, metrics: {
                pipelineMs: performance.now() - started,
                pointCount: output.getNumberOfPoints(),
                cellCount: output.getNumberOfCells(),
            }});
            return;
        }
        if (action === "export" || action === "exportRender") {
            const output = dataSets.get(event.data.handle);
            if (!output) throw new Error(`Unknown dataset handle: ${event.data.handle}`);
            let exported = output;
            if (action === "exportRender" && !output.hasSurface?.()) {
                exported = new DataSetSurfaceFilter({ passCellData: true }).setInputData(output).getOutputData();
            }
            if (action === "exportRender" && event.data.release === false) exported = exported.clone();
            const dataSet = serializeDataSet(exported);
            if (event.data.release !== false) dataSets.delete(event.data.handle);
            self.postMessage({ id, type: "result", dataSet }, collectTransferables(dataSet));
            return;
        }

        self.postMessage({ id, type: "progress", stage: "initialize", progress: 0.02 });
        await wasmReady;
        let output = null;
        let outOfCore = false;
        const started = performance.now();
        if (!buffer && file && format === "vtk" && file.size >= 32 * 1024 * 1024) {
            const header = await file.slice(0, 1024).text();
            if (/^ASCII\s*$/im.test(header)) {
                try {
                    output = await new VTKLegacyStreamReader().parseFile(file, {
                        onProgress: (message) => self.postMessage({ id, type: "progress", ...message }),
                    });
                    outOfCore = true;
                } catch (streamError) {
                    self.postMessage({ id, type: "progress", stage: "stream-fallback", progress: 0.03, message: streamError.message });
                }
            }
        }
        if (!output && !buffer && file && format === "vtp" && file.size >= 32 * 1024 * 1024) {
            try {
                if (await VTPStreamReader.canParse(file)) {
                    output = await new VTPStreamReader().parseFile(file, {
                        onProgress: (message) => self.postMessage({ id, type: "progress", ...message }),
                    });
                    outOfCore = true;
                }
            } catch (streamError) {
                self.postMessage({ id, type: "progress", stage: "stream-fallback", progress: 0.03, message: streamError.message });
            }
        }
        if (!output && !buffer && file) {
            self.postMessage({ id, type: "progress", stage: "read", progress: 0.04 });
            buffer = await readFileInChunks(file, id);
        }
        if (!output && !buffer) throw new Error("VTK worker received no file data");
        if (!output) {
            self.postMessage({ id, type: "progress", stage: "parse", progress: 0.08 });
            output = parseBuffer(buffer, format);
        }
        const parseMs = performance.now() - started;
        const inputBytes = file?.size ?? buffer?.byteLength ?? 0;
        if (action === "import") {
            const handle = nextHandle++;
            dataSets.set(handle, output);
            self.postMessage({ id, type: "progress", stage: "complete", progress: 1 });
            self.postMessage({ id, type: "result", handle, metrics: {
                parseMs, inputBytes, outOfCore,
                pointCount: output.getNumberOfPoints(), cellCount: output.getNumberOfCells(),
            }});
            return;
        }
        self.postMessage({ id, type: "progress", stage: "serialize", progress: 0.85 });
        const serializeStarted = performance.now();
        const dataSet = serializeDataSet(output);
        const metrics = {
            parseMs,
            serializeMs: performance.now() - serializeStarted,
            inputBytes, outOfCore,
            pointCount: output.getNumberOfPoints(),
            cellCount: output.getNumberOfCells(),
        };
        self.postMessage(
            { id, type: "result", dataSet, metrics },
            collectTransferables(dataSet),
        );
    } catch (error) {
        self.postMessage({ id, type: "error", message: error?.message ?? String(error), stack: error?.stack });
    }
};
