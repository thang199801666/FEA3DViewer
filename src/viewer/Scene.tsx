import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

// threejsVTK: A single import via the public barrel
import {
    RenderWindow,
    Renderer,
    RenderWindowInteractor,
    InteractorStyleOrbit,
    Picker,
    OrientationTriadActor,
    NavigationCube,
    ScalarBarActor,
    MeasurementRuler,
    Camera,
    applyVTKCameraApi,
    NAV_STYLE,
    RUBBER_BAND_MODE,
} from "../threejsVTK/src";

// App controllers (Not part of the library)
import SceneController from "../controllers/SceneController";
import { PickingController as AppPickingController } from "../controllers/PickingController";
import TextBlockController from "../controllers/TextBlockController";

applyVTKCameraApi(Camera);

const GRID_NAME = "system_grid";

const RUBBER_BAND_STYLES: Record<string | number, { border: string; background: string }> = {
    [RUBBER_BAND_MODE.CROSSING]: { border: "1.5px solid #4da3ff", background: "rgba(77, 163, 255, 0.15)" },
    [RUBBER_BAND_MODE.WINDOW]:   { border: "1.5px dashed #35c159", background: "rgba(53, 193, 89, 0.15)" },
};

const VIEWS = ["Front", "Back", "Top", "Bottom", "Left", "Right", "Isometric"] as const;
type ViewDirection = typeof VIEWS[number];

interface RubberBandSelectionOptions {
    additive: boolean;
    mode: any;
}

function applyRubberBandSelection(pc: any, selected: any[], { additive, mode }: RubberBandSelectionOptions): boolean {
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
        "[Scene] PickingController is missing known selection methods " +
        "(selectObjects / setSelection / selectActors / select). Rubber band selection failed."
    );
    return false;
}

