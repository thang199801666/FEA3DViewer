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
    MeasurementTool,
    Camera,
    GridActor,
    AmbientLightActor,
    DirectionalLightActor,
    applyVTKCameraApi,
    NAV_STYLE,
    RUBBER_BAND_MODE,
    WarpFilter,
    DataArray,
    polyDataFromExtracted,
} from "../../threejsVTK/src";

// App controllers (Not part of the library)
import SceneController from "../controllers/SceneController";
import { PickingController as AppPickingController } from "../controllers/PickingController";
import TextBlockController from "../controllers/TextBlockController";

applyVTKCameraApi(Camera);

const GRID_NAME = "system_grid";

// vtkGeometryFilter-style face cancellation at PolyData topology level. This
// runs before triangulation, so shared quad faces are removed even when two
// neighboring cells would triangulate that quad along different diagonals.
function extractBoundaryFacePolyData(input: any) {
    if (!input?.polys || input.polys.length === 0) return input;
    const records = new Map<string, { count: number; face: number[]; index: number }>();
    let index = 0;
    for (const cell of input.polys) {
        const face = Array.from(cell as Iterable<number>);
        const key = [...face].sort((a, b) => a - b).join("_");
        const record = records.get(key);
        if (record) record.count++;
        else records.set(key, { count: 1, face, index });
        index++;
    }
    if (![...records.values()].some((record) => record.count > 1)) return input;

    const kept = [...records.values()].filter((record) => record.count % 2 === 1);
    const output = input.clone();
    output.setPolys(kept.map((record) => record.face));
    const sourceMap = input.userData?.polySourceCellMap;
    output.userData = { ...input.userData };
    if (sourceMap) {
        output.userData.polySourceCellMap = Int32Array.from(kept.map((record) => sourceMap[record.index]));
    }
    output.userData.exteriorSurface = true;
    return output;
}

const RUBBER_BAND_STYLES: Record<string | number, { border: string; background: string }> = {
    [RUBBER_BAND_MODE.CROSSING]: { border: "1.5px solid #4da3ff", background: "rgba(77, 163, 255, 0.15)" },
    [RUBBER_BAND_MODE.WINDOW]:   { border: "1.5px dashed #35c159", background: "rgba(53, 193, 89, 0.15)" },
};

const VIEWS = ["Front", "Back", "Top", "Bottom", "Left", "Right", "Isometric"] as const;
type ViewDirection = typeof VIEWS[number];

type FieldComponentOption = { key: string; label: string; component: number; derived?: "mises" };
type ContourFieldOption = { name: string; components: FieldComponentOption[] };

function fieldComponents(name: string, count: number): FieldComponentOption[] {
    if (count <= 1) return [{ key: "0", label: name, component: 0 }];
    const upper = name.toUpperCase();
    if (count === 3 && ["U", "V", "A", "RF", "CF"].includes(upper)) {
        return [0, 1, 2].map((component) => ({ key: `${component}`, label: `${name}${component + 1}`, component }))
            .concat([{ key: "magnitude", label: `${name}_Magnitude`, component: -1 }]);
    }
    if (count === 6 && (upper.startsWith("S") || upper === "PE" || upper === "E" || upper === "LE")) {
        const labels = ["11", "22", "33", "12", "23", "13"];
        return labels.map((suffix, component) => ({ key: `${component}`, label: `${name}${suffix}`, component }))
            .concat([{ key: "mises", label: `${name}_Mises`, component: 0, derived: "mises" }]);
    }
    if (count === 9 && upper.startsWith("S")) {
        const labels = ["11", "12", "13", "21", "22", "23", "31", "32", "33"];
        return labels.map((suffix, component) => ({ key: `${component}`, label: `${name}${suffix}`, component }))
            .concat([{ key: "mises", label: `${name}_Mises`, component: 0, derived: "mises" }]);
    }
    return Array.from({ length: count }, (_, component) => ({
        key: `${component}`, label: `${name}${component + 1}`, component
    })).concat([{ key: "magnitude", label: `${name}_Magnitude`, component: -1 }]);
}

function defaultFieldComponent(field: ContourFieldOption | undefined): FieldComponentOption | undefined {
    if (!field) return undefined;
    const hasName = (component: FieldComponentOption, name: string) =>
        component.key.toLowerCase() === name
        || component.label.toLowerCase().includes(name);
    return field.components.find((component) => hasName(component, "mises"))
        ?? field.components.find((component) => hasName(component, "magnitude"))
        ?? field.components[0];
}

