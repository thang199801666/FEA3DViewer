// Actors/Actor.js
import * as THREE from "three";
import { FeatureEdges } from "../geometry/featureEdges.js";
import { extractByTopology } from "../geometry/surfaceTopology.js";
import { extractByVisibility } from "../geometry/surfaceVisibility.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";

const DEFAULT_FEATURE_EDGE_ANGLE = 20; // degrees

export const DisplayMode = Object.freeze({
    WIREFRAME: "wireframe",
    MODEL_WITH_EDGE: "modelWithEdges",
    MODEL_WITHOUT_EDGE: "modelWithoutEdges",
    BOUNDARY_EDGE: "boundaryEdges",
    MESH: "mesh"
});

export class Actor extends THREE.Group {
    constructor(a, b, c) {
        super();
        this.isActor = true;

        this.surface = null;
        this.boundaryEdge = null;
        this.displayMode = null;

        this.featureEdgeAngle = DEFAULT_FEATURE_EDGE_ANGLE;
        this.featureEdgeWeldTolerance = null;
        this.wireframeUseScalarColors = true;
        this._scalarVisible = true;
        this._scalarTexture = null;
        this._hasVertexColors = false;

        this.externalSurface = true;
        this.keepOuterShell = false;
        this.externalSurfaceWeldTolerance = null;

        let opts = {};
        let name = "Actor";
        let mapper = null;

        if (a && a.isPolyDataMapper) {
            mapper = a;
            name = typeof b === "string" ? b : (typeof c === "string" ? c : "Actor");
            opts = (b && typeof b === "object") ? b : ((c && typeof c === "object") ? c : {});
            this.mapper = mapper;
        } else {
            this.mapper = null;
            name = (typeof b === "string") ? b : (typeof c === "string" ? c : "Actor");
            opts = (b && typeof b === "object") ? b : ((c && typeof c === "object") ? c : {});
        }

        this._lambertMaterial = new THREE.MeshLambertMaterial({
            side: opts.side ?? THREE.DoubleSide,
            transparent: opts.opacity !== undefined && opts.opacity < 1,
            opacity: opts.opacity ?? 1
        });

        this.name = name;
        this.featureEdgeAngle = opts.featureEdgeAngle ?? DEFAULT_FEATURE_EDGE_ANGLE;
        this.featureEdgeWeldTolerance = opts.featureEdgeWeldTolerance ?? null;
        this.wireframeUseScalarColors = opts.wireframeUseScalarColors ?? true;
        this._scalarVisible = opts.showScalar ?? true;

        this.externalSurface = opts.externalSurface ?? true;
        this.keepOuterShell = opts.keepOuterShell ?? false;
        this.externalSurfaceWeldTolerance = opts.externalSurfaceWeldTolerance ?? null;
        this.externalSurfaceConeAngle = opts.externalSurfaceConeAngle ?? 72;
        this.externalSurfaceRayCount = opts.externalSurfaceRayCount ?? 64;
        this.externalSurfaceDebug = opts.externalSurfaceDebug ?? false;

        this.solidColor = new THREE.Color(opts.solidColor ?? 0xcccccc);

        this._baseEdgeColor = new THREE.Color(opts.featureEdgeColor ?? 0x000000);
        this._baseEdgeThickness = opts.featureEdgeThickness ?? 1.2;

        // CRITICAL FIX FOR COINCIDENT TOPOLOGY (Z-FIGHTING WITH LineMaterial):
        this._featureEdgeMaterial = new LineMaterial({
            color: opts.featureEdgeColor ?? 0x000000,
            linewidth: this._baseEdgeThickness,
            worldUnits: false,
            depthTest: true,
            polygonOffset: true,
            polygonOffsetFactor: -1.0, 
            polygonOffsetUnits: -4.0   
        });

        // CAE UPGRADE: Use LineMaterial for wireframe overlay to render clean screen-space adaptive fat lines
        this._wireframeFlatMaterial = new LineMaterial({
            color: 0x000000, // Đổi từ 0x222222 -> màu đen
            linewidth: opts.wireframeThickness ?? 1.0,
            worldUnits: false,
            depthTest: true,
            polygonOffset: true,
            polygonOffsetFactor: -1.0, 
            polygonOffsetUnits: -4.0   
        });

        this._wireframeVertexColorMaterial = new LineMaterial({
            vertexColors: false, // Ép thành false để bỏ qua màu vertex của CAE kết quả
            color: 0x000000,     // Đổi thành màu đen thống nhất
            linewidth: opts.wireframeThickness ?? 1.0,
            worldUnits: false,
            depthTest: true,
            polygonOffset: true,
            polygonOffsetFactor: -1.0,
            polygonOffsetUnits: -4.0
        });

        this._wireframeTextureMaterial = new LineMaterial({
            color: 0x000000,
            linewidth: opts.wireframeThickness ?? 1.0,
            worldUnits: false,
            depthTest: true,
            polygonOffset: true,
            polygonOffsetFactor: -1.0,
            polygonOffsetUnits: -4.0
        });

        let geometry = null;
        let rawFromMapper = false;
        if (this.mapper) {
            geometry = this.mapper.buildGeometry();
            rawFromMapper = true;
        } else if (a instanceof THREE.BufferGeometry) {
            geometry = a;
        } else {
            geometry = new THREE.BufferGeometry();
        }

        geometry = this._toExternalSurface(geometry, rawFromMapper);

        // --- FIX: IDENTIFY IF DATA TYPE IS A LINE primitive ---
        const polyData = this.getPolyData();
        const isLinePrimitive = !!(
            (polyData && polyData.lines && polyData.lines.length > 0) || 
            (polyData && (!polyData.polys || polyData.polys.length === 0)) ||
            geometry.userData?.primitiveType === "line" ||
            geometry.userData?.isLine === true
        );
        if (isLinePrimitive) {
            geometry.userData.primitiveType = "line";
        }
        // ------------------------------------------------------

        const colorTexture = (this.mapper && this.mapper.interpolateScalarsBeforeMapping && geometry.getAttribute("uv") && this.mapper.getColorTexture)
            ? this.mapper.getColorTexture() : null;

        this._surfaceLitMaterial = new THREE.MeshStandardMaterial({
            vertexColors: !colorTexture && !!geometry.getAttribute("color"),
            map: colorTexture,
            color: opts.color ?? 0xffffff,
            roughness: opts.roughness ?? 0.5,
            metalness: opts.metalness ?? 0.05,
            side: opts.side ?? THREE.DoubleSide,
            flatShading: opts.flatShading ?? true,
            transparent: opts.opacity !== undefined && opts.opacity < 1,
            opacity: opts.opacity ?? 1
        });

        this._surfaceUnlitMaterial = new THREE.MeshBasicMaterial({
            vertexColors: !colorTexture && !!geometry.getAttribute("color"),
            map: colorTexture,
            color: 0xffffff,
            side: opts.side ?? THREE.DoubleSide,
            transparent: opts.opacity !== undefined && opts.opacity < 1,
            opacity: opts.opacity ?? 1
        });

        // --- FIX: DYNAMICALLY CREATE MESH OR LINE ELEMENTS ---
        if (isLinePrimitive) {
            // For line elements, wrap the base geometry inside a LineSegments setup
            const baseLineMaterial = new THREE.LineBasicMaterial({
                vertexColors: !!geometry.getAttribute("color"),
                color: opts.color ?? 0x000000,
                transparent: opts.opacity !== undefined && opts.opacity < 1,
                opacity: opts.opacity ?? 1
            });
            this.surface = new THREE.LineSegments(geometry, baseLineMaterial);
        } else {
            // Default 3D surface mesh configuration
            this.surface = new THREE.Mesh(geometry, this._surfaceLitMaterial);
        }
        // ------------------------------------------------------

        this.surface.name = `${this.name}__surface`;
        this.add(this.surface);

        this._scalarTexture = colorTexture;
        this._hasVertexColors = !!geometry.getAttribute("color");
        this._applyScalarVisibility();

        this._buildBoundaryEdges();

        if (opts.displayMode) {
            this.setDisplayMode(opts.displayMode);
        } else {
            this.setDisplayMode(isLinePrimitive ? DisplayMode.MODEL_WITHOUT_EDGE : DisplayMode.MODEL_WITH_EDGE);
        }
    }

