import React, { useState, useRef, useEffect, useCallback, ChangeEvent } from "react"; 
import "./Toolbar.css"; 
// Note: You might need to supply declaration definitions file (.d.ts) matching these relative paths requirements module context
import {
    VTKReader,
    FEAReader,
    VTKWorkerSession,
    LookupTable,
    PolyDataMapper,
    Actor,
    LargeModelActor,
    ClipClosedSurfaceFilter,
    ClipFilter,
    computeSceneBounds,
    SectionPlaneHelperActor,
    assessVTKFileMemory,
} from "../../../threejsVTK/src";
import SectionDialog from "./SectionDialog"; 
import RibbonButton from "./RibbonButton";
import {
    executeToolbarCommand,
    type ToolbarCommandId,
    type ToolbarAction,
} from "../../../shared/controllers/commands/toolbarCommands";
import type { AppModule } from "../../../App";

// Definition requirements targeting discrete clipping spatial mapping coordinates configuration axes 
interface ClipAxisConfig {
    key: "x" | "y" | "z";
    label: string;
    index: number;
    color: number;
}

const CLIP_AXES: ClipAxisConfig[] = [
    { key: "x", label: "X", index: 0, color: 0xff5252 },
    { key: "y", label: "Y", index: 1, color: 0x4caf50 },
    { key: "z", label: "Z", index: 2, color: 0x448aff },
];

// Configuration layout mapped inside active axis cross-section slicing elements parameters
interface AxisClipSettings {
    on: boolean;
    pos: number;
    flip: boolean;
    showPlane?: boolean;
}

interface ClipState {
    x: AxisClipSettings;
    y: AxisClipSettings;
    z: AxisClipSettings;
}

interface ClipBounds {
    min: [number, number, number];
    max: [number, number, number];
}

interface BoxDimensions {
    length: number | string;
    width: number | string;
    height: number | string;
}

// Custom interface schema representing dynamic configurations parameterizing structural scene controller pipeline instances
interface SceneControllerInstance {
    scene: any;
    renderWindow?: {
        renderer?: {
            localClippingEnabled: boolean;
        };
    };
    showCameraNav?: boolean;
    _actorCounter?: number;
    scalarBar?: {
        setVisible: (visible: boolean) => void;
    };
    requestRender?: () => void;
    AddToRenderer?: (actor: any, options?: { showContour?: boolean }) => void;
    updateClipping?: () => void;
    fitView?: () => void;
    setView?: (viewName: string) => void;
    resetView?: () => void;
    setInteractionMode?: (mode: InteractionMode) => void;
    getInteractionMode?: () => InteractionMode;
    addBoxActor?: (length: number, width: number, height: number) => any;
    PlotContour?: (state: boolean) => void;
    PlotDeformedContour?: (state: boolean) => boolean;
    ToggleCameraNav?: () => void;
    globalOpacity?: number;
    deformationScaleFactor?: number;
}

// Definition specification requirements targeting explicit Toolbar props mappings instances
interface ToolbarProps {
    activeModule: AppModule;
    onModuleChange: (module: AppModule) => void;
    theme?: "light" | "dark" | "blue" | string;
    sceneController: SceneControllerInstance | null | undefined;
    onSceneChanged?: () => void;
    isSplit: boolean;
    onToggleSplit: () => void;
    isViewLinked: boolean;
    onToggleViewLink: () => void;
    showTextBlock: boolean;
    onToggleTextBlock: () => void;
    showAxes: boolean;
    onToggleAxes: () => void;
    showRuler: boolean;
    onToggleRuler: () => void;
    showGrid: boolean;
    onToggleGrid: () => void;
    measurementMode?: "distance" | "angle" | null;
    onSetMeasurementMode?: (mode: "distance" | "angle" | null) => void;
    onClearMeasurements?: () => void;
    onOpenSettings: () => void;
    onResetApp?: () => void;
}

type InteractionMode = "select" | "pan" | "rotate" | "zoom" | "dolly";

const INTERACTION_TOOLS: Array<{ mode: InteractionMode; label: string; icon: string; instruction: string }> = [
    { mode: "select", label: "Select", icon: "↖", instruction: "Select model entities. This is the default interaction mode." },
    { mode: "pan", label: "Pan", icon: "✋", instruction: "Drag with the left mouse button to move the camera view." },
    { mode: "rotate", label: "Rotate", icon: "⟳", instruction: "Drag with the left mouse button to orbit around the scene." },
    { mode: "zoom", label: "Zoom", icon: "⌕", instruction: "Drag a rectangle to zoom into a selected viewport region." },
    { mode: "dolly", label: "Dolly", icon: "↕", instruction: "Drag up to zoom in and down to zoom out around the scene center." },
];

