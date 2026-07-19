import { deserializeDataSet } from "./datasetTransfer.js";
import { recordPerformance } from "../performance/telemetry.js";

/**
 * Persistent worker session. Imported datasets remain worker-owned until
 * export/release, allowing several filters to run without intermediate copies.
 */
export class VTKWorkerSession {
    constructor({ onProgress } = {}) {
        if (typeof Worker === "undefined") throw new Error("Web Worker is unavailable");
        this.onProgress = onProgress;
        this.disposed = false;
        this.handles = new Set();
        this._createWorker();
    }

    _createWorker() {
        this.worker = new Worker(new URL("./vtkParser.worker.js", import.meta.url), { type: "module" });
        this.pending = new Map();
        this.nextId ??= 1;
        this.worker.onmessage = (event) => this._onMessage(event.data);
        this.worker.onerror = (event) => this._failAll(new Error(event.message || "VTK worker failed"));
    }

    _onMessage(message) {
        const request = this.pending.get(message.id);
        if (!request) return;
        if (message.type === "progress") {
            request.onProgress?.(message);
            this.onProgress?.(message);
            return;
        }
        this.pending.delete(message.id);
        if (message.type === "error") request.reject(new Error(message.message));
        else request.resolve(message);
    }

    _failAll(error) {
        for (const request of this.pending.values()) request.reject(error);
        this.pending.clear();
    }

    _request(action, payload = {}, transfer = [], onProgress, signal) {
        const id = this.nextId++;
        return new Promise((resolve, reject) => {
            const abort = () => {
                const error = new DOMException("VTK operation was cancelled", "AbortError");
                this._failAll(error);
                this.worker.terminate();
                this.handles.clear();
                if (!this.disposed) this._createWorker();
            };
            if (signal?.aborted) { reject(new DOMException("VTK operation was cancelled", "AbortError")); return; }
            const cleanupResolve = (value) => { signal?.removeEventListener("abort", abort); resolve(value); };
            const cleanupReject = (error) => { signal?.removeEventListener("abort", abort); reject(error); };
            this.pending.set(id, { resolve: cleanupResolve, reject: cleanupReject, onProgress });
            signal?.addEventListener("abort", abort, { once: true });
            this.worker.postMessage({ id, action, ...payload }, transfer);
        });
    }

    async importBuffer(buffer, { format = "vtk", fileName = "", onProgress, signal } = {}) {
        const started = performance.now();
        const result = await this._request("import", { buffer, format, fileName }, [buffer], onProgress, signal);
        recordPerformance({
            operation: "vtk-import-handle", backend: "worker", fileName,
            totalMs: performance.now() - started, ...result.metrics,
        });
        this.handles.add(result.handle);
        return result.handle;
    }

    async importFile(file, { format = null, fileName = file?.name ?? "", onProgress, signal } = {}) {
        const detected = format ?? (fileName.toLowerCase().endsWith(".vtp") ? "vtp" : "vtk");
        const started = performance.now();
        const result = await this._request("import", { file, format: detected, fileName }, [], onProgress, signal);
        this.handles.add(result.handle);
        recordPerformance({
            operation: "vtk-import-handle", backend: "worker-stream", fileName,
            totalMs: performance.now() - started, ...result.metrics,
        });
        return result.handle;
    }

    async runPipeline(handle, stages, { onProgress, signal } = {}) {
        if (!this.handles.has(handle)) throw new Error(`Dataset handle ${handle} is no longer valid`);
        const started = performance.now();
        const result = await this._request("pipeline", { handle, stages }, [], onProgress, signal);
        recordPerformance({
            operation: "vtk-pipeline", backend: "worker", handle,
            totalMs: performance.now() - started, stages: stages.map((stage) => stage.type),
            ...result.metrics,
        });
        return result.metrics;
    }

    async fork(handle) {
        if (!this.handles.has(handle)) throw new Error(`Dataset handle ${handle} is no longer valid`);
        const result = await this._request("fork", { handle });
        this.handles.add(result.handle);
        return result.handle;
    }

    async exportDataSet(handle, { release = true } = {}) {
        if (!this.handles.has(handle)) throw new Error(`Dataset handle ${handle} is no longer valid`);
        const result = await this._request("export", { handle, release });
        if (release) this.handles.delete(handle);
        return deserializeDataSet(result.dataSet);
    }

    async exportRenderDataSet(handle, { release = false } = {}) {
        if (!this.handles.has(handle)) throw new Error(`Dataset handle ${handle} is no longer valid`);
        const result = await this._request("exportRender", { handle, release });
        if (release) this.handles.delete(handle);
        return deserializeDataSet(result.dataSet);
    }

    async release(handle) {
        const result = await this._request("release", { handle });
        this.handles.delete(handle);
        return result.released;
    }

    dispose() {
        this.disposed = true;
        this.handles.clear();
        this._failAll(new Error("VTK worker session was disposed"));
        this.worker.terminate();
    }
}