    _toExternalSurface(geometry, disposeRaw = false) {
        if (!this.externalSurface || !geometry) {
            return geometry;
        }

        // --- FIX: SKIP TRIANGLE TOPOLOGY LOOPS ENTIRELY FOR LINES ---
        const polyData = this.getPolyData();
        if (
            (polyData && polyData.lines && polyData.lines.length > 0) || 
            geometry.userData?.primitiveType === "line" ||
            geometry.userData?.isLine === true
        ) {
            return geometry;
        }
        // -------------------------------------------------------------

        const tol = this.externalSurfaceWeldTolerance ?? 1e-6;
        let ext;

        if (this.keepOuterShell) {
            ext = extractByVisibility(geometry, {
                weldTolerance: tol,
                escapeConeAngle: this.externalSurfaceConeAngle ?? 72,
                rayCount: this.externalSurfaceRayCount ?? 64,
            });
        } else {
            ext = extractByTopology(geometry, {
                removeInternalWalls: true,
                weldTolerance: tol,
            });
        }

        if (ext !== geometry && disposeRaw) {
            geometry.dispose();
        }

        return ext;
    }

    setExternalSurface(enabled, { keepOuterShell } = {}) {
        this.externalSurface = !!enabled;
        if (keepOuterShell !== undefined) this.keepOuterShell = !!keepOuterShell;
        if (this.mapper) return this.update();
        return this;
    }

    setScalarVisibility(visible) {
        this._scalarVisible = !!visible;
        this._applyScalarVisibility();
        return this;
    }

    getScalarVisibility() {
        return !!this._scalarVisible;
    }

    toggleScalarVisibility() {
        return this.setScalarVisibility(!this._scalarVisible);
    }

    hasActiveScalarColoring() {
        return this._scalarVisible && (!!this._scalarTexture || this._hasVertexColors);
    }

    _applyScalarVisibility() {
        if (!this.surface) return this;

        const hasScalar = !!this._scalarTexture || this._hasVertexColors;
        const showScalar = hasScalar && this._scalarVisible;

        const mat = showScalar ? this._surfaceUnlitMaterial : this._surfaceLitMaterial;

        if (showScalar) {
            mat.map = this._scalarTexture || null;
            mat.vertexColors = !mat.map && this._hasVertexColors;
            mat.color.set(0xffffff);
        } else if (hasScalar) {
            mat.map = null;
            mat.vertexColors = false;
            mat.color.copy(this.solidColor);
            mat.emissive.copy(this.solidColor).multiplyScalar(0.3);

            if (this.surface.userData.initialRoughness === undefined) {
                this.surface.userData.initialRoughness = mat.roughness;
            }
            mat.roughness = 1.0;
        }
        mat.needsUpdate = true;

        if (this.surface.material !== mat) {
            this.surface.material = mat;
            this.surface.userData.isMaterialCloned = false;
        }

        if (this.displayMode === DisplayMode.WIREFRAME) {
            this.showWireframe();
        } else if (this.displayMode === DisplayMode.MESH) {
            this.showMesh();
        }
        return this;
    }

    setEdgeColor(color) {
        if (this._featureEdgeMaterial) {
            this._featureEdgeMaterial.color.set(color);
            this._featureEdgeMaterial.needsUpdate = true;
        }
        return this;
    }

    setFeatureEdgeColor(color) {
        return this.setEdgeColor(color);
    }

