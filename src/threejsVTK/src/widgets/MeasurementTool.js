import * as THREE from "three";
import { ActorTopology } from "../interaction/picking/ActorTopology.js";
import { PickMode } from "../interaction/picking/PickMode.js";

export const MEASUREMENT_MODE = Object.freeze({ DISTANCE: "distance", ANGLE: "angle" });

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();

function formatValue(value) {
    if (!Number.isFinite(value)) return "—";
    if (Math.abs(value) >= 1000) return value.toFixed(1);
    if (Math.abs(value) >= 1) return value.toFixed(3).replace(/\.?0+$/, "");
    return value.toPrecision(4).replace(/\.?0+$/, "");
}

export class MeasurementTool {
    constructor({ scene, pickingController, requestRender = null, color = 0xffe066 } = {}) {
        this.scene = scene;
        this.pickingController = pickingController;
        this.requestRender = requestRender ?? (() => {});
        this.color = new THREE.Color(color);
        this.mode = null;
        this.first = null;
        this.annotations = [];
        this.group = new THREE.Group();
        this.group.name = "system_measurements";
        this.group.userData.isMeasurementOverlay = true;
        this.scene?.add(this.group);
        this._handleSelect = this._handleSelect.bind(this);
        this.pickingController?.on?.("select", this._handleSelect);
    }

    setMode(mode) {
        this.mode = Object.values(MEASUREMENT_MODE).includes(mode) ? mode : null;
        this._clearPending();
        return this;
    }
    getMode() { return this.mode; }

    clear() {
        this._clearPending();
        for (const annotation of this.annotations) this._disposeObject(annotation);
        this.annotations.length = 0;
        this.requestRender();
        return this;
    }

    _handleSelect(_actor, result) {
        if (!this.mode || !result?.actor) return;
        const sample = this._sample(result);
        if (!sample) return;
        if (!this.first) {
            this.first = sample;
            this._pendingMarker = this._makeMarker(sample.point, 6);
            this.group.add(this._pendingMarker);
            this.requestRender();
            return;
        }
        const first = this.first;
        this._clearPending();
        const annotation = this.mode === MEASUREMENT_MODE.ANGLE
            ? this._makeAngle(first, sample) : this._makeDistance(first, sample);
        if (annotation) { this.annotations.push(annotation); this.group.add(annotation); }
        this.requestRender();
    }

    _sample(result) {
        const actor = result.actor;
        const topo = ActorTopology.get(actor);
        actor.updateMatrixWorld(true);
        let point = result.point?.clone?.() ?? null;
        if (!point) {
            const local = new THREE.Vector3();
            if (result.mode === PickMode.PART) topo.bbox.getCenter(local);
            else if (result.mode === PickMode.SURFACE) {
                const tris = topo.trianglesOfSurface(result.id);
                if (!tris.length) return null;
                for (const tri of tris) local.add(topo.triCentroid(tri, _a));
                local.multiplyScalar(1 / tris.length);
            } else if (result.mode === PickMode.ELEMENT) {
                const raw = topo.rawTrianglesOfCell(result.id);
                if (!raw?.length) return null;
                const ids = new Set(raw);
                for (const id of ids) local.add(_a.fromBufferAttribute(topo.corners, id));
                local.multiplyScalar(1 / ids.size);
            } else if (result.mode === PickMode.EDGE) {
                const chain = topo.chainOf(result.id);
                if (!chain) return null;
                local.fromArray(chain.positions, 0).add(_a.fromArray(chain.positions, 3)).multiplyScalar(0.5);
            } else if (result.mode === PickMode.NODE) topo.nodePosition(result.id, local);
            else if (result.mode === PickMode.POINT) topo.weldedPosition(result.welded ?? result.id, local);
            else return null;
            point = local.applyMatrix4(actor.matrixWorld);
        }
        return { point, direction: this._direction(result, topo) };
    }

    _direction(result, topo) {
        const actor = result.actor;
        if (result.tri != null) {
            const o = result.tri * 3;
            _a.fromBufferAttribute(topo.corners, topo.triRaw[o]);
            _b.fromBufferAttribute(topo.corners, topo.triRaw[o + 1]);
            _c.fromBufferAttribute(topo.corners, topo.triRaw[o + 2]);
            return new THREE.Vector3().subVectors(_b, _a).cross(_c.clone().sub(_a)).normalize()
                .applyMatrix3(new THREE.Matrix3().getNormalMatrix(actor.matrixWorld)).normalize();
        }
        if (result.mode === PickMode.EDGE) {
            const chain = topo.chainOf(result.id);
            if (chain) return new THREE.Vector3().fromArray(chain.positions, 3)
                .sub(new THREE.Vector3().fromArray(chain.positions, 0))
                .transformDirection(actor.matrixWorld).normalize();
        }
        return null;
    }

    _makeDistance(first, second) {
        return this._makeRuler(first.point, second.point, `L = ${formatValue(first.point.distanceTo(second.point))}`);
    }

