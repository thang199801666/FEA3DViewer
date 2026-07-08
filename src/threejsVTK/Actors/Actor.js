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

        // External-surface options
        this.externalSurface = opts.externalSurface ?? true;
        this.keepOuterShell = opts.keepOuterShell ?? false;
        this.externalSurfaceWeldTolerance = opts.externalSurfaceWeldTolerance ?? null;
        this.externalSurfaceConeAngle = opts.externalSurfaceConeAngle ?? 72;
        this.externalSurfaceRayCount = opts.externalSurfaceRayCount ?? 64;
        this.externalSurfaceDebug = opts.externalSurfaceDebug ?? false;

        // Initialize Materials
        this.solidColor = new THREE.Color(opts.solidColor ?? 0xcccccc);

        this._baseEdgeColor = new THREE.Color(opts.featureEdgeColor ?? 0x000000);
        this._baseEdgeThickness = opts.featureEdgeThickness ?? 1.0;

        this._featureEdgeMaterial = new LineMaterial({
            color: opts.featureEdgeColor ?? 0x000000,
            linewidth: this._baseEdgeThickness,
            worldUnits: false,
            depthTest: true
        });
        this._wireframeFlatMaterial = new THREE.LineBasicMaterial({
            color: opts.wireframeColor ?? 0x000000
        });
        this._wireframeVertexColorMaterial = new THREE.LineBasicMaterial({
            vertexColors: true
        });
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

        geometry = this._toExternalSurface(geometry, rawFromMapper);

        // Build Surface Mesh
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

        this.surface = new THREE.Mesh(geometry, this._surfaceLitMaterial);
        this.surface.name = `${this.name}__surface`;
        this.add(this.surface);

        this._scalarTexture = colorTexture;
        this._hasVertexColors = !!geometry.getAttribute("color");
        this._applyScalarVisibility();

        this._buildBoundaryEdges();

        if (opts.displayMode) {
            this.setDisplayMode(opts.displayMode);
        } else {
            this.setDisplayMode(DisplayMode.MODEL_WITH_EDGE);
        }
    }

    // ------------------------------------------------------------------
    // External Surface (body) extraction
    // ------------------------------------------------------------------

    _toExternalSurface(geometry, disposeRaw = false) {
        if (!this.externalSurface || !geometry) {
            return geometry;
        }

        const tol = this.externalSurfaceWeldTolerance ?? 1e-6;
        let ext;

        if (this.keepOuterShell) {
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
            ext = new GeometryFilter()
                .setRemoveInternalWalls(true)
                .setWeldTolerance(tol)
                .setInputData(geometry)
                .getOutputData();
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
            wireGeom = this._buildScalarWireframeGeometry(srcGeom, {});
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
    // Wireframe Structural Builder (TOPOLOGY TRACING & CELL COORDINATES)
    // ------------------------------------------------------------------

    _buildScalarWireframeGeometry(src, opts = {}) {
        const polyData = this.getPolyData();
        
        // PHƯƠNG ÁN CHUẨN FEA: Nếu có dữ liệu ô (Cells) nguyên bản từ file VTK
        if (polyData && polyData.cells && polyData.cells.length > 0) {
            const positions = [];
            const colors = opts.color ? [] : null;
            const uvs = opts.uv ? [] : null;

            // Truy xuất trực tiếp từ các thuộc tính gốc của PolyData đầu vào mapper
            // Điều này đảm bảo tọa độ (X, Y, Z) và chỉ mục đỉnh khớp hoàn toàn với cấu trúc Cell
            const rawPoints = polyData.points; // Mảng phẳng [x0, y0, z0, x1, y1, z1, ...]
            const rawColors = opts.color && polyData.pointData ? polyData.pointData.scalars : null;
            const rawUvs = opts.uv && polyData.pointData ? polyData.pointData.tcoords : null;

            const uniqueEdges = new Set();

            const addEdgeRaw = (i, j) => {
                if (i === undefined || j === undefined) return;
                const key = i < j ? `${i}_${j}` : `${j}_${i}`;
                if (uniqueEdges.has(key)) return; // Tối ưu: Gộp các cạnh trùng nhau giữa các khối kề sát
                uniqueEdges.add(key);

                // Điểm i
                positions.push(rawPoints[i * 3], rawPoints[i * 3 + 1], rawPoints[i * 3 + 2]);
                // Điểm j
                positions.push(rawPoints[j * 3], rawPoints[j * 3 + 1], rawPoints[j * 3 + 2]);

                if (colors && rawColors) {
                    // Hỗ trợ cả cấu trúc mảng RGB phẳng hoặc mảng giá trị đơn
                    const cDim = rawColors.length / (rawPoints.length / 3);
                    if (cDim >= 3) {
                        colors.push(rawColors[i * cDim], rawColors[i * cDim + 1], rawColors[i * cDim + 2]);
                        colors.push(rawColors[j * cDim], rawColors[j * cDim + 1], rawColors[j * cDim + 2]);
                    } else {
                        // Ánh xạ màu giả lập hoặc contour (nếu cần xử lý sâu hơn thông qua Mapper)
                        colors.push(rawColors[i], rawColors[i], rawColors[i]);
                        colors.push(rawColors[j], rawColors[j], rawColors[j]);
                    }
                }
                if (uvs && rawUvs) {
                    uvs.push(rawUvs[i * 2], rawUvs[i * 2 + 1]);
                    uvs.push(rawUvs[j * 2], rawUvs[j * 2 + 1]);
                }
            };

            // Duyệt qua từng ô phần tử hữu hạn nguyên bản
            for (let c = 0; c < polyData.cells.length; c++) {
                const cell = polyData.cells[c];
                if (!cell || cell.length < 2) continue;

                if (cell.length === 8) { 
                    // KHỐI HEXAHEDRON (8 ĐỈNH) - Vẽ đúng 12 cạnh biên của khối hộp, SẠCH ĐƯỜNG CHÉO
                    // 4 cạnh đáy mặt dưới (v0-v1-v2-v3)
                    addEdgeRaw(cell[0], cell[1]); addEdgeRaw(cell[1], cell[2]);
                    addEdgeRaw(cell[2], cell[3]); addEdgeRaw(cell[3], cell[0]);
                    
                    // 4 cạnh đáy mặt trên (v4-v5-v6-v7)
                    addEdgeRaw(cell[4], cell[5]); addEdgeRaw(cell[5], cell[6]);
                    addEdgeRaw(cell[6], cell[7]); addEdgeRaw(cell[7], cell[4]);
                    
                    // 4 cạnh đứng liên kết dọc theo chiều cao
                    addEdgeRaw(cell[0], cell[4]); addEdgeRaw(cell[1], cell[5]);
                    addEdgeRaw(cell[2], cell[6]); addEdgeRaw(cell[3], cell[7]);

                } else if (cell.length === 4) {
                    // PHẦN TỬ QUẤT/TẤM QUAD (4 ĐỈNH)
                    addEdgeRaw(cell[0], cell[1]); addEdgeRaw(cell[1], cell[2]);
                    addEdgeRaw(cell[2], cell[3]); addEdgeRaw(cell[3], cell[0]);
                } else if (cell.length === 3) {
                    // PHẦN TỬ TAM GIÁC (TRIANGLE)
                    addEdgeRaw(cell[0], cell[1]); addEdgeRaw(cell[1], cell[2]);
                    addEdgeRaw(cell[2], cell[0]);
                } else {
                    // Các phần tử dạng thanh (Line) hoặc đa diện đặc thù khác (Polygon)
                    for (let i = 0; i < cell.length; i++) {
                        addEdgeRaw(cell[i], cell[(i + 1) % cell.length]);
                    }
                }
            }

            const g = new THREE.BufferGeometry();
            g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
            if (colors && colors.length > 0) g.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
            if (uvs && uvs.length > 0) g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
            return g;
        }

        // ------------------------------------------------------------------
        // FALLBACK TRONG SUỐT: Dùng giải thuật hình học tính góc nếu không chạy qua Mapper
        // ------------------------------------------------------------------
        if (!src.getAttribute("normal")) {
            src.computeVertexNormals();
        }

        const pos = src.getAttribute("position");
        const col = opts.color ? src.getAttribute("color") : null;
        const uv = opts.uv ? src.getAttribute("uv") : null;
        const index = src.getIndex();
        const count = index ? index.count : pos.count;

        const edgeMap = {};
        const triangles = [];
        const vA = new THREE.Vector3(), vB = new THREE.Vector3(), vC = new THREE.Vector3();
        const cb = new THREE.Vector3(), ab = new THREE.Vector3();

        for (let t = 0, triIdx = 0; t < count; t += 3, triIdx++) {
            const a = index ? index.getX(t)     : t;
            const b = index ? index.getX(t + 1) : t + 1;
            const c = index ? index.getX(t + 2) : t + 2;

            vA.fromBufferAttribute(pos, a); vB.fromBufferAttribute(pos, b); vC.fromBufferAttribute(pos, c);
            cb.subVectors(vC, vB).cross(ab.subVectors(vA, vB)).normalize();

            triangles.push({ indices: [a, b, c], normal: cb.clone() });

            const keys = [
                a < b ? `${a}_${b}` : `${b}_${a}`,
                b < c ? `${b}_${c}` : `${c}_${b}`,
                c < a ? `${c}_${a}` : `${a}_${c}`
            ];
            keys.forEach(key => {
                if (!edgeMap[key]) edgeMap[key] = [];
                edgeMap[key].push(triIdx);
            });
        }

        const positions = [];
        const colors = col ? [] : null;
        const uvs = uv ? [] : null;

        const pushVertex = (i) => {
            positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
            if (colors) colors.push(col.getX(i), col.getY(i), col.getZ(i));
            if (uvs) uvs.push(uv.getX(i), uv.getY(i));
        };

        const pA = new THREE.Vector3(), pB = new THREE.Vector3(), pC = new THREE.Vector3(), pD = new THREE.Vector3();
        const nPlane = new THREE.Vector3(), mLine = new THREE.Vector3();
        const thresholdCos = Math.cos(THREE.MathUtils.degToRad(5));

        for (const key in edgeMap) {
            const triIds = edgeMap[key];
            const [v1Str, v2Str] = key.split("_");
            const v1 = parseInt(v1Str, 10); const v2 = parseInt(v2Str, 10);

            if (triIds.length === 1) {
                pushVertex(v1); pushVertex(v2);
            } else if (triIds.length === 2) {
                const tri1 = triangles[triIds[0]];
                const tri2 = triangles[triIds[1]];
                if (tri1.normal.dot(tri2.normal) > thresholdCos) {
                    const cIdx = tri1.indices.find(idx => idx !== v1 && idx !== v2);
                    const dIdx = tri2.indices.find(idx => idx !== v1 && idx !== v2);
                    pA.fromBufferAttribute(pos, v1); pB.fromBufferAttribute(pos, v2);
                    pC.fromBufferAttribute(pos, cIdx); pD.fromBufferAttribute(pos, dIdx);

                    mLine.subVectors(pD, pC).cross(nPlane.copy(tri1.normal)).normalize();
                    if (pA.clone().sub(pC).dot(mLine) * pB.clone().sub(pC).dot(mLine) >= 0) {
                        pushVertex(v1); pushVertex(v2);
                    }
                } else {
                    pushVertex(v1); pushVertex(v2);
                }
            } else {
                pushVertex(v1); pushVertex(v2);
            }
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