    setFeatureEdgeThickness(thickness) {
        if (this._featureEdgeMaterial) {
            this._featureEdgeMaterial.linewidth = thickness;
            this._featureEdgeMaterial.needsUpdate = true;
        }
        return this;
    }

    resetEdgeAppearance() {
        this.setEdgeColor(this._baseEdgeColor);
        this.setFeatureEdgeThickness(this._baseEdgeThickness);
        return this;
    }

    // HELPER: Refactored wireframe wrapper utilizing LineSegments2 for fat screen-space lines
    _createWireframeOverlayMesh(srcGeom) {
        // Luôn sử dụng chất liệu phẳng màu đen thống nhất
        let wireGeom = this._buildScalarWireframeGeometry(srcGeom, {});
        
        // --- FIX: Fallback to standard Three.js WireframeGeometry if polyData doesn't exist ---
        if (!wireGeom) {
            wireGeom = new THREE.WireframeGeometry(srcGeom);
        }
        // -------------------------------------------------------------------------------------

        let material = this._wireframeFlatMaterial;

        // CAE IMPLEMENTATION: Convert standard Line Edge segments to LineSegmentsGeometry format
        const nonIndexedGeom = wireGeom.getIndex() ? wireGeom.toNonIndexed() : wireGeom;
        const fatLineGeom = new LineSegmentsGeometry().fromEdgesGeometry(nonIndexedGeom);
        
        if (nonIndexedGeom !== wireGeom) nonIndexedGeom.dispose();
        wireGeom.dispose();

        const overlay = new LineSegments2(fatLineGeom, material);
        overlay.computeLineDistances();
        overlay.renderOrder = 3; 

        overlay.onBeforeRender = (renderer) => {
            if (material.resolution) {
                renderer.getSize(material.resolution);
            }
        };

        return overlay;
    }

    showWireframe() {
        this.displayMode = DisplayMode.WIREFRAME;

        this.surface.visible = false;
        if (this.boundaryEdge) this.boundaryEdge.visible = false;

        this._disposeWireframeOverlay();

        this._wireframeOverlay = this._createWireframeOverlayMesh(this.surface.geometry);
        this._wireframeOverlay.name = `${this.name}__wireframeOverlay`;

        this.add(this._wireframeOverlay);
        return this;
    }

    showModelWithEdges() {
        this.displayMode = DisplayMode.MODEL_WITH_EDGE;
        this._disposeWireframeOverlay();

        this.surface.visible = true;
        if (this.boundaryEdge) this.boundaryEdge.visible = true;
        return this;
    }

    showModelWithoutEdges() {
        this.displayMode = DisplayMode.MODEL_WITHOUT_EDGE;
        this._disposeWireframeOverlay();

        this.surface.visible = true;
        if (this.boundaryEdge) this.boundaryEdge.visible = false;
        return this;
    }

    showBoundaryEdges() {
        this.displayMode = DisplayMode.BOUNDARY_EDGE;
        this._disposeWireframeOverlay();

        this.surface.visible = false;
        if (this.boundaryEdge) this.boundaryEdge.visible = true;
        return this;
    }

    showMesh() {
        this.displayMode = DisplayMode.MESH;

        this.surface.visible = true;
        if (this.boundaryEdge) this.boundaryEdge.visible = false;

        this._disposeWireframeOverlay();

        this._wireframeOverlay = this._createWireframeOverlayMesh(this.surface.geometry);
        this._wireframeOverlay.name = `${this.name}__wireframeOverlay`;

        this.add(this._wireframeOverlay);
        return this;
    }

    setDisplayMode(mode) {
        switch (mode) {
            case DisplayMode.WIREFRAME:          return this.showWireframe();
            case DisplayMode.MODEL_WITH_EDGE:    return this.showModelWithEdges();
            case DisplayMode.MODEL_WITHOUT_EDGE: return this.showModelWithoutEdges();
            case DisplayMode.BOUNDARY_EDGE:      return this.showBoundaryEdges();
            case DisplayMode.MESH:               return this.showMesh();
            default:
                console.warn(`[Actor] Invalid displayMode requested: ${mode}`);
                return this;
            }
    }

    getDisplayMode() { return this.displayMode; }

    _buildScalarWireframeGeometry(src, opts = {}) {
        const polyData = this.getPolyData();

        if (polyData && polyData.polys && polyData.polys.length > 0) {

            const colors = opts.color ? true : null;
            const uvs = opts.uv ? true : null;

            const rawPoints = polyData.points;
            const rawColors = opts.color ? polyData.getScalars?.() : null;
            const rawUvs = opts.uv && polyData.pointData
                ? polyData.pointData.tcoords
                : null;

            // Plain "+" concatenation avoids template-literal overhead per edge;
            // more importantly, dedup cost here scales with total face-edges,
            // so this runs on every showWireframe()/showMesh() call.
            const edgeMap = new Map();

            const addEdge = (a, b) => {
                const key = a < b ? a + "_" + b : b + "_" + a;
                if (!edgeMap.has(key))
                    edgeMap.set(key, [a, b]);
            };

            for (const face of polyData.polys) {

                const n = face.length;

                for (let i = 0; i < n; i++) {

                    const a = face[i];
                    const b = face[(i + 1) % n];

                    addEdge(a, b);
                }
            }

            // Preallocate typed output buffers now that the edge count is known,
            // instead of push-growing plain arrays and converting afterward.
            const edgeCount = edgeMap.size;
            const posArr = new Float32Array(edgeCount * 6);
            const colArr = colors ? new Float32Array(edgeCount * 6) : null;
            const uvArr = uvs ? new Float32Array(edgeCount * 4) : null;
            const nc = (colors && rawColors) ? rawColors.length / (rawPoints.length / 3) : 0;

            let pw = 0, cw = 0, uw = 0;
            for (const [a, b] of edgeMap.values()) {
                posArr[pw++] = rawPoints[a * 3];
                posArr[pw++] = rawPoints[a * 3 + 1];
                posArr[pw++] = rawPoints[a * 3 + 2];
                posArr[pw++] = rawPoints[b * 3];
                posArr[pw++] = rawPoints[b * 3 + 1];
                posArr[pw++] = rawPoints[b * 3 + 2];

                if (colArr && rawColors) {
                    for (let c = 0; c < 3; c++) colArr[cw++] = rawColors[a * nc + c];
                    for (let c = 0; c < 3; c++) colArr[cw++] = rawColors[b * nc + c];
                }

                if (uvArr && rawUvs) {
                    uvArr[uw++] = rawUvs[a * 2];
                    uvArr[uw++] = rawUvs[a * 2 + 1];
                    uvArr[uw++] = rawUvs[b * 2];
                    uvArr[uw++] = rawUvs[b * 2 + 1];
                }
            }

            const g = new THREE.BufferGeometry();

            g.setAttribute(
                "position",
                new THREE.Float32BufferAttribute(posArr, 3)
            );

            if (colArr)
                g.setAttribute(
                    "color",
                    new THREE.Float32BufferAttribute(colArr, 3)
                );

            if (uvArr)
                g.setAttribute(
                    "uv",
                    new THREE.Float32BufferAttribute(uvArr, 2)
                );

            return g;
        }
    }

