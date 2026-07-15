import * as THREE from "three";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { PickMode } from "../picking/PickMode.js";
import { ActorTopology } from "../picking/ActorTopology.js";

const _dir = new THREE.Vector3();
const _off = new THREE.Matrix4();
const _point = new THREE.Vector3();

let _dotTexture = null;
function dotTexture() {
    if (_dotTexture) return _dotTexture;
    const s = 64;
    const cv = document.createElement("canvas");
    cv.width = cv.height = s;
    const g = cv.getContext("2d");
    g.beginPath();
    g.arc(s / 2, s / 2, s / 2 - 2, 0, Math.PI * 2);
    g.fillStyle = "#fff";
    g.fill();
    _dotTexture = new THREE.CanvasTexture(cv);
    return _dotTexture;
}

/** Nudges the overlay matrix slightly towards the camera to mitigate z-fighting. */
function depthNudge(obj, eps) {
    obj.onBeforeRender = (renderer, scene, camera) => {
        camera.getWorldDirection(_dir);
        _off.makeTranslation(-_dir.x * eps, -_dir.y * eps, -_dir.z * eps);
        obj.matrixWorld.premultiply(_off);
    };
}

export class SelectionHighlighter {
    constructor({ renderer = null, selectColor = 0xff0000, hoverColor = 0xff8c00, opacity = 0.3 } = {}) {
        this.renderer = renderer;
        this.selectColor = new THREE.Color(selectColor);
        this.hoverColor = new THREE.Color(hoverColor);
        this.opacity = opacity;

        this._hover = null;
        this._hoverKey = null;
        this._selection = new Map();
    }

    setHover(result) {
        // Hover temporarily supersedes selection for the same entity. Restore
        // the selected overlay as soon as the pointer leaves or moves away.
        if (this._hoverKey) {
            const selected = this._selection.get(this._hoverKey);
            if (selected) selected.visible = true;
        }
        if (this._hover) this._destroy(this._hover);
        this._hover = result ? this._build(result, this.hoverColor, true) : null;
        this._hoverKey = result?.key ?? null;
        if (this._hoverKey) {
            const selected = this._selection.get(this._hoverKey);
            if (selected) selected.visible = false;
        }
    }

    /** Replaces the entire current selection with new picked results. */
    setSelection(results) {
        for (const o of this._selection.values()) this._destroy(o);
        this._selection.clear();
        for (const r of results) {
            const o = this._build(r, this.selectColor, false);
            if (o) this._selection.set(r.key, o);
        }
        const hoveredSelection = this._hoverKey ? this._selection.get(this._hoverKey) : null;
        if (hoveredSelection) hoveredSelection.visible = false;
    }

    toggle(result) {
        if (this._selection.has(result.key)) {
            this._destroy(this._selection.get(result.key));
            this._selection.delete(result.key);
        } else {
            const o = this._build(result, this.selectColor, false);
            if (o) {
                this._selection.set(result.key, o);
                if (result.key === this._hoverKey) o.visible = false;
            }
        }
    }

    has(key) { return this._selection.has(key); }
    get selectedKeys() { return Array.from(this._selection.keys()); }

    clear() {
        this.setHover(null);
        for (const o of this._selection.values()) this._destroy(o);
        this._selection.clear();
    }

    dispose() { this.clear(); }

    // ------------------------------------------------------------------
    // Overlay Construction
    // ------------------------------------------------------------------