function collectContourFields(scene: any): ContourFieldOption[] {
    const fields = new Map<string, number>();
    scene?.traverse?.((obj: any) => {
        if (!obj?.isActor) return;
        const data = obj.userData.__undeformedInput ?? obj.mapper?.input;
        const pointData = data?.pointData;
        for (const name of pointData?.getArrayNames?.() ?? []) {
            if (name.startsWith("__derived_")) continue;
            const array = pointData.getArray(name);
            if (array?.getNumberOfTuples?.() === data.getNumberOfPoints?.()) {
                fields.set(name, Math.max(fields.get(name) ?? 0, array.numberOfComponents));
            }
        }
    });
    return [...fields].map(([name, count]) => ({ name, components: fieldComponents(name, count) }));
}

function addMisesArray(data: any, sourceName: string): string | null {
    const source = data?.pointData?.getArray?.(sourceName);
    if (!source || (source.numberOfComponents !== 6 && source.numberOfComponents !== 9)) return null;
    const derivedName = `__derived_${sourceName}_Mises`;
    if (data.pointData.getArray(derivedName)) return derivedName;
    const values = new Float32Array(source.getNumberOfTuples());
    for (let i = 0; i < values.length; i++) {
        let s11, s22, s33, s12, s23, s13;
        if (source.numberOfComponents === 6) {
            s11 = source.getComponent(i, 0); s22 = source.getComponent(i, 1); s33 = source.getComponent(i, 2);
            s12 = source.getComponent(i, 3); s23 = source.getComponent(i, 4); s13 = source.getComponent(i, 5);
        } else {
            s11 = source.getComponent(i, 0); s22 = source.getComponent(i, 4); s33 = source.getComponent(i, 8);
            s12 = (source.getComponent(i, 1) + source.getComponent(i, 3)) * 0.5;
            s23 = (source.getComponent(i, 5) + source.getComponent(i, 7)) * 0.5;
            s13 = (source.getComponent(i, 2) + source.getComponent(i, 6)) * 0.5;
        }
        values[i] = Math.sqrt(0.5 * ((s11-s22)**2 + (s22-s33)**2 + (s33-s11)**2) + 3 * (s12**2 + s23**2 + s13**2));
    }
    data.pointData.addArray(new DataArray(derivedName, values, 1));
    return derivedName;
}

interface RubberBandSelectionOptions {
    additive: boolean;
    mode: any;
    rect?: { x: number; y: number; width: number; height: number } | null;
}