    _disposeWireframeOverlay() {
        if (!this._wireframeOverlay) return;
        this.remove(this._wireframeOverlay);
        if (this._wireframeOverlay.geometry) this._wireframeOverlay.geometry.dispose();
        this._wireframeOverlay = null;
    }

    _buildBoundaryEdges() {
        if (!this.surface || !this.surface.geometry) return;
        this._disposeBoundaryEdges();

        // --- FIX: DO NOT ATTEMPT FEATURE-EDGE ANALYSIS ON RAW LINE STRUCTURES ---
        if (this.surface.geometry.userData?.primitiveType === "line" || this.surface instanceof THREE.LineSegments) {
            return; 
        }
        // ------------------------------------------------------------------------

        const edgesGeom = FeatureEdges.extract(this.surface.geometry, {
            featureAngle: this.featureEdgeAngle,
            boundaryEdges: true,
            featureEdges: true,
            nonManifoldEdges: true,
            manifoldEdges: false,
            windingIndependent: true,
            weldTolerance: this.featureEdgeWeldTolerance
        });

        const flatGeom = edgesGeom.getIndex() ? edgesGeom.toNonIndexed() : edgesGeom;
        const lineGeom = new LineSegmentsGeometry().fromEdgesGeometry(flatGeom);
        if (flatGeom !== edgesGeom) flatGeom.dispose();
        edgesGeom.dispose();

        this.boundaryEdge = new LineSegments2(lineGeom, this._featureEdgeMaterial);
        this.boundaryEdge.computeLineDistances();
        this.boundaryEdge.name = `${this.name}__boundaryEdges`;
        this.boundaryEdge.renderOrder = 4; 

        this.boundaryEdge.raycast = () => {};

        this.boundaryEdge.onBeforeRender = (renderer) => {
            renderer.getSize(this._featureEdgeMaterial.resolution);
        };

        this.add(this.boundaryEdge);
    }

    _disposeBoundaryEdges() {
        if (!this.boundaryEdge) return;
        this.remove(this.boundaryEdge);
        this.boundaryEdge.geometry.dispose();
        this.boundaryEdge = null;
    }

    getPolyData() { return this.mapper ? this.mapper.input : null; }

    get geometry() {
        return this.surface ? this.surface.geometry : null;
    }

    set geometry(geom) {
        if (this.surface) {
            this.surface.geometry = geom;
        }
    }

    get material() {
        return this.surface ? this.surface.material : null;
    }

    set material(mat) {
        if (this.surface) {
            this.surface.material = mat;
        }
    }

    update() {
        if (!this.mapper) return this;
        const oldGeom = this.surface.geometry;

        this.surface.geometry = this._toExternalSurface(this.mapper.buildGeometry(), true);
        if (oldGeom) oldGeom.dispose();

        this._applyScalarColorSource();
        this._buildBoundaryEdges();

        this.setDisplayMode(this.displayMode);
        return this;
    }

    _applyScalarColorSource() {
        const geom = this.surface.geometry;
        const tex = (this.mapper && this.mapper.interpolateScalarsBeforeMapping && this.mapper.getColorTexture)
            ? this.mapper.getColorTexture() : null;
        const useTexture = !!(tex && geom.getAttribute("uv"));

        this._scalarTexture = useTexture ? tex : null;
        this._hasVertexColors = !!geom.getAttribute("color");
        this._applyScalarVisibility();
    }

    dispose() {
        this._disposeBoundaryEdges();
        this._disposeWireframeOverlay();

        if (this._featureEdgeMaterial) this._featureEdgeMaterial.dispose();
        if (this._wireframeFlatMaterial) this._wireframeFlatMaterial.dispose();
        if (this._wireframeVertexColorMaterial) this._wireframeVertexColorMaterial.dispose();
        if (this._wireframeTextureMaterial) this._wireframeTextureMaterial.dispose();

        if (this.mapper && typeof this.mapper.dispose === "function") this.mapper.dispose();
        if (this._surfaceLitMaterial) this._surfaceLitMaterial.dispose();
        if (this._surfaceUnlitMaterial) this._surfaceUnlitMaterial.dispose();
        if (this.surface) {
            if (this.surface.geometry) this.surface.geometry.dispose();
            if (this.surface.material &&
                this.surface.material !== this._surfaceLitMaterial &&
                this.surface.material !== this._surfaceUnlitMaterial) {
                this.surface.material.dispose();
            }
        }
    }
}























// // Actors/Actor.js
// import * as THREE from "three";
// import { FeatureEdges } from "../geometry/featureEdges.js";
// import { extractByTopology } from "../geometry/surfaceTopology.js";
// import { extractByVisibility } from "../geometry/surfaceVisibility.js";
// import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
// import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
// import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";

