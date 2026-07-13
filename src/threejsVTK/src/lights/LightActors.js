import * as THREE from "three";

/**
 * Base Light Actor (Lớp cơ sở cho các loại đèn)
 */
class BaseLightActor extends THREE.Group {
    constructor() {
        super();
        this.isLightActor = true; // Flag để nhận diện trong hệ thống của bạn
    }

    /**
     * Lấy thực thể Đèn Three.js nội bộ
     */
    getLight() {
        return this.children.find(child => child.isLight);
    }

    /**
     * Bật / Tắt đèn
     */
    setVisible(visible) {
        this.visible = visible;
        return this;
    }

    /**
     * Lấy trạng thái hiển thị
     */
    getVisible() {
        return this.visible;
    }
}

/**
 * AmbientLightActor - Đèn môi trường
 */
export class AmbientLightActor extends BaseLightActor {
    constructor(color = 0xffffff, intensity = 0.5) {
        super();
        
        // Khởi tạo đèn ThreeJS thuần bên trong wrapper
        const ambientLight = new THREE.AmbientLight(color, intensity);
        this.add(ambientLight);
    }

    // Định nghĩa getter/setter cho intensity để Scene.jsx truy cập trực tiếp bằng .intensity = ...
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
 * DirectionalLightActor - Đèn định hướng (Chiếu sáng giống mặt trời)
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
     * Đặt vị trí nguồn sáng thông qua mảng [x, y, z] thay vì Vector3 dính tới ThreeJS bên ngoài
     * @param {number|number[]} x - Tọa độ X hoặc mảng [x, y, z]
     * @param {number} [y] - Tọa độ Y
     * @param {number} [z] - Tọa độ Z
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
     * Lấy vị trí hiện tại dưới dạng mảng [x, y, z]
     */
    getPosition() {
        const pos = this.getLight()?.position;
        return pos ? [pos.x, pos.y, pos.z] : [0, 0, 0];
    }

    /**
     * Đặt mục tiêu chiếu sáng (Target) thông qua mảng [x, y, z]
     */
    setTargetPosition(x, y, z) {
        const light = this.getLight();
        if (!light) return this;

        if (Array.isArray(x)) {
            light.target.position.set(x[0], x[1], x[2]);
        } else {
            light.target.position.set(x, y, z);
        }
        // DirectionalLight yêu cầu target phải nằm trong scene để cập nhật ma trận hướng chiếu
        if (this.parent && !this.parent.children.includes(light.target)) {
            this.parent.add(light.target);
        }
        return this;
    }
}