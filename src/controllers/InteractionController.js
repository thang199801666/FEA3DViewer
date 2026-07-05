import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";

export default class InteractionController {
    constructor(camera, domElement) {
        this.controls = new OrbitControls(camera, domElement);
        
        // Tắt damping theo code cũ của bạn
        this.controls.enableDamping = false;

        // Cấu hình chuột: Chuột giữa xoay, Phải pan, Trái không làm gì
        this.controls.mouseButtons = {
            LEFT: THREE.MOUSE.NONE,
            MIDDLE: THREE.MOUSE.ROTATE,
            RIGHT: THREE.MOUSE.PAN
        };
    }

    update() {
        this.controls.update();
    }

    // Bạn có thể thêm các hàm bổ trợ ở đây nếu sau này cần điều khiển bằng code
    setTarget(x, y, z) {
        this.controls.target.set(x, y, z);
    }
}