// const DEFAULT_FEATURE_EDGE_ANGLE = 20; // degrees

// export const DisplayMode = Object.freeze({
//     WIREFRAME: "wireframe",
//     MODEL_WITH_EDGE: "modelWithEdges",
//     MODEL_WITHOUT_EDGE: "modelWithoutEdges",
//     BOUNDARY_EDGE: "boundaryEdges",
//     MESH: "mesh"
// });

// export class Actor extends THREE.Group {
//     constructor(a, b, c) {
//         super();
//         this.isActor = true;

//         this.surface = null;
//         this.boundaryEdge = null;
//         this.displayMode = null;

//         this.featureEdgeAngle = DEFAULT_FEATURE_EDGE_ANGLE;
//         this.featureEdgeWeldTolerance = null;
//         this.wireframeUseScalarColors = true;
//         this._scalarVisible = true;
//         this._scalarTexture = null;
//         this._hasVertexColors = false;

//         this.externalSurface = true;
//         this.keepOuterShell = false;
//         this.externalSurfaceWeldTolerance = null;

//         let opts = {};
//         let name = "Actor";
//         let mapper = null;

//         if (a && a.isPolyDataMapper) {
//             mapper = a;
//             name = typeof b === "string" ? b : (typeof c === "string" ? c : "Actor");
//             opts = (b && typeof b === "object") ? b : ((c && typeof c === "object") ? c : {});
//             this.mapper = mapper;
//         } else {
//             this.mapper = null;
//             name = (typeof b === "string") ? b : (typeof c === "string" ? c : "Actor");
//             opts = (b && typeof b === "object") ? b : ((c && typeof c === "object") ? c : {});
//         }

//         this._lambertMaterial = new THREE.MeshLambertMaterial({
//             side: opts.side ?? THREE.DoubleSide,
//             transparent: opts.opacity !== undefined && opts.opacity < 1,
//             opacity: opts.opacity ?? 1
//         });

//         this.name = name;
//         this.featureEdgeAngle = opts.featureEdgeAngle ?? DEFAULT_FEATURE_EDGE_ANGLE;
//         this.featureEdgeWeldTolerance = opts.featureEdgeWeldTolerance ?? null;
//         this.wireframeUseScalarColors = opts.wireframeUseScalarColors ?? true;
//         this._scalarVisible = opts.showScalar ?? true;

//         this.externalSurface = opts.externalSurface ?? true;
//         this.keepOuterShell = opts.keepOuterShell ?? false;
//         this.externalSurfaceWeldTolerance = opts.externalSurfaceWeldTolerance ?? null;
//         this.externalSurfaceConeAngle = opts.externalSurfaceConeAngle ?? 72;
//         this.externalSurfaceRayCount = opts.externalSurfaceRayCount ?? 64;
//         this.externalSurfaceDebug = opts.externalSurfaceDebug ?? false;

//         this.solidColor = new THREE.Color(opts.solidColor ?? 0xcccccc);

//         this._baseEdgeColor = new THREE.Color(opts.featureEdgeColor ?? 0x000000);
//         this._baseEdgeThickness = opts.featureEdgeThickness ?? 1.2;

//         // CRITICAL FIX FOR COINCIDENT TOPOLOGY (Z-FIGHTING WITH LineMaterial):
//         this._featureEdgeMaterial = new LineMaterial({
//             color: opts.featureEdgeColor ?? 0x000000,
//             linewidth: this._baseEdgeThickness,
//             worldUnits: false,
//             depthTest: true,
//             polygonOffset: true,
//             polygonOffsetFactor: -1.0, 
//             polygonOffsetUnits: -4.0   
//         });

//         // CAE UPGRADE: Use LineMaterial for wireframe overlay to render clean screen-space adaptive fat lines
//         this._wireframeFlatMaterial = new LineMaterial({
//             color: 0x000000, // Đổi từ 0x222222 -> màu đen
//             linewidth: opts.wireframeThickness ?? 1.0,
//             worldUnits: false,
//             depthTest: true,
//             polygonOffset: true,
//             polygonOffsetFactor: -1.0, 
//             polygonOffsetUnits: -4.0   
//         });

//         this._wireframeVertexColorMaterial = new LineMaterial({
//             vertexColors: false, // Ép thành false để bỏ qua màu vertex của CAE kết quả
//             color: 0x000000,     // Đổi thành màu đen thống nhất
//             linewidth: opts.wireframeThickness ?? 1.0,
//             worldUnits: false,
//             depthTest: true,
//             polygonOffset: true,
//             polygonOffsetFactor: -1.0,
//             polygonOffsetUnits: -4.0
//         });

//         this._wireframeTextureMaterial = new LineMaterial({
//             color: 0x000000,
//             linewidth: opts.wireframeThickness ?? 1.0,
//             worldUnits: false,
//             depthTest: true,
//             polygonOffset: true,
//             polygonOffsetFactor: -1.0,
//             polygonOffsetUnits: -4.0
//         });

//         let geometry = null;
//         let rawFromMapper = false;
//         if (this.mapper) {
//             geometry = this.mapper.buildGeometry();
//             rawFromMapper = true;
//         } else if (a instanceof THREE.BufferGeometry) {
//             geometry = a;
//         } else {
//             geometry = new THREE.BufferGeometry();
//         }

//         geometry = this._toExternalSurface(geometry, rawFromMapper);

//         // --- FIX: IDENTIFY IF DATA TYPE IS A LINE primitive ---
//         const polyData = this.getPolyData();
//         const isLinePrimitive = !!(
//             (polyData && polyData.lines && polyData.lines.length > 0) || 
//             (polyData && (!polyData.polys || polyData.polys.length === 0)) ||
//             geometry.userData?.primitiveType === "line" ||
//             geometry.userData?.isLine === true
//         );
//         if (isLinePrimitive) {
//             geometry.userData.primitiveType = "line";
//         }
//         // ------------------------------------------------------

