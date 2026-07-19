import { Actor, DisplayMode } from "./Actor.js";
import { createLargeModelLOD } from "../rendering/LargeModelLOD.js";
import { MeshBVH, acceleratedRaycast } from "three-mesh-bvh";
import { recordPerformance } from "../performance/telemetry.js";

/** Actor optimized for large indexed surfaces while retaining a full-resolution picking proxy. */
export class LargeModelActor extends Actor {
    constructor(mapper, name = "LargeModel", options = {}) {
        super(mapper, name, { ...options, buildBoundaryEdges: false });
        this._largeModelOptions = options;
        this._bvhGeneration = 0;
        this._bvhIdleHandle = null;
        this._buildLOD();
        this._schedulePickingBVH();
    }

    _buildLOD() {
        const geometry = this.surface?.geometry;
        if (!geometry?.index || !this.surface?.isMesh) return;
        geometry.computeBoundingSphere();
        const radius = Math.max(1e-6, geometry.boundingSphere?.radius ?? 1);

        this.largeModelLOD = createLargeModelLOD(geometry, this._surfaceLitMaterial, {
            ratios: this._largeModelOptions?.lodRatios ?? [1, 0.25, 0.06],
            distances: this._largeModelOptions?.lodDistances ?? [0, radius * 2, radius * 8],
            maxTriangles: this._largeModelOptions?.maxTrianglesPerPartition ?? 250000,
        });
        this.largeModelLOD.name = `${this.name}__lod`;
        this.add(this.largeModelLOD);

        // Mesh remains available to topology/picking code but is not submitted to the renderer.
        this.surface.material.visible = false;
        this.surface.userData.isPickingProxy = true;
    }

    _disposeLOD() {
        if (!this.largeModelLOD) return;
        this.largeModelLOD.traverse((object) => {
            if (object.geometry && object.geometry !== this.surface?.geometry) object.geometry.dispose();
        });
        this.remove(this.largeModelLOD);
        this.largeModelLOD = null;
    }

    _disposePickingBVH() {
        this._bvhGeneration++;
        if (this._bvhIdleHandle !== null) {
            const cancel = globalThis.cancelIdleCallback ?? globalThis.clearTimeout;
            cancel(this._bvhIdleHandle);
            this._bvhIdleHandle = null;
        }
        this.surface?.geometry?.boundsTree?.dispose?.();
        if (this.surface?.geometry) this.surface.geometry.boundsTree = null;
    }

    _schedulePickingBVH() {
        const generation = ++this._bvhGeneration;
        const schedule = globalThis.requestIdleCallback
            ? (callback) => globalThis.requestIdleCallback(callback, { timeout: 1500 })
            : (callback) => globalThis.setTimeout(callback, 0);
        this._bvhIdleHandle = schedule(() => {
            this._bvhIdleHandle = null;
            if (generation !== this._bvhGeneration) return;
            this.buildPickingBVHNow();
        });
    }

    buildPickingBVHNow() {
        const geometry = this.surface?.geometry;
        if (!geometry?.index || geometry.boundsTree) return geometry?.boundsTree ?? null;
        const started = performance.now();
        geometry.boundsTree = new MeshBVH(geometry, { maxLeafSize: 16 });
        this.surface.raycast = acceleratedRaycast;
        recordPerformance({
            operation: "picking-bvh-build", backend: "main-thread",
            durationMs: performance.now() - started,
            triangleCount: geometry.index.count / 3,
        });
        return geometry.boundsTree;
    }

    update() {
        this._disposePickingBVH();
        this._disposeLOD();
        super.update();
        this._disposeBoundaryEdges();
        this._buildLOD();
        this._schedulePickingBVH();
        const showSurface = this.displayMode !== DisplayMode.WIREFRAME && this.displayMode !== DisplayMode.BOUNDARY_EDGE;
        return this._syncLOD(showSurface);
    }

    _syncLOD(visible = true) {
        if (this.largeModelLOD) this.largeModelLOD.visible = visible;
        if (this.surface?.material) this.surface.material.visible = false;
        return this;
    }

    showModelWithEdges() { super.showModelWithEdges(); return this._syncLOD(true); }
    showModelWithoutEdges() { super.showModelWithoutEdges(); return this._syncLOD(true); }
    showMesh() { super.showMesh(); return this._syncLOD(true); }
    showWireframe() { super.showWireframe(); return this._syncLOD(false); }
    showBoundaryEdges() { super.showBoundaryEdges(); return this._syncLOD(false); }

    dispose() {
        this._disposePickingBVH();
        this._disposeLOD();
        super.dispose();
    }
}
