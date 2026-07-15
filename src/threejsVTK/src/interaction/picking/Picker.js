// threejsVTK/Picking/Picker.js
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
 * @property {number|null}    faceIndex     The index of the intersected face
 * @property {number|null}    cellId        Source cell identifier mapped from geometry
 * @property {number|null}    pointId       Nearest physical topological structural point node ID
 * @property {number|null}    localPointIndex Internal geometry index of the closest vertex
 */

export class Picker {
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

    setTolerance({ points, line } = {}) {
        if (points != null) this.raycaster.params.Points.threshold = points;
        if (line != null) this.raycaster.params.Line.threshold = line;
        return this;
    }

    pick(ndcX, ndcY, renderer = this.renderer, targets = null) {
        if (!renderer) throw new Error('Picker: renderer is required');

        _ndc.set(ndcX, ndcY);
        this.raycaster.setFromCamera(_ndc, renderer.camera);

        const list = targets ?? (renderer.getProps?.() || [renderer.scene]);
        const hits = this.raycaster.intersectObjects(list, this.recursive);
        const hit = hits.find((h) => this._accept(h.object));

        if (!hit) {
            this.lastResult = null;
            return null;
        }

        const localPointIndex = this._nearestVertexIndex(hit);
        
        this.lastResult = {
            actor: this._resolveActor(hit.object, renderer),
            object: hit.object,
            worldPosition: hit.point.clone(),
            distance: hit.distance,
            faceIndex: hit.faceIndex ?? null,
            cellId: this._cellId(hit.object, hit.faceIndex ?? hit.index),
            pointId: this._pointId(hit.object, localPointIndex),
            localPointIndex: localPointIndex
        };
        return this.lastResult;
    }

    pickFromClient(clientX, clientY, renderer = this.renderer, targets = null) {
        if (!renderer?.domElement) throw new Error('Picker: renderer.domElement is required');
        const rect = renderer.domElement.getBoundingClientRect();
        const x = ((clientX - rect.left) / rect.width) * 2 - 1;
        const y = -((clientY - rect.top) / rect.height) * 2 + 1;
        return this.pick(x, y, renderer, targets);
    }

    _accept(obj) {
        for (let cur = obj; cur; cur = cur.parent) {
            if (!cur.visible) return false;
        }
        return this.filter ? this.filter(obj) : true;
    }

    _resolveActor(object, renderer) {
        for (let cur = object; cur; cur = cur.parent) {
            if (cur.isActor) return cur;
        }
        return null;
    }

    _cellId(object, faceIndex) {
        if (faceIndex == null) return null;
        const map = object.geometry?.userData?.cellMap;
        const primitiveIndex = object.isLineSegments ? Math.floor(faceIndex / 2) : faceIndex;
        return map ? map[primitiveIndex] : primitiveIndex;
    }

    _pointId(object, vertexIndex) {
        if (vertexIndex == null) return null;
        const map = object.geometry?.userData?.pointMap;
        return map ? map[vertexIndex] : vertexIndex;
    }

    _nearestVertexIndex(hit) {
        const pos = hit.object.geometry?.attributes?.position;
        if (!pos) return null;
        if (!hit.face) {
            if (hit.object.isPoints) return hit.index ?? null;
            if (hit.object.isLineSegments && hit.index != null) {
                const a = hit.index, b = Math.min(a + 1, pos.count - 1);
                _va.fromBufferAttribute(pos, a).applyMatrix4(hit.object.matrixWorld);
                _vb.fromBufferAttribute(pos, b).applyMatrix4(hit.object.matrixWorld);
                return hit.point.distanceToSquared(_va) <= hit.point.distanceToSquared(_vb) ? a : b;
            }
            return null;
        }
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
