// ThreejsVTK/Picking/Picker.js

import * as THREE from 'three';

const _ndc = new THREE.Vector2();
const _va = new THREE.Vector3();
const _vb = new THREE.Vector3();
const _vc = new THREE.Vector3();

/**
 * @typedef {Object} PickResult
 * @property {Object|null}    actor         Target Actor Group containing the intersected mesh
 * @property {THREE.Object3D} object        Direct ThreeJS sub-mesh intersected by the ray
 * @property {THREE.Vector3}  worldPosition Intersection point in standard world space coordinates
 * @property {number}         distance      Linear absolute distance scalar from camera projection origin
 * @property {number|null}    cellId        Source cell identifier extracted from original source data mapping
 * @property {number|null}    pointId       Nearest topological structural point mapping id matching intersect
 */

export class Picker {
    /**
     * @param {Object}   [options]
     * @param {Object}   [options.renderer]  Fallback target scene context reference runner
     * @param {boolean}  [options.recursive] Traversal configuration strategy setting across nested matrices
     * @param {Function} [options.filter]    Boolean evaluator filter predicate applied to target geometries
     */
    constructor({ renderer = null, recursive = true, filter = null } = {}) {
        this.renderer = renderer;
        this.raycaster = new THREE.Raycaster();
        this.recursive = recursive;
        this.filter = filter;
        /** @type {PickResult|null} */
        this.lastResult = null;
    }

    setRenderer(renderer) { this.renderer = renderer; return this; }
    setFilter(filter)     { this.filter = filter;     return this; }

    /** Customizes evaluation proximity tolerance properties for discrete component entities. */
    setTolerance({ points, line } = {}) {
        if (points != null) this.raycaster.params.Points.threshold = points;
        if (line != null) this.raycaster.params.Line.threshold = line;
        return this;
    }

    /** Picks based on standard normalized device space coordinates. */
    pick(ndcX, ndcY, renderer = this.renderer, targets = null) {
        if (!renderer) throw new Error('Picker: renderer is required');

        _ndc.set(ndcX, ndcY);
        this.raycaster.setFromCamera(_ndc, renderer.camera);

        const list = targets ?? this._defaultTargets(renderer);
        const hits = this.raycaster.intersectObjects(list, this.recursive);
        const hit = hits.find((h) => this._accept(h.object));

        if (!hit) {
            this.lastResult = null;
            return null;
        }

        const vertexIndex = this._nearestVertexIndex(hit);
        this.lastResult = {
            actor: this._resolveActor(hit.object, renderer),
            object: hit.object,
            worldPosition: hit.point.clone(),
            distance: hit.distance,
            cellId: this._cellId(hit.object, hit.faceIndex),
            pointId: this._pointId(hit.object, vertexIndex),
        };
        return this.lastResult;
    }

    /** Automatically transforms client pointer coordinates into standardized camera viewport NDC space. */
    pickFromClient(clientX, clientY, renderer = this.renderer, targets = null) {
        if (!renderer?.domElement) throw new Error('Picker: renderer.domElement is required for pickFromClient');
        const rect = renderer.domElement.getBoundingClientRect();
        const x = ((clientX - rect.left) / rect.width) * 2 - 1;
        const y = -((clientY - rect.top) / rect.height) * 2 + 1;
        return this.pick(x, y, renderer, targets);
    }

    /** Evaluates picking using raw VTK normalized screen layout constraints ([0,1], bottom-left origin). */
    pickNormalized(nx, ny, renderer = this.renderer, targets = null) {
        return this.pick(nx * 2 - 1, ny * 2 - 1, renderer, targets);
    }

    getActor()        { return this.lastResult?.actor ?? null; }
    getPickPosition() { return this.lastResult?.worldPosition ?? null; }
    getCellId()       { return this.lastResult?.cellId ?? null; }
    getPointId()      { return this.lastResult?.pointId ?? null; }

    _defaultTargets(renderer) {
        const props = renderer.getProps?.();
        return props?.length ? props : [renderer.scene];
    }

    _accept(obj) {
        for (let cur = obj; cur; cur = cur.parent) {
            if (!cur.visible) return false;
        }
        return this.filter ? this.filter(obj) : true;
    }

    _resolveActor(object, renderer) {
        if (typeof renderer.getActorForObject === 'function') {
            const actor = renderer.getActorForObject(object);
            if (actor) return actor;
        }
        for (let cur = object; cur; cur = cur.parent) {
            if (cur.isActor) return cur;
        }
        return null;
    }

    _cellId(object, faceIndex) {
        if (faceIndex == null) return null;
        const map = object.geometry?.userData?.cellMap;
        return map ? map[faceIndex] : faceIndex;
    }

    _pointId(object, vertexIndex) {
        if (vertexIndex == null) return null;
        const map = object.geometry?.userData?.pointMap;
        return map ? map[vertexIndex] : vertexIndex;
    }

    _nearestVertexIndex(hit) {
        const pos = hit.object.geometry?.attributes?.position;
        if (!hit.face || !pos) return null;
        const { a, b, c } = hit.face;
        const m = hit.object.matrixWorld;
        _va.fromBufferAttribute(pos, a).applyMatrix4(m);
        _vb.fromBufferAttribute(pos, b).applyMatrix4(m);
        _vc.fromBufferAttribute(pos, c).applyMatrix4(m);
        const p = hit.point;
        const d0 = p.distanceToSquared(_va);
        const d1 = p.distanceToSquared(_vb);
        const d2 = p.distanceToSquared(_vc);
        if (d0 <= d1 && d0 <= d2) return a;
        if (d1 <= d2) return b;
        return c;
    }
}