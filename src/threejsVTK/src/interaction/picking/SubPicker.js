// Interaction/SubPicker.js

import * as THREE from "three";
import { PickMode, pickKey } from "./PickMode.js";
import { ActorTopology } from "./ActorTopology.js";

const _v3 = new THREE.Vector3();
const _v3b = new THREE.Vector3();
const _ndc = new THREE.Vector2();

/** Computes the 2D distance from a point to a line segment. */
function distToSegment(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const cx = ax + t * dx, cy = ay + t * dy;
    return { dist: Math.hypot(px - cx, py - cy), t };
}

export class SubPicker {
    /**
     * @param {object} o
     * @param {THREE.Camera|object} o.camera       THREE camera or a facade containing `.three`
     * @param {HTMLElement} o.domElement
     * @param {() => Actor[]} o.getActors          Callback returning candidate actors
     * @param {number} [o.tolerancePx=8]           Snap radius for edges/points in pixels
     */
    constructor({ camera, domElement, getActors, tolerancePx = 8 }) {
        this._camera = camera;
        this.domElement = domElement;
        this.getActors = getActors;
        this.tolerancePx = tolerancePx;

        this.raycaster = new THREE.Raycaster();
        this._occRay = new THREE.Raycaster();
        this._camPos = new THREE.Vector3();
        this._camDir = new THREE.Vector3();
    }

    get camera() {
        return this._camera && this._camera.isCamera ? this._camera : this._camera.three;
    }

    // ------------------------------------------------------------------
    // Projection & Depth Infrastructure
    // ------------------------------------------------------------------

    _prepare() {
        const cam = this.camera;
        cam.updateMatrixWorld(true);
        cam.getWorldPosition(this._camPos);
        cam.getWorldDirection(this._camDir);
        this._rect = this.domElement.getBoundingClientRect();
        return cam;
    }

    _actors() {
        return (this.getActors() || []).filter(
            (a) => a && a.isActor && a.visible && a.surface && a.surface.geometry
        );
    }

    /** Calculates the depth along the camera's viewing axis. */
    _viewDepth(worldPoint) {
        return _v3b.subVectors(worldPoint, this._camPos).dot(this._camDir);
    }

