import { useEffect, useRef } from "react";
import * as THREE from "three";

// ── threejsVTK: MỘT import duy nhất qua barrel công khai ─────────────────────
// package.json chỉ expose "." nên deep import ("../threejsVTK/Rendering/Renderer")
// sẽ bị chặn. Đây là chủ ý: nó khoá bề mặt API công khai lại.
import {
    RenderWindow,
    Renderer,
    RenderWindowInteractor,
    InteractorStyleOrbit,
    Picker,
    OrientationTriadActor,
    NavigationCube,          // trước: CameraNavigationActor (widgets/NavigationCube.js)
    ScalarBarActor,
    MeasurementRuler,        // trước: MeasurementRulerActor (widgets/MeasurementRuler.js)
    Camera,
    applyVTKCameraApi,
    missingCameraApi,
    NAV_STYLE,
    RUBBER_BAND_MODE,        // trước: import từ InteractorStyleOrbit (phụ thuộc ngược)
} from "../threejsVTK";

// ── app controllers (không thuộc thư viện) ──────────────────────────────────
// LƯU Ý: thư viện cũng có interaction/picking/PickingController.js — TRÙNG TÊN với
// file này nhưng là hai lớp khác nhau. Import tường minh để không ai nhầm.
import SceneController from "../shared/controllers/SceneController";
import { PickingController as AppPickingController } from "../shared/controllers/PickingController";
import TextBlockController from "../shared/controllers/TextBlockController";

// VTKCamera đã bị xoá; API của nó được hấp thụ vào Camera facade. Gọi một lần.
applyVTKCameraApi(Camera);

const GRID_NAME = "system_grid";

const RUBBER_BAND_STYLES = {
    [RUBBER_BAND_MODE.CROSSING]: { border: "1.5px solid #4da3ff", background: "rgba(77, 163, 255, 0.15)" },
    [RUBBER_BAND_MODE.WINDOW]:   { border: "1.5px dashed #35c159", background: "rgba(53, 193, 89, 0.15)" },
};

/**
 * Áp selection từ rubber band lên PickingController của app.
 *
 * Bản cũ dò 4 tên method (selectObjects / setSelection / selectActors / select) và
 * IM LẶNG không làm gì nếu không khớp cái nào. Giữ nguyên khả năng tương thích,
 * nhưng cảnh báo khi rơi xuống đáy — im lặng là cách tệ nhất để hỏng.
 */
function applyRubberBandSelection(pc, selected, { additive, mode }) {
    if (!pc) return false;
    if (typeof pc.selectObjects === "function") { pc.selectObjects(selected, { additive, mode }); return true; }
    if (typeof pc.setSelection === "function") { pc.setSelection(selected, additive); return true; }
    if (typeof pc.selectActors === "function") { pc.selectActors(selected, additive); return true; }
    if (typeof pc.select === "function") {
        if (!additive && typeof pc.clearSelection === "function") pc.clearSelection();
        selected.forEach((o) => pc.select(o));
        return true;
    }
    console.warn(
        "[Scene] PickingController không có method chọn nào đã biết " +
        "(selectObjects / setSelection / selectActors / select). Rubber band không chọn được gì."
    );
    return false;
}

