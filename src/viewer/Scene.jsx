import { useEffect, useRef } from "react";
import * as THREE from "three";

// --- threejsVTK core ---
import { RenderWindow }              from "../threejsVTK/Rendering/RenderWindow";
import { Renderer }                  from "../threejsVTK/Rendering/Renderer";
import { Camera as VTKCamera }       from "../threejsVTK/Rendering/Camera";
import { RenderWindowInteractor }    from "../threejsVTK/Interaction/RenderWindowInteractor";
import { Picker }                    from "../threejsVTK/Picking/Picker";
import { OrientationTriadActor }     from "../threejsVTK/Actors/OrientationTriadActor";
import { CameraNavigationActor }     from "../threejsVTK/Actors/CameraNavigationActor";
import { ScalarBarActor }            from "../threejsVTK/Actors/ScalarBarActor";
import { MeasurementRulerActor }     from "../threejsVTK/Actors/MeasurementRulerActor";

// New Facade Camera and Interactor Style
import { Camera as CadCamera }        from "../threejsVTK/Camera/Camera";
import { InteractorStyleOrbit }       from "../threejsVTK/Interaction/InteractorStyleOrbit";
import { NAV_STYLE }                  from "../threejsVTK/Interaction/InputStyleHandler";

// --- app controllers ---
import SceneController                      from "../controllers/SceneController";
import { PickingController }                from "../controllers/PickingController";
import TextBlockController                  from "../controllers/TextBlockController";