    _build(result, color, isHover) {
        const { actor, mode, id } = result;
        const topo = ActorTopology.get(actor);
        if (!topo) return null;

        let obj = null;
        switch (mode) {
            case PickMode.PART: {
                obj = new THREE.Group();
                const baseThickness = actor._featureEdgeMaterial?.linewidth
                    ?? actor._baseEdgeThickness
                    ?? 1.0;
                const outline = this._actorBoundaryEdges(
                    actor,
                    topo,
                    color,
                    baseThickness * (isHover ? 1.75 : 1.35)
                );
                if (outline) obj.add(outline);
                actor.add(obj);
                break;
            }
            case PickMode.SURFACE: {
                const tris = topo.trianglesOfSurface(id);
                obj = new THREE.Group();
                const face = this._meshFromTriangles(actor, topo, tris, color, false);
                if (face) obj.add(face);
                const outline = this._cellOutline(actor, topo, tris, color);
                if (outline) obj.add(outline);
                actor.add(obj);
                break;
            }
            case PickMode.ELEMENT: {
                const element = topo.elementOfCell?.(id);
                const rawTris = element?.triangles?.length ? element.triangles : null;
                const tris = element ? null : topo.trianglesOfCell(id);
                obj = new THREE.Group();
                const face = rawTris
                    ? this._meshFromRawTriangles(actor, topo, rawTris, color)
                    : element
                    ? null
                    : this._meshFromTriangles(actor, topo, tris, color, false);
                if (face) obj.add(face);
                const wire = element?.edges?.length
                    ? this._rawElementEdges(actor, topo, element.edges, color, isHover)
                    : rawTris
                    ? this._rawTriangleOutline(actor, topo, rawTris, color)
                    : this._cellOutline(actor, topo, tris, color);
                if (wire) obj.add(wire);
                if (element && !element.triangles.length && element.points.length) {
                    const points = element.points.map((raw) => this._sourcePoint(actor, raw, new THREE.Vector3()));
                    const nodes = this._pointSprite(actor, topo, points, color, isHover, false);
                    if (nodes) obj.add(nodes);
                }
                actor.add(obj);
                break;
            }
            case PickMode.EDGE:
                obj = this._chainLine(actor, topo, topo.chainOf(id), color, isHover);
                break;
            case PickMode.POINT: {
                const p = topo.weldedPosition(result.welded ?? result.id, new THREE.Vector3());
                obj = this._pointSprite(actor, topo, [p], color, isHover);
                break;
            }
            case PickMode.NODE: {
                const p = topo.nodePosition(result.id, new THREE.Vector3());
                obj = this._pointSprite(actor, topo, [p], color, isHover);
                break;
            }
        }

        if (obj) {
            if (!obj.isGroup) obj.renderOrder = isHover ? 9 : 10;
            obj.userData.__highlight = true;
            obj.userData.__highlightMode = mode;
            obj.userData.__highlightActor = actor;
        }
        return obj;
    }

    _meshFromTriangles(actor, topo, tris, color, autoAdd = true) {
        const src = actor.surface.geometry;
        const pos = src.getAttribute("position");

        const list = tris || Uint32Array.from({ length: topo.triCount }, (_, i) => i);
        const out = new Float32Array(list.length * 9);

        for (let i = 0; i < list.length; i++) {
            const o = list[i] * 3;
            for (let k = 0; k < 3; k++) {
                const vi = topo.triRaw[o + k];
                out[i * 9 + k * 3] = pos.getX(vi);
                out[i * 9 + k * 3 + 1] = pos.getY(vi);
                out[i * 9 + k * 3 + 2] = pos.getZ(vi);
            }
        }

        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.BufferAttribute(out, 3));

