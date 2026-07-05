import { useEffect, useRef } from "react";
import * as THREE from "three";
import RendererController       from "../controllers/RendererController";
import { CameraController }     from "../controllers/CameraController";
import SceneController          from "../controllers/SceneController";
import { PickingController }    from "../controllers/PickingController";
import TextBlockController      from "../controllers/TextBlockController";
import MeasurementController    from "../controllers/MeasurementController";
import OrientationTriad         from "./OrientationTriad";

export default function Scene({ onControllerReady, showTextBlock = false, showAxes = true, showRuler = true, showGrid = false }) {
    const containerRef = useRef();
    
    // Lưu các phần tử DOM thông qua Refs để chỉnh style trực tiếp
    const textBlockRef = useRef(null);
    const rulerRef = useRef(null);

    // Dùng Refs để tránh re-init Three.js canvas khi ấn nút trên Toolbar
    const showAxesRef = useRef(showAxes);
    const showGridRef = useRef(showGrid);

    useEffect(() => { showAxesRef.current = showAxes; }, [showAxes]);
    useEffect(() => { showGridRef.current = showGrid; }, [showGrid]);

    // Lắng nghe thay đổi trực tiếp để ẩn hiện DOM
    useEffect(() => {
        if (textBlockRef.current) textBlockRef.current.style.display = showTextBlock ? "block" : "none";
    }, [showTextBlock]);

    useEffect(() => {
        if (rulerRef.current) rulerRef.current.style.display = showRuler ? "block" : "none";
    }, [showRuler]);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const triadConfig = { position: "bottom-left", size: 120 };
        const padding = 20;          

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
        sceneController.camera = camera;

        // --- HỆ THỐNG LƯỚI ĐÔI ADAPTIVE CAD GRID (MẶT PHẲNG X-Z) ---
        // 1. Lưới chính (Major Grid) - Phân chia khoảng lớn nét đậm
        const majorGrid = new THREE.GridHelper(2000, 200, 0x444444, 0x888888); 
        majorGrid.name = "system_grid";
        majorGrid.frustumCulled = false;
        majorGrid.material.transparent = true;
        majorGrid.material.opacity = 0.5;
        majorGrid.material.depthWrite = true;
        majorGrid.material.polygonOffset = true;
        majorGrid.material.polygonOffsetFactor = 1;
        majorGrid.material.polygonOffsetUnits = 1;
        sceneController.scene.add(majorGrid);

        // 2. Lưới phụ (Minor Grid) - TĂNG PHÂN ĐOẠN LÊN 2000 ĐỂ Ô LƯỚI MỊN HƠN 2 LẦN
        // (Nếu muốn mịn nữa, bạn có thể tăng hẳn lên 4000)
        const minorGrid = new THREE.GridHelper(2000, 2000, 0x999999, 0xcccccc);
        minorGrid.name = "system_grid";
        minorGrid.frustumCulled = false;
        minorGrid.material.transparent = true;
        minorGrid.material.opacity = 0.25; // Tăng nhẹ opacity để nhìn rõ lưới mịn hơn
        minorGrid.material.depthWrite = true;
        minorGrid.material.polygonOffset = true;
        minorGrid.material.polygonOffsetFactor = 1.1;
        minorGrid.material.polygonOffsetUnits = 1.1;
        sceneController.scene.add(minorGrid);

        // Tạo phần tử chứa TextBlock DOM Panel
        const textBlockContainer = document.createElement("div");
        textBlockRef.current = textBlockContainer; 
        const leftPosition = triadConfig.position === "bottom-left" ? `${triadConfig.size + padding}px` : `${padding}px`;                   
        const rightPosition = triadConfig.position === "bottom-right" ? `${triadConfig.size + padding}px` : `${padding}px`;                   

        Object.assign(textBlockContainer.style, {
            position: "absolute",
            bottom: "70px",       
            left: leftPosition,   
            right: rightPosition, 
            pointerEvents: "none",
            zIndex: 10,
            display: showTextBlock ? "block" : "none"      
        });
        container.appendChild(textBlockContainer);

        const textBlockController = new TextBlockController(textBlockContainer, {
            position: "relative", 
            triadPosition: triadConfig.position,  
            triadSize: triadConfig.size                 
        });
        sceneController.textBlock = textBlockController;

        // Tạo phần tử chứa Measurement Ruler Component
        const rulerContainer = document.createElement("div");
        rulerRef.current = rulerContainer; 
        Object.assign(rulerContainer.style, {
            position: "absolute",
            bottom: "20px",
            left: "50%",
            transform: "translateX(-50%)",
            pointerEvents: "none",
            zIndex: 10,
            display: showRuler ? "block" : "none"
        });
        container.appendChild(rulerContainer);

        const measurementController = new MeasurementController(rulerContainer, camera);

        // Tạo Khối định hướng Triad axes
        const triad = new OrientationTriad(renderer);
        const cameraController = new CameraController(camera, renderer.domElement, {
            autoResize: false,
            onOrientationChange: (quat) => {
                if (triad.setOrientation) triad.setOrientation(quat);
                else triad.quaternion?.copy(quat);
            },
        });
        cameraController.setDamping(false);
        sceneController.cameraController = cameraController;

        const pickingController = new PickingController(sceneController);
        sceneController.pickingController = pickingController;
        
        sceneController.updateClipping();

        function resize() {
            if (!container) return;
            const w = container.clientWidth;
            const h = container.clientHeight;
            if (w === 0 || h === 0) return;

            rendererController.resize ? rendererController.resize() : renderer.setSize(w, h, false);

            const a = w / h;
            const halfH = (camera.top - camera.bottom) / 2;
            camera.left = -halfH * a;
            camera.right = halfH * a;
            camera.updateProjectionMatrix();
            
            if (measurementController?.update) measurementController.update(); 
        }

        sceneController.onResize = resize;
        if (onControllerReady) onControllerReady(sceneController);

        const resizeObserver = new ResizeObserver(() => { resize(); });
        resizeObserver.observe(container);
        
        let rafId;
        function animate() {
            rafId = requestAnimationFrame(animate);

            if (showGridRef.current) {
                majorGrid.visible = true;
                minorGrid.visible = true;

                const zoom = camera.zoom || 1;
                const exponent = Math.floor(Math.log10(1 / zoom));
                const majorScale = Math.pow(10, exponent);
                
                // CẬP NHẬT: Vì mật độ phân đoạn khởi tạo của minorGrid (2000) 
                // đang gấp 10 lần majorGrid (200), ta giữ nguyên tỷ lệ scale là 1
                const minorScale = majorScale; 

                majorGrid.scale.set(majorScale, 1, majorScale);
                minorGrid.scale.set(minorScale, 1, minorScale);

                const fractional = (1 / zoom) / majorScale;
                minorGrid.material.opacity = Math.max(0, Math.min(0.3, (1 - fractional) * 1.5));
                
                sceneController.updateClipping(); 
            } else {
                majorGrid.visible = false;
                minorGrid.visible = false;
            }
            
            rendererController.render(sceneController.scene, camera);
            if (showAxesRef.current) {
                triad.update(camera);
                triad.render();
            } else {
                renderer.clearDepth();
            }
            if (measurementController?.update) measurementController.update(); 
        }
        animate();

        return () => {
            cancelAnimationFrame(rafId);
            resizeObserver.disconnect();
            rendererController.dispose();
            cameraController.dispose();
            textBlockController.dispose();
            measurementController.dispose();
            pickingController.dispose();
            if (container.contains(textBlockContainer)) container.removeChild(textBlockContainer);
            if (container.contains(rulerContainer)) container.removeChild(rulerContainer);
        };
    }, [onControllerReady]); 

    return <div ref={containerRef} className="scene-container" style={{ width: "100%", height: "100%", position: "relative" }} />;
}