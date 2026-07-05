import * as THREE from "three";

export default class SceneController {
    constructor(camera, cameraController = null) {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x3b3b3b);

        this.camera = camera;
        this.cameraController = cameraController;

        this.frustumSize = 10;

        this.initialize();
    }

    initialize() {
        this.scene.add(new THREE.AmbientLight(0xffffff, 1.2));

        const light1 = new THREE.DirectionalLight(0xffffff, 2);
        light1.position.set(15, 20, 15);
        this.scene.add(light1);

        const light2 = new THREE.DirectionalLight(0xffffff, 0.5);
        light2.position.set(-10, -10, -10);
        this.scene.add(light2);

        const cube = new THREE.Mesh(
            new THREE.BoxGeometry(),
            new THREE.MeshStandardMaterial({
                color: 0xd9d9d9,
                roughness: 0.7,
                metalness: 0.1
            })
        );
        this.scene.add(cube);
    }

    /**
     * Zoom Fit toàn bộ scene, giữ nguyên hướng nhìn hiện tại.
     * padding: hệ số nới rộng (1.2 = chừa 20% biên), KHÔNG phải pixel như bản cũ —
     * CameraMath.fitBox tính theo tỉ lệ camera-space, không phụ thuộc kích thước viewport.
     */
    fitView(padding = 1.2) {
        if (!this.cameraController || !this.scene) return false;

        this.scene.updateMatrixWorld(true);

        const box = new THREE.Box3().setFromObject(this.scene);
        if (box.isEmpty()) return false;

        this.cameraController.zoomFit(box, { padding, animate: true });
        this.updateClipping();
        return true;
    }

    /**
     * Đặt camera về 1 trong các view chuẩn rồi tự động Fit View theo nội dung scene.
     * viewName: 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom' | 'iso'
     */
    setView(viewName) {
        if (!this.cameraController) return false;

        const name = viewName.toLowerCase();
        const valid = ["front", "back", "left", "right", "top", "bottom", "iso"];
        if (!valid.includes(name)) {
            console.warn(`View orientation "${viewName}" not recognized.`);
            return false;
        }

        this.cameraController.setStandardView(name, true);
        // Fit lại theo nội dung scene sau khi animation xoay kết thúc, để khung
        // hình luôn vừa khít bất kể trước đó zoom ở mức nào.
        window.setTimeout(() => this.fitView(), 420);
        return true;
    }

    /** Đưa camera về view mặc định (Iso) và fit lại toàn bộ scene. */
    resetView() {
        return this.setView("iso");
    }

    /**
     * Cập nhật bounding sphere cho auto-clipping của CameraController.
     * Gọi lại hàm này mỗi khi thêm/xoá mesh trong scene (ví dụ sau Clear Scene).
     */
    updateClipping() {
        if (!this.cameraController || !this.scene) return;

        const box = new THREE.Box3().setFromObject(this.scene);
        if (box.isEmpty()) return;

        const sphere = box.getBoundingSphere(new THREE.Sphere());
        this.cameraController.setBoundingSphere(sphere);
    }
}