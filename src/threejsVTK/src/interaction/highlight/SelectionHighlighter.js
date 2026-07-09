import * as THREE from "three";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { PickMode } from "../picking/PickMode.js";
import { ActorTopology } from "../picking/ActorTopology.js";

const _dir = new THREE.Vector3();
const _off = new THREE.Matrix4();

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
    constructor({ renderer = null, selectColor = 0xff8c00, hoverColor = 0x00c8ff, opacity = 0.55 } = {}) {
        this.renderer = renderer;
        this.selectColor = new THREE.Color(selectColor);
        this.hoverColor = new THREE.Color(hoverColor);
        this.opacity = opacity;

        this._hover = null;
        this._selection = new Map();
    }

    setHover(result) {
        if (this._hover) this._destroy(this._hover);
        this._hover = result ? this._build(result, this.hoverColor, true) : null;
    }

    /** Replaces the entire current selection with new picked results. */
    setSelection(results) {
        for (const o of this._selection.values()) this._destroy(o);
        this._selection.clear();
        for (const r of results) {
            const o = this._build(r, this.selectColor, false);
            if (o) this._selection.set(r.key, o);
        }
    }

    toggle(result) {
        if (this._selection.has(result.key)) {
            this._destroy(this._selection.get(result.key));
            this._selection.delete(result.key);
        } else {
            const o = this._build(result, this.selectColor, false);
            if (o) this._selection.set(result.key, o);
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
            case PickMode.PART:
                obj = this._meshFromTriangles(actor, topo, null, color);
                break;
            case PickMode.SURFACE:
                obj = this._meshFromTriangles(actor, topo, topo.trianglesOfSurface(id), color);
                break;
            case PickMode.ELEMENT: {
                const tris = topo.trianglesOfCell(id);
                obj = new THREE.Group();
                const face = this._meshFromTriangles(actor, topo, tris, color, false);
                if (face) obj.add(face);
                const wire = this._cellOutline(actor, topo, tris, color);
                if (wire) obj.add(wire);
                actor.add(obj);
                break;
            }
            case PickMode.EDGE:
                obj = this._chainLine(actor, topo, topo.chainOf(id), color, isHover);
                break;
            case PickMode.POINT: {
                const c = topo.cornerOf(id);
                obj = c ? this._pointSprite(actor, topo, [c.pos], color, isHover) : null;
                break;
            }
            case PickMode.NODE: {
                const p = topo.nodePosition(result.id, new THREE.Vector3());
                obj = this._pointSprite(actor, topo, [p], color, isHover);
                break;
            }
        }

        if (obj) {
            obj.renderOrder = isHover ? 9 : 10;
            obj.userData.__highlight = true;
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
            polygonOffsetUnits: -2
        });

        const mesh = new THREE.Mesh(g, m);
        mesh.raycast = () => {};
        if (autoAdd) actor.add(mesh);
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
        const geom = new LineSegmentsGeometry();
        geom.setPositions(flatPts);

        const mat = new LineMaterial({
            color: new THREE.Color(color).getHex(),
            linewidth: width,
            worldUnits: false,
            depthTest: true,
            depthWrite: false
        });

        const line = new LineSegments2(geom, mat);
        line.computeLineDistances();
        line.raycast = () => {};

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

    _pointSprite(actor, topo, positions, color, isHover) {
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
            depthWrite: false
        });

        const pts = new THREE.Points(g, m);
        pts.raycast = () => {};
        depthNudge(pts, topo.diag * 5e-4);
        actor.add(pts);
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