//         const colorTexture = (this.mapper && this.mapper.interpolateScalarsBeforeMapping && geometry.getAttribute("uv") && this.mapper.getColorTexture)
//             ? this.mapper.getColorTexture() : null;

//         this._surfaceLitMaterial = new THREE.MeshStandardMaterial({
//             vertexColors: !colorTexture && !!geometry.getAttribute("color"),
//             map: colorTexture,
//             color: opts.color ?? 0xffffff,
//             roughness: opts.roughness ?? 0.5,
//             metalness: opts.metalness ?? 0.05,
//             side: opts.side ?? THREE.DoubleSide,
//             flatShading: opts.flatShading ?? true,
//             transparent: opts.opacity !== undefined && opts.opacity < 1,
//             opacity: opts.opacity ?? 1
//         });

//         this._surfaceUnlitMaterial = new THREE.MeshBasicMaterial({
//             vertexColors: !colorTexture && !!geometry.getAttribute("color"),
//             map: colorTexture,
//             color: 0xffffff,
//             side: opts.side ?? THREE.DoubleSide,
//             transparent: opts.opacity !== undefined && opts.opacity < 1,
//             opacity: opts.opacity ?? 1
//         });

//         // --- FIX: DYNAMICALLY CREATE MESH OR LINE ELEMENTS ---
//         if (isLinePrimitive) {
//             // For line elements, wrap the base geometry inside a LineSegments setup
//             const baseLineMaterial = new THREE.LineBasicMaterial({
//                 vertexColors: !!geometry.getAttribute("color"),
//                 color: opts.color ?? 0x000000,
//                 transparent: opts.opacity !== undefined && opts.opacity < 1,
//                 opacity: opts.opacity ?? 1
//             });
//             this.surface = new THREE.LineSegments(geometry, baseLineMaterial);
//         } else {
//             // Default 3D surface mesh configuration
//             this.surface = new THREE.Mesh(geometry, this._surfaceLitMaterial);
//         }
//         // ------------------------------------------------------

//         this.surface.name = `${this.name}__surface`;
//         this.add(this.surface);

//         this._scalarTexture = colorTexture;
//         this._hasVertexColors = !!geometry.getAttribute("color");
//         this._applyScalarVisibility();

//         this._buildBoundaryEdges();

//         if (opts.displayMode) {
//             this.setDisplayMode(opts.displayMode);
//         } else {
//             this.setDisplayMode(isLinePrimitive ? DisplayMode.MODEL_WITHOUT_EDGE : DisplayMode.MODEL_WITH_EDGE);
//         }
//     }

//     _toExternalSurface(geometry, disposeRaw = false) {
//         if (!this.externalSurface || !geometry) {
//             return geometry;
//         }

//         // --- FIX: SKIP TRIANGLE TOPOLOGY LOOPS ENTIRELY FOR LINES ---
//         const polyData = this.getPolyData();
//         if (
//             (polyData && polyData.lines && polyData.lines.length > 0) || 
//             geometry.userData?.primitiveType === "line" ||
//             geometry.userData?.isLine === true
//         ) {
//             return geometry;
//         }
//         // -------------------------------------------------------------

//         const tol = this.externalSurfaceWeldTolerance ?? 1e-6;
//         let ext;

//         if (this.keepOuterShell) {
//             ext = extractByVisibility(geometry, {
//                 weldTolerance: tol,
//                 escapeConeAngle: this.externalSurfaceConeAngle ?? 72,
//                 rayCount: this.externalSurfaceRayCount ?? 64,
//             });
//         } else {
//             ext = extractByTopology(geometry, {
//                 removeInternalWalls: true,
//                 weldTolerance: tol,
//             });
//         }

//         if (ext !== geometry && disposeRaw) {
//             geometry.dispose();
//         }

//         return ext;
//     }

//     setExternalSurface(enabled, { keepOuterShell } = {}) {
//         this.externalSurface = !!enabled;
//         if (keepOuterShell !== undefined) this.keepOuterShell = !!keepOuterShell;
//         if (this.mapper) return this.update();
//         return this;
//     }

//     setScalarVisibility(visible) {
//         this._scalarVisible = !!visible;
//         this._applyScalarVisibility();
//         return this;
//     }

//     getScalarVisibility() {
//         return !!this._scalarVisible;
//     }

//     toggleScalarVisibility() {
//         return this.setScalarVisibility(!this._scalarVisible);
//     }

//     hasActiveScalarColoring() {
//         return this._scalarVisible && (!!this._scalarTexture || this._hasVertexColors);
//     }

//     _applyScalarVisibility() {
//         if (!this.surface) return this;

//         const hasScalar = !!this._scalarTexture || this._hasVertexColors;
//         const showScalar = hasScalar && this._scalarVisible;

//         const mat = showScalar ? this._surfaceUnlitMaterial : this._surfaceLitMaterial;

//         if (showScalar) {
//             mat.map = this._scalarTexture || null;
//             mat.vertexColors = !mat.map && this._hasVertexColors;
//             mat.color.set(0xffffff);
//         } else if (hasScalar) {
//             mat.map = null;
//             mat.vertexColors = false;
//             mat.color.copy(this.solidColor);
//             mat.emissive.copy(this.solidColor).multiplyScalar(0.3);

//             if (this.surface.userData.initialRoughness === undefined) {
//                 this.surface.userData.initialRoughness = mat.roughness;
//             }
//             mat.roughness = 1.0;
//         }
//         mat.needsUpdate = true;

//         if (this.surface.material !== mat) {
//             this.surface.material = mat;
//             this.surface.userData.isMaterialCloned = false;
//         }

//         if (this.displayMode === DisplayMode.WIREFRAME) {
//             this.showWireframe();
//         } else if (this.displayMode === DisplayMode.MESH) {
//             this.showMesh();
//         }
//         return this;
//     }

