import * as THREE from "three";

export default class SceneController {
    constructor(camera, cameraController = null) {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0xffffff);

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
     * Hàm nội bộ tính toán Bounding Box tinh khiết của các Model hình học trong Scene,
     * loại trừ hoàn toàn các thành phần bổ trợ như lưới tọa độ (system_grid).
     */
    _calculateModelBounds() {
        const box = new THREE.Box3();
        
        if (!this.scene) return box;
        this.scene.updateMatrixWorld(true);

        this.scene.traverse((child) => {
            // Loại trừ Grid hệ thống dựa vào tên định danh hoặc kiểu lớp đối tượng
            if (child === this.scene || child.name === "system_grid" || child.isGridHelper) {
                return;
            }

            // Chỉ tính toán giới hạn không gian dựa trên các đối tượng hình học thực tế (Mesh)
            if (child.isMesh) {
                if (!child.geometry.boundingBox) {
                    child.geometry.computeBoundingBox();
                }
                const childBox = child.geometry.boundingBox.clone();
                childBox.applyMatrix4(child.matrixWorld);
                box.union(childBox);
            }
        });

        return box;
    }

    /**
     * Zoom Fit toàn bộ scene, giữ nguyên hướng nhìn hiện tại (Đã loại trừ Grid)
     */
    fitView(padding = 1.2) {
        if (!this.cameraController || !this.scene) return false;

        const box = this._calculateModelBounds();
        if (box.isEmpty()) return false;

        this.cameraController.zoomFit(box, { padding, animate: true });
        this.updateClipping();
        return true;
    }

    /**
     * Đặt camera về 1 trong các view chuẩn rồi tự động Fit View theo nội dung scene.
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
        window.setTimeout(() => this.fitView(), 420);
        return true;
    }

    /** Đưa camera về view mặc định (Iso) và fit lại toàn bộ scene. */
    resetView() {
        return this.setView("iso");
    }

    /**
     * Cập nhật bounding sphere cho bộ xử lý auto-clipping của CameraController (Đã loại trừ Grid)
     */
    updateClipping() {
        if (!this.cameraController || !this.scene) return;

        // 1. Tính toán box tinh khiết của Model (đã loại trừ system_grid)
        const box = this._calculateModelBounds();
        if (box.isEmpty()) return;

        const sphere = box.getBoundingSphere(new THREE.Sphere());
        
        // 2. GIẢI PHÁP ĐỘNG: Lấy giá trị zoom hiện tại của camera (mặc định là 1 nếu không có)
        const currentZoom = (this.camera && this.camera.zoom) ? this.camera.zoom : 1;

        // Định nghĩa kích thước cơ sở của Grid (ví dụ bạn đặt lưới kích thước 2000)
        const baseGridSize = 2000; 

        // Khi zoom out (currentZoom giảm dần về 0.1, 0.01...), ta lấy kích thước lưới 
        // chia cho currentZoom để nới rộng bán kính khối cầu bao phủ một cách vô hạn.
        const dynamicRadius = Math.max(sphere.radius * 3.0, baseGridSize / currentZoom);

        sphere.radius = dynamicRadius;

        // 3. Đẩy thông số khối cầu đã nới rộng sang cho bộ điều khiển camera tính near/far
        this.cameraController.setBoundingSphere(sphere);
        
        // 4. Ép ma trận trực giao của camera mở rộng khoảng cắt tuyệt đối ở tầng cấu hình
        if (this.camera && typeof this.camera.updateProjectionMatrix === "function") {
            this.camera.near = -dynamicRadius; // Cho phép hiển thị cả các vật thể phía sau camera khi trực giao
            this.camera.far = dynamicRadius * 2;
            this.camera.updateProjectionMatrix();
        }
    }
}