    _makeAngle(first, second) {
        const connector = new THREE.Vector3().subVectors(second.point, first.point).normalize();
        let d1 = first.direction?.clone() ?? connector.clone();
        let d2 = second.direction?.clone() ?? (first.direction ? connector.clone() : new THREE.Vector3(1, 0, 0));
        if (d1.lengthSq() < 1e-12) d1.set(1, 0, 0);
        if (d2.lengthSq() < 1e-12) d2.set(1, 0, 0);
        d1.normalize(); d2.normalize();
        if (d1.dot(d2) < 0) d2.negate();
        const angle = THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(d1.dot(d2), -1, 1)));
        const group = this._makeRuler(first.point, second.point, `θ = ${formatValue(angle)}°`);
        const center = new THREE.Vector3().addVectors(first.point, second.point).multiplyScalar(0.5);
        const radius = Math.max(first.point.distanceTo(second.point) * 0.25, 1e-6);
        const positions = [], end1 = center.clone().addScaledVector(d1, radius), end2 = center.clone().addScaledVector(d2, radius);
        positions.push(...center, ...end1, ...center, ...end2);
        const axis = new THREE.Vector3().crossVectors(d1, d2);
        if (axis.lengthSq() > 1e-12) {
            axis.normalize();
            const radians = Math.acos(THREE.MathUtils.clamp(d1.dot(d2), -1, 1));
            let prev = center.clone().addScaledVector(d1, radius * 0.72);
            for (let i = 1; i <= 24; i++) {
                const next = center.clone().addScaledVector(d1.clone().applyAxisAngle(axis, radians * i / 24), radius * 0.72);
                positions.push(...prev, ...next); prev = next;
            }
        }
        group.add(this._makeLine(positions));
        return group;
    }

    _makeRuler(p1, p2, label) {
        const group = new THREE.Group();
        group.userData.measurementAnnotation = true;
        group.add(this._makeLine([...p1, ...p2]), this._makeMarker(p1, 5), this._makeMarker(p2, 5));
        const sprite = this._makeLabel(label);
        sprite.position.addVectors(p1, p2).multiplyScalar(0.5);
        group.add(sprite);
        return group;
    }

    _makeLine(values) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.Float32BufferAttribute(values, 3));
        const material = new THREE.LineBasicMaterial({ color: this.color, transparent: true, opacity: 1, depthTest: false, depthWrite: false, toneMapped: false });
        const line = new THREE.LineSegments(geometry, material);
        line.renderOrder = 2000; line.frustumCulled = false; line.raycast = () => {};
        return line;
    }

    _makeMarker(point, pixelSize) {
        const marker = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshBasicMaterial({ color: this.color, depthTest: false, depthWrite: false, toneMapped: false }));
        marker.position.copy(point); marker.userData.measurePixelSize = pixelSize; marker.renderOrder = 2001; marker.raycast = () => {};
        return marker;
    }

    _makeLabel(text) {
        const canvas = document.createElement("canvas"); canvas.width = 512; canvas.height = 128;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "rgba(20,20,20,.88)";
        if (ctx.roundRect) ctx.roundRect(8, 8, 496, 112, 18);
        else ctx.rect(8, 8, 496, 112);
        ctx.fill();
        ctx.strokeStyle = "#ffe066"; ctx.lineWidth = 5; ctx.stroke();
        ctx.fillStyle = "#fff4b3"; ctx.font = "bold 54px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(text, 256, 64);
        const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
        sprite.userData.measureLabel = true; sprite.renderOrder = 2002; sprite.raycast = () => {};
        return sprite;
    }

    update(camera, viewportHeight) {
        if (!camera || !viewportHeight) return;
        const cameraPos = camera.getWorldPosition(_a);
        this.group.traverse((obj) => {
            if (!obj.userData.measureLabel && !obj.userData.measurePixelSize) return;
            const unitsPerPixel = camera.isOrthographicCamera
                ? (camera.top - camera.bottom) / camera.zoom / viewportHeight
                : 2 * Math.max(obj.getWorldPosition(_b).distanceTo(cameraPos), 1e-6) * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / viewportHeight;
            if (obj.userData.measureLabel) obj.scale.set(130 * unitsPerPixel, 32 * unitsPerPixel, 1);
            else obj.scale.setScalar(obj.userData.measurePixelSize * unitsPerPixel);
        });
    }

    _clearPending() { this.first = null; if (this._pendingMarker) this._disposeObject(this._pendingMarker); this._pendingMarker = null; }
    _disposeObject(obj) {
        if (!obj) return; obj.parent?.remove(obj);
        obj.traverse((child) => { child.geometry?.dispose?.(); if (child.material?.map) child.material.map.dispose(); child.material?.dispose?.(); });
    }
    dispose() { this.pickingController?.off?.("select", this._handleSelect); this.clear(); this.scene?.remove(this.group); }
}

export default MeasurementTool;