export default function Toolbar({ 
    onModuleChange,
    theme = "light", // Fallback to "light" defaults if undefined to guarantee type safety down the tree
    sceneController, 
    onSceneChanged, 
    isSplit, 
    onToggleSplit, 
    isViewLinked, 
    onToggleViewLink,
    showTextBlock,
    onToggleTextBlock,
    showAxes,
    onToggleAxes,
    showRuler,
    onToggleRuler,
    showGrid,
    onToggleGrid,
    measurementMode = null,
    onSetMeasurementMode,
    onClearMeasurements,
    onOpenSettings,
    onResetApp
}: ToolbarProps) {
    const [activeTab, setActiveTab] = useState<string>("home");
    const [interactionMode, setInteractionMode] = useState<InteractionMode>("select");
    const [isCollapsed, setIsCollapsed] = useState<boolean>(false);
    const [isOpenDialog, setIsOpenDialog] = useState<boolean>(false);
    const [boxDimensions, setBoxDimensions] = useState<BoxDimensions>({ length: 1, width: 1, height: 1 });
    const [showContour, setShowContour] = useState<boolean>(false);
    const [showDeformedContour, setShowDeformedContour] = useState<boolean>(false);
    const [importProgress, setImportProgress] = useState<{ stage: string; value: number } | null>(null);
    const importAbortRef = useRef<AbortController | null>(null);

    useEffect(() => {
        const syncContourState = (event: Event) => {
            const detail = (event as CustomEvent<{ visible?: boolean; deformed?: boolean }>).detail;
            const visible = detail?.visible ?? true;
            setShowContour(visible);
            if (detail?.deformed !== undefined) setShowDeformedContour(detail.deformed);
        };
        window.addEventListener("fea-contour-state", syncContourState);
        return () => window.removeEventListener("fea-contour-state", syncContourState);
    }, []);
    
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => () => importAbortRef.current?.abort(), []);

    const applyInteractionMode = useCallback((mode: InteractionMode): void => {
        setInteractionMode(mode);
        sceneController?.setInteractionMode?.(mode);
    }, [sceneController]);

    useEffect(() => {
        applyInteractionMode("select");
    }, [applyInteractionMode]);

    useEffect(() => {
        const handleEscape = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
            applyInteractionMode("select");
        };
        window.addEventListener("keydown", handleEscape);
        return () => window.removeEventListener("keydown", handleEscape);
    }, [applyInteractionMode]);

    // Boundary limits and active spatial clipping constraints parameters
    const [isClipOpen, setIsClipOpen] = useState<boolean>(false);
    const [clip, setClip] = useState<ClipState>({
        x: { on: false, pos: 0, flip: false, showPlane: true },
        y: { on: false, pos: 0, flip: false, showPlane: true },
        z: { on: false, pos: 0, flip: false, showPlane: true },
    });
    const [clipBounds, setClipBounds] = useState<ClipBounds>({ min: [-1, -1, -1], max: [1, 1, 1] });

    const clipHelpersRef = useRef<{ x: any | null; y: any | null; z: any | null }>({ 
        x: null, 
        y: null, 
        z: null 
    });
    const clipOriginalDataRef = useRef<WeakMap<any, any>>(new WeakMap());
    const clipLastCountRef = useRef<number>(0);
    const workerClipTimersRef = useRef<Map<any, number>>(new Map());
    const applyClipRef = useRef<((state?: ClipState, scalarVisible?: boolean) => void) | null>(null);

    useEffect(() => {
        const reapplyClipAfterScale = () => applyClipRef.current?.(undefined, true);
        window.addEventListener("fea-deformation-scale-changed", reapplyClipAfterScale);
        return () => window.removeEventListener("fea-deformation-scale-changed", reapplyClipAfterScale);
    }, []);

    useEffect(() => () => {
        for (const timer of workerClipTimersRef.current.values()) window.clearTimeout(timer);
        workerClipTimersRef.current.clear();
    }, []);

    // Computes aggregate bounding constraints for active mesh instances across the spatial scene
    const getModelBounds = useCallback(() => {
        const scene = sceneController?.scene;
        return computeSceneBounds(scene, (o: any) => ("isActor" in o && o.isActor && o.name !== "system_grid"));
    }, [sceneController]);

    // Internal traversal mapping interface acting explicitly across valid finite element meshes
    const forEachActorMaterial = useCallback((cb: (material: any) => void): void => {
        const scene = sceneController?.scene;
        if (!scene) return;
        scene.traverse((o: any) => {
            if (o.name === "clip_plane_helper" || o.name === "system_grid") return;
            if (!("material" in o) || !(o as any).material) return;
            
            let p: any | null = o;
            let isInActor = false;
            while (p) { 
                if ("isActor" in p && (p as any).isActor) { 
                    isInActor = true; 
                    break; 
                } 
                p = p.parent; 
            }
            if (!isInActor) return;
            
            const targetMaterial = (o as any).material;
            const mats: any[] = Array.isArray(targetMaterial) ? targetMaterial : [targetMaterial];
            mats.forEach(cb);
        });
    }, [sceneController]);

    // Updates state matrix configurations, geometries, and visual representations for active section layers
    const applyClip = useCallback((state: ClipState = clip, scalarVisible: boolean = showContour): void => {
        if (!sceneController?.scene) return;
        const helpers = clipHelpersRef.current;
        const scene = sceneController.scene;

        const box = getModelBounds();
        const isEmpty = box.isEmpty();
        const sizeX = isEmpty ? 2 : (box.max[0] - box.min[0]) || 1;
        const sizeY = isEmpty ? 2 : (box.max[1] - box.min[1]) || 1;
        const sizeZ = isEmpty ? 2 : (box.max[2] - box.min[2]) || 1;
        const center = isEmpty ? [0, 0, 0] : box.center;

        const activeFilters: Array<{ normal: [number, number, number]; origin: [number, number, number] }> = [];
        for (const ax of CLIP_AXES) {
            const s = state[ax.key];
            const normal: [number, number, number] = [0, 0, 0];
            normal[ax.index] = s.flip ? 1 : -1;

            if (s.on) {
                const origin: [number, number, number] = [center[0], center[1], center[2]];
                origin[ax.index] = s.pos;
                activeFilters.push({ normal, origin });
                
                if (!helpers[ax.key]) {
                    let w = 1, h = 1;
                    if (ax.key === "x") { w = sizeZ; h = sizeY; }
                    if (ax.key === "y") { w = sizeX; h = sizeZ; }
                    if (ax.key === "z") { w = sizeX; h = sizeY; }

                    w *= 1.1; 
                    h *= 1.1;

                    const customHelper = new SectionPlaneHelperActor({
                        axis: ax.key,
                        width: w,
                        height: h,
                        color: ax.color,
                        opacity: 0.12, 
                    });

                    scene.add(customHelper);
                    helpers[ax.key] = customHelper;
                }

                if (helpers[ax.key]) {
                    const position: [number, number, number] = [center[0], center[1], center[2]];
                    position[ax.index] = s.pos;
                    helpers[ax.key]!.setPositionArray(position);
                    helpers[ax.key]!.visible = s.showPlane ?? true;
                }

            } else if (helpers[ax.key]) {
                scene.remove(helpers[ax.key]!);
                helpers[ax.key]!.dispose?.();
                helpers[ax.key] = null;
            }
        }

        const countChanged = activeFilters.length !== clipLastCountRef.current;
        forEachActorMaterial((m: any) => {
            // Section cut is now applied to actor PolyData, not only by shader planes.
            // Keep material clipping disabled so cap surfaces remain visible.
            m.clippingPlanes = null;
            m.clipIntersection = false;
            if (countChanged) m.needsUpdate = true;
        });
        clipLastCountRef.current = activeFilters.length;

        scene.traverse((obj: any) => {
            if (!obj?.isActor || obj.name === "system_grid" || obj.name === "clip_plane_helper") return;
            const mapper = obj.mapper;
            if (!mapper?.input || typeof mapper.setInputData !== "function") return;

            const originals = clipOriginalDataRef.current;
            // Keep the visible body on the extracted exterior shell. Only the
            // cap samples the complete element faces, giving it interior
            // scalar samples without exposing the internal element grid.
            const originalInput = obj.userData.__undeformedInput
                ?? originals.get(obj)
                ?? mapper.input;
            if (!originals.has(obj)) originals.set(obj, originalInput);

            if (obj.hasWorkerDataset?.()) {
                const previousTimer = workerClipTimersRef.current.get(obj);
                if (previousTimer !== undefined) window.clearTimeout(previousTimer);
                const stages: any[] = [];
                if (obj.userData.__deformationActive && obj.userData.__deformationVectorName) {
                    stages.push({
                        type: "warp",
                        arrayName: obj.userData.__deformationVectorName,
                        scaleFactor: sceneController.deformationScaleFactor ?? 1,
                    });
                }
                for (const filter of activeFilters) {
                    stages.push({ type: "clipClosed", ...filter, insideOut: false, capping: true });
                }
                const timer = window.setTimeout(() => {
                    workerClipTimersRef.current.delete(obj);
                    void obj.updateFromWorker(stages).then((result: any) => {
                        if (!result) return;
                        obj.setScalarVisibility?.(scalarVisible);
                        sceneController.requestRender?.();
                    }).catch((error: unknown) => console.error("Worker clipping failed", error));
                }, 80);
                workerClipTimersRef.current.set(obj, timer);
                return;
            }

            let output = obj.userData.__deformationActive
                ? (obj.userData.__deformationInput ?? originalInput)
                : originalInput;
            let capInput = obj.userData.__deformationActive
                ? (obj.userData.__deformationSourceInput ?? output)
                : (obj.userData.__sourceInput ?? output);
            for (const f of activeFilters) {
                output = new ClipClosedSurfaceFilter()
                    .setInputData(output)
                    .setCapInputData(capInput)
                    .setPlane(f.normal, f.origin)
                    .setInsideOut(false)
                    .setCapping(true)
                    .getOutputData();
                // Restrict the source used by subsequent caps to all planes
                // already applied, while keeping its internal element faces.
                capInput = new ClipFilter()
                    .setInputData(capInput)
                    .setPlane(f.normal, f.origin)
                    .setInsideOut(false)
                    .getOutputData();
            }

            mapper.setInputData(output);
            obj.setScalarVisibility?.(scalarVisible);
            obj.update?.();
        });

        const rw = sceneController?.renderWindow;
        if (rw?.renderer) rw.renderer.localClippingEnabled = true;

        sceneController?.requestRender?.();
    }, [sceneController, clip, getModelBounds, forEachActorMaterial, showContour]);

    applyClipRef.current = applyClip;

    useEffect(() => { applyClip(clip); }, [clip, applyClip]);

    // Triggers visibility for the cross-sectional clipping control panel dialog
    const openClipDialog = (): void => {
        const box = getModelBounds();
        if (!box.isEmpty()) {
            const min = box.min, max = box.max, c = box.center;
            setClipBounds({ min: [min[0], min[1], min[2]], max: [max[0], max[1], max[2]] });
            setClip((prev) => ({
                x: { ...prev.x, pos: prev.x.on ? prev.x.pos : c[0] },
                y: { ...prev.y, pos: prev.y.on ? prev.y.pos : c[1] },
                z: { ...prev.z, pos: prev.z.on ? prev.z.pos : c[2] },
            }));
        }
        setIsClipOpen(true);
    };

    const setAxis = (key: "x" | "y" | "z", patch: Partial<AxisClipSettings>): void => 
        setClip((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));

    // Disposes and systematically purges all loaded clipping geometries and auxiliary components
    const clearClip = (): void => {
        if (sceneController?.scene) {
            const helpers = clipHelpersRef.current;
            for (const key in helpers) {
                const k = key as "x" | "y" | "z";
                if (helpers[k]) {
                    sceneController.scene.remove(helpers[k]!);
                    helpers[k]!.dispose?.();
                    helpers[k] = null;
                }
            }
        }
        setClip({
            x: { on: false, pos: 0, flip: false, showPlane: true },
            y: { on: false, pos: 0, flip: false, showPlane: true },
            z: { on: false, pos: 0, flip: false, showPlane: true },
        });
    };

    const handleOpenClick = (): void => { if (fileInputRef.current) fileInputRef.current.click(); };

    // Execution pipeline handling internal data parses for .vtk and .vtp files
    const handleFileChange = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
        const file = e.target.files?.[0];
        if (!file) return;
        e.target.value = "";
        const lowerName = file.name.toLowerCase();
        const isVTK = lowerName.endsWith(".vtk");
        const isVTP = lowerName.endsWith(".vtp");
        const isFEA = lowerName.endsWith(".fea");
        if (!isVTK && !isVTP && !isFEA) { alert("Only supports .fea, .vtk or .vtp files"); return; }

        const memoryAssessment = assessVTKFileMemory(file.size, { retainedWorker: file.size >= 100 * 1024 * 1024 });
        if (memoryAssessment.level !== "ok") {
            const estimatedGB = (memoryAssessment.estimatedPeakBytes / 1024 ** 3).toFixed(1);
            const budgetGB = (memoryAssessment.budgetBytes / 1024 ** 3).toFixed(1);
            const proceed = window.confirm(
                `Model này có thể cần khoảng ${estimatedGB} GB RAM (budget an toàn ${budgetGB} GB). ` +
                "Tiếp tục có thể khiến tab bị đóng. Bạn vẫn muốn import?"
            );
            if (!proceed) return;
        }

        importAbortRef.current?.abort();
        const abortController = new AbortController();
        importAbortRef.current = abortController;
        setImportProgress({ stage: "read", value: 0 });
        let workerSession: VTKWorkerSession | null = null;
        try {
                const onProgress = ({ stage, progress }: { stage?: string; progress?: number }) =>
                    setImportProgress({ stage: stage ?? "parse", value: progress ?? 0 });
                const retainInWorker = !isFEA && file.size >= 100 * 1024 * 1024 && typeof Worker !== "undefined";
                let workerHandle: number | null = null;
                const dataSet = retainInWorker
                    ? await (async () => {
                        workerSession = new VTKWorkerSession({ onProgress });
                        workerHandle = await workerSession.importFile(file, {
                            format: isVTP ? "vtp" : "vtk",
                            signal: abortController.signal,
                        });
                        return workerSession.exportRenderDataSet(workerHandle, { release: false });
                    })()
                    : isFEA
                    ? await new FEAReader().parseFile(file)
                    : await new VTKReader({
                    signal: abortController.signal,
                    onProgress,
                }).parseFile(file);
                const polyData = isFEA ? dataSet.extractSurface({ passCellData: true }) : dataSet;

                const mapper = new PolyDataMapper().setInputData(polyData).setLookupTable(new LookupTable());
                mapper.setInterpolateScalarsBeforeMapping(true);
                mapper.getLookupTable().setNumberOfColors(12);
                
                const triangleCount = polyData.getTriangles?.().length / 3 || 0;
                const actor = triangleCount >= 500_000
                    ? new LargeModelActor(mapper, file.name, { maxTrianglesPerPartition: 200_000 })
                    : new Actor(mapper, file.name);
                if (workerSession && workerHandle !== null) actor.attachWorkerDataset(workerSession, workerHandle);
                actor.showModelWithEdges();

                if (sceneController && typeof sceneController.AddToRenderer === "function") {
                    sceneController.AddToRenderer(actor, { showContour: showContour });
                } else if (sceneController?.scene) {
                    sceneController.scene.add(actor);
                    sceneController.updateClipping?.();
                    sceneController.fitView?.();
                }
                applyClipRef.current?.();
                onSceneChanged?.();
        } catch (err: any) {
            workerSession?.dispose();
            if (err?.name === "AbortError") return;
            console.error(err);
            alert(`Cannot read file: ${err.message}`);
        } finally {
            if (importAbortRef.current === abortController) {
                importAbortRef.current = null;
                setImportProgress(null);
            }
        }
    };

    const handleFitView = (): void => {
        const tryFitView = (): boolean => {
            if (!sceneController || typeof sceneController.fitView !== "function") return false;
            sceneController.fitView();
            return true;
        };
        if (tryFitView()) return;
        requestAnimationFrame(() => { if (!tryFitView()) window.setTimeout(tryFitView, 50); });
    };

    const handleSetView = (viewName: string): void => {
        if (!sceneController) return;

        // Extract the camera instance from the sceneController
        const cadCam = (sceneController as any).cadCamera;
        if (!cadCam?.getPosition || !cadCam?.setPosition) return;

        const target = [0, 0, 0];
        const pos = cadCam.getPosition([0, 0, 0]);
        const distance = Math.hypot(pos[0] - target[0], pos[1] - target[1], pos[2] - target[2]) || 15;

        let newPos: [number, number, number] = [0, 0, distance];
        let newUp: [number, number, number] = [0, 1, 0]; // Default Up along +Y

        // Normalize viewName strings to handle lowercase routing cleanly from the ribbon buttons
        const viewKey = viewName.toLowerCase();

        switch (viewKey) {
            case "front":
                newPos = [0, 0, distance];
                newUp = [0, 1, 0];
                break;
            case "back":
                newPos = [0, 0, -distance];
                newUp = [0, 1, 0];
                break;
            case "top":
                newPos = [0, distance, 0];
                newUp = [0, 0, -1]; // Looking down from +Y means -Z becomes viewport "Up"
                break;
            case "bottom":
                newPos = [0, -distance, 0];
                newUp = [0, 0, 1];  // Looking up from -Y means +Z becomes viewport "Up"
                break;
            case "left":
                newPos = [-distance, 0, 0];
                newUp = [0, 1, 0];
                break;
            case "right":
                newPos = [distance, 0, 0];
                newUp = [0, 1, 0];
                break;
            case "iso":
            case "isometric":
                const iso = distance / Math.sqrt(3);
                newPos = [iso, iso, iso];
                newUp = [-1 / Math.sqrt(6), 2 / Math.sqrt(6), -1 / Math.sqrt(6)]; // Mathematically consistent for true FEA isometric projection
                break;
            default:
                return;
        }

        // Apply spatial transformations safely matching Scene.tsx perfectly
        cadCam.setPosition(newPos[0], newPos[1], newPos[2]);
        cadCam.setUp?.(newUp[0], newUp[1], newUp[2]);
        cadCam.lookAt?.(target[0], target[1], target[2]);
        cadCam.updateMatrixWorld?.(true);

        // Synchronize the threejsVTK Camera wrapper facade state core
        if (typeof cadCam.setFromThree === "function") {
            cadCam.setFromThree();
        }

        // Fire clipping pipeline passes and fit camera frustum to bounding elements immediately
        if (typeof sceneController.updateClipping === "function") {
            sceneController.updateClipping();
        }
        if (typeof sceneController.fitView === "function") {
            sceneController.fitView();
        }
        if (typeof sceneController.requestRender === "function") {
            sceneController.requestRender();
        }

        onSceneChanged?.();
    };

    // Drops and flushes out loaded simulation components inside the visualization context
    const handleClearScene = (): void => {
        if (!sceneController || !sceneController.scene) return;
        const scene = sceneController.scene;
        for (let i = scene.children.length - 1; i >= 0; i--) {
            const child = scene.children[i];
            if ("isActor" in child && (child as any).isActor) {
                scene.remove(child);
                if ("geometry" in child && (child as any).geometry) (child as any).geometry.dispose();
                if ("material" in child && (child as any).material) {
                    const mat = (child as any).material;
                    if (Array.isArray(mat)) mat.forEach((m: any) => m.dispose());
                    else mat.dispose();
                }
            }
        }
        if (sceneController._actorCounter !== undefined) sceneController._actorCounter = 0;
        if (typeof sceneController.updateClipping === "function") sceneController.updateClipping();
        if (sceneController.scalarBar) sceneController.scalarBar.setVisible(false);
        window.dispatchEvent(new Event("fea-field-data-changed"));
        onSceneChanged?.();
    };

    const handleResetApp = (): void => {
        const confirmed = window.confirm(
            "Reset the application? All loaded models, measurements, and current settings will be cleared."
        );
        if (!confirmed) return;

        handleClearScene();
        onClearMeasurements?.();
        setActiveTab("home");
        setIsCollapsed(false);
        setIsOpenDialog(false);
        setIsClipOpen(false);
        setBoxDimensions({ length: 1, width: 1, height: 1 });
        setShowContour(false);
        setShowDeformedContour(false);
        setClip({
            x: { on: false, pos: 0, flip: false, showPlane: true },
            y: { on: false, pos: 0, flip: false, showPlane: true },
            z: { on: false, pos: 0, flip: false, showPlane: true },
        });
        if (fileInputRef.current) fileInputRef.current.value = "";
        onResetApp?.();
    };

    const handleOpenBoxDialog = (): void => setIsOpenDialog(true);
    const handleConfirmAddBox = (): void => {
        if (sceneController && typeof sceneController.addBoxActor === "function") {
            const { length, width, height } = boxDimensions;
            const boxActor = sceneController.addBoxActor(Number(length), Number(width), Number(height));
            if (boxActor && typeof sceneController.AddToRenderer === "function") {
                sceneController.AddToRenderer(boxActor, { showContour: showContour });
            }
            onSceneChanged?.();
        }
        applyClipRef.current?.();
        setIsOpenDialog(false);
    };
    
    const handleInputChange = (e: ChangeEvent<HTMLInputElement>): void => {
        const { name, value } = e.target;
        setBoxDimensions(prev => ({ ...prev, [name]: value }));
    };

    const handleToggleContour = (): void => {
        if (!sceneController) return;
        const nextState = showDeformedContour ? true : !showContour;
        setShowContour(nextState);
        setShowDeformedContour(false);
        if (typeof sceneController.PlotContour === "function") sceneController.PlotContour(nextState);
        applyClipRef.current?.(undefined, nextState);
        onSceneChanged?.();
    };

    const handleToggleDeformedContour = (): void => {
        if (!sceneController) return;
        const nextState = !showDeformedContour;
        const applied = sceneController.PlotDeformedContour?.(nextState) ?? false;
        if (nextState && !applied) {
            window.alert('No 3-component point vector named "Displacement" or "U" was found.');
        }
        setShowDeformedContour(nextState && applied);
        setShowContour(nextState && applied);
        applyClipRef.current?.(undefined, nextState && applied);
        onSceneChanged?.();
    };

    const handleToggleCameraNav = (): void => {
        if (!sceneController || typeof sceneController.ToggleCameraNav !== "function") return;
        sceneController.ToggleCameraNav();
        onSceneChanged?.();
    };

    const commandActionsRef = useRef<Record<string, ToolbarAction | undefined>>({});
    commandActionsRef.current = {
        openFile: handleOpenClick,
        resetView: handleResetApp,
        toggleContour: handleToggleContour,
        toggleDeformedContour: handleToggleDeformedContour,
        openSettings: onOpenSettings,
        clearScene: handleClearScene,
        openClipDialog,
        openBoxDialog: handleOpenBoxDialog,
        setView: handleSetView,
        fitView: handleFitView,
        setInteractionMode: applyInteractionMode,
        toggleSplit: onToggleSplit,
        toggleViewLink: onToggleViewLink,
        toggleGrid: onToggleGrid,
        toggleAxes: onToggleAxes,
        toggleCameraNav: handleToggleCameraNav,
        toggleRuler: onToggleRuler,
        toggleNotes: onToggleTextBlock,
        setMeasurementMode: (mode: "distance" | "angle") =>
            onSetMeasurementMode?.(measurementMode === mode ? null : mode),
        clearMeasurements: onClearMeasurements,
        showAbout: () => alert("FEA Viewer Version 1.0.0"),
    };

    const runCommand = useCallback((
        commandId: ToolbarCommandId,
        payload?: unknown
    ): void => {
        executeToolbarCommand(commandId, { actions: commandActionsRef.current }, payload);
    }, []);

    // Theme Configuration Palette Settings
    let toolbarBg = "#f3f3f3";
    let bodyBg = "#ffffff";
    let textColor = "#333333";
    let borderStyle = "1px solid #ccc";
    let groupTitleBg = "#f9f9f9";
    let groupTitleColor = "#666666";
    let activeBtnBg = "#e2e8f0";

    if (theme === "dark") {
        toolbarBg = "#252526";
        bodyBg = "#1e1e1e";
        textColor = "#cccccc";
        borderStyle = "1px solid #3c3c3c";
        groupTitleBg = "#2d2d2d";
        groupTitleColor = "#888888";
        activeBtnBg = "#3e3e42";
    } else if (theme === "blue") {
        toolbarBg = "#deeaf6"; 
        bodyBg = "#ffffff";    
        textColor = "#1e3a8a"; 
        borderStyle = "1px solid #a3b8cc";
        groupTitleBg = "#f1f5f9";
        groupTitleColor = "#475569";
        activeBtnBg = "#bae6fd"; 
    }

    return (
        <div
            className={`ribbon-toolbar${isCollapsed ? " collapsed" : ""}`}
            style={{ background: toolbarBg, borderBottom: borderStyle, color: textColor }}
        >
            <input  type="file" 
                    ref={fileInputRef}
                    style={{ display: "none" }} 
                    accept=".fea,.vtk,.vtp" 
                    onChange={handleFileChange} 
                />
            {importProgress && (
                <div className="vtk-import-progress" role="status" aria-live="polite">
                    <span>{importProgress.stage}: {Math.round(importProgress.value * 100)}%</span>
                    <progress max={1} value={importProgress.value} />
                    <button type="button" onClick={() => importAbortRef.current?.abort()}>Cancel</button>
                </div>
            )}

            {/* Ribbon Interface Header Tab Switchers */}
            <div className="ribbon-tabs" style={{ display: "flex", gap: "2px", padding: "4px 4px 0 4px" }}>
                {["home", "modify", "shape", "view", "measure", "help"].map((tab) => {
                    const isActive = activeTab === tab;
                    let tabStyle: React.CSSProperties = {
                        background: "transparent",
                        border: "1px solid transparent",
                        color: textColor,
                        padding: "4px 12px",
                        fontSize: "12px",
                        cursor: "pointer",
                        borderBottom: "none",
                        borderTopLeftRadius: "3px",
                        borderTopRightRadius: "3px"
                    };
                    if (isActive) {
                        tabStyle.background = bodyBg;
                        tabStyle.border = borderStyle;
                        tabStyle.borderBottom = `1px solid ${bodyBg}`;
                        tabStyle.fontWeight = "bold";
                        tabStyle.position = "relative";
                        tabStyle.zIndex = 2;
                    }
                    return (
                        <button 
                            key={tab}
                            style={tabStyle}
                            onClick={() => setActiveTab(tab)}
                            onDoubleClick={() => {
                                setActiveTab(tab);
                                setIsCollapsed(false);
                            }}
                        >
                            {tab.charAt(0).toUpperCase() + tab.slice(1)}
                        </button>
                    );
                })}
                <button
                    type="button"
                    className="ribbon-collapse-btn"
                    style={{ color: textColor, borderColor: borderStyle.replace("1px solid ", "") }}
                    aria-label={isCollapsed ? "Expand toolbar" : "Collapse toolbar"}
                    aria-expanded={!isCollapsed}
                    title={isCollapsed ? "Expand toolbar" : "Collapse toolbar"}
                    onClick={() => setIsCollapsed((collapsed) => !collapsed)}
                >
                    <span aria-hidden="true">{isCollapsed ? "⌄" : "⌃"}</span>
                </button>
            </div>

            {/* Ribbon Segment Container Control Groups */}
            {!isCollapsed && <div className="ribbon-body" style={{ background: bodyBg, borderTop: borderStyle, display: "flex", gap: "10px", padding: "6px", marginTop: "-1px" }}>
                
                {/* Home Operations Category */}
                {activeTab === "home" && (
                    <>
                        <div className="ribbon-group" style={{ borderRight: borderStyle, paddingRight: "8px" }}>
                            <div className="ribbon-group-content" style={{ display: "flex", gap: "6px" }}>
                                <RibbonButton 
                                    icon="folder-open" 
                                    label="Open" 
                                    hotkey="Ctrl+O"
                                    instruction="Import structural datasets from standard legacy .vtk or .vtp file models into the render context."
                                    textColor={textColor}
                                    commandId="file.open"
                                    onCommand={runCommand}
                                />
                                <button
                                    type="button"
                                    className="module-ribbon-btn"
                                    onClick={() => onModuleChange("start-page")}
                                    title="Return to the module start page"
                                >
                                    <span className="module-ribbon-icon">⌂</span>
                                    <span>Start Page</span>
                                </button>
                                <RibbonButton 
                                    icon="fitcontent" 
                                    label="Reset" 
                                    instruction="Clear all loaded data and restore the application to its initial settings after confirmation."
                                    textColor={textColor}
                                    commandId="view.reset"
                                    onCommand={runCommand}
                                />
                            </div>
                            <div className="ribbon-group-title" style={{ backgroundColor: groupTitleBg, color: groupTitleColor }}>File & Reset</div>
                        </div>

                        {/* Result Category Group (Moved from View tab) */}
                        <div className="ribbon-group" style={{ borderRight: borderStyle, paddingRight: "8px" }}>
                            <div className="ribbon-group-content" style={{ display: "flex", gap: "6px" }}>
                                <RibbonButton 
                                    icon="contour" 
                                    label="Contour" 
                                    textColor={textColor} 
                                    active={showContour} 
                                    activeBtnBg={activeBtnBg} 
                                    commandId="result.toggleContour"
                                    onCommand={runCommand}
                                    instruction="Render post-processing continuous isoline color map gradients derived from calculated node arrays."
                                />
                                <RibbonButton
                                    icon="contour"
                                    label="Def Contour"
                                    textColor={textColor}
                                    active={showDeformedContour}
                                    activeBtnBg={activeBtnBg}
                                    commandId="result.toggleDeformedContour"
                                    onCommand={runCommand}
                                    instruction="Render contour on the mesh deformed by the Displacement or U point vector."
                                />
                            </div>
                            <div className="ribbon-group-title" style={{ backgroundColor: groupTitleBg, color: groupTitleColor }}>Result</div>
                        </div>

                        <div className="ribbon-group" style={{ borderRight: borderStyle, paddingRight: "8px" }}>
                            <div className="ribbon-group-content" style={{ display: "flex", gap: "6px" }}>
                                <RibbonButton 
                                    icon="setting" 
                                    label="Settings" 
                                    instruction="Open systems parameters configurations window panel to adapt default renderer targets."
                                    textColor={textColor}
                                    commandId="app.openSettings"
                                    onCommand={runCommand}
                                />
                            </div>
                            <div className="ribbon-group-title" style={{ backgroundColor: groupTitleBg, color: groupTitleColor }}>Configuration</div>
                        </div>
                    </>
                )}

                {/* Modification Operations Category */}
                {activeTab === "modify" && (
                    <>
                        <div className="ribbon-group" style={{ borderRight: borderStyle, paddingRight: "8px" }}>
                            <div className="ribbon-group-content" style={{ display: "flex", gap: "6px" }}>
                                <RibbonButton 
                                    icon="clearBrush" 
                                    label="Clear All" 
                                    instruction="Flush all elements, actors, geometries, and reference datasets out of the pipeline canvas context."
                                    textColor={textColor}
                                    commandId="scene.clear"
                                    onCommand={runCommand}
                                />
                            </div>
                            <div className="ribbon-group-title" style={{ backgroundColor: groupTitleBg, color: groupTitleColor }}>Scene Actions</div>
                        </div>
                        <div className="ribbon-group" style={{ borderRight: borderStyle, paddingRight: "8px" }}>
                            <div className="ribbon-group-content" style={{ display: "flex", gap: "6px" }}>
                                <RibbonButton 
                                    icon="section" 
                                    label="Section" 
                                    hotkey="Ctrl+S"
                                    instruction="Initialize planar matrix cross-sectional slicing variables across active element boundaries."
                                    textColor={textColor}
                                    active={(clip.x.on || clip.y.on || clip.z.on)}
                                    activeBtnBg={activeBtnBg}
                                    commandId="clip.open"
                                    onCommand={runCommand}
                                />
                            </div>
                            <div className="ribbon-group-title" style={{ backgroundColor: groupTitleBg, color: groupTitleColor }}>Clipping</div>
                        </div>
                    </>
                )}

                {/* Primitives Construction Category */}
                {activeTab === "shape" && (
                    <div className="ribbon-group" style={{ borderRight: borderStyle, paddingRight: "8px" }}>
                        <div className="ribbon-group-content" style={{ display: "flex", gap: "6px" }}>
                            <RibbonButton 
                                icon="box" 
                                label="Box" 
                                instruction="Generate a solid mesh configuration primitive entity bounding specified geometric scale constants."
                                textColor={textColor}
                                commandId="shape.addBox"
                                onCommand={runCommand}
                            />
                        </div>
                        <div className="ribbon-group-title" style={{ backgroundColor: groupTitleBg, color: groupTitleColor }}>Primitives</div>
                    </div>
                )}

                {/* Viewport Projection Category */}
                {activeTab === "view" && (
                    <>
                        <div className="ribbon-group" style={{ borderRight: borderStyle, paddingRight: "8px" }}>
                            <div className="ribbon-group-content" style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                                {INTERACTION_TOOLS.map((tool) => (
                                    <RibbonButton
                                        key={tool.mode}
                                        icon={tool.icon}
                                        label={tool.label}
                                        instruction={tool.instruction}
                                        textColor={textColor}
                                        active={interactionMode === tool.mode}
                                        activeBtnBg={activeBtnBg}
                                        commandId="view.setInteractionMode"
                                        commandPayload={tool.mode}
                                        onCommand={runCommand}
                                    />
                                ))}
                            </div>
                            <div className="ribbon-group-title" style={{ backgroundColor: groupTitleBg, color: groupTitleColor }}>Interaction</div>
                        </div>

                        {/* Orientation Tracking Controls */}
                        <div className="ribbon-group" style={{ borderRight: borderStyle, paddingRight: "8px" }}>
                            <div className="ribbon-group-content" style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                                {["front", "back", "top", "bottom", "left", "right", "iso"].map((view) => (
                                    <RibbonButton 
                                        key={view}
                                        icon={`${view === "iso" ? "isometric" : view}view`}
                                        label={view.charAt(0).toUpperCase() + view.slice(1)}
                                        instruction={`Align camera matrices transformation mapping vectors looking directly from the ${view} layout angle.`}
                                        textColor={textColor}
                                        commandId="view.setOrientation"
                                        commandPayload={view}
                                        onCommand={runCommand}
                                    />
                                ))}

                                <div className="ribbon-separator" style={{ borderLeft: borderStyle, height: "20px", margin: "0 4px" }}></div>
                                
                                <RibbonButton 
                                    icon="fit-view" 
                                    label="Fit" 
                                    instruction="Re-scale camera viewing frustum bounds parameters encapsulating every existing model geometry."
                                    textColor={textColor}
                                    commandId="view.fit"
                                    onCommand={runCommand}
                                />
                            </div>
                            <div className="ribbon-group-title" style={{ backgroundColor: groupTitleBg, color: groupTitleColor }}>Orientations & Camera</div>
                        </div>

                        {/* Viewport Split Partition Layout Controls */}
                        <div className="ribbon-group" style={{ borderRight: borderStyle, paddingRight: "8px" }}>
                            <div className="ribbon-group-content" style={{ display: "flex", gap: "6px" }}>
                                <RibbonButton 
                                    icon="split-view" 
                                    label="Split View" 
                                    instruction="Toggle multi-view viewport configuration layout dividing the central render node space horizontally."
                                    textColor={textColor}
                                    active={isSplit}
                                    activeBtnBg={activeBtnBg}
                                    commandId="layout.toggleSplit"
                                    onCommand={runCommand}
                                />
                                <RibbonButton 
                                    icon="link" 
                                    label="Link View" 
                                    instruction="Synchronize rotation, panning, and zoom transforms variables across dual partitioned viewports."
                                    textColor={textColor}
                                    active={(isViewLinked && isSplit)}
                                    activeBtnBg={activeBtnBg}
                                    disabled={!isSplit}
                                    commandId="layout.toggleLink"
                                    onCommand={runCommand}
                                />
                            </div>
                            <div className="ribbon-group-title" style={{ backgroundColor: groupTitleBg, color: groupTitleColor }}>Layouts</div>
                        </div>

                        {/* Structural Layer Auxiliary Visibility Elements */}
                        <div className="ribbon-group" style={{ borderRight: borderStyle, paddingRight: "8px" }}>
                            <div className="ribbon-group-content" style={{ display: "flex", gap: "6px" }}>
                                <RibbonButton 
                                    icon="grid" label="Grid" textColor={textColor} active={showGrid} activeBtnBg={activeBtnBg} commandId="display.toggleGrid" onCommand={runCommand}
                                    instruction="Toggle global reference coordinate workspace base ground grid visibility status."
                                />
                                <RibbonButton 
                                    icon="axes" label="Axes" textColor={textColor} active={showAxes} activeBtnBg={activeBtnBg} commandId="display.toggleAxes" onCommand={runCommand}
                                    instruction="Toggle visible local origin coordinate tracking system directional vector arrow indicators."
                                />
                                <RibbonButton 
                                    icon="camera-orientation" label="Cam Nav" textColor={textColor} active={sceneController?.showCameraNav} activeBtnBg={activeBtnBg}
                                    instruction="Toggle navigation direction orientation interactive block cube inside active view views."
                                    commandId="display.toggleCameraNav"
                                    onCommand={runCommand}
                                />
                                <RibbonButton 
                                    icon="ruler" label="Ruler" textColor={textColor} active={showRuler} activeBtnBg={activeBtnBg} commandId="display.toggleRuler" onCommand={runCommand}
                                    instruction="Toggle mouse pointer metrics measuring tool to determine distance between surface coordinates nodes."
                                />
                                <RibbonButton 
                                    icon="notes" label="Notes" textColor={textColor} active={showTextBlock} activeBtnBg={activeBtnBg} commandId="display.toggleNotes" onCommand={runCommand}
                                    instruction="Display on-screen presentation text fields editor block for context tracking documentation."
                                />
                            </div>
                            <div className="ribbon-group-title" style={{ backgroundColor: groupTitleBg, color: groupTitleColor }}>Display Toggles</div>
                        </div>
                    </>
                )}

                {activeTab === "measure" && (
                    <div className="ribbon-group" style={{ borderRight: borderStyle, paddingRight: "8px" }}>
                        <div className="ribbon-group-content" style={{ display: "flex", gap: "6px" }}>
                            <RibbonButton
                                icon="measureLength" label="Distance" textColor={textColor}
                                active={measurementMode === "distance"} activeBtnBg={activeBtnBg}
                                commandId="measure.setMode" commandPayload="distance" onCommand={runCommand}
                                instruction="Select two entities. Draw a ruler and show their distance at its midpoint."
                            />
                            <RibbonButton
                                icon="measureAngle" label="Angle" textColor={textColor}
                                active={measurementMode === "angle"} activeBtnBg={activeBtnBg}
                                commandId="measure.setMode" commandPayload="angle" onCommand={runCommand}
                                instruction="Select two entities. Measure their face/edge direction angle and draw the result."
                            />
                            <RibbonButton
                                icon="clearBrush" label="Clear" textColor={textColor}
                                commandId="measure.clear" onCommand={runCommand}
                                instruction="Remove all measurement annotations from the scene."
                            />
                        </div>
                        <div className="ribbon-group-title" style={{ backgroundColor: groupTitleBg, color: groupTitleColor }}>Measurement</div>
                    </div>
                )}

                {/* Support Reference Channels Category */}
                {activeTab === "help" && (
                    <div className="ribbon-group" style={{ borderRight: borderStyle, paddingRight: "8px" }}>
                        <div className="ribbon-group-content" style={{ display: "flex", gap: "6px" }}>
                            <RibbonButton 
                                icon="📖" 
                                label="Docs" 
                                instruction="Launch complete application user manual guide detailing algorithmic implementations and user workflow steps."
                                textColor={textColor}
                                href="#documentation" target="_blank" rel="noreferrer"
                            />
                            <RibbonButton 
                                icon="ℹ️" 
                                label="About" 
                                instruction="Display core build information metadata configurations for this active FEA execution software platform."
                                textColor={textColor}
                                commandId="help.about"
                                onCommand={runCommand}
                            />
                        </div>
                        <div className="ribbon-group-title" style={{ backgroundColor: groupTitleBg, color: groupTitleColor }}>Support</div>
                    </div>
                )}
            </div>}

            {/* Modal Input Form Interface Handling Box Boundary Initializations */}
            {isOpenDialog && (
                <div className="modal-overlay">
                    <div className="modal-container">
                        <h3>Box Dimensions</h3>
                        <div className="modal-body-inputs">
                            <div className="input-group"><label>Length (X):</label><input type="number" name="length" value={boxDimensions.length} onChange={handleInputChange} min="0.1" step="0.1"/></div>
                            <div className="input-group"><label>Width (Y):</label><input type="number" name="width" value={boxDimensions.width} onChange={handleInputChange} min="0.1" step="0.1"/></div>
                            <div className="input-group"><label>Height (Z):</label><input type="number" name="height" value={boxDimensions.height} onChange={handleInputChange} min="0.1" step="0.1"/></div>
                        </div>
                        <div className="modal-actions">
                            <button className="modal-btn cancel-btn" onClick={() => setIsOpenDialog(false)}>Cancel</button>
                            <button className="modal-btn confirm-btn" onClick={handleConfirmAddBox}>Add Box</button>
                        </div>
                    </div>
                </div>
            )}

            <SectionDialog 
                isOpen={isClipOpen}
                onClose={() => setIsClipOpen(false)}
                clip={clip}
                clipBounds={clipBounds}
                setAxis={setAxis}
                clearClip={clearClip}
                theme={theme}
            />
        </div>
    );
}
