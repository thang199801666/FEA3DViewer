// Actors/Actor.js
import * as THREE from "three";
import { FeatureEdges } from "../Filters/FeatureEdges.js";
import { GeometryFilter } from "../Filters/GeometryFilter.js";
import { ExternalSurfaceFilter } from "../Filters/ExternalSurfaceFilter.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";

const DEFAULT_FEATURE_EDGE_ANGLE = 20; // degrees

export const DisplayMode = Object.freeze({
    WIREFRAME: "wireframe",
    MODEL_WITH_EDGE: "modelWithEdges",
    MODEL_WITHOUT_EDGE: "modelWithoutEdges",
    BOUNDARY_EDGE: "boundaryEdges"
});

export class Actor extends THREE.Group {
    constructor(a, b, c) {
        super();
        this.isActor = true;

        // Initialize underlying components
        this.surface = null;
        this.boundaryEdge = null;
        this.displayMode = null;

        // Configuration and State
        this.featureEdgeAngle = DEFAULT_FEATURE_EDGE_ANGLE;
        this.featureEdgeWeldTolerance = null;
        this.wireframeUseScalarColors = true;
        this._scalarVisible = true;
        this._scalarTexture = null;
        this._hasVertexColors = false;

        // External-surface (body) state.
        // body chỉ giữ mặt bao ngoài -> nhẹ hơn, feature edge sạch, stencil cap đúng.
        this.externalSurface = true;
        this.keepOuterShell = false;
        this.externalSurfaceWeldTolerance = null;

        // Material Options caching
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
            // a = BufferGeometry (hoặc rỗng); b có thể là opts (object) hoặc name (string), c là name.
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

        // External-surface options (mặc định BẬT).
        this.externalSurface = opts.externalSurface ?? true;
        this.keepOuterShell = opts.keepOuterShell ?? false;   // true -> ẩn vách ngăn bên trong (ExternalSurfaceFilter)
        this.externalSurfaceWeldTolerance = opts.externalSurfaceWeldTolerance ?? null;
        // Tinh chỉnh riêng cho ExternalSurfaceFilter (chỉ dùng khi keepOuterShell = true).
        this.externalSurfaceConeAngle = opts.externalSurfaceConeAngle ?? 72; // hạ -> siết vách trong; nâng -> tránh thủng vỏ
        this.externalSurfaceRayCount = opts.externalSurfaceRayCount ?? 64;   // tăng -> chính xác hơn, chậm hơn
        this.externalSurfaceDebug = opts.externalSurfaceDebug ?? false;      // bật để in số tam giác trước/sau khi lọc

        // Initialize Materials
        this.solidColor = new THREE.Color(opts.solidColor ?? 0xcccccc);

        // Remember the "resting" edge appearance so highlight code can restore it cleanly.
        this._baseEdgeColor = new THREE.Color(opts.featureEdgeColor ?? 0x000000);
        this._baseEdgeThickness = opts.featureEdgeThickness ?? 1.0;

        // LineMaterial ("fat lines") hỗ trợ linewidth thật theo pixel,
        // khác với LineBasicMaterial.linewidth vốn bị WebGL bỏ qua (luôn 1px).
        this._featureEdgeMaterial = new LineMaterial({
            color: opts.featureEdgeColor ?? 0x000000,
            linewidth: this._baseEdgeThickness, // đơn vị: pixel (worldUnits = false)
            worldUnits: false,
            depthTest: true
        });
        this._wireframeFlatMaterial = new THREE.LineBasicMaterial({
            color: opts.wireframeColor ?? 0x000000
        });
        this._wireframeVertexColorMaterial = new THREE.LineBasicMaterial({
            vertexColors: true
        });
        // Wireframe hiển thị contour khi scalar được cấp qua texture + uv
        // (LineBasicMaterial hỗ trợ .map từ three.js r138)
        this._wireframeTextureMaterial = new THREE.LineBasicMaterial({
            color: 0xffffff
        });

        // Extract geometry from mapper or arguments
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

        // BODY = mặt ngoài. Chỉ dispose geometry gốc khi nó do mapper tạo (ta sở hữu);
        // geometry do người dùng truyền vào (BufferGeometry) thì KHÔNG dispose.
        geometry = this._toExternalSurface(geometry, rawFromMapper);

        // Build Surface Mesh
        const colorTexture = (this.mapper && this.mapper.interpolateScalarsBeforeMapping && geometry.getAttribute("uv") && this.mapper.getColorTexture)
            ? this.mapper.getColorTexture() : null;

        // Lit material: used when displaying solid color (affected by lights)
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

        // Unlit material: used when scalar visibility is ON (ignores all lighting)
        this._surfaceUnlitMaterial = new THREE.MeshBasicMaterial({
            vertexColors: !colorTexture && !!geometry.getAttribute("color"),
            map: colorTexture,
            color: 0xffffff,
            side: opts.side ?? THREE.DoubleSide,
            transparent: opts.opacity !== undefined && opts.opacity < 1,
            opacity: opts.opacity ?? 1
        });

        this.surface = new THREE.Mesh(geometry, this._surfaceLitMaterial);
        this.surface.name = `${this.name}__surface`;
        this.add(this.surface);

        // Analyze initial scalar parameters
        this._scalarTexture = colorTexture;
        this._hasVertexColors = !!geometry.getAttribute("color");
        this._applyScalarVisibility();

        // Build Boundary Edge Line Segments
        this._buildBoundaryEdges();

        // Apply display modes
        if (opts.displayMode) {
            this.setDisplayMode(opts.displayMode);
        } else {
            this.setDisplayMode(DisplayMode.MODEL_WITH_EDGE);
        }
    }