function applyRubberBandSelection(pc: any, selected: any[], { additive, mode, rect }: RubberBandSelectionOptions): boolean {
    if (!pc) return false;
    if (typeof pc.selectObjects === "function") { pc.selectObjects(selected, { additive, mode, rect }); return true; }
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
    selectionFeatureAngle?: number;
    measurementMode?: "distance" | "angle" | null;
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
    selectionMode = "Part",
    selectionFeatureAngle = 20,
    measurementMode = null
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
    const [contourFields, setContourFields] = useState<ContourFieldOption[]>([]);
    const [selectedField, setSelectedField] = useState<string>("");
    const [selectedComponent, setSelectedComponent] = useState<string>("");
    const dropdownRef = useRef<HTMLDivElement>(null);
    const scaleControlRef = useRef<HTMLDivElement>(null);
    const opacityControlRef = useRef<HTMLDivElement>(null);
    const [isScaleOpen, setIsScaleOpen] = useState(false);
    const [deformationScale, setDeformationScale] = useState(1);
    const [deformationScaleText, setDeformationScaleText] = useState("1");
    const [globalOpacity, setGlobalOpacity] = useState(1);
    const [isOpacityOpen, setIsOpacityOpen] = useState(false);

    useEffect(() => { otherControllerRef.current = otherController; }, [otherController]);
    useEffect(() => { isViewLinkedRef.current = isViewLinked; }, [isViewLinked]);
    useEffect(() => { showAxesRef.current = showAxes; }, [showAxes]);
    useEffect(() => { showGridRef.current = showGrid; }, [showGrid]);
    useEffect(() => { showRulerRef.current = showRuler; }, [showRuler]);

    useEffect(() => {
        const refresh = () => {
            const next = collectContourFields(sharedScene);
            setContourFields(next);
            setSelectedField(next[0]?.name ?? "");
            setSelectedComponent(defaultFieldComponent(next[0])?.key ?? "");
        };
        refresh();
        window.addEventListener("fea-field-data-changed", refresh);
        return () => window.removeEventListener("fea-field-data-changed", refresh);
    }, [sharedScene]);

    useEffect(() => {
        const syncScale = (event: Event) => {
            const scale = (event as CustomEvent<{ scale?: number }>).detail?.scale;
            if (!Number.isFinite(scale)) return;
            setDeformationScale(scale!);
            setDeformationScaleText(`${scale}`);
            if (sceneControllerRef.current) sceneControllerRef.current.deformationScaleFactor = scale;
        };
        window.addEventListener("fea-deformation-scale-changed", syncScale);
        return () => window.removeEventListener("fea-deformation-scale-changed", syncScale);
    }, []);

    useEffect(() => {
        const syncOpacity = (event: Event) => {
            const opacity = (event as CustomEvent<{ opacity?: number }>).detail?.opacity;
            if (!Number.isFinite(opacity)) return;
            setGlobalOpacity(opacity!);
            if (sceneControllerRef.current) sceneControllerRef.current.globalOpacity = opacity;
        };
        window.addEventListener("fea-global-opacity-changed", syncOpacity);
        return () => window.removeEventListener("fea-global-opacity-changed", syncOpacity);
    }, []);

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsDropdownOpen(false);
            }
            if (scaleControlRef.current && !scaleControlRef.current.contains(event.target as Node)) {
                setIsScaleOpen(false);
            }
            if (opacityControlRef.current && !opacityControlRef.current.contains(event.target as Node)) {
                setIsOpacityOpen(false);
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
        sceneControllerRef.current?.pickingController?.setSelectionFeatureAngle(selectionFeatureAngle);
    }, [selectionFeatureAngle]);

    useEffect(() => {
        sceneControllerRef.current?.measurementTool?.setMode(measurementMode);
    }, [measurementMode]);

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
            enableZoomWindow: true,
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
            onRubberBandSelect: (selected: any[], { mode, additive, rect }: RubberBandSelectionOptions) => {
                applyRubberBandSelection(sceneController.pickingController, selected, { additive, mode, rect });
                sceneController.requestRender?.();
            },
        } as any);
        interactor.setInteractorStyle(style);
        sceneController.interactorStyle = style;

        const picker = new Picker({ filter: isSelectable as any });
        interactor.setPicker(picker);
        interactor.initialize();

        const pickingController = new AppPickingController(sceneController);
        pickingController.setSelectionFeatureAngle(selectionFeatureAngle);
        pickingController.setSelectionMode(selectionMode);
        sceneController.pickingController = pickingController;
        const syncTreeSelection = (actors: any[]) => {
            window.dispatchEvent(new CustomEvent("fea-scene-selection-changed", {
                detail: {
                    actors,
                    activeActor: pickingController.getSelectedActor?.() ?? actors.at(-1) ?? null,
                    viewportIndex,
                }
            }));
        };
        pickingController.on("selectionchange", syncTreeSelection);

        const measurementTool = new MeasurementTool({
            scene: sharedScene,
            pickingController,
            requestRender: () => sceneController.requestRender?.(),
        });
        measurementTool.setMode(measurementMode);
        sceneController.measurementTool = measurementTool;
        sceneController.setMeasurementMode = (mode: "distance" | "angle" | null) => measurementTool.setMode(mode);
        sceneController.clearMeasurements = () => measurementTool.clear();

        const scalarBar = new ScalarBarActor({
            anchor: "BottomRight", range: [0, 1], numberOfColors: 12, precision: 3,
            textColor: "#f0f0f0", showOutline: true, outlineColor: "#ffffff",
        }).attachTo(container);
        scalarBar.setVisible(false);
        sceneController.scalarBar = scalarBar;
        sceneController.updateClipping();

        sceneController.PlotContour = (visibleState: boolean) => {
            if (!sceneController.scene) return;
            sceneController.deformationVisible = false;

            let lastActor: any = null;
            sceneController.scene.traverse((child: any) => {
                if (child.isActor && typeof child.setScalarVisibility === "function") {
                    const actor = child;
                    const original = actor.userData.__undeformedInput;
                    if (original && actor.mapper?.input !== original) {
                        actor.mapper.setInputData(original);
                        actor.userData.__deformationActive = false;
                        actor.update?.();
                    }
                    const canShowSelectedField = actor.userData.__excludeFromContour !== true
                        && actor.userData.__hasSelectedContourField !== false;
                    actor.setScalarVisibility(visibleState && canShowSelectedField);
                    if (canShowSelectedField) lastActor = child;
                }
            });

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
                    scalarBar.show({
                        title: sceneController.selectedContourLabel || lastActor.name || "Contour",
                        range: sceneController.selectedContourRange ?? range,
                        numberOfColors: 12,
                        anchor: "TopLeft"
                    });
                } else {
                    scalarBar.setVisible?.(false);
                }
            }
            if (sceneController.requestRender) sceneController.requestRender();
            else renderWindow.render();
        };

        sceneController.SetContourField = (fieldName: string, componentKey: string) => {
            const matches: Array<{ actor: any; colorName: string; colorComponent: number; descriptor: FieldComponentOption; range: number[] }> = [];
            let selectedLabel = fieldName;

            const actors: any[] = [];
            sceneController.scene.traverse((object: any) => object?.isActor && actors.push(object));
            for (const actor of actors) {
                if (!actor.isActor || !actor.mapper?.input) continue;
                const current = actor.mapper.input;
                const source = current.pointData?.getArray?.(fieldName);
                const descriptor = source
                    ? fieldComponents(fieldName, source.numberOfComponents).find((c) => c.key === componentKey)
                    : null;

                if (!source || !descriptor) {
                    actor.userData.__hasSelectedContourField = false;
                    actor.setScalarVisibility?.(false);
                    continue;
                }

                let colorName = fieldName;
                let colorComponent = descriptor.component;
                if (descriptor.derived === "mises") {
                    const original = actor.userData.__undeformedInput;
                    if (original) addMisesArray(original, fieldName);
                    const deformed = actor.userData.__deformationInput;
                    if (deformed && deformed !== original) addMisesArray(deformed, fieldName);
                    colorName = addMisesArray(current, fieldName) ?? fieldName;
                    colorComponent = 0;
                }

                const colorArray = current.pointData.getArray(colorName);
                if (!colorArray) {
                    actor.userData.__hasSelectedContourField = false;
                    actor.setScalarVisibility?.(false);
                    continue;
                }
                actor.userData.__hasSelectedContourField = true;
                matches.push({
                    actor,
                    colorName,
                    colorComponent,
                    descriptor,
                    range: colorArray.getRange(colorComponent),
                });
                selectedLabel = descriptor.label;
            }

            if (matches.length) {
                const range = matches.reduce(
                    (combined, match) => [Math.min(combined[0], match.range[0]), Math.max(combined[1], match.range[1])],
                    [Infinity, -Infinity]
                );
                for (const { actor, colorName, colorComponent } of matches) {
                    actor.mapper.setColorBy(colorName, colorComponent);
                    actor.mapper.setScalarRange(range[0], range[1]);
                    actor.setScalarVisibility?.(true);
                    actor.update?.();
                }
                sceneController.selectedContourLabel = selectedLabel;
                sceneController.selectedContourRange = range;
                scalarBar.show({ title: selectedLabel, range, numberOfColors: 12, anchor: "TopLeft" });
                window.dispatchEvent(new CustomEvent("fea-contour-state", { detail: { visible: true } }));
            } else {
                sceneController.selectedContourRange = null;
                scalarBar.setVisible?.(false);
            }
            sceneController.requestRender?.();
            if (matches.length) {
                const deformationApplied = sceneController.PlotDeformedContour?.(true) ?? false;
                if (!deformationApplied) {
                    for (const { actor } of matches) actor.userData.__fitAfterPipelineUpdate = false;
                }
            }
            return matches.length > 0;
        };

        sceneController.PlotDeformedContour = (visibleState: boolean) => {
            if (!sceneController.scene) return false;

            let foundVector = false;
            let lastDeformedActor: any = null;
            let lastContourActor: any = null;
            const actors: any[] = [];
            sceneController.scene.traverse((object: any) => object?.isActor && actors.push(object));
            for (const actor of actors) {
                if (!actor.isActor || !actor.mapper?.input) continue;
                const hasSelectedField = actor.userData.__hasSelectedContourField !== false;
                if (hasSelectedField) lastContourActor = actor;

                const original = actor.userData.__undeformedInput ?? actor.mapper.input;
                actor.userData.__undeformedInput = original;
                let output = original;
                const sourceOriginal = actor.userData.__sourceInput ?? original;
                let sourceOutput = sourceOriginal;

                if (visibleState) {
                    const pointData = original.pointData ?? original.getPointData?.();
                    const names: string[] = pointData?.getArrayNames?.() ?? [];
                    const vectorName = ["Displacement", "U"].find((preferred) => {
                        const actual = names.find((name) => name.toLowerCase() === preferred.toLowerCase());
                        return actual && pointData.getArray(actual)?.numberOfComponents === 3;
                    });
                    const actualName = vectorName
                        ? names.find((name) => name.toLowerCase() === vectorName.toLowerCase())
                        : null;
                    if (actualName) {
                        if (actor.hasWorkerDataset?.()) {
                            foundVector = true;
                            if (hasSelectedField) lastDeformedActor = actor;
                            actor.userData.__deformationActive = true;
                            actor.userData.__deformationVectorName = actualName;
                            void actor.updateFromWorker([{
                                type: "warp",
                                arrayName: actualName,
                                scaleFactor: sceneController.deformationScaleFactor ?? 1.0,
                            }]).then((workerOutput: any) => {
                                if (!workerOutput) return;
                                actor.userData.__deformationInput = workerOutput;
                                actor.setScalarVisibility?.(hasSelectedField);
                                sceneController.updateClipping?.();
                                if (actor.userData.__fitAfterPipelineUpdate) {
                                    actor.userData.__fitAfterPipelineUpdate = false;
                                    sceneController.fitView?.();
                                }
                                sceneController.requestRender?.();
                                window.dispatchEvent(new CustomEvent("fea-deformation-scale-changed"));
                            }).catch((error: unknown) => {
                                console.error("Worker deformation failed", error);
                            });
                            continue;
                        }
                        output = new WarpFilter()
                            .setInputData(original)
                            .setVectorArrayName(actualName)
                            .setScaleFactor(sceneController.deformationScaleFactor ?? 1.0)
                            .getOutputData();
                        // Keep a deformed copy of the complete element-face
                        // data for section cuts. The render input contains
                        // only the exterior shell and cannot interpolate a
                        // scalar field correctly through a cut interior.
                        if (sourceOriginal !== original) {
                            sourceOutput = new WarpFilter()
                                .setInputData(sourceOriginal)
                                .setVectorArrayName(actualName)
                                .setScaleFactor(sceneController.deformationScaleFactor ?? 1.0)
                                .getOutputData();
                        } else {
                            sourceOutput = output;
                        }
                        foundVector = true;
                        if (hasSelectedField) lastDeformedActor = actor;
                    }
                } else {
                    actor.invalidateWorkerPipeline?.();
                }

                actor.userData.__deformationInput = output;
                actor.userData.__deformationSourceInput = sourceOutput;
                actor.userData.__deformationActive = visibleState && output !== original;
                actor.mapper.setInputData(output);
                actor.setScalarVisibility?.(visibleState && hasSelectedField);
                actor.update?.();
            }

            if (visibleState && lastDeformedActor) {
                const mapper = lastDeformedActor.mapper;
                const range = mapper?.getEffectiveScalarRange?.() ?? [0, 1];
                scalarBar.show({
                    title: sceneController.selectedContourLabel || lastDeformedActor.name || "Def Contour",
                    range: sceneController.selectedContourRange ?? range,
                    numberOfColors: 12,
                    anchor: "TopLeft"
                });
            } else if (visibleState && lastContourActor) {
                scalarBar.show({
                    title: sceneController.selectedContourLabel || lastContourActor.name || "Contour",
                    range: sceneController.selectedContourRange ?? lastContourActor.mapper?.getEffectiveScalarRange?.() ?? [0, 1],
                    numberOfColors: 12,
                    anchor: "TopLeft"
                });
            } else {
                scalarBar.setVisible?.(false);
            }
            if (visibleState && !foundVector) {
                console.warn('[Scene] Def Contour requires a 3-component point vector named "Displacement" or "U".');
            }
            sceneController.deformationVisible = visibleState && foundVector;
            window.dispatchEvent(new CustomEvent("fea-contour-state", {
                detail: { visible: visibleState, deformed: sceneController.deformationVisible }
            }));
            sceneController.requestRender?.();
            return foundVector;
        };

        sceneController.deformationScaleFactor = 1.0;
        sceneController.deformationVisible = false;
        sceneController.SetDeformationScale = (value: number) => {
            const scale = Math.min(100, Math.max(1, Number(value) || 1));
            sceneController.deformationScaleFactor = scale;
            if (sceneController.deformationVisible) {
                sceneController.PlotDeformedContour(true);
            }
            window.dispatchEvent(new CustomEvent("fea-deformation-scale-changed", { detail: { scale } }));
            return scale;
        };

        sceneController.AddToRenderer = (actor: any, { showContour = false } = {}) => {
            if (!actor) return;
            actor.setOpacity?.(sceneController.globalOpacity ?? 1);
            if (actor.mapper?.input) {
                const sourceInput = actor.mapper.input;
                const boundaryInput = extractBoundaryFacePolyData(sourceInput);
                if (boundaryInput !== sourceInput) {
                    actor.mapper.setInputData(boundaryInput);
                    actor.update?.();
                }
                // Actor has already performed vtkGeometryFilter-like exterior
                // extraction while building its render geometry. Convert that
                // exact retained shell back to PolyData and make it the only
                // downstream input for contour, deformation and section cuts.
                const exteriorInput = actor.surface?.geometry
                    ? polyDataFromExtracted(boundaryInput, actor.surface.geometry)
                    : boundaryInput;
                actor.userData.__sourceInput = sourceInput;
                actor.userData.__exteriorInput = exteriorInput;
                actor.userData.__undeformedInput = exteriorInput;
                if (exteriorInput !== sourceInput) {
                    actor.mapper.setInputData(exteriorInput);
                    actor.update?.();
                }
            }
            sceneController.scene.add(actor);
            window.dispatchEvent(new Event("fea-field-data-changed"));
            const firstField = collectContourFields(sceneController.scene)[0];
            const firstComponent = defaultFieldComponent(firstField);
            if (firstField && firstComponent) {
                actor.userData.__fitAfterPipelineUpdate = true;
                sceneController.SetContourField(firstField.name, firstComponent.key);
            } else {
                sceneController.PlotContour(showContour);
            }
            // SetContourField/PlotDeformedContour may rebuild the actor
            // synchronously. Fit only after that final geometry exists.
            sceneController.updateClipping();
            sceneController.fitView();
            if (!actor.hasWorkerDataset?.()) actor.userData.__fitAfterPipelineUpdate = false;
        };

        function resize() {
            const w = container?.clientWidth ?? 0, h = container?.clientHeight ?? 0;
            if (!w || !h) return;
            glRenderer.setSize(w, h, true);
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
        const renderOverlays = () => {
            const activeCam = camera.getThreeCamera();
            activeCam.updateMatrixWorld(true);

            // Keep every overlay in the same composite render as the model.
            // Wheel/drag handlers can render immediately between animation
            // frames; drawing widgets here prevents those renders erasing them.
            activeCam.userData.focalPoint = camera.state.target;
            activeCam.userData.focalDistance = camera.state.distance;

            if (showAxesRef.current) { triad.update(activeCam); triad.render(); }
            if (sceneController.showCameraNav) { gizmo.update(activeCam); gizmo.render(); }

            if (showRulerRef.current && rulerRef.current?.group) {
                (ruler as any).update(container?.clientWidth ?? 0, container?.clientHeight ?? 0, activeCam);
                ruler.render();
            }
            measurementTool.update(activeCam, container?.clientHeight ?? 0);
        };
        const removeAfterRender = renderWindow.addAfterRenderCallback(renderOverlays);

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
        }
        animate();

        return () => {
            cancelAnimationFrame(rafId);
            removeAfterRender();
            resizeObserver.disconnect();

            style.dispose();
            camera.dispose();
            interactor.dispose();
            rubberBandEl.remove();
            measurementTool.dispose();
            pickingController.off("selectionchange", syncTreeSelection);
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

        camWrapper.switchType(type);
        const newThreeCam = camWrapper.getThreeCamera?.();
        if (!newThreeCam) return;
        
        controller.camera = newThreeCam;

        const w = containerRef.current.clientWidth;
        const h = containerRef.current.clientHeight;
        camWrapper.setAspect(w / h);

        if (type === "perspective") {
            camWrapper.setClippingRange(0.1, 5000);
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

    const activeField = contourFields.find((field) => field.name === selectedField) ?? null;
    const handleFieldChange = (fieldName: string) => {
        const field = contourFields.find((item) => item.name === fieldName);
        const component = defaultFieldComponent(field)?.key ?? "";
        setSelectedField(fieldName);
        setSelectedComponent(component);
        if (fieldName && component) sceneControllerRef.current?.SetContourField?.(fieldName, component);
    };
    const handleComponentChange = (component: string) => {
        setSelectedComponent(component);
        if (selectedField && component) sceneControllerRef.current?.SetContourField?.(selectedField, component);
    };
    const commitDeformationScale = (value: number) => {
        const scale = Math.min(100, Math.max(1, Number.isFinite(value) ? value : 1));
        setDeformationScale(scale);
        setDeformationScaleText(`${scale}`);
        sceneControllerRef.current?.SetDeformationScale?.(scale);
    };
    const applyGlobalOpacity = (value: number) => {
        const opacity = Math.round(Math.max(0, Math.min(1, Number.isFinite(value) ? value : 1)) / 0.05) * 0.05;
        setGlobalOpacity(opacity);
        if (sceneControllerRef.current) sceneControllerRef.current.globalOpacity = opacity;
        sharedScene.traverse((actor: any) => actor?.isActor && actor.setOpacity?.(opacity));
        sceneControllerRef.current?.requestRender?.();
        otherControllerRef.current?.requestRender?.();
        window.dispatchEvent(new CustomEvent("fea-global-opacity-changed", { detail: { opacity } }));
    };

    return (
        <div
            className="scene-container"
            style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}
        >
            <div
                id={`Field_Data_Container${viewportIndex > 1 ? `_${viewportIndex}` : ""}`}
                className="Field_Data_Container"
                style={{
                    height: 32, minHeight: 32, boxSizing: "border-box",
                    zIndex: 45, display: "flex", alignItems: "center", justifyContent: "flex-start", gap: 6,
                    padding: "2px 10px", background: "linear-gradient(180deg, #f4f6f8 0%, #e4e8ec 100%)",
                    borderBottom: "1px solid #a7afb8", color: "#20242a",
                    font: "12px Arial, sans-serif", whiteSpace: "nowrap"
                }}
            >
                <label htmlFor={`field-${viewportIndex}`} style={{ fontWeight: 600, color: "#4a5562", fontSize: 11 }}>Field</label>
                <select
                    id={`field-${viewportIndex}`}
                    value={selectedField}
                    onChange={(event) => handleFieldChange(event.target.value)}
                    disabled={!contourFields.length}
                    style={{
                        width: 109, height: 26, boxSizing: "border-box", padding: "0 8px",
                        border: "1px solid #a2abb5", borderRadius: 6, outline: "none",
                        background: "linear-gradient(180deg, #fff 0%, #f7f8fa 100%)", color: "#26313d",
                        boxShadow: "0 1px 2px rgba(25, 35, 45, .08)", fontSize: 12, cursor: "pointer"
                    }}
                >
                    {!contourFields.length && <option value="">No field data</option>}
                    {contourFields.map((field) => <option key={field.name} value={field.name}>{field.name}</option>)}
                </select>
                <label htmlFor={`component-${viewportIndex}`} style={{ fontWeight: 600, color: "#4a5562", fontSize: 11 }}>Component</label>
                <select
                    id={`component-${viewportIndex}`}
                    value={selectedComponent}
                    onChange={(event) => handleComponentChange(event.target.value)}
                    disabled={!activeField}
                    style={{
                        width: 124, height: 26, boxSizing: "border-box", padding: "0 8px",
                        border: "1px solid #a2abb5", borderRadius: 6, outline: "none",
                        background: "linear-gradient(180deg, #fff 0%, #f7f8fa 100%)", color: "#26313d",
                        boxShadow: "0 1px 2px rgba(25, 35, 45, .08)", fontSize: 12, cursor: "pointer"
                    }}
                >
                    {!activeField && <option value="">No component</option>}
                    {activeField?.components.map((component) => (
                        <option key={component.key} value={component.key}>{component.label}</option>
                    ))}
                </select>
                <div ref={scaleControlRef} style={{ position: "relative" }}>
                    <div
                        title="Deformation scale factor"
                        onClick={() => setIsScaleOpen((open) => !open)}
                        style={{
                            width: 58, height: 26, boxSizing: "border-box", display: "flex", alignItems: "center",
                            border: isScaleOpen ? "1px solid #3978c5" : "1px solid #a2abb5", borderRadius: 6,
                            background: "linear-gradient(180deg, #fff 0%, #f7f8fa 100%)", cursor: "pointer",
                            boxShadow: isScaleOpen ? "0 0 0 2px rgba(57,120,197,.16)" : "0 1px 2px rgba(25,35,45,.08)"
                        }}
                    >
                        <input
                            aria-label="Deformation scale"
                            value={deformationScaleText}
                            onClick={(event) => event.stopPropagation()}
                            onFocus={() => setIsScaleOpen(true)}
                            onChange={(event) => setDeformationScaleText(event.target.value)}
                            onBlur={() => commitDeformationScale(Number(deformationScaleText))}
                            onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                    commitDeformationScale(Number(deformationScaleText));
                                    event.currentTarget.blur();
                                }
                            }}
                            style={{ width: 27, marginLeft: 3, padding: 0, border: 0, outline: 0, textAlign: "right", background: "transparent", color: "#26313d", font: "600 12px Arial" }}
                        />
                        <span style={{ width: 24, textAlign: "center", color: "#5e6975", fontSize: 10 }}>x ▾</span>
                    </div>
                    {isScaleOpen && (
                        <div style={{
                            position: "absolute", top: 29, right: 0, zIndex: 60, width: 173,
                            boxSizing: "border-box", padding: "4px 6px", background: "#fff", border: "1px solid #a2abb5", borderRadius: 7,
                            boxShadow: "0 8px 22px rgba(28,38,50,.24)"
                        }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 3, color: "#59636f", fontSize: 9 }}>
                                <span style={{ fontWeight: 600 }}>Scale</span>
                                <span>1x</span>
                                <input
                                    type="range" min="1" max="100" step="1" value={deformationScale}
                                    onChange={(event) => commitDeformationScale(Number(event.target.value))}
                                    style={{ width: 86, minWidth: 0, margin: 0 }}
                                />
                                <span>100x</span>
                            </div>
                        </div>
                    )}
                </div>
                <div ref={opacityControlRef} style={{ position: "relative", display: "flex", height: 26 }}>
                    <input aria-label="Global model opacity" type="number" min="0" max="1" step="0.05"
                        value={globalOpacity.toFixed(2)} onChange={(event) => applyGlobalOpacity(Number(event.target.value))}
                        style={{ width: 54, boxSizing: "border-box", padding: "0 5px", border: "1px solid #a2abb5", borderRadius: "6px 0 0 6px", outline: 0, background: "linear-gradient(180deg, #fff 0%, #f7f8fa 100%)", color: "#26313d", font: "600 12px Arial" }} />
                    <button type="button" title="Global model opacity" onClick={() => setIsOpacityOpen((open) => !open)}
                        style={{ width: 23, padding: 0, border: "1px solid #a2abb5", borderLeft: 0, borderRadius: "0 6px 6px 0", background: "linear-gradient(180deg, #fff 0%, #f7f8fa 100%)", color: "#5e6975", cursor: "pointer" }}>▾</button>
                    {isOpacityOpen && <div style={{ position: "absolute", top: 29, right: 0, zIndex: 60, width: 173, boxSizing: "border-box", padding: "4px 6px", background: "#fff", border: "1px solid #a2abb5", borderRadius: 7, boxShadow: "0 8px 22px rgba(28,38,50,.24)" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 3, color: "#59636f", fontSize: 9 }}>
                            <span style={{ fontWeight: 600 }}>Opacity</span>
                            <span>0</span>
                            <input type="range" min="0" max="1" step="0.05" value={globalOpacity}
                                onChange={(event) => applyGlobalOpacity(Number(event.target.value))} style={{ width: 86, minWidth: 0, margin: 0 }} />
                            <span>1</span>
                        </div>
                    </div>}
                </div>
            </div>
            <div ref={containerRef} style={{ flex: 1, minHeight: 0, position: "relative", background }}>
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
        </div>
    );
}
