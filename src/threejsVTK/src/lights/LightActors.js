import * as THREE from "three";

/**
 * Base class for light actors.
 */
class BaseLightActor extends THREE.Group {
    constructor() {
        super();
        this.isLightActor = true;
    }

    /**
     * Returns the wrapped Three.js light.
     */
    getLight() {
        return this.children.find(child => child.isLight);
    }

    /**
     * Sets light visibility.
     */
    setVisible(visible) {
        this.visible = visible;
        return this;
    }

    /**
     * Returns the current visibility state.
     */
    getVisible() {
        return this.visible;
    }
}

/**
 * Ambient light wrapper.
 */
export class AmbientLightActor extends BaseLightActor {
    constructor(color = 0xffffff, intensity = 0.5) {
        super();
        
        const ambientLight = new THREE.AmbientLight(color, intensity);
        this.add(ambientLight);
    }

    // Keep direct .intensity access compatible with scene settings code.
    get intensity() {
        return this.getLight()?.intensity ?? 0;
    }

    set intensity(value) {
        const light = this.getLight();
        if (light) light.intensity = value;
    }

    get color() {
        return this.getLight()?.color;
    }

    set color(value) {
        const light = this.getLight();
        if (light) light.color.set(value);
    }
}

/**
 * Directional light wrapper.
 */
export class DirectionalLightActor extends BaseLightActor {
    constructor(color = 0xffffff, intensity = 1.0) {
        super();

        const directionalLight = new THREE.DirectionalLight(color, intensity);
        this.add(directionalLight);
    }

    get intensity() {
        return this.getLight()?.intensity ?? 0;
    }

    set intensity(value) {
        const light = this.getLight();
        if (light) light.intensity = value;
    }

    get color() {
        return this.getLight()?.color;
    }

    set color(value) {
        const light = this.getLight();
        if (light) light.color.set(value);
    }

    /**
     * Sets the light source position using numbers or an [x, y, z] array.
     * @param {number|number[]} x - X coordinate or [x, y, z] array.
     * @param {number} [y] - Y coordinate.
     * @param {number} [z] - Z coordinate.
     */
    setPosition(x, y, z) {
        const light = this.getLight();
        if (!light) return this;

        if (Array.isArray(x)) {
            light.position.set(x[0], x[1], x[2]);
        } else {
            light.position.set(x, y, z);
        }
        return this;
    }

    /**
     * Returns the current light position as an [x, y, z] array.
     */
    getPosition() {
        const pos = this.getLight()?.position;
        return pos ? [pos.x, pos.y, pos.z] : [0, 0, 0];
    }

    /**
     * Sets the directional light target using numbers or an [x, y, z] array.
     */
    setTargetPosition(x, y, z) {
        const light = this.getLight();
        if (!light) return this;

        if (Array.isArray(x)) {
            light.target.position.set(x[0], x[1], x[2]);
        } else {
            light.target.position.set(x, y, z);
        }
        // DirectionalLight requires the target to be attached to the scene graph.
        if (this.parent && !this.parent.children.includes(light.target)) {
            this.parent.add(light.target);
        }
        return this;
    }
}