    // ------------------------------------------------------------------
    // External Surface (body) extraction
    // ------------------------------------------------------------------

    /**
     * Chuyển geometry đầy đủ -> chỉ mặt ngoài (ẩn vách ngăn / vỏ con bên trong).
     * Trả về geometry mới đã nén; nếu externalSurface = false thì trả nguyên bản.
     * disposeRaw = true: giải phóng geometry gốc (chỉ khi ta sở hữu nó, vd mapper tạo).
     *
     * - keepOuterShell = true  -> ExternalSurfaceFilter (occlusion): ẩn HẲN mọi vách
     *   ngăn / gân / gusset bên trong, chỉ chừa vỏ ngoài cùng -> cắt ra tiết diện đặc.
     * - keepOuterShell = false -> GeometryFilter: chỉ gộp các mặt trùng khít giữa
     *   các khối (giữ lại bề mặt khoang rỗng thật, nhẹ và nhanh).
     */
    _toExternalSurface(geometry, disposeRaw = false) {
        if (!this.externalSurface || !geometry) {
            return geometry;
        }

        const tol = this.externalSurfaceWeldTolerance ?? 1e-6;
        let ext;

        if (this.keepOuterShell) {
            // Vỏ ngoài cùng thật sự: ẩn vách ngăn bên trong bằng occlusion ray test.
            ext = new ExternalSurfaceFilter()
                .setWeldTolerance(tol)
                .setEscapeConeAngle(this.externalSurfaceConeAngle ?? 72)
                .setRayCount(this.externalSurfaceRayCount ?? 64)
                .setInputData(geometry)
                .getOutputData();

            if (this.externalSurfaceDebug) {
                const triIn = geometry.getIndex()
                    ? geometry.getIndex().count / 3 : geometry.getAttribute("position").count / 3;
                const triOut = (ext && ext.getIndex())
                    ? ext.getIndex().count / 3 : ext.getAttribute("position").count / 3;
                console.info(`[Actor:ExternalSurface] ${this.name}: ${triIn} -> ${triOut} tam giác `
                    + `(bỏ ${triIn - triOut}). keepOuterShell=${this.keepOuterShell}`);
            }
        } else {
            // Đường nhẹ: chỉ loại mặt trùng khít giữa các khối (chuẩn VTK vtkGeometryFilter).
            ext = new GeometryFilter()
                .setRemoveInternalWalls(true)
                .setWeldTolerance(tol)
                .setInputData(geometry)
                .getOutputData();
        }

        // Giải phóng bộ nhớ của geometry thô trung gian nếu do mapper sinh ra
        if (ext !== geometry && disposeRaw) {
            geometry.dispose();
        }

        return ext;
    }

    /** Bật/tắt chế độ mặt ngoài rồi dựng lại body + edge (cần có mapper để build lại). */
    setExternalSurface(enabled, { keepOuterShell } = {}) {
        this.externalSurface = !!enabled;
        if (keepOuterShell !== undefined) this.keepOuterShell = !!keepOuterShell;
        if (this.mapper) return this.update();
        return this;
    }

    // ------------------------------------------------------------------
    // Scalar / Contour State Management
    // ------------------------------------------------------------------

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

    /**
     * True ONLY when a scalar contour / color-map is really being drawn on the surface.
     */
    hasActiveScalarColoring() {
        return this._scalarVisible && (!!this._scalarTexture || this._hasVertexColors);
    }

