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
        this._baseEdgeThickness = opts.featureEdgeThickness ?? 1.0;

        this._featureEdgeMaterial = new LineMaterial({
            color: opts.featureEdgeColor ?? 0x000000,
            linewidth: this._baseEdgeThickness,
            worldUnits: false,
            depthTest: true,
            transparent: true,
            opacity: 1.0,
            polygonOffset: true,
            polygonOffsetFactor: -1.0, 
            polygonOffsetUnits: -4.0   
        });

        this._wireframeFlatMaterial = new LineMaterial({
            color: 0x000000, 
            linewidth: opts.wireframeThickness ?? 1.0,
            worldUnits: false,
            depthTest: true,
            polygonOffset: true,
            polygonOffsetFactor: -1.0, 
            polygonOffsetUnits: -4.0   
        });

        this._wireframeVertexColorMaterial = new LineMaterial({
            vertexColors: false, 
            color: 0x000000,     
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

        const polyData = this.getPolyData();
        const isPointPrimitive = !!(
            geometry.userData?.primitiveType === "point" ||
            geometry.userData?.isPoint === true ||
            (polyData && polyData.verts && polyData.verts.length > 0 &&
                (!polyData.lines || polyData.lines.length === 0) &&
                (!polyData.polys || polyData.polys.length === 0) &&
                (!polyData.strips || polyData.strips.length === 0))
        );
        const isLinePrimitive = !isPointPrimitive && !!(
            (polyData && polyData.lines && polyData.lines.length > 0) ||
            geometry.userData?.primitiveType === "line" ||
            geometry.userData?.isLine === true
        );
        if (isLinePrimitive) {
            geometry.userData.primitiveType = "line";
        } else if (isPointPrimitive) {
            geometry.userData.primitiveType = "point";
        }

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

        if (isLinePrimitive) {
            const baseLineMaterial = new THREE.LineBasicMaterial({
                vertexColors: !!geometry.getAttribute("color"),
                color: opts.color ?? 0x000000,
                transparent: opts.opacity !== undefined && opts.opacity < 1,
                opacity: opts.opacity ?? 1
            });
            this.surface = new THREE.LineSegments(geometry, baseLineMaterial);
        } else if (isPointPrimitive) {
            const pointMaterial = new THREE.PointsMaterial({
                size: opts.pointSize ?? 4,
                sizeAttenuation: opts.pointSizeAttenuation ?? false,
                vertexColors: !!geometry.getAttribute("color"),
                color: opts.color ?? 0x000000,
                transparent: opts.opacity !== undefined && opts.opacity < 1,
                opacity: opts.opacity ?? 1
            });
            this.surface = new THREE.Points(geometry, pointMaterial);
        } else {
            this.surface = new THREE.Mesh(geometry, this._surfaceLitMaterial);
        }

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

        const polyData = this.getPolyData();
        if (
            (polyData && polyData.lines && polyData.lines.length > 0) || 
            geometry.userData?.primitiveType === "line" ||
            geometry.userData?.isLine === true ||
            geometry.userData?.primitiveType === "point" ||
            geometry.userData?.isPoint === true
        ) {
            return geometry;
        }

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

    setOpacity(value) {
        const opacity = THREE.MathUtils.clamp(Number(value), 0, 1);
        this.userData.actorOpacity = opacity;
        const allMaterials = new Set([
            this._surfaceLitMaterial,
            this._surfaceUnlitMaterial,
            this._featureEdgeMaterial,
            this._wireframeFlatMaterial,
            this._wireframeVertexColorMaterial,
            this._wireframeTextureMaterial,
        ].filter(Boolean));
        this.traverse((object) => {
            const materials = Array.isArray(object.material) ? object.material : [object.material];
            for (const material of materials) if (material) allMaterials.add(material);
        });
        for (const material of allMaterials) {
            material.opacity = opacity;
            material.transparent = opacity < 1;
            // Keep the nearest exterior surface in the depth buffer while
            // translucent. Without this, back/internal triangles blend in
            // arbitrary draw order and appear as cross-section-like slices.
            material.depthWrite = opacity > 0;
            if ("forceSinglePass" in material) material.forceSinglePass = true;
            material.needsUpdate = true;
        }
        return this;
    }

    getOpacity() {
        return this.userData.actorOpacity ?? this.surface?.material?.opacity ?? 1;
    }

    hasActiveScalarColoring() {
        return this._scalarVisible && (!!this._scalarTexture || this._hasVertexColors);
    }

    _applyScalarVisibility() {
        if (!this.surface) return this;

        const hasScalar = !!this._scalarTexture || this._hasVertexColors;
        const showScalar = hasScalar && this._scalarVisible;

        if (this.surface instanceof THREE.LineSegments || this.surface instanceof THREE.Points) {
            const mat = this.surface.material;
            if (mat) {
                mat.vertexColors = showScalar && this._hasVertexColors;
                mat.color.copy(showScalar ? new THREE.Color(0xffffff) : this.solidColor);
                mat.visible = !(this.displayMode === DisplayMode.WIREFRAME || this.displayMode === DisplayMode.BOUNDARY_EDGE);
                mat.needsUpdate = true;
            }
            return this;
        }

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
        
        // FIX: Ensure material visibility matches the current active display mode configuration
        if (this.displayMode === DisplayMode.WIREFRAME || this.displayMode === DisplayMode.BOUNDARY_EDGE) {
            mat.visible = false;
        } else {
            mat.visible = true;
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

    _createWireframeOverlayMesh(srcGeom) {
        let wireGeom = this._buildScalarWireframeGeometry(srcGeom, {});
        
        if (!wireGeom) {
            wireGeom = new THREE.WireframeGeometry(srcGeom);
        }

        let material = this._wireframeFlatMaterial;

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
        this._disposeWireframeOverlay();

        this.surface.visible = true;
        if (this.surface.material) {
            this.surface.material.visible = false;
        }
        
        if (this.boundaryEdge) this.boundaryEdge.visible = true;

        this._wireframeOverlay = this._createWireframeOverlayMesh(this.surface.geometry);
        this._wireframeOverlay.name = `${this.name}__wireframeOverlay`;

        this.add(this._wireframeOverlay);
        return this;
    }

    showModelWithEdges() {
        this.displayMode = DisplayMode.MODEL_WITH_EDGE;
        this._disposeWireframeOverlay();

        this.surface.visible = true;
        if (this.surface.material) {
            this.surface.material.visible = true;
        }
        if (this.boundaryEdge) this.boundaryEdge.visible = true;
        return this;
    }

    showModelWithoutEdges() {
        this.displayMode = DisplayMode.MODEL_WITHOUT_EDGE;
        this._disposeWireframeOverlay();

        this.surface.visible = true;
        if (this.surface.material) {
            this.surface.material.visible = true;
        }
        if (this.boundaryEdge) this.boundaryEdge.visible = false;
        return this;
    }

    showBoundaryEdges() {
        this.displayMode = DisplayMode.BOUNDARY_EDGE;
        this._disposeWireframeOverlay();

        this.surface.visible = true;
        if (this.surface.material) {
            this.surface.material.visible = false;
        }
        
        if (this.boundaryEdge) this.boundaryEdge.visible = true;
        return this;
    }

    showMesh() {
        this.displayMode = DisplayMode.MESH;
        this._disposeWireframeOverlay();

        this.surface.visible = true;
        if (this.surface.material) {
            this.surface.material.visible = true;
        }
        if (this.boundaryEdge) this.boundaryEdge.visible = true;

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
            const rawUvs = opts.uv && polyData.pointData ? polyData.pointData.tcoords : null;

            const capArray = polyData.cellData?.getArray?.("IsCap");
            const capValues = capArray?.values ?? null;
            const edgeMap = new Map();
            const addEdge = (a, b, normal, isCapFace) => {
                const key = a < b ? a + "_" + b : b + "_" + a;
                let rec = edgeMap.get(key);
                if (!rec) {
                    rec = { a, b, normals: [], capCount: 0, count: 0 };
                    edgeMap.set(key, rec);
                }
                rec.normals.push(normal);
                rec.count++;
                if (isCapFace) rec.capCount++;
            };

            const p0 = new THREE.Vector3();
            const p1 = new THREE.Vector3();
            const p2 = new THREE.Vector3();
            const e1 = new THREE.Vector3();
            const e2 = new THREE.Vector3();
            let faceId = 0;
            for (const face of polyData.polys) {
                const n = face.length;
                if (n < 2) continue;

                let normal = null;
                if (n >= 3) {
                    p0.fromArray(rawPoints, face[0] * 3);
                    p1.fromArray(rawPoints, face[1] * 3);
                    p2.fromArray(rawPoints, face[2] * 3);
                    e1.subVectors(p1, p0);
                    e2.subVectors(p2, p0);
                    normal = new THREE.Vector3().crossVectors(e1, e2);
                    if (normal.lengthSq() > 1e-20) normal.normalize();
                    else normal = null;
                }
                const isCapFace = !!(capValues && capValues[faceId] > 0.5);
                for (let i = 0; i < n; i++) {
                    addEdge(face[i], face[(i + 1) % n], normal, isCapFace);
                }
                faceId++;
            }

            const isInternalCapEdge = (rec) => {
                if (!capValues || rec.count < 2 || rec.capCount !== rec.count) return false;
                const n0 = rec.normals[0];
                if (!n0) return false;
                for (let i = 1; i < rec.normals.length; i++) {
                    const ni = rec.normals[i];
                    if (!ni || Math.abs(n0.dot(ni)) < 1 - 1e-4) return false;
                }
                return true;
            };

            const edges = [];
            for (const rec of edgeMap.values()) {
                if (!isInternalCapEdge(rec)) edges.push([rec.a, rec.b]);
            }

            const edgeCount = edges.length;
            const posArr = new Float32Array(edgeCount * 6);
            const colArr = colors ? new Float32Array(edgeCount * 6) : null;
            const uvArr = uvs ? new Float32Array(edgeCount * 4) : null;
            const nc = (colors && rawColors) ? rawColors.length / (rawPoints.length / 3) : 0;

            let pw = 0, cw = 0, uw = 0;
            for (const [a, b] of edges) {
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
            g.setAttribute("position", new THREE.Float32BufferAttribute(posArr, 3));
            if (colArr) g.setAttribute("color", new THREE.Float32BufferAttribute(colArr, 3));
            if (uvArr) g.setAttribute("uv", new THREE.Float32BufferAttribute(uvArr, 2));

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

        if (
            this.surface.geometry.userData?.primitiveType === "line" ||
            this.surface.geometry.userData?.primitiveType === "point" ||
            this.surface instanceof THREE.LineSegments ||
            this.surface instanceof THREE.Points
        ) {
            return; 
        }

        const edgesGeom = FeatureEdges.extract(this.surface.geometry, {
            featureAngle: this.featureEdgeAngle,
            boundaryEdges: true,
            featureEdges: true,
            nonManifoldEdges: true,
            manifoldEdges: false,
            windingIndependent: true,
            weldTolerance: this.featureEdgeWeldTolerance
        });

        const filteredEdgesGeom = this._filterInternalCapEdges(edgesGeom);
        if (filteredEdgesGeom !== edgesGeom) edgesGeom.dispose();

        const flatGeom = filteredEdgesGeom.getIndex() ? filteredEdgesGeom.toNonIndexed() : filteredEdgesGeom;
        const lineGeom = new LineSegmentsGeometry().fromEdgesGeometry(flatGeom);
        if (flatGeom !== filteredEdgesGeom) flatGeom.dispose();
        filteredEdgesGeom.dispose();

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

    _filterInternalCapEdges(edgeGeometry) {
        const polyData = this.getPolyData();
        const capValues = polyData?.cellData?.getArray?.("IsCap")?.values ?? null;
        if (!polyData || !capValues || !edgeGeometry?.getAttribute("position")) return edgeGeometry;

        const tol = this.featureEdgeWeldTolerance ?? this.externalSurfaceWeldTolerance ?? 1e-6;
        const keyPoint = (arr, offset) => {
            const q = (v) => Math.round(v / tol);
            return `${q(arr[offset])},${q(arr[offset + 1])},${q(arr[offset + 2])}`;
        };
        const keyEdge = (pa, pb) => pa < pb ? `${pa}|${pb}` : `${pb}|${pa}`;

        const rawPoints = polyData.points;
        const capEdgeMap = new Map();
        const p0 = new THREE.Vector3();
        const p1 = new THREE.Vector3();
        const p2 = new THREE.Vector3();
        const e1 = new THREE.Vector3();
        const e2 = new THREE.Vector3();

        let faceId = 0;
        for (const face of polyData.polys) {
            const n = face.length;
            const isCapFace = capValues[faceId] > 0.5;
            if (isCapFace && n >= 3) {
                p0.fromArray(rawPoints, face[0] * 3);
                p1.fromArray(rawPoints, face[1] * 3);
                p2.fromArray(rawPoints, face[2] * 3);
                e1.subVectors(p1, p0);
                e2.subVectors(p2, p0);
                const normal = new THREE.Vector3().crossVectors(e1, e2);
                if (normal.lengthSq() > 1e-20) normal.normalize();

                for (let i = 0; i < n; i++) {
                    const a = face[i] * 3;
                    const b = face[(i + 1) % n] * 3;
                    const key = keyEdge(keyPoint(rawPoints, a), keyPoint(rawPoints, b));
                    let rec = capEdgeMap.get(key);
                    if (!rec) {
                        rec = { count: 0, normals: [] };
                        capEdgeMap.set(key, rec);
                    }
                    rec.count++;
                    rec.normals.push(normal.clone());
                }
            }
            faceId++;
        }

        const internalKeys = new Set();
        for (const [key, rec] of capEdgeMap) {
            if (rec.count < 2) continue;
            const n0 = rec.normals[0];
            if (!n0) continue;
            let coplanar = true;
            for (let i = 1; i < rec.normals.length; i++) {
                if (!rec.normals[i] || Math.abs(n0.dot(rec.normals[i])) < 1 - 1e-4) {
                    coplanar = false;
                    break;
                }
            }
            if (coplanar) internalKeys.add(key);
        }
        if (!internalKeys.size) return edgeGeometry;

        const flat = edgeGeometry.getIndex() ? edgeGeometry.toNonIndexed() : edgeGeometry;
        const pos = flat.getAttribute("position").array;
        const kept = [];
        for (let i = 0; i + 5 < pos.length; i += 6) {
            const key = keyEdge(keyPoint(pos, i), keyPoint(pos, i + 3));
            if (internalKeys.has(key)) continue;
            kept.push(pos[i], pos[i + 1], pos[i + 2], pos[i + 3], pos[i + 4], pos[i + 5]);
        }

        const out = new THREE.BufferGeometry();
        out.setAttribute("position", new THREE.Float32BufferAttribute(kept, 3));
        if (flat !== edgeGeometry) flat.dispose();
        return out;
    }

    _disposeBoundaryEdges() {
        if (!this.boundaryEdge) return;
        this.remove(this.boundaryEdge);
        this.boundaryEdge.geometry.dispose();
        this.boundaryEdge = null;
    }

    getPolyData() { return this.mapper ? this.mapper.input : null; }

    get geometry() { return this.surface ? this.surface.geometry : null; }
    set geometry(geom) { if (this.surface) this.surface.geometry = geom; }

    get material() { return this.surface ? this.surface.material : null; }
    set material(mat) { if (this.surface) this.surface.material = mat; }

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