    /** Estimates world units per pixel at a given world-space point depth. */
    _worldPerPixel(worldPoint) {
        const cam = this.camera;
        const h = this._rect.height || 1;
        if (cam.isOrthographicCamera) {
            return (cam.top - cam.bottom) / cam.zoom / h;
        }
        const d = Math.max(this._viewDepth(worldPoint), 1e-6);
        return (2 * d * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2)) / h;
    }

    /** Converts a world point to client screen coordinates. Returns null if behind camera. */
    _toScreen(worldPoint, out) {
        if (this.camera.isPerspectiveCamera && this._viewDepth(worldPoint) <= this.camera.near) {
            return null;
        }
        _v3.copy(worldPoint).project(this.camera);
        out.x = this._rect.left + ((_v3.x + 1) / 2) * this._rect.width;
        out.y = this._rect.top + ((1 - _v3.y) / 2) * this._rect.height;
        return out;
    }

    /** Custom raycast pass that bypasses visibility checks (e.g., to allow picking in wireframe mode). */
    _intersectSurfaces(raycaster, actors) {
        const hits = [];
        for (const a of actors) {
            const m = a.surface;
            if (!m.material) continue;
            const before = hits.length;
            m.raycast(raycaster, hits);
            for (let i = before; i < hits.length; i++) hits[i].actor = a;
        }
        hits.sort((p, q) => p.distance - q.distance);
        return hits;
    }

    /** Performs an occlusion check by casting a ray through the candidate's screen position. */
    _occluded(worldPoint, actors) {
        const s = this._toScreen(worldPoint, new THREE.Vector2());
        if (!s) return true;

        _ndc.set(
            ((s.x - this._rect.left) / this._rect.width) * 2 - 1,
            -((s.y - this._rect.top) / this._rect.height) * 2 + 1
        );
        this._occRay.setFromCamera(_ndc, this.camera);

        const hits = this._intersectSurfaces(this._occRay, actors);
        if (!hits.length) return false;

        const bias = 4 * this._worldPerPixel(worldPoint);
        const dCand = _v3b.subVectors(worldPoint, this._occRay.ray.origin).dot(this._occRay.ray.direction);
        return dCand > hits[0].distance + bias;
    }

    // ------------------------------------------------------------------
    // Core Picking Methods
    // ------------------------------------------------------------------

    /**
     * @returns {null | {mode, actor, id, key, point, tri}}
     */
    pick(clientX, clientY, mode = PickMode.PART) {
        const cam = this._prepare();
        const actors = this._actors();
        if (!actors.length) return null;

        _ndc.set(
            ((clientX - this._rect.left) / this._rect.width) * 2 - 1,
            -((clientY - this._rect.top) / this._rect.height) * 2 + 1
        );
        this.raycaster.setFromCamera(_ndc, cam);

        switch (mode) {
            case PickMode.PART:
            case PickMode.SURFACE:
            case PickMode.ELEMENT:
                return this._pickByRay(mode, actors);

            case PickMode.EDGE:
                return this._pickEdge(clientX, clientY, actors);

            case PickMode.POINT:
                return this._pickVertexLike(clientX, clientY, actors, true);

            case PickMode.NODE:
                return this._pickVertexLike(clientX, clientY, actors, false);

            default:
                console.warn(`[SubPicker] Invalid pick mode: ${mode}`);
                return null;
        }
    }

    _pickByRay(mode, actors) {
        const hits = this._intersectSurfaces(this.raycaster, actors);
        if (!hits.length) return null;

        const hit = hits[0];
        const actor = hit.actor;
        const tri = hit.faceIndex;

        if (mode === PickMode.PART) {
            return { mode, actor, id: actor.uuid, key: pickKey(actor, mode, actor.uuid), point: hit.point, tri };
        }

        const topo = ActorTopology.get(actor);
        if (!topo || tri == null) return null;

        const id = mode === PickMode.SURFACE ? topo.surfaceOf(tri) : topo.cellOf(tri);
        if (id < 0) return null;

        return { mode, actor, id, key: pickKey(actor, mode, id), point: hit.point, tri };
    }

    // ------------------------------------------------------------------
    // EDGE — Screen-space Edge Chain Processing
    // ------------------------------------------------------------------

    _pickEdge(cx, cy, actors) {
        const tol = this.tolerancePx;
        const a2 = new THREE.Vector2(), b2 = new THREE.Vector2(), c2 = new THREE.Vector2();
        const wp = new THREE.Vector3(), wq = new THREE.Vector3();
        const sphere = new THREE.Sphere();

        let best = null;
        let bestDist = tol;

        for (const actor of actors) {
            const topo = ActorTopology.get(actor);
            if (!topo || !topo.chains.length) continue;
            actor.updateMatrixWorld(true);

            for (const chain of topo.chains) {
                // Broad-phase bounding sphere screening in screen-space
                sphere.copy(chain.sphere).applyMatrix4(actor.matrixWorld);
                if (!this._toScreen(sphere.center, c2)) continue;
                const rPx = sphere.radius / this._worldPerPixel(sphere.center);
                if (Math.hypot(cx - c2.x, cy - c2.y) > rPx + tol) continue;

                const P = chain.positions;
                for (let i = 0; i + 1 < chain.verts.length; i++) {
                    wp.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]).applyMatrix4(actor.matrixWorld);
                    wq.set(P[i * 3 + 3], P[i * 3 + 4], P[i * 3 + 5]).applyMatrix4(actor.matrixWorld);

                    if (!this._toScreen(wp, a2) || !this._toScreen(wq, b2)) continue;

                    const r = distToSegment(cx, cy, a2.x, a2.y, b2.x, b2.y);
                    if (r.dist < bestDist) {
                        bestDist = r.dist;
                        best = {
                            actor,
                            chain,
                            point: new THREE.Vector3().lerpVectors(wp, wq, r.t)
                        };
                    }
                }
            }
        }

        if (!best || this._occluded(best.point, actors)) return null;

        return {
            mode: PickMode.EDGE,
            actor: best.actor,
            id: best.chain.id,
            key: pickKey(best.actor, PickMode.EDGE, best.chain.id),
            point: best.point,
            tri: null
        };
    }

    // ------------------------------------------------------------------
    // POINT (Geometric Corner) & NODE (Mesh Vertex)
    // ------------------------------------------------------------------

    _pickVertexLike(cx, cy, actors, isCorner) {
        const tol = this.tolerancePx;
        const s2 = new THREE.Vector2();
        const wp = new THREE.Vector3();

        // Localize search space using the raycast surface hit as an anchor point
        const hits = this._intersectSurfaces(this.raycaster, actors);
        const anchor = hits.length ? hits[0].point : null;

        let best = null;
        let bestDist = tol;

        for (const actor of actors) {
            const topo = ActorTopology.get(actor);
            if (!topo) continue;
            actor.updateMatrixWorld(true);

            const inv = new THREE.Matrix4().copy(actor.matrixWorld).invert();

            let candidates;
            if (isCorner) {
                candidates = topo.corners.map((c) => c.welded);
            } else if (anchor) {
                const localAnchor = _v3.copy(anchor).applyMatrix4(inv);
                const rWorld = tol * 2 * this._worldPerPixel(anchor);
                const scale = actor.getWorldScale(_v3b).x || 1;
                candidates = topo.queryVerts(localAnchor, rWorld / scale);
            } else if (topo.wcount <= 200000) {
                candidates = Array.from({ length: topo.wcount }, (_, i) => i);
            } else {
                continue; // Skip dense meshes lacking an anchor to preserve smooth hover performance
            }

            for (const w of candidates) {
                topo.weldedPosition(w, wp).applyMatrix4(actor.matrixWorld);
                if (!this._toScreen(wp, s2)) continue;

                const d = Math.hypot(cx - s2.x, cy - s2.y);
                if (d < bestDist) {
                    bestDist = d;
                    best = { actor, welded: w, point: wp.clone(), topo };
                }
            }
        }

        if (!best || this._occluded(best.point, actors)) return null;

        const mode = isCorner ? PickMode.POINT : PickMode.NODE;
        const id = isCorner ? best.topo.weldedToCorner.get(best.welded) : best.topo.nodeOf(best.welded);

        return {
            mode,
            actor: best.actor,
            id,
            welded: best.welded,
            key: pickKey(best.actor, mode, id),
            point: best.point,
            tri: null
        };
    }

    // ------------------------------------------------------------------
    // Rubber Band / Marquee Selection
    // ------------------------------------------------------------------

    /**
     * @param {{x, y, width, height}} rectPx   Selection box in client pixels
     * @param {boolean} crossing               True if crossing mode is active, false for window/inside mode
     * @returns {Array}                         List of picked sub-entity items matching the criteria
     */
    pickRect(rectPx, mode, crossing) {
        this._prepare();
        const actors = this._actors();
        const out = [];

        const rL = rectPx.x, rT = rectPx.y;
        const rR = rectPx.x + rectPx.width, rB = rectPx.y + rectPx.height;
        const s2 = new THREE.Vector2();
        const wp = new THREE.Vector3();

        const inside = (p) => p.x >= rL && p.x <= rR && p.y >= rT && p.y <= rB;

        const test = (actor, points) => {
            let any = false, all = true;
            for (const p of points) {
                wp.copy(p).applyMatrix4(actor.matrixWorld);
                const s = this._toScreen(wp, s2);
                if (!s || !inside(s)) { all = false; if (!crossing) return false; }
                else any = true;
                if (crossing && any) return true;
            }
            return crossing ? any : all;
        };

        for (const actor of actors) {
            const topo = ActorTopology.get(actor);
            if (!topo) continue;
            actor.updateMatrixWorld(true);

            if (!this._actorTouchesRect(actor, topo, rL, rT, rR, rB)) continue;

            switch (mode) {
                case PickMode.PART:
                    out.push({ mode, actor, id: actor.uuid, key: pickKey(actor, mode, actor.uuid), point: null, tri: null });
                    break;

                case PickMode.SURFACE:
                case PickMode.ELEMENT: {
                    const groups = mode === PickMode.SURFACE
                        ? topo.surfaces.map((s) => [s.id, s.tris])
                        : Array.from(topo.cellTris.entries());

                    for (const [id, tris] of groups) {
                        const pts = [];
                        for (let i = 0; i < tris.length; i++) {
                            const o = tris[i] * 3;
                            pts.push(new THREE.Vector3(topo.triCentroid[o], topo.triCentroid[o + 1], topo.triCentroid[o + 2]));
                        }
                        if (test(actor, pts)) {
                            out.push({ mode, actor, id, key: pickKey(actor, mode, id), point: null, tri: null });
                        }
                    }
                    break;
                }

                case PickMode.EDGE:
                    for (const chain of topo.chains) {
                        const pts = [];
                        for (let i = 0; i < chain.verts.length; i++) {
                            pts.push(new THREE.Vector3(chain.positions[i * 3], chain.positions[i * 3 + 1], chain.positions[i * 3 + 2]));
                        }
                        if (test(actor, pts)) {
                            out.push({ mode, actor, id: chain.id, key: pickKey(actor, mode, chain.id), point: null, tri: null });
                        }
                    }
                    break;

                case PickMode.POINT:
                    for (const c of topo.corners) {
                        if (test(actor, [c.pos])) {
                            out.push({ mode, actor, id: c.id, key: pickKey(actor, mode, c.id), point: null, tri: null });
                        }
                    }
                    break;

                case PickMode.NODE:
                    for (let w = 0; w < topo.wcount; w++) {
                        topo.weldedPosition(w, wp).applyMatrix4(actor.matrixWorld);
                        const s = this._toScreen(wp, s2);
                        if (s && inside(s)) {
                            const id = topo.nodeOf(w);
                            out.push({ mode, actor, id, welded: w, key: pickKey(actor, mode, id), point: null, tri: null });
                        }
                    }
                    break;
            }
        }
        return out;
    }

    _actorTouchesRect(actor, topo, rL, rT, rR, rB) {
        const box = topo.bbox;
        const corner = new THREE.Vector3();
        const s2 = new THREE.Vector2();
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

        for (let i = 0; i < 8; i++) {
            corner.set(
                i & 1 ? box.max.x : box.min.x,
                i & 2 ? box.max.y : box.min.y,
                i & 4 ? box.max.z : box.min.z
            ).applyMatrix4(actor.matrixWorld);
            if (!this._toScreen(corner, s2)) continue;
            minX = Math.min(minX, s2.x); maxX = Math.max(maxX, s2.x);
            minY = Math.min(minY, s2.y); maxY = Math.max(maxY, s2.y);
        }
        if (minX === Infinity) return false;
        return minX <= rR && maxX >= rL && minY <= rB && maxY >= rT;
    }
}

export default SubPicker;