        const m = new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: this.opacity,
            depthTest: true,
            depthWrite: false,
            side: THREE.DoubleSide,
            polygonOffset: true,
            polygonOffsetFactor: -2,
            polygonOffsetUnits: -2,
            toneMapped: false,
            blending: THREE.AdditiveBlending
        });

        const mesh = new THREE.Mesh(g, m);
        mesh.raycast = () => {};
        if (autoAdd) actor.add(mesh);
        return mesh;
    }

    _meshFromRawTriangles(actor, topo, rawTris, color) {
        const out = new Float32Array(rawTris.length * 3);
        for (let i = 0; i < rawTris.length; i++) {
            const p = this._sourcePoint(actor, rawTris[i], _point);
            out[i * 3] = p.x;
            out[i * 3 + 1] = p.y;
            out[i * 3 + 2] = p.z;
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.BufferAttribute(out, 3));
        const m = new THREE.MeshBasicMaterial({
            color, transparent: true, opacity: this.opacity,
            depthTest: true, depthWrite: false, side: THREE.DoubleSide,
            polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
            toneMapped: false, blending: THREE.AdditiveBlending
        });
        const mesh = new THREE.Mesh(g, m);
        mesh.raycast = () => {};
        return mesh;
    }

    /** Extracts the boundary/outline of a set of triangles (edges shared by only one triangle). */
    _cellOutline(actor, topo, tris, color) {
        if (!tris || !tris.length) return null;

        const count = new Map();
        const key = (a, b) => (a < b ? `${a}_${b}` : `${b}_${a}`);
        for (const t of tris) {
            const o = t * 3;
            const a = topo.tri[o], b = topo.tri[o + 1], c = topo.tri[o + 2];
            for (const [u, v] of [[a, b], [b, c], [c, a]]) {
                const k = key(u, v);
                count.set(k, (count.get(k) || 0) + 1);
            }
        }

        const pts = [];
        for (const [k, n] of count) {
            if (n !== 1) continue;
            const [u, v] = k.split("_").map(Number);
            pts.push(topo.wpos[u * 3], topo.wpos[u * 3 + 1], topo.wpos[u * 3 + 2]);
            pts.push(topo.wpos[v * 3], topo.wpos[v * 3 + 1], topo.wpos[v * 3 + 2]);
        }
        if (!pts.length) return null;

        return this._lineSegments(actor, topo, pts, color, 3);
    }

    _rawTriangleOutline(actor, topo, rawTris, color) {
        if (!rawTris?.length) return null;
        const edges = new Map();
        const normals = [];
        const pa = new THREE.Vector3(), pb = new THREE.Vector3(), pc = new THREE.Vector3();
        const key = (a, b) => (a < b ? `${a}_${b}` : `${b}_${a}`);
        for (let i = 0; i < rawTris.length; i += 3) {
            const a = topo._rawToWelded[rawTris[i]];
            const b = topo._rawToWelded[rawTris[i + 1]];
            const c = topo._rawToWelded[rawTris[i + 2]];
            pa.set(topo.wpos[a * 3], topo.wpos[a * 3 + 1], topo.wpos[a * 3 + 2]);
            pb.set(topo.wpos[b * 3], topo.wpos[b * 3 + 1], topo.wpos[b * 3 + 2]);
            pc.set(topo.wpos[c * 3], topo.wpos[c * 3 + 1], topo.wpos[c * 3 + 2]);
            const normalId = normals.length;
            normals.push(new THREE.Vector3().subVectors(pb, pa).cross(pc.clone().sub(pa)).normalize());
            for (const [u, v] of [[a, b], [b, c], [c, a]]) {
                const k = key(u, v);
                if (!edges.has(k)) edges.set(k, { u, v, normals: [] });
                edges.get(k).normals.push(normalId);
            }
        }
        const pts = [];
        const cosLimit = Math.cos(THREE.MathUtils.degToRad(topo.actor?.featureEdgeAngle ?? 20));
        for (const { u, v, normals: adjacent } of edges.values()) {
            let keep = adjacent.length !== 2;
            if (adjacent.length === 2) {
                keep = Math.abs(normals[adjacent[0]].dot(normals[adjacent[1]])) <= cosLimit;
            }
            if (!keep) continue;
            pts.push(
                topo.wpos[u * 3], topo.wpos[u * 3 + 1], topo.wpos[u * 3 + 2],
                topo.wpos[v * 3], topo.wpos[v * 3 + 1], topo.wpos[v * 3 + 2]
            );
        }
        return this._lineSegments(actor, topo, pts, color, 3);
    }

    _rawElementEdges(actor, topo, edges, color, isHover) {
        const pts = [];
        for (const chain of edges) {
            for (let i = 0; i + 1 < chain.length; i++) {
                for (const raw of [chain[i], chain[i + 1]]) {
                    const p = this._sourcePoint(actor, raw, _point);
                    pts.push(p.x, p.y, p.z);
                }
            }
        }
        return this._lineSegments(actor, topo, pts, color, isHover ? 3 : 4);
    }

    _sourcePoint(actor, pointId, target) {
        const points = actor.mapper?.input?.points;
        if (points && pointId * 3 + 2 < points.length) {
            return target.fromArray(points, pointId * 3);
        }
        return target.fromBufferAttribute(actor.surface.geometry.getAttribute("position"), pointId);
    }

    _chainLine(actor, topo, chain, color, isHover) {
        if (!chain) return null;
        const pts = [];
        for (let i = 0; i + 1 < chain.verts.length; i++) {
            pts.push(chain.positions[i * 3], chain.positions[i * 3 + 1], chain.positions[i * 3 + 2]);
            pts.push(chain.positions[i * 3 + 3], chain.positions[i * 3 + 4], chain.positions[i * 3 + 5]);
        }
        const line = this._lineSegments(actor, topo, pts, color, isHover ? 3 : 4);
        actor.add(line);
        return line;
    }

    _lineSegments(actor, topo, flatPts, color, width) {
        if (!flatPts?.length) return null;
        const geom = new LineSegmentsGeometry();
        geom.setPositions(flatPts);

        const mat = new LineMaterial({
            color: new THREE.Color(color).getHex(),
            linewidth: width,
            worldUnits: false,
            // Highlight outlines are an interaction overlay. They must remain
            // visible through the solid model rather than being depth-culled.
            depthTest: false,
            depthWrite: false,
            transparent: true,
            opacity: 1,
            toneMapped: false
        });

        const line = new LineSegments2(geom, mat);
        line.computeLineDistances();
        line.raycast = () => {};
        line.renderOrder = 1000;
        line.frustumCulled = false;

        const renderer = this.renderer;
        line.onBeforeRender = (r, scene, camera) => {
            (renderer || r).getSize(mat.resolution);
            camera.getWorldDirection(_dir);
            const eps = topo.diag * 5e-4;
            _off.makeTranslation(-_dir.x * eps, -_dir.y * eps, -_dir.z * eps);
            line.matrixWorld.premultiply(_off);
        };
        return line;
    }

    /** Reuses the actor's already filtered boundary/feature-edge geometry. */
    _actorBoundaryEdges(actor, topo, color, width) {
        const source = actor.boundaryEdge?.geometry;
        if (!source) {
            return this._lineSegments(actor, topo, topo.partOutlinePositions, color, width);
        }

        const geom = source.clone();
        const mat = new LineMaterial({
            color: new THREE.Color(color).getHex(),
            linewidth: width,
            worldUnits: false,
            depthTest: false,
            depthWrite: false,
            transparent: true,
            opacity: 1,
            toneMapped: false
        });
        const line = new LineSegments2(geom, mat);
        line.computeLineDistances();
        line.raycast = () => {};
        line.renderOrder = 1000;
        line.frustumCulled = false;
        line.onBeforeRender = (renderer, scene, camera) => {
            renderer.getSize(mat.resolution);
            camera.getWorldDirection(_dir);
            const eps = topo.diag * 5e-4;
            _off.makeTranslation(-_dir.x * eps, -_dir.y * eps, -_dir.z * eps);
            line.matrixWorld.premultiply(_off);
        };
        return line;
    }

    _pointSprite(actor, topo, positions, color, isHover, autoAdd = true) {
        const arr = new Float32Array(positions.length * 3);
        positions.forEach((p, i) => { arr[i * 3] = p.x; arr[i * 3 + 1] = p.y; arr[i * 3 + 2] = p.z; });

        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.BufferAttribute(arr, 3));

        const m = new THREE.PointsMaterial({
            color,
            size: isHover ? 10 : 13,
            sizeAttenuation: false,
            map: dotTexture(),
            transparent: true,
            alphaTest: 0.5,
            depthTest: true,
            depthWrite: false,
            opacity: 1,
            toneMapped: false
        });

        const pts = new THREE.Points(g, m);
        pts.raycast = () => {};
        depthNudge(pts, topo.diag * 5e-4);
        if (autoAdd) actor.add(pts);
        return pts;
    }

    _destroy(obj) {
        if (!obj) return;
        if (obj.parent) obj.parent.remove(obj);
        obj.traverse((o) => {
            if (o.geometry) o.geometry.dispose();
            if (o.material) o.material.dispose();
        });
    }
}

export default SelectionHighlighter;