//     setEdgeColor(color) {
//         if (this._featureEdgeMaterial) {
//             this._featureEdgeMaterial.color.set(color);
//             this._featureEdgeMaterial.needsUpdate = true;
//         }
//         return this;
//     }

//     setFeatureEdgeColor(color) {
//         return this.setEdgeColor(color);
//     }

//     setFeatureEdgeThickness(thickness) {
//         if (this._featureEdgeMaterial) {
//             this._featureEdgeMaterial.linewidth = thickness;
//             this._featureEdgeMaterial.needsUpdate = true;
//         }
//         return this;
//     }

//     resetEdgeAppearance() {
//         this.setEdgeColor(this._baseEdgeColor);
//         this.setFeatureEdgeThickness(this._baseEdgeThickness);
//         return this;
//     }

//     // HELPER: Refactored wireframe wrapper utilizing LineSegments2 for fat screen-space lines
//     _createWireframeOverlayMesh(srcGeom) {
//         // Luôn sử dụng chất liệu phẳng màu đen thống nhất
//         let wireGeom = this._buildScalarWireframeGeometry(srcGeom, {});
        
//         // --- FIX: Fallback to standard Three.js WireframeGeometry if polyData doesn't exist ---
//         if (!wireGeom) {
//             wireGeom = new THREE.WireframeGeometry(srcGeom);
//         }
//         // -------------------------------------------------------------------------------------

//         let material = this._wireframeFlatMaterial;

//         // CAE IMPLEMENTATION: Convert standard Line Edge segments to LineSegmentsGeometry format
//         const nonIndexedGeom = wireGeom.getIndex() ? wireGeom.toNonIndexed() : wireGeom;
//         const fatLineGeom = new LineSegmentsGeometry().fromEdgesGeometry(nonIndexedGeom);
        
//         if (nonIndexedGeom !== wireGeom) nonIndexedGeom.dispose();
//         wireGeom.dispose();

//         const overlay = new LineSegments2(fatLineGeom, material);
//         overlay.computeLineDistances();
//         overlay.renderOrder = 3; 

//         overlay.onBeforeRender = (renderer) => {
//             if (material.resolution) {
//                 renderer.getSize(material.resolution);
//             }
//         };

//         return overlay;
//     }

//     showWireframe() {
//         this.displayMode = DisplayMode.WIREFRAME;

//         this.surface.visible = false;
//         if (this.boundaryEdge) this.boundaryEdge.visible = false;

//         this._disposeWireframeOverlay();

//         this._wireframeOverlay = this._createWireframeOverlayMesh(this.surface.geometry);
//         this._wireframeOverlay.name = `${this.name}__wireframeOverlay`;

//         this.add(this._wireframeOverlay);
//         return this;
//     }

//     showModelWithEdges() {
//         this.displayMode = DisplayMode.MODEL_WITH_EDGE;
//         this._disposeWireframeOverlay();

//         this.surface.visible = true;
//         if (this.boundaryEdge) this.boundaryEdge.visible = true;
//         return this;
//     }

//     showModelWithoutEdges() {
//         this.displayMode = DisplayMode.MODEL_WITHOUT_EDGE;
//         this._disposeWireframeOverlay();

//         this.surface.visible = true;
//         if (this.boundaryEdge) this.boundaryEdge.visible = false;
//         return this;
//     }

//     showBoundaryEdges() {
//         this.displayMode = DisplayMode.BOUNDARY_EDGE;
//         this._disposeWireframeOverlay();

//         this.surface.visible = false;
//         if (this.boundaryEdge) this.boundaryEdge.visible = true;
//         return this;
//     }

//     showMesh() {
//         this.displayMode = DisplayMode.MESH;

//         this.surface.visible = true;
//         if (this.boundaryEdge) this.boundaryEdge.visible = false;

//         this._disposeWireframeOverlay();

//         this._wireframeOverlay = this._createWireframeOverlayMesh(this.surface.geometry);
//         this._wireframeOverlay.name = `${this.name}__wireframeOverlay`;

//         this.add(this._wireframeOverlay);
//         return this;
//     }

//     setDisplayMode(mode) {
//         switch (mode) {
//             case DisplayMode.WIREFRAME:          return this.showWireframe();
//             case DisplayMode.MODEL_WITH_EDGE:    return this.showModelWithEdges();
//             case DisplayMode.MODEL_WITHOUT_EDGE: return this.showModelWithoutEdges();
//             case DisplayMode.BOUNDARY_EDGE:      return this.showBoundaryEdges();
//             case DisplayMode.MESH:               return this.showMesh();
//             default:
//                 console.warn(`[Actor] Invalid displayMode requested: ${mode}`);
//                 return this;
//             }
//     }

//     getDisplayMode() { return this.displayMode; }

//     _buildScalarWireframeGeometry(src, opts = {}) {
//         const polyData = this.getPolyData();

//         if (polyData && polyData.polys && polyData.polys.length > 0) {

//             const positions = [];
//             const colors = opts.color ? [] : null;
//             const uvs = opts.uv ? [] : null;

//             const rawPoints = polyData.points;
//             const rawColors = opts.color ? polyData.getScalars?.() : null;
//             const rawUvs = opts.uv && polyData.pointData
//                 ? polyData.pointData.tcoords
//                 : null;

//             const edgeMap = new Map();

//             const addEdge = (a, b) => {

//                 const key = a < b ? `${a}_${b}` : `${b}_${a}`;

//                 if (!edgeMap.has(key))
//                     edgeMap.set(key, [a, b]);
//             };

//             for (const face of polyData.polys) {

//                 const n = face.length;

//                 for (let i = 0; i < n; i++) {

//                     const a = face[i];
//                     const b = face[(i + 1) % n];

//                     addEdge(a, b);
//                 }
//             }

//             for (const [a, b] of edgeMap.values()) {

//                 positions.push(
//                     rawPoints[a * 3],
//                     rawPoints[a * 3 + 1],
//                     rawPoints[a * 3 + 2],

