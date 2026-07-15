import * as THREE from "three";

export class GridActor extends THREE.GridHelper {
    constructor({
        size = 2000,
        divisions = 200,
        colorCenterLine = 0x444444,
        colorGrid = 0x888888,
        opacity = 0.5,
        polygonOffset = 1,
        name = "GridActor",
    } = {}) {
        super(size, divisions, colorCenterLine, colorGrid);
        this.isGridActor = true;
        this.name = name;
        this.frustumCulled = false;
        this.setOpacity(opacity);
        this.setPolygonOffset(polygonOffset);
    }

    setLayer(layer) {
        this.layers.set(layer);
        return this;
    }

    setOpacity(opacity) {
        this.material.transparent = opacity < 1;
        this.material.opacity = opacity;
        this.material.needsUpdate = true;
        return this;
    }

    setGridScale(scale) {
        this.scale.set(scale, 1, scale);
        return this;
    }

    setPolygonOffset(offset) {
        Object.assign(this.material, {
            depthWrite: true,
            polygonOffset: true,
            polygonOffsetFactor: offset,
            polygonOffsetUnits: offset,
        });
        this.material.needsUpdate = true;
        return this;
    }

    dispose() {
        this.geometry?.dispose?.();
        this.material?.dispose?.();
    }
}

export default GridActor;
