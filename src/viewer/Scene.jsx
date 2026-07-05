import { useEffect, useRef } from "react";
import * as THREE from "three";
import RendererController from "../controllers/RendererController";
import { CameraController } from "../controllers/CameraController";
import SceneController from "../controllers/SceneController";
import OrientationTriad from "../components/OrientationTriad";

export default function Scene({ onControllerReady }) {
    const containerRef = useRef();

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        //------------------------------------------
        // Renderer
        //------------------------------------------
        const rendererController = new RendererController(container);
        const renderer = rendererController.renderer;

        //------------------------------------------
        // Camera — CameraController
        //------------------------------------------
        const aspect = container.clientWidth / container.clientHeight || 1;
        const frustumSize = 10;
        const camera = new THREE.OrthographicCamera(
            (-frustumSize * aspect) / 2,
            (frustumSize * aspect) / 2,
            frustumSize / 2,
            -frustumSize / 2,
            0.01,
            10000
        );
        camera.position.set(10, 10, 10);

        //------------------------------------------
        // Scene
        //------------------------------------------
        // Lưu ý: CameraController mới không có `.controls` (không dùng OrbitControls),
        // nên bỏ tham số thứ 2 nếu SceneController chỉ cần camera.
        const sceneController = new SceneController(camera);

        //------------------------------------------
        // Orientation triad (view cube)
        //------------------------------------------
        const triad = new OrientationTriad(renderer);

        //------------------------------------------
        // Camera controller mới
        //------------------------------------------
        const cameraController = new CameraController(camera, renderer.domElement, {
            autoResize: false,
            onOrientationChange: (quat) => {
                if (triad.setOrientation) triad.setOrientation(quat);
                else triad.quaternion?.copy(quat);
            },
        });

        cameraController.setDamping(false);

        // Auto clipping ban đầu (gọi lại hàm này mỗi khi thêm/xóa object trong scene)
        const updateClipping = () => {
            const box = new THREE.Box3().setFromObject(sceneController.scene);
            if (!box.isEmpty()) {
                cameraController.setBoundingSphere(box.getBoundingSphere(new THREE.Sphere()));
            }
        };
        updateClipping();

        sceneController.cameraController = cameraController;
        if (onControllerReady) onControllerReady(sceneController);

        //------------------------------------------
        // Resize
        //------------------------------------------
        function resize() {
            rendererController.resize();

            const w = container.clientWidth;
            const h = container.clientHeight;
            if (w === 0 || h === 0) return;

            const a = w / h;
            const halfH = (camera.top - camera.bottom) / 2;
            camera.left = -halfH * a;
            camera.right = halfH * a;
            camera.updateProjectionMatrix();
        }

        const resizeObserver = new ResizeObserver(resize);
        resizeObserver.observe(container);

        //------------------------------------------
        // Animation loop
        //------------------------------------------
        let rafId;
        function animate() {
            rafId = requestAnimationFrame(animate);
            rendererController.render(sceneController.scene, camera);
            triad.update(camera);
            triad.render();
        }
        animate();

        //------------------------------------------
        return () => {
            cancelAnimationFrame(rafId);
            resizeObserver.disconnect();
            rendererController.dispose();
            cameraController.dispose();
        };
    }, [onControllerReady]);

    return <div ref={containerRef} className="scene-container" style={{ width: "100%", height: "100%" }} />;
}