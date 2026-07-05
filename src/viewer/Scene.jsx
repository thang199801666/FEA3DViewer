import { useEffect, useRef } from "react";
import * as THREE from "three";
import RendererController       from "../controllers/RendererController";
import { CameraController }     from "../controllers/CameraController";
import SceneController          from "../controllers/SceneController";
import TextBlockController      from "../controllers/TextBlockController";
import MeasurementController    from "../controllers/MeasurementController";
import OrientationTriad         from "./OrientationTriad";

export default function Scene({ onControllerReady }) {
    const containerRef = useRef();

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        //------------------------------------------
        // Cấu hình Triad ban đầu (Dùng làm biến để tính toán layout)
        //------------------------------------------
        const triadConfig = {
            position: "bottom-left", // Vị trí của Triad: "bottom-left" hoặc "bottom-right"
            size: 120                // Kích thước chiều rộng/cao của Triad (triad width)
        };
        const padding = 20;          // Khoảng cách padding theo yêu cầu

        //------------------------------------------
        // Renderer & Camera
        //------------------------------------------
        const rendererController = new RendererController(container);
        const renderer = rendererController.renderer;

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

        const sceneController = new SceneController(camera);

        //------------------------------------------
        // 1. TẠO CONTAINER CHO TEXTBLOCK (Trải đều theo chiều rộng)
        //------------------------------------------
        const textBlockContainer = document.createElement("div");
        
        // Tính toán left và right động dựa theo cấu hình vị trí Triad
        const leftPosition = triadConfig.position === "bottom-left" 
            ? `${triadConfig.size + padding}px`  // triad width + 20px padding
            : `${padding}px`;                   // 20px padding mặc định nếu không có triad bên trái

        const rightPosition = triadConfig.position === "bottom-right"
            ? `${triadConfig.size + padding}px` // scene width - triad width - 20px padding
            : `${padding}px`;                   // 20px padding mặc định nếu không có triad bên phải

        Object.assign(textBlockContainer.style, {
            position: "absolute",
            bottom: "70px",       // Nằm trên Ruler (Ruler 20px + Chiều cao thước ~30px + 20px Padding = 70px)
            left: leftPosition,   // Điểm bắt đầu
            right: rightPosition, // Điểm kết thúc
            pointerEvents: "none",
            zIndex: 10,
            display: "block"      // Đảm bảo khối trải rộng tối đa từ left sang right
        });
        container.appendChild(textBlockContainer);

        // Khởi tạo TextBlock bên trong container đã được tính toán vị trí chuẩn
        const textBlockController = new TextBlockController(textBlockContainer, {
            position: "relative", // Chuyển sang relative để điền đầy textBlockContainer rộng lớn này
            triadPosition: triadConfig.position,  
            triadSize: triadConfig.size                 
        });
        sceneController.textBlock = textBlockController;

        //------------------------------------------
        // 2. TẠO CONTAINER CHO MEASUREMENT RULER (Chính giữa - Dưới cùng)
        //------------------------------------------
        const rulerContainer = document.createElement("div");
        Object.assign(rulerContainer.style, {
            position: "absolute",
            bottom: "20px",
            left: "50%",
            transform: "translateX(-50%)",
            pointerEvents: "none",
            zIndex: 10
        });
        container.appendChild(rulerContainer);

        // Khởi tạo thước đo nằm riêng ở rulerContainer
        const measurementController = new MeasurementController(rulerContainer, camera);

        //------------------------------------------
        // Orientation triad (View Cube) & Camera Controller
        //------------------------------------------
        const triad = new OrientationTriad(renderer);
        const cameraController = new CameraController(camera, renderer.domElement, {
            autoResize: false,
            onOrientationChange: (quat) => {
                if (triad.setOrientation) triad.setOrientation(quat);
                else triad.quaternion?.copy(quat);
            },
        });
        cameraController.setDamping(false);

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
        // Resize & Animation Loop
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
            
            measurementController.update(); 
        }

        const resizeObserver = new ResizeObserver(resize);
        resizeObserver.observe(container);

        let rafId;
        function animate() {
            rafId = requestAnimationFrame(animate);
            rendererController.render(sceneController.scene, camera);
            triad.update(camera);
            triad.render();
            measurementController.update(); 
        }
        animate();

        //------------------------------------------
        // Clean up giải phóng bộ nhớ
        //------------------------------------------
        return () => {
            cancelAnimationFrame(rafId);
            resizeObserver.disconnect();
            rendererController.dispose();
            cameraController.dispose();
            textBlockController.dispose();
            measurementController.dispose();
            
            if (container.contains(textBlockContainer)) container.removeChild(textBlockContainer);
            if (container.contains(rulerContainer)) container.removeChild(rulerContainer);
        };
    }, [onControllerReady]);

    return <div ref={containerRef} className="scene-container" style={{ width: "100%", height: "100%", position: "relative" }} />;
}