    /** Applies the current scalar contour state to surface materials and wireframe overlays. */
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
        }
        return this;
    }

    // ------------------------------------------------------------------
    // Edge Highlight Support (color + thickness)
    // ------------------------------------------------------------------

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

    // ------------------------------------------------------------------
    // Display Mode Execution Matrix
    // ------------------------------------------------------------------

    showWireframe() {
        this.displayMode = DisplayMode.WIREFRAME;

        this.surface.visible = false;
        if (this.boundaryEdge) this.boundaryEdge.visible = false;

        this._disposeWireframeOverlay();

        const srcGeom = this.surface.geometry;
        const wantScalar = this.wireframeUseScalarColors && this._scalarVisible;
        const useTexture = wantScalar && !!this._scalarTexture && !!srcGeom.getAttribute("uv");
        const useVertexColor = wantScalar && !useTexture && !!srcGeom.getAttribute("color");

        let wireGeom, material;
        if (useTexture) {
            wireGeom = this._buildScalarWireframeGeometry(srcGeom, { uv: true });
            material = this._wireframeTextureMaterial;
            if (material.map !== this._scalarTexture) {
                material.map = this._scalarTexture;
                material.needsUpdate = true;
            }
        } else if (useVertexColor) {
            wireGeom = this._buildScalarWireframeGeometry(srcGeom, { color: true });
            material = this._wireframeVertexColorMaterial;
        } else {
            wireGeom = new THREE.WireframeGeometry(srcGeom);
            material = this._wireframeFlatMaterial;
        }

        this._wireframeOverlay = new THREE.LineSegments(wireGeom, material);
        this._wireframeOverlay.name = `${this.name}__wireframeOverlay`;
        this._wireframeOverlay.renderOrder = 1;
        material.depthTest = true;

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

    setDisplayMode(mode) {
        switch (mode) {
            case DisplayMode.WIREFRAME:          return this.showWireframe();
            case DisplayMode.MODEL_WITH_EDGE:    return this.showModelWithEdges();
            case DisplayMode.MODEL_WITHOUT_EDGE: return this.showModelWithoutEdges();
            case DisplayMode.BOUNDARY_EDGE:      return this.showBoundaryEdges();
            default:
                console.warn(`[Actor] Invalid displayMode requested: ${mode}`);
                return this;
        }
    }

    getDisplayMode() { return this.displayMode; }

    // ------------------------------------------------------------------
    // Wireframe Structural Builder
    // ------------------------------------------------------------------

    _buildScalarWireframeGeometry(src, opts = {}) {
        const pos = src.getAttribute("position");
        const col = opts.color ? src.getAttribute("color") : null;
        const uv = opts.uv ? src.getAttribute("uv") : null;
        const index = src.getIndex();
        const count = index ? index.count : pos.count;

        const positions = [];
        const colors = col ? [] : null;
        const uvs = uv ? [] : null;
        const seen = index ? new Set() : null;

        const pushVertex = (i) => {
            positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
            if (colors) colors.push(col.getX(i), col.getY(i), col.getZ(i));
            if (uvs) uvs.push(uv.getX(i), uv.getY(i));
        };
        const addEdge = (i, j) => {
            if (seen) {
                const key = i < j ? `${i}_${j}` : `${j}_${i}`;
                if (seen.has(key)) return;
                seen.add(key);
            }
            pushVertex(i);
            pushVertex(j);
        };

        for (let t = 0; t < count; t += 3) {
            const a = index ? index.getX(t)     : t;
            const b = index ? index.getX(t + 1) : t + 1;
            const c = index ? index.getX(t + 2) : t + 2;
            addEdge(a, b);
            addEdge(b, c);
            addEdge(c, a);
        }

        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
        if (colors) g.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
        if (uvs) g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
        return g;
    }

    _disposeWireframeOverlay() {
        if (!this._wireframeOverlay) return;
        this.remove(this._wireframeOverlay);
        this._wireframeOverlay.geometry.dispose();
        this._wireframeOverlay = null;
    }

    // ------------------------------------------------------------------
    // Boundary Edge Computation
    // ------------------------------------------------------------------

    _buildBoundaryEdges() {
        if (!this.surface || !this.surface.geometry) return;
        this._disposeBoundaryEdges();

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
        this.boundaryEdge.renderOrder = 2;

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

    // ------------------------------------------------------------------
    // Pipeline / Upgrades Management
    // ------------------------------------------------------------------

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

        // XỬ LÝ CHÍNH SÁC TẠI ĐÂY: Build geometry mới từ mapper -> lọc bỏ vách trong -> gán lại cho surface
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