//                     rawPoints[b * 3],
//                     rawPoints[b * 3 + 1],
//                     rawPoints[b * 3 + 2]
//                 );

//                 if (colors && rawColors) {

//                     const nc = rawColors.length / (rawPoints.length / 3);

//                     for (let c = 0; c < 3; c++) {

//                         colors.push(rawColors[a * nc + c]);
//                     }

//                     for (let c = 0; c < 3; c++) {

//                         colors.push(rawColors[b * nc + c]);
//                     }
//                 }

//                 if (uvs && rawUvs) {

//                     uvs.push(rawUvs[a * 2], rawUvs[a * 2 + 1]);
//                     uvs.push(rawUvs[b * 2], rawUvs[b * 2 + 1]);
//                 }
//             }

//             const g = new THREE.BufferGeometry();

//             g.setAttribute(
//                 "position",
//                 new THREE.Float32BufferAttribute(positions, 3)
//             );

//             if (colors)
//                 g.setAttribute(
//                     "color",
//                     new THREE.Float32BufferAttribute(colors, 3)
//                 );

//             if (uvs)
//                 g.setAttribute(
//                     "uv",
//                     new THREE.Float32BufferAttribute(uvs, 2)
//                 );

//             return g;
//         }
//     }

//     _disposeWireframeOverlay() {
//         if (!this._wireframeOverlay) return;
//         this.remove(this._wireframeOverlay);
//         if (this._wireframeOverlay.geometry) this._wireframeOverlay.geometry.dispose();
//         this._wireframeOverlay = null;
//     }

//     _buildBoundaryEdges() {
//         if (!this.surface || !this.surface.geometry) return;
//         this._disposeBoundaryEdges();

//         // --- FIX: DO NOT ATTEMPT FEATURE-EDGE ANALYSIS ON RAW LINE STRUCTURES ---
//         if (this.surface.geometry.userData?.primitiveType === "line" || this.surface instanceof THREE.LineSegments) {
//             return; 
//         }
//         // ------------------------------------------------------------------------

//         const edgesGeom = FeatureEdges.extract(this.surface.geometry, {
//             featureAngle: this.featureEdgeAngle,
//             boundaryEdges: true,
//             featureEdges: true,
//             nonManifoldEdges: true,
//             manifoldEdges: false,
//             windingIndependent: true,
//             weldTolerance: this.featureEdgeWeldTolerance
//         });

//         const flatGeom = edgesGeom.getIndex() ? edgesGeom.toNonIndexed() : edgesGeom;
//         const lineGeom = new LineSegmentsGeometry().fromEdgesGeometry(flatGeom);
//         if (flatGeom !== edgesGeom) flatGeom.dispose();
//         edgesGeom.dispose();

//         this.boundaryEdge = new LineSegments2(lineGeom, this._featureEdgeMaterial);
//         this.boundaryEdge.computeLineDistances();
//         this.boundaryEdge.name = `${this.name}__boundaryEdges`;
//         this.boundaryEdge.renderOrder = 4; 

//         this.boundaryEdge.raycast = () => {};

//         this.boundaryEdge.onBeforeRender = (renderer) => {
//             renderer.getSize(this._featureEdgeMaterial.resolution);
//         };

//         this.add(this.boundaryEdge);
//     }

//     _disposeBoundaryEdges() {
//         if (!this.boundaryEdge) return;
//         this.remove(this.boundaryEdge);
//         this.boundaryEdge.geometry.dispose();
//         this.boundaryEdge = null;
//     }

//     getPolyData() { return this.mapper ? this.mapper.input : null; }

//     get geometry() {
//         return this.surface ? this.surface.geometry : null;
//     }

//     set geometry(geom) {
//         if (this.surface) {
//             this.surface.geometry = geom;
//         }
//     }

//     get material() {
//         return this.surface ? this.surface.material : null;
//     }

//     set material(mat) {
//         if (this.surface) {
//             this.surface.material = mat;
//         }
//     }

//     update() {
//         if (!this.mapper) return this;
//         const oldGeom = this.surface.geometry;

//         this.surface.geometry = this._toExternalSurface(this.mapper.buildGeometry(), true);
//         if (oldGeom) oldGeom.dispose();

//         this._applyScalarColorSource();
//         this._buildBoundaryEdges();

//         this.setDisplayMode(this.displayMode);
//         return this;
//     }

//     _applyScalarColorSource() {
//         const geom = this.surface.geometry;
//         const tex = (this.mapper && this.mapper.interpolateScalarsBeforeMapping && this.mapper.getColorTexture)
//             ? this.mapper.getColorTexture() : null;
//         const useTexture = !!(tex && geom.getAttribute("uv"));

//         this._scalarTexture = useTexture ? tex : null;
//         this._hasVertexColors = !!geom.getAttribute("color");
//         this._applyScalarVisibility();
//     }

//     dispose() {
//         this._disposeBoundaryEdges();
//         this._disposeWireframeOverlay();

//         if (this._featureEdgeMaterial) this._featureEdgeMaterial.dispose();
//         if (this._wireframeFlatMaterial) this._wireframeFlatMaterial.dispose();
//         if (this._wireframeVertexColorMaterial) this._wireframeVertexColorMaterial.dispose();
//         if (this._wireframeTextureMaterial) this._wireframeTextureMaterial.dispose();

//         if (this.mapper && typeof this.mapper.dispose === "function") this.mapper.dispose();
//         if (this._surfaceLitMaterial) this._surfaceLitMaterial.dispose();
//         if (this._surfaceUnlitMaterial) this._surfaceUnlitMaterial.dispose();
//         if (this.surface) {
//             if (this.surface.geometry) this.surface.geometry.dispose();
//             if (this.surface.material &&
//                 this.surface.material !== this._surfaceLitMaterial &&
//                 this.surface.material !== this._surfaceUnlitMaterial) {
//                 this.surface.material.dispose();
//             }
//         }
//     }
// }