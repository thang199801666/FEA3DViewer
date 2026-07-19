import { deserializeDataSet } from "./datasetTransfer.js";
import { recordPerformance } from "../performance/telemetry.js";

let nextRequestId = 1;

export function canUseVTKWorker() {
    return typeof Worker !== "undefined";
}

export function parseVTKInWorker(input, { format, fileName = "", onProgress, signal } = {}) {
    if (!canUseVTKWorker()) throw new Error("Web Worker is unavailable");
    const id = nextRequestId++;
    const worker = new Worker(new URL("./vtkParser.worker.js", import.meta.url), { type: "module" });
    const totalStarted = performance.now();

    return new Promise((resolve, reject) => {
        const cleanup = () => {
            signal?.removeEventListener("abort", abort);
            worker.terminate();
        };
        const abort = () => {
            cleanup();
            reject(new DOMException("VTK import was cancelled", "AbortError"));
        };
        if (signal?.aborted) { abort(); return; }
        signal?.addEventListener("abort", abort, { once: true });

        worker.onerror = (event) => {
            cleanup();
            reject(new Error(event.message || "VTK worker failed"));
        };
        worker.onmessage = (event) => {
            const message = event.data;
            if (message.id !== id) return;
            if (message.type === "progress") {
                onProgress?.(message);
                return;
            }
            cleanup();
            if (message.type === "error") {
                const error = new Error(message.message);
                error.stack = message.stack ?? error.stack;
                reject(error);
                return;
            }
            const deserializeStarted = performance.now();
            const dataSet = deserializeDataSet(message.dataSet);
            recordPerformance({
                operation: "vtk-import",
                backend: "worker",
                fileName,
                ...message.metrics,
                deserializeMs: performance.now() - deserializeStarted,
                totalMs: performance.now() - totalStarted,
            });
            resolve(dataSet);
        };
        if (input instanceof ArrayBuffer) worker.postMessage({ id, buffer: input, format, fileName }, [input]);
        else worker.postMessage({ id, file: input, format, fileName });
    });
}