export interface SceneProps {
    viewportIndex?: number;
    sharedScene: THREE.Scene;
    onControllerReady?: (controller: any) => void;
    otherController?: any;
    isViewLinked?: boolean;
    showTextBlock?: boolean;
    showAxes?: boolean;
    showRuler?: boolean;
    showGrid?: boolean;
    isGradientBackground?: boolean;
    topColor?: string;
    bottomColor?: string;
    navStyle?: any;
    antialias?: boolean;
    multiSamples?: number;
    addDefaultLights?: boolean;
    ambientIntensity?: number;
    directionalIntensity?: number;
    selectionMode?: string;
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
    topColor = "#6883A7",
    bottomColor = "#BBC9DB",
    navStyle = NAV_STYLE.BLENDER,
    antialias = true,
    multiSamples = 2, 
    addDefaultLights = false,
    ambientIntensity = 0.5,
    directionalIntensity = 1.0,
    selectionMode = "Part"
}: SceneProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const textBlockRef = useRef<HTMLDivElement | null>(null);
    const showAxesRef = useRef<boolean>(showAxes);
    const showGridRef = useRef<boolean>(showGrid);

    const rulerRef = useRef<any>(null);
    const sceneControllerRef = useRef<any>(null);
    const cameraRef = useRef<any>(null);
    const interactorRef = useRef<any>(null);

    const otherControllerRef = useRef<any>(otherController);
    const isViewLinkedRef = useRef<boolean>(isViewLinked);

    const [isContourActive, setIsContourActive] = useState<boolean>(false);
    
    // UI States cho Toolbar
    const [isDropdownOpen, setIsDropdownOpen] = useState<boolean>(false);
    const [cameraType, setCameraType] = useState<"orthographic" | "perspective">("orthographic");
    const dropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => { otherControllerRef.current = otherController; }, [otherController]);
    useEffect(() => { isViewLinkedRef.current = isViewLinked; }, [isViewLinked]);
    useEffect(() => { showAxesRef.current = showAxes; }, [showAxes]);
    useEffect(() => { showGridRef.current = showGrid; }, [showGrid]);

    // Đóng dropdown khi click ra ngoài panel
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsDropdownOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    useEffect(() => {
        if (textBlockRef.current) textBlockRef.current.style.display = showTextBlock ? "block" : "none";
    }, [showTextBlock]);

    useEffect(() => {
        if (rulerRef.current?.group) rulerRef.current.group.visible = showRuler;
    }, [showRuler]);

    useEffect(() => {
        sceneControllerRef.current?.interactorStyle?.setNavStyle(navStyle);
    }, [navStyle]);

    useEffect(() => {
        if (sceneControllerRef.current?.pickingController) {
            sceneControllerRef.current.pickingController.setSelectionMode(selectionMode);
        }
    }, [selectionMode]);

    useEffect(() => {
        if (viewportIndex !== 1 || !sharedScene) return;

        const AMBIENT = "settings_ambient_light";
        const DIRECTIONAL = "settings_directional_light";

        let ambient = sharedScene.getObjectByName(AMBIENT) as THREE.AmbientLight | undefined;
        if (!ambient) {
            ambient = new THREE.AmbientLight(0xffffff, ambientIntensity);
            ambient.name = AMBIENT;
            sharedScene.add(ambient);
        } else {
            ambient.intensity = ambientIntensity;
        }

        let directional = sharedScene.getObjectByName(DIRECTIONAL) as THREE.DirectionalLight | undefined;
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

        const renderWindow = new RenderWindow({
            container,
            rendererParams: { 
                antialias: antialias || multiSamples > 1, 
                alpha: true,
                samples: multiSamples 
            },
        });
        const glRenderer = renderWindow.renderer;
        glRenderer.setClearColor(0x000000, 0);
        glRenderer.localClippingEnabled = true;

        sharedScene.background = null;

        // --- KHỞI TẠO CAMERA DÙNG THREJSVTK CAMERA CLASS ---
        const camera = new Camera(renderWindow.domElement, {
            type: "orthographic",
            autoResize: false,
            autoClipping: false,
            target: new THREE.Vector3(0, 0, 0),
            onChange: () => {
                sceneController.updateClipping?.();
                sceneController.requestRender?.();
                pushCameraToLinked();
            }
        });
        cameraRef.current = camera;

        // Setup vị trí ban đầu thông qua lõi three của lớp Camera wrapper
        const threeCamera = camera.three;
        threeCamera.position.set(10, 10, 10);
        threeCamera.up.set(0, 1, 0);
        threeCamera.lookAt(0, 0, 0);
        threeCamera.updateMatrixWorld(true);
        threeCamera.layers.enable(0);
        threeCamera.layers.enable(viewportIndex);
        camera.syncFromThree();

        const pushCameraToLinked = () => {
            if (sceneController._applyingLinked) return;
            if (!isViewLinkedRef.current) return;
            otherControllerRef.current?.applyLinkedCamera?.(camera.three);
        };

        const vtkRenderer = new Renderer({ scene: sharedScene, camera, addDefaultLights });
        vtkRenderer.viewport = [0, 0, 1, 1];
        renderWindow.addRenderer(vtkRenderer);

        const sceneController = new SceneController(camera.three, null, sharedScene);
        sceneControllerRef.current = sceneController;

        sceneController.showCameraNav = true;
        sceneController.ToggleCameraNav = () => {
            sceneController.showCameraNav = !sceneController.showCameraNav;
        };

        sceneController.SetMultiSamples = (samples: number) => {
            console.warn("[SceneController] Changing MultiSamples requires re-initializing the WebGL Context (re-mounting the component).");
        };
        sceneController.GetMultiSamples = () => multiSamples;

        sceneController.attachRendering({
            renderWindow,
            renderer: vtkRenderer,
            vtkCamera: camera,
            camera,
            domElement: renderWindow.domElement,
        });
        sceneController.cadCamera = camera;

        sceneController.applyLinkedCamera = (srcCam: any) => {
            if (!srcCam) return;
            sceneController._applyingLinked = true;
            const destCam = camera.three;
            destCam.position.copy(srcCam.position);
            destCam.quaternion.copy(srcCam.quaternion);
            destCam.up.copy(srcCam.up);
            if (destCam.isOrthographicCamera && srcCam.isOrthographicCamera) {
                destCam.zoom = srcCam.zoom;
            }
            destCam.updateProjectionMatrix();
            destCam.updateMatrixWorld(true);
            camera.setFromThree();
            sceneController.updateClipping?.();
            sceneController.requestRender?.();
            sceneController._applyingLinked = false;
        };

        const makeGrid = (divisions: number, c1: number, c2: number, opacity: number, offset: number) => {
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

        const ruler = new MeasurementRuler(glRenderer, {
            color: 0xffffff, 
            targetPixelWidth: 120, 
            tickHeight: 0.08, 
            fontSize: 90      
        });
        rulerRef.current = ruler;

        const applyRulerLayer = () => ruler.group?.traverse((o: THREE.Object3D) => o.layers.set(viewportIndex));
        applyRulerLayer();

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
                camera.setFromThree();
                sceneController.updateClipping();
                renderWindow.render();
                pushCameraToLinked();
            },
            onTranslate: (delta: THREE.Vector3) => {
                const hasActorAncestor = (o: any) => {
                    let p = o.parent;
                    while (p) { if (p.isActor) return true; p = p.parent; }
                    return false;
                };
                sharedScene.traverse((o: any) => {
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

        const interactor = new RenderWindowInteractor();
        renderWindow.setInteractor(interactor);
        interactorRef.current = interactor;

        const rubberBandEl = document.createElement("div");
        Object.assign(rubberBandEl.style, {
            position: "fixed", display: "none", pointerEvents: "none", zIndex: 20,
        });
        document.body.appendChild(rubberBandEl);

        const isSelectable = (o: any) => o.visible && o.name !== GRID_NAME;
        const collectSelectableActors = () => {
            const actors: any[] = [];
            sharedScene.traverse((o: any) => { if (o.isActor && isSelectable(o)) actors.push(o); });
            return actors;
        };

        const style = new InteractorStyleOrbit(camera, {
            enableDamping: false,
            navStyle,
            enableZoomWindow: false,
            enableRubberBand: true,
            getSelectableObjects: collectSelectableActors,
            rubberBandFilter: isSelectable,
            onRubberBandUpdate: (r: { x: number; y: number; width: number; height: number }, mode: any) => {
                const c = RUBBER_BAND_STYLES[mode] ?? RUBBER_BAND_STYLES[RUBBER_BAND_MODE.CROSSING];
                Object.assign(rubberBandEl.style, {
                    display: "block",
                    left: `${r.x}px`, top: `${r.y}px`,
                    width: `${r.width}px`, height: `${r.height}px`,
                    border: c.border, background: c.background,
                });
            },
            onRubberBandEnd: () => { rubberBandEl.style.display = "none"; },
            onRubberBandSelect: (selected: any[], { mode, additive }: RubberBandSelectionOptions) => {
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
        pickingController.selectionMode = selectionMode;
        sceneController.pickingController = pickingController;

        const scalarBar = new ScalarBarActor({
            anchor: "BottomRight", range: [0, 1], numberOfColors: 12, precision: 3,
            textColor: "#f0f0f0", showOutline: true, outlineColor: "#ffffff",
        }).attachTo(container);
        scalarBar.setVisible(false);
        sceneController.scalarBar = scalarBar;
        sceneController.updateClipping();

        sceneController.PlotContour = (visibleState: boolean) => {
            if (!sceneController.scene) return;

            let lastActor: any = null;
            for (const child of sceneController.scene.children) {
                if ((child as any).isActor && typeof (child as any).setScalarVisibility === "function") {
                    (child as any).setScalarVisibility(visibleState);
                    lastActor = child;
                }
            }

            if (scalarBar) {
                if (visibleState && lastActor) {
                    const lut = lastActor.mapper?.lookupTable ?? lastActor.mapper?.getLookupTable?.() ?? null;
                    let range: [number, number] = [0, 1];
                    if (lut && Array.isArray(lut.range) && lut.range[0] !== lut.range[1]) {
                        range = lut.range.slice() as [number, number];
                    } else {
                        const polyData = lastActor.mapper?.input ?? lastActor.mapper?.getInputData?.() ?? lastActor.inputData ?? null;
                        const defaultPointData = polyData?.pointData ?? polyData?.getPointData?.();
                        const scalars = defaultPointData?.getScalars?.();
                        if (scalars?.getRange) range = scalars.getRange();
                    }
                    scalarBar.show({ title: lastActor.name || "Contour", range, numberOfColors: 12, anchor: "TopLeft" });
                } else {
                    scalarBar.setVisible?.(false);
                }
            }
            sceneController.requestRender?.() ?? renderWindow.render();
        };

        sceneController.AddToRenderer = (actor: any, { showContour = false } = {}) => {
            if (!actor) return;
            sceneController.scene.add(actor);
            sceneController.updateClipping();
            sceneController.fitView();
            sceneController.PlotContour(showContour);
        };

        function resize() {
            const w = container.clientWidth, h = container.clientHeight;
            if (!w || !h) return;
            glRenderer.setSize(w, h, false);
            camera.setAspect(w / h);
            if (ruler) {
                ruler.update(w, h, camera.three);
            }
        }

        sceneController.onResize = resize;
        onControllerReady?.(sceneController);

        const resizeObserver = new ResizeObserver(resize);
        resizeObserver.observe(container);

        let rafId: number;
        function animate() {
            rafId = requestAnimationFrame(animate);
            const activeCam = camera.three;

            if (showGridRef.current) {
                majorGrid.visible = minorGrid.visible = true;
                const zoom = activeCam.zoom || 1;
                const majorScale = Math.pow(10, Math.floor(Math.log10(1 / zoom)));
                majorGrid.scale.set(majorScale, 1, majorScale);
                minorGrid.scale.set(majorScale, 1, majorScale);
                const fractional = (1 / zoom) / majorScale;
                minorGrid.material.opacity = Math.max(0, Math.min(0.3, (1 - fractional) * 1.5));
                sceneController.updateClipping();
            } else {
                majorGrid.visible = minorGrid.visible = false;
            }

            renderWindow.render();
            activeCam.updateMatrixWorld(true);

            if (showAxesRef.current) { triad.update(activeCam); triad.render(); }
            if (sceneController.showCameraNav) { gizmo.update(activeCam); gizmo.render(); }
            
            if (showRuler) {
                ruler.update(container.clientWidth, container.clientHeight, activeCam);
                ruler.render();
            }
        }
        animate();

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
                (g.material as THREE.Material).dispose();
            }

            if (container.contains(textBlockContainer)) container.removeChild(textBlockContainer);

            renderWindow.dispose();
        };
    }, [onControllerReady, sharedScene, viewportIndex, antialias, multiSamples, showRuler, addDefaultLights]);

    const handleFitView = () => {
        if (sceneControllerRef.current?.fitView) {
            sceneControllerRef.current.fitView();
            sceneControllerRef.current.requestRender?.();
        }
    };

    const handleSwitchCameraType = (type: "orthographic" | "perspective") => {
        if (!cameraRef.current || !sceneControllerRef.current || !containerRef.current) return;
        
        const controller = sceneControllerRef.current;
        const camWrapper = cameraRef.current;

        const oldPos = new THREE.Vector3();
        const oldTarget = new THREE.Vector3();
        
        if (camWrapper.three) {
            oldPos.copy(camWrapper.three.position);
        }
        if (camWrapper.state && camWrapper.state.target) {
            oldTarget.copy(camWrapper.state.target);
        } else {
            oldTarget.set(0, 0, 0);
        }

        if (oldPos.distanceTo(oldTarget) < 0.001) {
            oldPos.set(oldTarget.x + 10, oldTarget.y + 10, oldTarget.z + 10);
        }

        camWrapper.switchType(type);
        
        const newThreeCam = camWrapper.three;
        newThreeCam.position.copy(oldPos);
        
        controller.camera = newThreeCam;

        const w = containerRef.current.clientWidth;
        const h = containerRef.current.clientHeight;
        camWrapper.setAspect(w / h);

        if (type === "perspective") {
            camWrapper.setClippingRange(0.1, 5000);
            newThreeCam.lookAt(oldTarget);
        }

        newThreeCam.updateMatrix();
        newThreeCam.updateMatrixWorld(true);
        newThreeCam.updateProjectionMatrix();

        if (interactorRef.current) {
            interactorRef.current.camera = camWrapper;
            if (typeof interactorRef.current.syncCamera === 'function') {
                interactorRef.current.syncCamera();
            }
        }

        if (typeof controller.updateClipping === "function") {
            controller.updateClipping();
        }

        controller.requestRender();
        setCameraType(type);

        if (isViewLinkedRef.current && otherControllerRef.current) {
            otherControllerRef.current.applyLinkedCamera?.(newThreeCam);
        }
    };

    const handleSetView = (viewDirection: ViewDirection) => {
        const controller = sceneControllerRef.current;
        if (!controller || !controller.cadCamera) return;

        const cam = controller.cadCamera; 
        const target = new THREE.Vector3(0, 0, 0);
        
        const currentPos = new THREE.Vector3();
        if (cam.three) currentPos.copy(cam.three.position);
        const distance = currentPos.distanceTo(target) || 15;

        let newPos = new THREE.Vector3();
        let newUp = new THREE.Vector3(0, 1, 0);

        switch (viewDirection) {
            case "Front":  
                newPos.set(0, 0, distance); 
                newUp.set(0, 1, 0);
                break;
            case "Back":   
                newPos.set(0, 0, -distance); 
                newUp.set(0, 1, 0);
                break;
            case "Top":    
                newPos.set(0, distance, 0); 
                newUp.set(0, 0, -1); 
                break;
            case "Bottom": 
                newPos.set(0, -distance, 0); 
                newUp.set(0, 0, 1);  
                break;
            case "Left":   
                newPos.set(-distance, 0, 0); 
                newUp.set(0, 1, 0);
                break;
            case "Right":  
                newPos.set(distance, 0, 0); 
                newUp.set(0, 1, 0);
                break;
            case "Isometric":
                const iso = distance / Math.sqrt(3);
                newPos.set(iso, iso, iso);
                newUp.set(-1, 2, -1).normalize(); 
                break;
            default: return;
        }

        if (cam.three) {
            cam.three.position.copy(newPos);
            cam.three.up.copy(newUp);
            cam.three.lookAt(target);
            cam.three.updateMatrixWorld(true);
            cam.setFromThree?.(); 
        }

        controller.updateClipping?.();
        if (typeof controller.fitView === "function") {
            controller.fitView();
        }
        controller.requestRender?.();
        
        if (isViewLinkedRef.current && cam.three) {
            otherControllerRef.current?.applyLinkedCamera?.(cam.three);
        }

        setIsDropdownOpen(false);
    };

    const background = isGradientBackground
        ? `linear-gradient(to top, ${bottomColor}, ${topColor})`
        : bottomColor;

    return (
        <div
            ref={containerRef}
            className="scene-container"
            style={{ width: "100%", height: "100%", position: "relative", background }}
        >
            <div 
                className="fea-vertical-toolbar"
                style={{
                    position: "absolute",
                    top: "185px", 
                    right: "20px",
                    zIndex: 30,
                    display: "flex",
                    flexDirection: "column",
                    gap: "4px",
                    backgroundColor: "rgba(30, 30, 30, 0.4)",
                    backdropFilter: "blur(6px)",
                    WebkitBackdropFilter: "blur(6px)",
                    padding: "4px",
                    borderRadius: "6px",
                    border: "1px solid rgba(255, 255, 255, 0.15)",
                    boxShadow: "0 4px 12px rgba(0, 0, 0, 0.2)",
                    alignItems: "center"
                }}
            >
                {/* Button Fit View */}
                <button
                    onClick={handleFitView}
                    title="Fit View"
                    style={{
                        width: "30px",
                        height: "30px",
                        backgroundColor: "transparent",
                        border: "none",
                        borderRadius: "4px",
                        color: "#ffffff",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        transition: "background-color 0.2s"
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "rgba(255, 255, 255, 0.15)"}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = "transparent"}
                >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M15 3h6v6M9 21H3v-6M21 9v12h-6M3 15V3h6" />
                    </svg>
                </button>

                {/* Dropdown Button Standard Views */}
                <div ref={dropdownRef} style={{ position: "relative", display: "flex", justifyContent: "center" }}>
                    <button
                        onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                        title="Standard Views"
                        style={{
                            width: "30px",
                            height: "30px",
                            backgroundColor: isDropdownOpen ? "rgba(255, 255, 255, 0.2)" : "transparent",
                            border: "none",
                            borderRadius: "4px",
                            color: "#ffffff",
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            transition: "background-color 0.2s"
                        }}
                        onMouseEnter={(e) => !isDropdownOpen && (e.currentTarget.style.backgroundColor = "rgba(255, 255, 255, 0.15)")}
                        onMouseLeave={(e) => !isDropdownOpen && (e.currentTarget.style.backgroundColor = "transparent")}
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                            <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                            <line x1="12" y1="22.08" x2="12" y2="12" />
                        </svg>
                    </button>

                    {/* Dropdown Menu Standard Views */}
                    {isDropdownOpen && (
                        <div
                            style={{
                                position: "absolute",
                                right: "38px",
                                top: "0",
                                backgroundColor: "rgba(25, 25, 25, 0.95)",
                                border: "1px solid rgba(255, 255, 255, 0.15)",
                                borderRadius: "4px",
                                padding: "4px 0",
                                display: "flex",
                                flexDirection: "column",
                                width: "110px",
                                boxShadow: "-2px 4px 10px rgba(0,0,0,0.4)"
                            }}
                        >
                            {VIEWS.map((view) => (
                                <button
                                    key={view}
                                    onClick={() => handleSetView(view)}
                                    style={{
                                        backgroundColor: "transparent",
                                        border: "none",
                                        color: "#e0e0e0",
                                        padding: "6px 12px",
                                        textAlign: "left",
                                        cursor: "pointer",
                                        fontSize: "13px",
                                        transition: "background-color 0.15s, color 0.15s"
                                    }}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.backgroundColor = "#2266cc";
                                        e.currentTarget.style.color = "#ffffff";
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.backgroundColor = "transparent";
                                        e.currentTarget.style.color = "#e0e0e0";
                                    }}
                                >
                                    {view}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                <div style={{ width: "18px", height: "1px", backgroundColor: "rgba(255,255,255,0.15)", margin: "4px 0" }} />

                {/* Button Orthographic Camera */}
                <button
                    onClick={() => handleSwitchCameraType("orthographic")}
                    title="Orthographic View"
                    style={{
                        width: "30px",
                        height: "30px",
                        backgroundColor: cameraType === "orthographic" ? "#2266cc" : "transparent",
                        border: "none",
                        borderRadius: "4px",
                        color: "#ffffff",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        transition: "background-color 0.2s"
                    }}
                    onMouseEnter={(e) => cameraType !== "orthographic" && (e.currentTarget.style.backgroundColor = "rgba(255, 255, 255, 0.15)")}
                    onMouseLeave={(e) => cameraType !== "orthographic" && (e.currentTarget.style.backgroundColor = "transparent")}
                >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="3" y="3" width="18" height="18" rx="2" />
                        <line x1="9" y1="3" x2="9" y2="21" />
                        <line x1="15" y1="3" x2="15" y2="21" />
                        <line x1="3" y1="9" x2="21" y2="9" />
                        <line x1="3" y1="15" x2="21" y2="15" />
                    </svg>
                </button>

                {/* Button Perspective Camera */}
                <button
                    onClick={() => handleSwitchCameraType("perspective")}
                    title="Perspective View"
                    style={{
                        width: "30px",
                        height: "30px",
                        backgroundColor: cameraType === "perspective" ? "#2266cc" : "transparent",
                        border: "none",
                        borderRadius: "4px",
                        color: "#ffffff",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        transition: "background-color 0.2s"
                    }}
                    onMouseEnter={(e) => cameraType !== "perspective" && (e.currentTarget.style.backgroundColor = "rgba(255, 255, 255, 0.15)")}
                    onMouseLeave={(e) => cameraType !== "perspective" && (e.currentTarget.style.backgroundColor = "transparent")}
                >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M4 19L8 5h8l4 14H4z" />
                        <path d="M8 5v14M16 5v14" />
                        <path d="M6 12h12" />
                    </svg>
                </button>
            </div>
        </div>
    );
}