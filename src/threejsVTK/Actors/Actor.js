// Actors/Actor.js
import * as THREE from "three";
import { FeatureEdges } from "../Utils/FeatureEdges.js";
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
            name = c || "Actor";
            opts = {};
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
        if (this.mapper) {
            geometry = this.mapper.buildGeometry();
        } else if (a instanceof THREE.BufferGeometry) {
            geometry = a;
        } else {
            geometry = new THREE.BufferGeometry();
        }

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
     * (getScalarVisibility() alone is true by default even for plain models, which is
     * why highlight coloring used to be suppressed on every object.)
     */
    hasActiveScalarColoring() {
        return this._scalarVisible && (!!this._scalarTexture || this._hasVertexColors);
    }

    /** Applies the current scalar contour state to surface materials and wireframe overlays. */
    _applyScalarVisibility() {
        if (!this.surface) return this;

        const hasScalar = !!this._scalarTexture || this._hasVertexColors;
        const showScalar = hasScalar && this._scalarVisible;

        // Scalar ON  -> unlit material (MeshBasicMaterial): mọi ánh sáng bị bỏ qua,
        //               màu contour hiển thị đúng 100% giá trị scalar.
        // Scalar OFF -> lit material (MeshStandardMaterial): tô màu solid có chiếu sáng.
        const mat = showScalar ? this._surfaceUnlitMaterial : this._surfaceLitMaterial;

        if (showScalar) {
            // Restore mapping scalars onto target channels
            mat.map = this._scalarTexture || null;
            mat.vertexColors = !mat.map && this._hasVertexColors;
            mat.color.set(0xffffff);
        } else if (hasScalar) {
            // Remove scalar sources and fallback to solid coloring configurations
            mat.map = null;
            mat.vertexColors = false;
            mat.color.copy(this.solidColor);

            // --- GIẢI PHÁP LÀM SÁNG MODEL (chỉ áp dụng cho material có ánh sáng) ---
            // Cách A: Dùng Emissive làm Ambient giả lập (Sáng đều mọi góc)
            mat.emissive.copy(this.solidColor).multiplyScalar(0.3); // Thêm 30% độ sáng ambient

            // Cách B: Tăng tính chất khuếch tán (Diffusion), triệt tiêu phản xạ gắt
            if (this.surface.userData.initialRoughness === undefined) {
                this.surface.userData.initialRoughness = mat.roughness;
            }
            mat.roughness = 1.0; // Tối đa hóa khả năng tán xạ ánh sáng
        }
        mat.needsUpdate = true;

        // Hoán đổi material trên surface mesh nếu cần
        if (this.surface.material !== mat) {
            this.surface.material = mat;
            // Reset cờ clone của PickingController vì material gốc đã thay đổi
            this.surface.userData.isMaterialCloned = false;
        }

        // Force rebuild surface mesh if currently active in wireframe mode
        if (this.displayMode === DisplayMode.WIREFRAME) {
            this.showWireframe();
        }
        return this;
    }

    // ------------------------------------------------------------------
    // Edge Highlight Support (color + thickness)
    // ------------------------------------------------------------------

    /** Set the boundary / feature edge color. */
    setEdgeColor(color) {
        if (this._featureEdgeMaterial) {
            this._featureEdgeMaterial.color.set(color);
            this._featureEdgeMaterial.needsUpdate = true;
        }
        return this;
    }

    /** Alias kept for API compatibility with PickingController. */
    setFeatureEdgeColor(color) {
        return this.setEdgeColor(color);
    }

    /**
     * Set the boundary / feature edge line thickness (in pixels).
     * Boundary edges now use LineSegments2 + LineMaterial ("fat lines"),
     * so linewidth is rendered correctly on every WebGL driver.
     */
    setFeatureEdgeThickness(thickness) {
        if (this._featureEdgeMaterial) {
            this._featureEdgeMaterial.linewidth = thickness;
            this._featureEdgeMaterial.needsUpdate = true;
        }
        return this;
    }

    /** Restore the edge to its resting color/thickness captured at construction. */
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

        // Disable solid surfaces and boundaries
        this.surface.visible = false;
        if (this.boundaryEdge) this.boundaryEdge.visible = false;

        // Clean any existing wireframe overlays bound to the surface mesh directly
        this._disposeWireframeOverlay();

        // Build specific line material and geometry representation for wireframe.
        // Nguồn scalar theo đúng thứ tự ưu tiên của surface:
        //   1) texture + uv (interpolateScalarsBeforeMapping)
        //   2) vertex colors (attribute "color")
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

    /**
     * Xây geometry line segments cho wireframe, sao chép kèm các attribute mang
     * dữ liệu scalar để đường mesh hiển thị đúng màu contour:
     *   - opts.color: copy attribute "color" (vertex colors)
     *   - opts.uv:    copy attribute "uv" (dùng với texture LUT của mapper)
     */
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

        // Trích xuất theo mô hình vtkFeatureEdges (class độc lập FeatureEdges):
        //   - Boundary edges: đường bao của vật thể (cạnh chỉ thuộc 1 tam giác)
        //   - Feature edges:  đường gấp khúc có góc nhị diện >= featureEdgeAngle
        //   - Non-manifold:   cạnh thuộc > 2 tam giác (mặc định bật, giống VTK)
        // Đỉnh trùng vị trí được hàn theo tolerance tương đối với bounding box,
        // và phép thử góc không phụ thuộc chiều winding của tam giác.
        const edgesGeom = FeatureEdges.extract(this.surface.geometry, {
            featureAngle: this.featureEdgeAngle,
            boundaryEdges: true,
            featureEdges: true,
            nonManifoldEdges: true,
            manifoldEdges: false,
            windingIndependent: true,
            weldTolerance: this.featureEdgeWeldTolerance // null => tự tính (diag * 1e-4)
        });

        // Chuyển geometry line-segments thường sang LineSegmentsGeometry (fat lines).
        // fromEdgesGeometry đọc trực tiếp mảng position nên geometry phải non-indexed.
        const flatGeom = edgesGeom.getIndex() ? edgesGeom.toNonIndexed() : edgesGeom;
        const lineGeom = new LineSegmentsGeometry().fromEdgesGeometry(flatGeom);
        if (flatGeom !== edgesGeom) flatGeom.dispose();
        edgesGeom.dispose();

        this.boundaryEdge = new LineSegments2(lineGeom, this._featureEdgeMaterial);
        this.boundaryEdge.computeLineDistances();
        this.boundaryEdge.name = `${this.name}__boundaryEdges`;
        this.boundaryEdge.renderOrder = 2; // Elevate render order above solid surface geometry layer

        // LineSegments2 kế thừa Mesh (isMesh = true) => loại khỏi raycasting
        // để PickingController không pick nhầm vào đường edge.
        this.boundaryEdge.raycast = () => {};

        // LineMaterial cần biết kích thước viewport để đổi linewidth (px) sang NDC.
        // Tự cập nhật trước mỗi lần render nên không cần hook sự kiện resize.
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

        this.surface.geometry = this.mapper.buildGeometry();
        if (oldGeom) oldGeom.dispose();

        this._applyScalarColorSource();
        this._buildBoundaryEdges();

        // Re-trigger current display configurations
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
            // Dispose material đang gắn nếu nó là bản clone (do PickingController tạo)
            if (this.surface.material &&
                this.surface.material !== this._surfaceLitMaterial &&
                this.surface.material !== this._surfaceUnlitMaterial) {
                this.surface.material.dispose();
            }
        }
    }
}