export default function Scene({
    viewportIndex = 1,
    sharedScene,
    onControllerReady,
    otherController = null,
    isViewLinked = true,
    showTextBlock = false,
    showAxes = true,
    showRuler = true,
    showGrid = false,
    isGradientBackground = true,
    topColor = "#ffffff",
    bottomColor = "#000000",
    navStyle = NAV_STYLE.BLENDER,
    antialias = true,
    addDefaultLights = false,
    ambientIntensity = 0.5,
    directionalIntensity = 1.0,
}) {
    const containerRef = useRef();
    const textBlockRef = useRef(null);
    const showAxesRef = useRef(showAxes);
    const showGridRef = useRef(showGrid);

    const rulerRef = useRef(null);
    const sceneControllerRef = useRef(null);

    const otherControllerRef = useRef(otherController);
    const isViewLinkedRef = useRef(isViewLinked);
    useEffect(() => { otherControllerRef.current = otherController; }, [otherController]);
    useEffect(() => { isViewLinkedRef.current = isViewLinked; }, [isViewLinked]);
    useEffect(() => { showAxesRef.current = showAxes; }, [showAxes]);
    useEffect(() => { showGridRef.current = showGrid; }, [showGrid]);

    useEffect(() => {
        if (textBlockRef.current) textBlockRef.current.style.display = showTextBlock ? "block" : "none";
    }, [showTextBlock]);

    useEffect(() => {
        if (rulerRef.current?.group) rulerRef.current.group.visible = showRuler;
    }, [showRuler]);

    useEffect(() => {
        sceneControllerRef.current?.interactorStyle?.setNavStyle(navStyle);
    }, [navStyle]);

    // ── Đèn nằm trong sharedScene nên chỉ viewport chính (index 1) sở hữu chúng,
    //    nếu không split view sẽ thêm một bộ đèn trùng. Tra theo tên để đổi cường
    //    độ tại chỗ.
    useEffect(() => {
        if (viewportIndex !== 1 || !sharedScene) return;

        const AMBIENT = "settings_ambient_light";
        const DIRECTIONAL = "settings_directional_light";

        let ambient = sharedScene.getObjectByName(AMBIENT);
        if (!ambient) {
            ambient = new THREE.AmbientLight(0xffffff, ambientIntensity);
            ambient.name = AMBIENT;
            sharedScene.add(ambient);
        } else {
            ambient.intensity = ambientIntensity;
        }

        let directional = sharedScene.getObjectByName(DIRECTIONAL);
        if (!directional) {
            directional = new THREE.DirectionalLight(0xffffff, directionalIntensity);
            directional.name = DIRECTIONAL;
            directional.position.set(1, 1, 1);
            sharedScene.add(directional);
        } else {
            directional.intensity = directionalIntensity;
        }

        sceneControllerRef.current?.requestRender?.();
    }, [viewportIndex, sharedScene, ambientIntensity, directionalIntensity]);

    useEffect(() => {
        const container = containerRef.current;
        if (!container || !sharedScene) return;

        const triadConfig = { position: "bottom-left", size: 120 };
        const padding = 20;

        // ── 1) RenderWindow: sở hữu WebGLRenderer + canvas ───────────────────
        const renderWindow = new RenderWindow({
            container,
            // antialias bị khoá lúc tạo WebGL context; đổi sau cần reload scene.
            rendererParams: { antialias, alpha: true },
        });
        const glRenderer = renderWindow.renderer;   // THREE.WebGLRenderer
        glRenderer.setClearColor(0x000000, 0);
        glRenderer.localClippingEnabled = true;

        // Giữ canvas trong suốt để background CSS của container (gradient) hiện ra.
        // Gán scene.background đục ở đây sẽ che mất nó — đúng lý do đổi màu nền
        // trước kia không có tác dụng.
        sharedScene.background = null;

        // ── 2) Camera: MỘT object duy nhất ───────────────────────────────────
        // Trước đây có HAI: `vtkCamera` (adapter cho Renderer + gizmo) và `cadCamera`
        // (facade cho interactor), cùng bọc một THREE.OrthographicCamera. Scene phải
        // cross-sync tay: cadCamera.onChange -> vtkCamera.setFromThree(), và
        // gizmo.onChange -> cadCamera.syncFromThree(). Hai đường ghi, không có single
        // source of truth. VTKCamera đã bị xoá; API của nó nằm trong Camera facade.
        const aspect = container.clientWidth / container.clientHeight || 1;
        const frustumSize = 10;
        const threeCamera = new THREE.OrthographicCamera(
            (-frustumSize * aspect) / 2, (frustumSize * aspect) / 2,
            frustumSize / 2, -frustumSize / 2,
            0.01, 10000
        );
        threeCamera.position.set(10, 10, 10);
        threeCamera.up.set(0, 1, 0);
        threeCamera.lookAt(0, 0, 0);
        threeCamera.updateMatrixWorld(true);
        threeCamera.layers.enable(0);
        threeCamera.layers.enable(viewportIndex);

        const pushCameraToLinked = () => {
            if (sceneController._applyingLinked) return;
            if (!isViewLinkedRef.current) return;
            otherControllerRef.current?.applyLinkedCamera?.(threeCamera);
        };

        const camera = new Camera(threeCamera, renderWindow.domElement, {
            autoResize: false,
            autoClipping: false,
            onChange: () => {
                sceneController.updateClipping?.();
                sceneController.requestRender?.();
                pushCameraToLinked();
            },
        });

        // Bắt lỗi sớm nếu Camera facade thiếu API mà Renderer/gizmo cần, thay vì
        // "undefined is not a function" ở frame đầu tiên.
        const missing = missingCameraApi(camera);
        if (missing.length) {
            throw new Error(
                `[Scene] Camera facade thiếu: ${missing.join(", ")}.\n` +
                `Gọi applyVTKCameraApi(Camera) trước khi khởi tạo, hoặc bổ sung các method này ` +
                `vào camera/Camera.js. Xem src/camera/vtkCameraApi.js.`
            );
        }

        // ── 3) VTK Renderer ──────────────────────────────────────────────────
        const vtkRenderer = new Renderer({ scene: sharedScene, camera, addDefaultLights });
        vtkRenderer.viewport = [0, 0, 1, 1];
        renderWindow.addRenderer(vtkRenderer);

        // ── 4) SceneController ───────────────────────────────────────────────
        const sceneController = new SceneController(threeCamera, null, sharedScene);
        sceneControllerRef.current = sceneController;

        sceneController.showCameraNav = true;
        sceneController.ToggleCameraNav = () => {
            sceneController.showCameraNav = !sceneController.showCameraNav;
        };

        sceneController.attachRendering({
            renderWindow,
            renderer: vtkRenderer,
            vtkCamera: camera,   // giữ tên key cho SceneController; giờ là Camera facade
            camera,
            domElement: renderWindow.domElement,
        });
        sceneController.cadCamera = camera;

        sceneController.applyLinkedCamera = (srcCam) => {
            if (!srcCam) return;
            sceneController._applyingLinked = true;
            threeCamera.position.copy(srcCam.position);
            threeCamera.quaternion.copy(srcCam.quaternion);
            threeCamera.up.copy(srcCam.up);
            threeCamera.zoom = srcCam.zoom;
            threeCamera.updateProjectionMatrix();
            threeCamera.updateMatrixWorld(true);
            camera.setFromThree();                    // MỘT lần sync, không còn hai
            sceneController.updateClipping?.();
            sceneController.requestRender?.();
            sceneController._applyingLinked = false;
        };

        // ── 5) Lưới CAD thích ứng hai cấp ────────────────────────────────────
        const makeGrid = (divisions, c1, c2, opacity, offset) => {
            const g = new THREE.GridHelper(2000, divisions, c1, c2);
            g.name = GRID_NAME;
            g.frustumCulled = false;
            g.layers.set(viewportIndex);
            Object.assign(g.material, {
                transparent: true, opacity, depthWrite: true,
                polygonOffset: true, polygonOffsetFactor: offset, polygonOffsetUnits: offset,
            });
            sceneController.scene.add(g);
            return g;
        };
        const majorGrid = makeGrid(200, 0x444444, 0x888888, 0.5, 1);
        const minorGrid = makeGrid(2000, 0x999999, 0xcccccc, 0.25, 1.1);

        // ── 6) Overlay DOM: TextBlock ────────────────────────────────────────
        const textBlockContainer = document.createElement("div");
        textBlockRef.current = textBlockContainer;
        const left = triadConfig.position === "bottom-left" ? `${triadConfig.size + padding}px` : `${padding}px`;
        const right = triadConfig.position === "bottom-right" ? `${triadConfig.size + padding}px` : `${padding}px`;
        Object.assign(textBlockContainer.style, {
            position: "absolute", bottom: "70px", left, right,
            pointerEvents: "none", zIndex: 10, display: showTextBlock ? "block" : "none",
        });
        container.appendChild(textBlockContainer);

        const textBlockController = new TextBlockController(textBlockContainer, {
            position: "relative",
            triadPosition: triadConfig.position,
            triadSize: triadConfig.size,
        });
        sceneController.textBlock = textBlockController;

        // ── 7) Thước đo ──────────────────────────────────────────────────────
        const ruler = new MeasurementRuler(sharedScene, threeCamera, {
            color: 0xffffff, targetPixelWidth: 120, tickHeight: 0.08, fontSize: 40,
        });
        ruler.group.visible = showRuler;
        rulerRef.current = ruler;

        const applyRulerLayer = () => ruler.group?.traverse((o) => o.layers.set(viewportIndex));
        applyRulerLayer();

        // ── 8) Overlay actors: Triad + NavigationCube ────────────────────────
        const triad = new OrientationTriadActor(glRenderer, {
            position: triadConfig.position,
            size: triadConfig.size,
        });

        const gizmo = new NavigationCube(glRenderer, container, camera, {
            position: "top-right",
            size: 150,
            animateSpeed: 0.15,
            dragRotateSpeed: 1,
            spriteScale: 0.4,
            onChange: () => {
                // Gizmo xoay THREE.Camera trực tiếp; facade tự đọc lại state.
                // Trước đây phải gọi cadCamera.syncFromThree() vì gizmo cầm vtkCamera.
                camera.setFromThree();
                sceneController.updateClipping();
                renderWindow.render();
                pushCameraToLinked();
            },
            onTranslate: (delta) => {
                const hasActorAncestor = (o) => {
                    let p = o.parent;
                    while (p) { if (p.isActor) return true; p = p.parent; }
                    return false;
                };
                sharedScene.traverse((o) => {
                    if (o.isActor && o.name !== GRID_NAME && !hasActorAncestor(o)) {
                        o.position.add(delta);
                        o.updateMatrixWorld?.(true);
                    }
                });
                sceneController.updateClipping?.();
                renderWindow.render();
                pushCameraToLinked();
            },
        });

        // ── 9) Interactor + InteractorStyleOrbit + Picker ────────────────────
        const interactor = new RenderWindowInteractor();
        renderWindow.setInteractor(interactor);

        const rubberBandEl = document.createElement("div");
        Object.assign(rubberBandEl.style, {
            position: "fixed", display: "none", pointerEvents: "none", zIndex: 20,
        });
        document.body.appendChild(rubberBandEl);

        const isSelectable = (o) => o.visible && o.name !== GRID_NAME;
        const collectSelectableActors = () => {
            const actors = [];
            sharedScene.traverse((o) => { if (o.isActor && isSelectable(o)) actors.push(o); });
            return actors;
        };

        const style = new InteractorStyleOrbit(camera, {
            enableDamping: false,
            navStyle,
            enableZoomWindow: false,
            enableRubberBand: true,
            getSelectableObjects: collectSelectableActors,
            rubberBandFilter: isSelectable,
            onRubberBandUpdate: (r, mode) => {
                const c = RUBBER_BAND_STYLES[mode] ?? RUBBER_BAND_STYLES[RUBBER_BAND_MODE.CROSSING];
                Object.assign(rubberBandEl.style, {
                    display: "block",
                    left: `${r.x}px`, top: `${r.y}px`,
                    width: `${r.width}px`, height: `${r.height}px`,
                    border: c.border, background: c.background,
                });
            },
            onRubberBandEnd: () => { rubberBandEl.style.display = "none"; },
            onRubberBandSelect: (selected, { mode, additive }) => {
                applyRubberBandSelection(sceneController.pickingController, selected, { additive, mode });
                sceneController.requestRender?.();
            },
        });
        interactor.setInteractorStyle(style);
        sceneController.interactorStyle = style;

        const picker = new Picker({ filter: isSelectable });
        interactor.setPicker(picker);
        interactor.initialize();

        const pickingController = new AppPickingController(sceneController);
        sceneController.pickingController = pickingController;

        // ── 10) Scalar bar ───────────────────────────────────────────────────
        const scalarBar = new ScalarBarActor({
            anchor: "BottomRight", range: [0, 1], numberOfColors: 12, precision: 3,
            textColor: "#f0f0f0", showOutline: true, outlineColor: "#ffffff",
        }).attachTo(container);
        scalarBar.setVisible(false);
        sceneController.scalarBar = scalarBar;
        sceneController.updateClipping();

        sceneController.PlotContour = (visibleState) => {
            if (!sceneController.scene) return;

            let lastActor = null;
            for (const child of sceneController.scene.children) {
                if (child.isActor && typeof child.setScalarVisibility === "function") {
                    child.setScalarVisibility(visibleState);
                    lastActor = child;
                }
            }

            if (scalarBar) {
                if (visibleState && lastActor) {
                    const lut = lastActor.mapper?.lookupTable ?? lastActor.mapper?.getLookupTable?.() ?? null;
                    let range = [0, 1];
                    if (lut && Array.isArray(lut.range) && lut.range[0] !== lut.range[1]) {
                        range = lut.range.slice();
                    } else {
                        const polyData = lastActor.mapper?.input ?? lastActor.mapper?.getInputData?.() ?? lastActor.inputData ?? null;
                        const pointData = polyData?.pointData ?? polyData?.getPointData?.();
                        const scalars = pointData?.getScalars?.();
                        if (scalars?.getRange) range = scalars.getRange();
                    }
                    scalarBar.show({ title: lastActor.name || "Contour", range, numberOfColors: 12, anchor: "TopLeft" });
                } else {
                    scalarBar.setVisible?.(false);
                }
            }
            sceneController.requestRender?.() ?? renderWindow.render();
        };

        sceneController.AddToRenderer = (actor, { showContour = false } = {}) => {
            if (!actor) return;
            sceneController.scene.add(actor);
            sceneController.updateClipping();
            sceneController.fitView();
            sceneController.PlotContour(showContour);
        };

        // ── 11) Vòng render ──────────────────────────────────────────────────
        const _forward = new THREE.Vector3();
        const _up = new THREE.Vector3();
        const _target = new THREE.Vector3();

        function updateRulerPosition() {
            threeCamera.updateMatrixWorld(true);
            _forward.set(0, 0, -1).applyQuaternion(threeCamera.quaternion);
            _up.set(0, 1, 0).applyQuaternion(threeCamera.quaternion);
            _target.copy(threeCamera.position).addScaledVector(_forward, 10);

            // camera.bottom ÂM (ortho), nên hệ số này kéo thước XUỐNG mép dưới.
            const offsetAlongUp = (threeCamera.bottom / threeCamera.zoom) * 0.95;
            _target.addScaledVector(_up, offsetAlongUp);

            ruler.position.copy(_target);
            ruler.group.position.copy(_target);
            ruler.group.quaternion.copy(threeCamera.quaternion);
            ruler.group.updateMatrixWorld(true);
        }

        function resize() {
            const w = container.clientWidth, h = container.clientHeight;
            if (!w || !h) return;
            glRenderer.setSize(w, h, false);
            camera.setAspect(w / h);          // trước: viết tay halfH * aspect trong Scene
            if (ruler) {
                updateRulerPosition();
                ruler.update(w);
                applyRulerLayer();
            }
        }

        sceneController.onResize = resize;
        onControllerReady?.(sceneController);

        const resizeObserver = new ResizeObserver(resize);
        resizeObserver.observe(container);

        let rafId;
        function animate() {
            rafId = requestAnimationFrame(animate);

            if (showGridRef.current) {
                majorGrid.visible = minorGrid.visible = true;
                const zoom = threeCamera.zoom || 1;
                const majorScale = Math.pow(10, Math.floor(Math.log10(1 / zoom)));
                majorGrid.scale.set(majorScale, 1, majorScale);
                minorGrid.scale.set(majorScale, 1, majorScale);
                const fractional = (1 / zoom) / majorScale;
                minorGrid.material.opacity = Math.max(0, Math.min(0.3, (1 - fractional) * 1.5));
                sceneController.updateClipping();
            } else {
                majorGrid.visible = minorGrid.visible = false;
            }

            if (ruler.group.visible) {
                updateRulerPosition();
                ruler.update(container.clientWidth);
                applyRulerLayer();
            }

            renderWindow.render();
            threeCamera.updateMatrixWorld(true);

            if (showAxesRef.current) { triad.update(threeCamera); triad.render(); }
            if (sceneController.showCameraNav) { gizmo.update(threeCamera); gizmo.render(); }
            if (!showAxesRef.current && !sceneController.showCameraNav) glRenderer.clearDepth();
        }
        animate();

        // ── 12) Dọn dẹp ──────────────────────────────────────────────────────
        return () => {
            cancelAnimationFrame(rafId);
            resizeObserver.disconnect();

            style.dispose();
            camera.dispose();
            interactor.dispose();
            rubberBandEl.remove();
            pickingController.dispose();
            textBlockController.dispose();
            ruler.dispose();
            scalarBar.dispose();
            gizmo.dispose();
            triad.dispose();

            for (const g of [majorGrid, minorGrid]) {
                sceneController.scene?.remove(g);
                g.geometry.dispose();
                g.material.dispose();
            }

            if (container.contains(textBlockContainer)) container.removeChild(textBlockContainer);

            // BẢN CŨ THIẾU: renderWindow không bao giờ được dispose -> WebGLRenderer và
            // WebGL context của nó rò rỉ mỗi lần Scene unmount. Trình duyệt chỉ cho ~16
            // context đồng thời; split-view remount vài lần là mất context.
            renderWindow.dispose();
        };
    }, [onControllerReady, sharedScene, viewportIndex]);

    const background = isGradientBackground
        ? `linear-gradient(to top, ${bottomColor}, ${topColor})`
        : bottomColor;

    return (
        <div
            ref={containerRef}
            className="scene-container"
            style={{ width: "100%", height: "100%", position: "relative", background }}
        />
    );
}
