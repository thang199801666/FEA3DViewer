import { useEffect, useRef, useState } from "react";

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
    GridActor,
    AmbientLightActor,
    DirectionalLightActor,
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
    sharedScene: any;
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
    const showRulerRef = useRef<boolean>(showRuler);

    const rulerRef = useRef<any>(null);
    const sceneControllerRef = useRef<any>(null);
    const cameraRef = useRef<any>(null);
    const interactorRef = useRef<any>(null);

    const otherControllerRef = useRef<any>(otherController);
    const isViewLinkedRef = useRef<boolean>(isViewLinked);

    const [isDropdownOpen, setIsDropdownOpen] = useState<boolean>(false);
    const [cameraType, setCameraType] = useState<"orthographic" | "perspective">("orthographic");
    const dropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => { otherControllerRef.current = otherController; }, [otherController]);
    useEffect(() => { isViewLinkedRef.current = isViewLinked; }, [isViewLinked]);
    useEffect(() => { showAxesRef.current = showAxes; }, [showAxes]);
    useEffect(() => { showGridRef.current = showGrid; }, [showGrid]);
    useEffect(() => { showRulerRef.current = showRuler; }, [showRuler]);

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
        if (rulerRef.current?.group) {
            rulerRef.current.group.visible = showRuler;
        }
        if (sceneControllerRef.current?.requestRender) {
            sceneControllerRef.current.requestRender();
        }
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

        let ambient = sharedScene.getObjectByName(AMBIENT) as any;
        if (!ambient) {
            ambient = new AmbientLightActor(0xffffff, ambientIntensity);
            ambient.name = AMBIENT;
            sharedScene.add(ambient);
        } else {
            ambient.intensity = ambientIntensity;
        }

        let directional = sharedScene.getObjectByName(DIRECTIONAL) as any;
        if (!directional) {
            directional = new DirectionalLightActor(0xffffff, directionalIntensity);
            directional.name = DIRECTIONAL;
            directional.setPosition?.(1, 1, 1);
            sharedScene.add(directional);
        } else {
            directional.intensity = directionalIntensity;
        }

        sceneControllerRef.current?.requestRender?.();
    }, [viewportIndex, sharedScene, ambientIntensity, directionalIntensity]);

    useEffect(() => {
        const container = containerRef.current;
        // FIXED: Clear guard statement right at the top so TypeScript knows container is not null
        if (!container || !sharedScene) return;

        let sceneController: any = null;

        const triadConfig = { position: "bottom-left", size: 120 };
        const padding = 20;

        // FIXED: Cast constructor object to any to permit the 'container' property
        const renderWindow = new RenderWindow({
            container,
            rendererParams: { 
                antialias: antialias || multiSamples > 1, 
                alpha: true,
                samples: multiSamples 
            } as any,
        } as any);
        
        const glRenderer = renderWindow.renderer;
        glRenderer.setClearColor(0x000000, 0);
        glRenderer.localClippingEnabled = true;

        sharedScene.background = null;

        const pushCameraToLinked = () => {
            if (sceneController?._applyingLinked) return;
            if (!isViewLinkedRef.current) return;
            otherControllerRef.current?.applyLinkedCamera?.(camera.getThreeCamera());
        };

        const camera = new Camera(renderWindow.domElement, {
            type: "orthographic",
            autoResize: false,
            autoClipping: false,
            target: [0, 0, 0],
            onChange: () => {
                sceneController?.updateClipping?.();
                sceneController?.requestRender?.();
                pushCameraToLinked();
            }
        } as any);
        cameraRef.current = camera;

        camera
            .setPosition(10, 10, 10)
            .setUp(0, 1, 0)
            .lookAt(0, 0, 0)
            .setLayerEnabled(0, true)
            .setLayerEnabled(viewportIndex, true)
            .syncFromThree();

        // FIXED: Cast constructor object to any to permit the 'addDefaultLights' property
        const vtkRenderer = new Renderer({ 
            scene: sharedScene as any, 
            camera: camera as any, 
            addDefaultLights 
        } as any);
        vtkRenderer.viewport = [0, 0, 1, 1];
        renderWindow.addRenderer(vtkRenderer);

        sceneController = new SceneController(camera.getThreeCamera() as any, null as any, sharedScene as any);
        sceneControllerRef.current = sceneController;

        sceneController.showCameraNav = true;
        sceneController.ToggleCameraNav = () => {
            sceneController.showCameraNav = !sceneController.showCameraNav;
        };

        sceneController.SetMultiSamples = (_samples: number) => {
            console.warn("[SceneController] Changing MultiSamples requires re-initializing the WebGL Context.");
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
            try {
                const destCam = camera.getThreeCamera() as any;
                destCam.position.copy(srcCam.position);
                destCam.quaternion.copy(srcCam.quaternion);
                destCam.up.copy(srcCam.up);
                if (destCam.isOrthographicCamera && srcCam.isOrthographicCamera) {
                    destCam.zoom = srcCam.zoom;
                }
                destCam.updateProjectionMatrix();
                destCam.updateMatrixWorld(true);
                (camera as any).setFromThree();
                sceneController.updateClipping?.();
                sceneController.requestRender?.();
            } finally {
                sceneController._applyingLinked = false;
            }
        };

        const makeGrid = (divisions: number, c1: number, c2: number, opacity: number, offset: number) => {
            const g = new GridActor({
                name: GRID_NAME,
                size: 2000,
                divisions,
                colorCenterLine: c1,
                colorGrid: c2,
                opacity,
                polygonOffset: offset,
            }).setLayer(viewportIndex);
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
        
        if ((ruler as any).group) {
            (ruler as any).group.visible = showRulerRef.current;
        }

        const applyRulerLayer = () => (ruler as any).group?.traverse((o: any) => o.layers.set(viewportIndex));
        applyRulerLayer();

        const triad = new OrientationTriadActor(glRenderer, {
            position: triadConfig.position,
            size: triadConfig.size,
        });

        const gizmo = new NavigationCube(glRenderer, container, camera as any, {
            position: "top-right",
            size: 150,
            animateSpeed: 0.15,
            dragRotateSpeed: 1,
            spriteScale: 0.4,
            onChange: () => {
                (camera as any).setFromThree?.();
                sceneController.updateClipping();
                renderWindow.render();
                pushCameraToLinked();
            },
            onTranslate: (delta: any) => {
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
        } as any);

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

        const style = new InteractorStyleOrbit(camera as any, {
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
        } as any);
        interactor.setInteractorStyle(style);
        sceneController.interactorStyle = style;

        const picker = new Picker({ filter: isSelectable as any });
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
            if (sceneController.requestRender) sceneController.requestRender();
            else renderWindow.render();
        };

        sceneController.AddToRenderer = (actor: any, { showContour = false } = {}) => {
            if (!actor) return;
            sceneController.scene.add(actor);
            sceneController.updateClipping();
            sceneController.fitView();
            sceneController.PlotContour(showContour);
        };

        function resize() {
            const w = container?.clientWidth ?? 0, h = container?.clientHeight ?? 0;
            if (!w || !h) return;
            glRenderer.setSize(w, h, false);
            camera.setAspect(w / h);
            if (ruler) {
                (ruler as any).update(w, h, camera.getThreeCamera());
            }
        }

        sceneController.onResize = resize;
        onControllerReady?.(sceneController);

        const resizeObserver = new ResizeObserver(resize);
        resizeObserver.observe(container);

        let rafId: number;
        let lastGridMajorScale = Number.NaN;
        let lastGridMinorOpacity = Number.NaN;
        function animate() {
            rafId = requestAnimationFrame(animate);
            const activeCam = camera.getThreeCamera();

            if (showGridRef.current) {
                majorGrid.visible = minorGrid.visible = true;
                const zoom = (activeCam as any).zoom || 1;
                const majorScale = Math.pow(10, Math.floor(Math.log10(1 / zoom)));
                const fractional = (1 / zoom) / majorScale;
                const minorOpacity = Math.max(0, Math.min(0.3, (1 - fractional) * 1.5));

                if (majorScale !== lastGridMajorScale) {
                    majorGrid.setGridScale(majorScale);
                    minorGrid.setGridScale(majorScale);
                    lastGridMajorScale = majorScale;
                }
                if (minorOpacity !== lastGridMinorOpacity) {
                    minorGrid.setOpacity(minorOpacity);
                    lastGridMinorOpacity = minorOpacity;
                }
            } else {
                majorGrid.visible = minorGrid.visible = false;
            }

            renderWindow.render();
            activeCam.updateMatrixWorld(true);

            if (showAxesRef.current) { triad.update(activeCam); triad.render(); }
            if (sceneController.showCameraNav) { gizmo.update(activeCam); gizmo.render(); }
            
            if (showRulerRef.current && rulerRef.current?.group) {
                (ruler as any).update(container?.clientWidth ?? 0, container?.clientHeight ?? 0, activeCam);
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
                (g as any).dispose?.();
            }

            if (container.contains(textBlockContainer)) container.removeChild(textBlockContainer);

            renderWindow.dispose();
            sceneControllerRef.current = null;
            cameraRef.current = null;
            interactorRef.current = null;
            rulerRef.current = null;
        };
    }, [onControllerReady, sharedScene, viewportIndex, antialias, multiSamples, addDefaultLights]);

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

        const oldPos = camWrapper.getPosition?.([0, 0, 0]) ?? [0, 0, 0];
        const targetState = camWrapper.state?.target;
        const oldTarget = targetState
            ? [targetState.x, targetState.y, targetState.z]
            : [0, 0, 0];

        if (Math.hypot(oldPos[0] - oldTarget[0], oldPos[1] - oldTarget[1], oldPos[2] - oldTarget[2]) < 0.001) {
            oldPos[0] = oldTarget[0] + 10;
            oldPos[1] = oldTarget[1] + 10;
            oldPos[2] = oldTarget[2] + 10;
        }

        camWrapper.switchType(type);
        
        camWrapper.setPosition?.(oldPos[0], oldPos[1], oldPos[2]);
        const newThreeCam = camWrapper.getThreeCamera?.();
        if (!newThreeCam) return;
        
        controller.camera = newThreeCam;

        const w = containerRef.current.clientWidth;
        const h = containerRef.current.clientHeight;
        camWrapper.setAspect(w / h);

        if (type === "perspective") {
            camWrapper.setClippingRange(0.1, 5000);
            camWrapper.lookAt?.(oldTarget[0], oldTarget[1], oldTarget[2]);
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
        const target = [0, 0, 0];
        const currentPos = cam.getPosition?.([0, 0, 0]) ?? [0, 0, 0];
        const distance = Math.hypot(currentPos[0], currentPos[1], currentPos[2]) || 15;

        let newPos = [0, 0, 0];
        let newUp = [0, 1, 0];

        switch (viewDirection) {
            case "Front":  
                newPos = [0, 0, distance]; 
                newUp = [0, 1, 0];
                break;
            case "Back":   
                newPos = [0, 0, -distance]; 
                newUp = [0, 1, 0];
                break;
            case "Top":    
                newPos = [0, distance, 0]; 
                newUp = [0, 0, -1]; 
                break;
            case "Bottom": 
                newPos = [0, -distance, 0]; 
                newUp = [0, 0, 1];  
                break;
            case "Left":   
                newPos = [-distance, 0, 0]; 
                newUp = [0, 1, 0];
                break;
            case "Right":  
                newPos = [distance, 0, 0]; 
                newUp = [0, 1, 0];
                break;
            case "Isometric":
                const iso = distance / Math.sqrt(3);
                newPos = [iso, iso, iso];
                newUp = [-1 / Math.sqrt(6), 2 / Math.sqrt(6), -1 / Math.sqrt(6)]; 
                break;
            default: return;
        }

        cam.setPosition?.(newPos[0], newPos[1], newPos[2]);
        cam.setUp?.(newUp[0], newUp[1], newUp[2]);
        cam.lookAt?.(target[0], target[1], target[2]);
        cam.updateMatrixWorld?.(true);
        cam.setFromThree?.();

        controller.updateClipping?.();
        if (typeof controller.fitView === "function") {
            controller.fitView();
        }
        controller.requestRender?.();
        
        const linkedCam = cam.getThreeCamera?.();
        if (isViewLinkedRef.current && linkedCam) {
            otherControllerRef.current?.applyLinkedCamera?.(linkedCam);
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
                    <svg
                        width={24}
                        height={24}
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    >
                        <path d="M4 8V4H8" />
                        <path d="M16 4H20V8" />
                        <path d="M20 16V20H16" />
                        <path d="M8 20H4V16" />
                        <rect x={9} y={9} width={6} height={6} rx={1} />
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