export default function Scene({
    viewportIndex = 1,
    sharedScene,
    onControllerReady,
    showTextBlock = false,
    showAxes = true,
    showRuler = true,
    showGrid = false,
    isGradientBackground = true,
    topColor = "#ffffff",
    bottomColor = "#000000",
    navStyle = NAV_STYLE.BLENDER,
}) {
    const containerRef = useRef();
    const textBlockRef = useRef(null);
    const showAxesRef = useRef(showAxes);
    const showGridRef = useRef(showGrid);
    
    // Store reference of rulerActor to control visibility and updates
    const rulerActorRef = useRef(null);
    const sceneControllerRef = useRef(null);

    useEffect(() => { showAxesRef.current = showAxes; }, [showAxes]);
    useEffect(() => { showGridRef.current = showGrid; }, [showGrid]);

    useEffect(() => {
        if (textBlockRef.current) textBlockRef.current.style.display = showTextBlock ? "block" : "none";
    }, [showTextBlock]);

    // Toggle 3D ruler visibility based on showRuler prop
    useEffect(() => {
        if (rulerActorRef.current?.group) {
            rulerActorRef.current.group.visible = showRuler;
        }
    }, [showRuler]);

    // Update navigation style dynamically when navStyle prop changes
    useEffect(() => {
        if (sceneControllerRef.current?.interactorStyle) {
            sceneControllerRef.current.interactorStyle.setNavStyle(navStyle);
        }
    }, [navStyle]);

    useEffect(() => {
        const container = containerRef.current;
        if (!container || !sharedScene) return;

        const triadConfig = { position: "bottom-left", size: 120 };
        const padding = 20;

        // ------------------------------------------------------------------
        // 1) RenderWindow - owns WebGLRenderer + canvas
        // ------------------------------------------------------------------
        const renderWindow = new RenderWindow({
            container,
            rendererParams: { antialias: true, alpha: true },
        });
        const renderer = renderWindow.renderer; // THREE.WebGLRenderer
        renderer.setClearColor(0x000000, 0);

        if (!sharedScene.background) {
            sharedScene.background = createGradientTexture();
        }

        // ------------------------------------------------------------------
        // 2) Camera (Orthographic) + VTK Camera adopt
        // ------------------------------------------------------------------
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
        camera.up.set(0, 1, 0);
        camera.lookAt(0, 0, 0);
        camera.updateMatrixWorld(true);
        camera.layers.enable(0);
        camera.layers.enable(viewportIndex);

        const vtkCamera = new VTKCamera({ threeCamera: camera });

        // ------------------------------------------------------------------
        // 3) VTK Renderer adopts scene + vtkCamera (Lights added by SceneController)
        // ------------------------------------------------------------------
        const vtkRenderer = new Renderer({
            scene: sharedScene,
            camera: vtkCamera,
            addDefaultLights: false,
        });
        vtkRenderer.viewport = [0, 0, 1, 1];
        renderWindow.addRenderer(vtkRenderer);

        // ------------------------------------------------------------------
        // 4) SceneController
        // ------------------------------------------------------------------
        const sceneController = new SceneController(camera, null, sharedScene);
        sceneControllerRef.current = sceneController;
        
        sceneController.attachRendering({
            renderWindow,
            renderer: vtkRenderer,
            vtkCamera,
            domElement: renderWindow.domElement,
        });

        // --- DOUBLE ADAPTIVE CAD GRID SYSTEM ---
        const majorGrid = new THREE.GridHelper(2000, 200, 0x444444, 0x888888);
        majorGrid.name = "system_grid";
        majorGrid.frustumCulled = false;
        majorGrid.layers.set(viewportIndex);
        majorGrid.material.transparent = true;
        majorGrid.material.opacity = 0.5;
        majorGrid.material.depthWrite = true;
        majorGrid.material.polygonOffset = true;
        majorGrid.material.polygonOffsetFactor = 1;
        majorGrid.material.polygonOffsetUnits = 1;
        sceneController.scene.add(majorGrid);

        const minorGrid = new THREE.GridHelper(2000, 2000, 0x999999, 0xcccccc);
        minorGrid.name = "system_grid";
        minorGrid.frustumCulled = false;
        minorGrid.layers.set(viewportIndex);
        minorGrid.material.transparent = true;
        minorGrid.material.opacity = 0.25;
        minorGrid.material.depthWrite = true;
        minorGrid.material.polygonOffset = true;
        minorGrid.material.polygonOffsetFactor = 1.1;
        minorGrid.material.polygonOffsetUnits = 1.1;
        sceneController.scene.add(minorGrid);

        // ------------------------------------------------------------------
        // 5) Overlay DOM: TextBlock
        // ------------------------------------------------------------------
        const textBlockContainer = document.createElement("div");
        textBlockRef.current = textBlockContainer;
        const leftPosition = triadConfig.position === "bottom-left" ? `${triadConfig.size + padding}px` : `${padding}px`;
        const rightPosition = triadConfig.position === "bottom-right" ? `${triadConfig.size + padding}px` : `${padding}px`;
        Object.assign(textBlockContainer.style, {
            position: "absolute", bottom: "70px", left: leftPosition, right: rightPosition,
            pointerEvents: "none", zIndex: 10, display: showTextBlock ? "block" : "none",
        });
        container.appendChild(textBlockContainer);

        const textBlockController = new TextBlockController(textBlockContainer, {
            position: "relative",
            triadPosition: triadConfig.position,
            triadSize: triadConfig.size,
        });
        sceneController.textBlock = textBlockController;

        // ------------------------------------------------------------------
        // INITIALIZE MEASUREMENT RULER ACTOR
        // ------------------------------------------------------------------
        const measurementRulerActor = new MeasurementRulerActor(sharedScene, camera, {
            color: 0xffffff,
            targetPixelWidth: 120,
            tickHeight: 0.08,
            fontSize: 40
        });
        measurementRulerActor.group.visible = showRuler;
        rulerActorRef.current = measurementRulerActor;

        // ------------------------------------------------------------------
        // 6) Overlay actors: Triad + Navigation Gizmo (threejsVTK)
        // ------------------------------------------------------------------
        const triad = new OrientationTriadActor(renderer, {
            position: triadConfig.position,
            size: triadConfig.size,
        });

        const gizmo = new CameraNavigationActor(renderer, container, vtkCamera, {
            position: "top-right",
            size: 150,
            animateSpeed: 0.15,
            dragRotateSpeed: 1,
            onChange: () => {
                // Gizmo directly mutates THREE camera -> sync back to Facade CameraState
                // to prevent camera "jumping" during the next drag-rotate event.
                sceneController.cadCamera?.syncFromThree();
                sceneController.updateClipping();
                renderWindow.render();
            },
        });

        // ------------------------------------------------------------------
        // 7) Interactor + Camera Facade + InteractorStyleOrbit + Picker
        // ------------------------------------------------------------------
        const interactor = new RenderWindowInteractor();
        renderWindow.setInteractor(interactor);

        // Facade Camera: CameraState is the single source of truth <-> THREE ortho camera.
        const cadCamera = new CadCamera(camera, renderWindow.domElement, {
            autoResize: false,
            autoClipping: false,
            onChange: () => {
                vtkCamera.setFromThree?.(); // Keep vtkCamera (gizmo/triad) synchronized
                sceneController.updateClipping?.();
                sceneController.requestRender?.();
            },
        });
        sceneController.cadCamera = cadCamera;

        // ------------------------------------------------------------------
        // DOM Overlay cho RUBBER BAND SELECTION (kéo chuột TRÁI):
        //   - Kéo sang PHẢI (mode 'crossing') -> XANH DƯƠNG: chọn actor chạm khung
        //   - Kéo sang TRÁI (mode 'window')   -> XANH LÁ  : chỉ chọn actor nằm gọn
        // Màu/kiểu viền được cập nhật động theo mode do InteractorStyleOrbit trả về.
        // (Zoom Window chuột phải đã bị gỡ bỏ — enableZoomWindow: false.)
        // ------------------------------------------------------------------
        const RUBBER_BAND_STYLES = {
            crossing: { // kéo phải — xanh dương, nét liền
                border: "1.5px solid #4da3ff",
                background: "rgba(77, 163, 255, 0.15)",
            },
            window: {   // kéo trái — xanh lá, nét đứt (theo convention CAD)
                border: "1.5px dashed #35c159",
                background: "rgba(53, 193, 89, 0.15)",
            },
        };

        const rubberBandEl = document.createElement("div");
        Object.assign(rubberBandEl.style, {
            position: "fixed", display: "none", pointerEvents: "none",
            zIndex: 20,
        });
        document.body.appendChild(rubberBandEl);

        // Chỉ lấy ACTOR thật làm ứng viên chọn (cùng tiêu chí với PlotContour),
        // duyệt đệ quy để không bỏ sót actor nằm trong Group. Nếu đưa cả
        // sharedScene.children vào thì grid/ruler/light cũng bị test => sai.
        const collectSelectableActors = () => {
            const actors = [];
            sharedScene.traverse((o) => {
                if (o.isActor && o.visible && o.name !== "system_grid") actors.push(o);
            });
            return actors;
        };

        const style = new InteractorStyleOrbit(cadCamera, {
            enableDamping: false,
            navStyle: navStyle, // Pass current navigation style configuration

            // GỠ BỎ Zoom Window ở chuột phải: nav style có map nút nào sang
            // ZOOM_WINDOW thì hành động đó cũng bị bỏ qua.
            enableZoomWindow: false,

            // --- Rubber band selection (chuột TRÁI) ---
            enableRubberBand: true,
            getSelectableObjects: collectSelectableActors,
            rubberBandFilter: (o) => o.visible && o.name !== "system_grid",
            onRubberBandUpdate: (r, mode) => {
                const c = RUBBER_BAND_STYLES[mode] ?? RUBBER_BAND_STYLES.crossing;
                Object.assign(rubberBandEl.style, {
                    display: "block",
                    left: `${r.x}px`, top: `${r.y}px`,
                    width: `${r.width}px`, height: `${r.height}px`,
                    border: c.border,
                    background: c.background,
                });
            },
            onRubberBandEnd: () => { rubberBandEl.style.display = "none"; },
            onRubberBandSelect: (selected, { mode, additive }) => {
                console.log(`[RubberBand] mode=${mode}, additive=${additive}, hit=${selected.length}`, selected.map(o => o.name));
                const pc = sceneController.pickingController;
                if (!pc) return;

                // Thử lần lượt các API phổ biến của PickingController.
                // ĐỔI nhánh đầu tiên thành đúng tên hàm trong PickingController
                // của dự án nếu các tên dưới đây đều không khớp.
                if (typeof pc.selectObjects === "function") {
                    pc.selectObjects(selected, { additive, mode });
                } else if (typeof pc.setSelection === "function") {
                    pc.setSelection(selected, additive);
                } else if (typeof pc.selectActors === "function") {
                    pc.selectActors(selected, additive);
                } else if (typeof pc.select === "function") {
                    if (!additive && typeof pc.clearSelection === "function") pc.clearSelection();
                    selected.forEach((o) => pc.select(o));
                } else {
                    // In ra toàn bộ method có sẵn để biết cần nối vào hàm nào
                    console.warn(
                        "[RubberBand] PickingController không có API select phù hợp. Các method hiện có:",
                        Object.getOwnPropertyNames(Object.getPrototypeOf(pc))
                    );
                }
                sceneController.requestRender?.();
            },
        });
        interactor.setInteractorStyle(style);
        sceneController.interactorStyle = style;

        const picker = new Picker({ filter: (o) => o.visible && o.name !== "system_grid" });
        interactor.setPicker(picker);

        interactor.initialize();

        // ------------------------------------------------------------------
        // 8) PickingController (hover/select highlight)
        // ------------------------------------------------------------------
        const pickingController = new PickingController(sceneController);
        sceneController.pickingController = pickingController;

        // ------------------------------------------------------------------
        // 9) Scalar bar
        // ------------------------------------------------------------------
        const scalarBar = new ScalarBarActor({
            anchor: "BottomRight", 
            range: [0, 1], 
            numberOfColors: 12, 
            precision: 3,
            textColor: "#f0f0f0",
            showOutline: true,
            outlineColor: "#ffffff",
        }).attachTo(container);
        scalarBar.setVisible(false);

        sceneController.scalarBar = scalarBar;
        sceneController.updateClipping();

        // ------------------------------------------------------------------
        // PlotContour: Sets scalar visibility state for all actors in scene
        // ------------------------------------------------------------------
        sceneController.PlotContour = (visibleState) => {
            if (!sceneController.scene) return;
            
            let lastActor = null;
            sceneController.scene.children.forEach((child) => {
                if (child.isActor && typeof child.setScalarVisibility === "function") {
                    child.setScalarVisibility(visibleState);
                    lastActor = child;
                }
            });

            // Synchronize Scalar Bar display state
            if (sceneController.scalarBar) {
                if (visibleState && lastActor) {
                    let range = [0, 1];
                    const lut = lastActor.mapper?.lookupTable ?? lastActor.mapper?.getLookupTable?.() ?? null;
                    
                    if (lut && Array.isArray(lut.range) && lut.range[0] !== lut.range[1]) {
                        range = lut.range.slice();
                    } else {
                        const polyData = lastActor.mapper?.getInputData?.() ?? lastActor.inputData ?? null;
                        const pointData = polyData?.getPointData?.();
                        if (pointData) {
                            const scalars = pointData.getScalars?.();
                            if (scalars && typeof scalars.getRange === "function") {
                                range = scalars.getRange();
                            }
                        }
                    }

                    sceneController.scalarBar.show({
                        title: lastActor.name || "Contour",
                        range: range,
                        numberOfColors: 12,
                        anchor: "TopLeft",
                    });
                } else if (typeof sceneController.scalarBar.setVisible === "function") {
                    sceneController.scalarBar.setVisible(false);
                }
            }

            if (typeof sceneController.requestRender === "function") {
                sceneController.requestRender();
            } else {
                renderWindow.render();
            }
        };

        // Legacy wrapper method to support compatibility with file loading logic
        sceneController.AddToRenderer = (actor, options = {}) => {
            if (!actor) return;
            const { showContour = false } = options;
            sceneController.scene.add(actor);
            sceneController.updateClipping();
            sceneController.fitView();
            sceneController.PlotContour(showContour);
        };

        function createGradientTexture() {
            const canvas = document.createElement("canvas");
            canvas.width = 2; canvas.height = 512;
            const ctx = canvas.getContext("2d");
            const g = ctx.createLinearGradient(0, canvas.height, 0, 0);
            g.addColorStop(0, "#000000");
            g.addColorStop(1, "#ffffff");
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            const texture = new THREE.CanvasTexture(canvas);
            texture.colorSpace = THREE.SRGBColorSpace;
            return texture;
        }

        function updateRulerPosition() {
            if (!camera || !measurementRulerActor) return;
            camera.updateMatrixWorld(true);
            const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
            const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
            const targetPoint = new THREE.Vector3().copy(camera.position).addScaledVector(forward, 10); 
            const orthoHeightAtZoom = camera.bottom / camera.zoom;
            const finalPosition = new THREE.Vector3().copy(targetPoint).addScaledVector(up, orthoHeightAtZoom * 0.85);

            measurementRulerActor.position.copy(finalPosition);
            measurementRulerActor.group.position.copy(finalPosition);
            measurementRulerActor.group.quaternion.copy(camera.quaternion);
            measurementRulerActor.group.updateMatrixWorld(true);
        }

        function resize() {
            if (!container) return;
            const w = container.clientWidth, h = container.clientHeight;
            if (w === 0 || h === 0) return;
            renderer.setSize(w, h, false);
            const a = w / h;
            const halfH = (camera.top - camera.bottom) / 2;
            camera.left = -halfH * a;
            camera.right = halfH * a;
            camera.updateProjectionMatrix();
            
            if (measurementRulerActor) {
                updateRulerPosition();
                measurementRulerActor.update(w);
            }
        }

        sceneController.onResize = resize;
        if (onControllerReady) onControllerReady(sceneController);

        const resizeObserver = new ResizeObserver(() => resize());
        resizeObserver.observe(container);

        // ------------------------------------------------------------------
        // 10) Render Animation Loop
        // ------------------------------------------------------------------
        let rafId;
        function animate() {
            rafId = requestAnimationFrame(animate);

            if (showGridRef.current) {
                majorGrid.visible = true;
                minorGrid.visible = true;
                const zoom = camera.zoom || 1;
                const exponent = Math.floor(Math.log10(1 / zoom));
                const majorScale = Math.pow(10, exponent);
                majorGrid.scale.set(majorScale, 1, majorScale);
                minorGrid.scale.set(majorScale, 1, majorScale);
                const fractional = (1 / zoom) / majorScale;
                minorGrid.material.opacity = Math.max(0, Math.min(0.3, (1 - fractional) * 1.5));
                sceneController.updateClipping();
            } else {
                majorGrid.visible = false;
                minorGrid.visible = false;
            }

            if (measurementRulerActor && measurementRulerActor.group.visible) {
                updateRulerPosition();
                measurementRulerActor.update(container.clientWidth);
            }

            renderWindow.render();

            if (showAxesRef.current) {
                camera.updateMatrixWorld(true);
                triad.update(camera);
                triad.render();
                gizmo.update(camera);
                gizmo.render();
            } else {
                renderer.clearDepth();
            }
        }
        animate();

        return () => {
            cancelAnimationFrame(rafId);
            resizeObserver.disconnect();

            style.dispose();
            cadCamera.dispose();
            interactor.dispose();
            if (rubberBandEl.parentNode) rubberBandEl.parentNode.removeChild(rubberBandEl);
            pickingController.dispose();
            textBlockController.dispose();
            
            if (measurementRulerActor) {
                measurementRulerActor.dispose();
            }
            
            scalarBar.dispose();
            gizmo.dispose();
            triad.dispose();

            if (sceneController.scene) {
                sceneController.scene.remove(majorGrid);
                sceneController.scene.remove(minorGrid);
                majorGrid.geometry.dispose();
                majorGrid.material.dispose();
                minorGrid.geometry.dispose();
                minorGrid.material.dispose();
            }

            if (container.contains(textBlockContainer)) container.removeChild(textBlockContainer);
        };
    }, [onControllerReady, sharedScene, viewportIndex]); // Removed navStyle dependency here to avoid complete scene re-init

    const backgroundStyle = isGradientBackground
        ? `linear-gradient(to top, ${bottomColor}, ${topColor})`
        : bottomColor;

    return (
        <div
            ref={containerRef}
            className="scene-container"
            style={{ width: "100%", height: "100%", position: "relative", background: backgroundStyle }}
        />
    );
}