import { useState, useRef, useEffect, useCallback } from "react"; 
import * as THREE from "three";
import "./Toolbar.css"; 
import { VTKLegacyReader, VTPReader, LookupTable, PolyDataMapper, Actor } from "../threejsVTK";
import SectionDialog from "./SectionDialog"; 
import RibbonButton from "./RibbonButton";

// Configuration mappings for localized spatial orientation clipping axes
const CLIP_AXES = [
    { key: "x", label: "X", index: 0, color: 0xff5252 },
    { key: "y", label: "Y", index: 1, color: 0x4caf50 },
    { key: "z", label: "Z", index: 2, color: 0x448aff },
];

export default function Toolbar({ 
    theme,
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
    onOpenSettings  
}) {
    const [activeTab, setActiveTab] = useState("home");
    const [isOpenDialog, setIsOpenDialog] = useState(false);
    const [boxDimensions, setBoxDimensions] = useState({ length: 1, width: 1, height: 1 });
    const [showContour, setShowContour] = useState(false);
    
    const fileInputRef = useRef(null);

    // Boundary limits and active spatial clipping constraints parameters
    const [isClipOpen, setIsClipOpen] = useState(false);
    const [clip, setClip] = useState({
        x: { on: false, pos: 0, flip: false },
        y: { on: false, pos: 0, flip: false },
        z: { on: false, pos: 0, flip: false },
    });
    const [clipBounds, setClipBounds] = useState({ min: [-1, -1, -1], max: [1, 1, 1] });

    // Instantiated Three.js logical plane structural references
    const clipPlanesRef = useRef({
        x: new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0),
        y: new THREE.Plane(new THREE.Vector3(0, -1, 0), 0),
        z: new THREE.Plane(new THREE.Vector3(0, 0, -1), 0),
    });
    const clipHelpersRef = useRef({ x: null, y: null, z: null });
    const clipLastCountRef = useRef(0);
    const applyClipRef = useRef(null);

    // Computes aggregate bounding constraints for active mesh instances across the spatial scene
    const getModelBounds = useCallback(() => {
        const box = new THREE.Box3();
        const scene = sceneController?.scene;
        if (!scene) return box;
        scene.updateMatrixWorld(true);
        scene.traverse((o) => {
            if (o.isActor && o.name !== "system_grid") box.expandByObject(o);
        });
        return box;
    }, [sceneController]);

    // Internal traversal mapping interface acting explicitly across valid finite element meshes
    const forEachActorMaterial = useCallback((cb) => {
        const scene = sceneController?.scene;
        if (!scene) return;
        scene.traverse((o) => {
            if (o.name === "clip_plane_helper" || o.name === "system_grid") return;
            if (!o.material) return;
            let p = o, isInActor = false;
            while (p) { if (p.isActor) { isInActor = true; break; } p = p.parent; }
            if (!isInActor) return;
            const mats = Array.isArray(o.material) ? o.material : [o.material];
            mats.forEach(cb);
        });
    }, [sceneController]);

    // Updates state matrix configurations, geometries, and visual representations for active section layers
    const applyClip = useCallback((state = clip) => {
        if (!sceneController?.scene) return;
        const planes = clipPlanesRef.current;
        const helpers = clipHelpersRef.current;
        const scene = sceneController.scene;

        const box = getModelBounds();
        const isEmpty = box.isEmpty();
        const sizeX = isEmpty ? 2 : (box.max.x - box.min.x) || 1;
        const sizeY = isEmpty ? 2 : (box.max.y - box.min.y) || 1;
        const sizeZ = isEmpty ? 2 : (box.max.z - box.min.z) || 1;
        const center = isEmpty ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());

        const active = [];
        for (const ax of CLIP_AXES) {
            const s = state[ax.key];
            const plane = planes[ax.key];
            
            const n = new THREE.Vector3();
            n.setComponent(ax.index, s.flip ? 1 : -1);
            plane.normal.copy(n);
            plane.constant = s.flip ? -s.pos : s.pos;

            if (s.on) {
                active.push(plane);
                
                if (!helpers[ax.key]) {
                    const customHelper = new THREE.Group();
                    customHelper.name = "clip_plane_helper";

                    let w = 1, h = 1;
                    if (ax.key === "x") { w = sizeZ; h = sizeY; }
                    if (ax.key === "y") { w = sizeX; h = sizeZ; }
                    if (ax.key === "z") { w = sizeX; h = sizeY; }

                    w *= 1.1; 
                    h *= 1.1;

                    const planeGeo = new THREE.PlaneGeometry(w, h);
                    const planeMat = new THREE.MeshBasicMaterial({
                        color: ax.color,
                        side: THREE.DoubleSide,
                        transparent: true,
                        opacity: 0.12, 
                        depthWrite: false
                    });
                    const mesh = new THREE.Mesh(planeGeo, planeMat);
                    customHelper.add(mesh);

                    const edgesGeo = new THREE.BufferGeometry().setFromPoints([
                        new THREE.Vector3(-w/2, -h/2, 0),
                        new THREE.Vector3(w/2, -h/2, 0),
                        new THREE.Vector3(w/2, h/2, 0),
                        new THREE.Vector3(-w/2, h/2, 0),
                    ]);
                    const lineMat = new THREE.LineBasicMaterial({ 
                        color: ax.color, 
                        linewidth: 1,
                        transparent: true,
                        opacity: 0.6 
                    });
                    const boundsLine = new THREE.LineLoop(edgesGeo, lineMat);
                    customHelper.add(boundsLine);

                    if (ax.key === "x") customHelper.lookAt(new THREE.Vector3(1, 0, 0));
                    if (ax.key === "y") customHelper.lookAt(new THREE.Vector3(0, 1, 0));
                    if (ax.key === "z") customHelper.lookAt(new THREE.Vector3(0, 0, 1));

                    scene.add(customHelper);
                    helpers[ax.key] = customHelper;
                }

                if (helpers[ax.key]) {
                    const posVec = center.clone();
                    posVec.setComponent(ax.index, s.pos);
                    helpers[ax.key].position.copy(posVec);
                    helpers[ax.key].visible = s.showPlane ?? true;
                }

            } else if (helpers[ax.key]) {
                scene.remove(helpers[ax.key]);
                helpers[ax.key].traverse((child) => {
                    if (child.geometry) child.geometry.dispose();
                    if (child.material) child.material.dispose();
                });
                helpers[ax.key] = null;
            }
        }

        const countChanged = active.length !== clipLastCountRef.current;
        forEachActorMaterial((m) => {
            m.clippingPlanes = active.length ? active : null;
            m.clipIntersection = false;
            if (countChanged) m.needsUpdate = true;
        });
        clipLastCountRef.current = active.length;

        const rw = sceneController.renderWindow;
        if (rw?.renderer) rw.renderer.localClippingEnabled = true;

        sceneController.requestRender?.();
    }, [sceneController, clip, getModelBounds, forEachActorMaterial]);

    applyClipRef.current = applyClip;

    useEffect(() => { applyClip(clip); }, [clip, applyClip]);

    // Triggers visibility for the cross-sectional clipping control panel dialog
    const openClipDialog = () => {
        const box = getModelBounds();
        if (!box.isEmpty()) {
            const min = box.min, max = box.max, c = box.getCenter(new THREE.Vector3());
            setClipBounds({ min: [min.x, min.y, min.z], max: [max.x, max.y, max.z] });
            setClip((prev) => ({
                x: { ...prev.x, pos: prev.x.on ? prev.x.pos : c.x },
                y: { ...prev.y, pos: prev.y.on ? prev.y.pos : c.y },
                z: { ...prev.z, pos: prev.z.on ? prev.z.pos : c.z },
            }));
        }
        setIsClipOpen(true);
    };

    const setAxis = (key, patch) => setClip((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));

    // Disposes and systematically purges all loaded clipping geometries and auxiliary components
    const clearClip = () => {
        if (sceneController?.scene) {
            const helpers = clipHelpersRef.current;
            for (const key in helpers) {
                if (helpers[key]) {
                    sceneController.scene.remove(helpers[key]);
                    helpers[key].traverse((child) => {
                        if (child.geometry) child.geometry.dispose();
                        if (child.material) child.material.dispose();
                    });
                    helpers[key] = null;
                }
            }
        }
        setClip({
            x: { on: false, pos: 0, flip: false, showPlane: true },
            y: { on: false, pos: 0, flip: false, showPlane: true },
            z: { on: false, pos: 0, flip: false, showPlane: true },
        });
    };

    const handleOpenClick = () => { if (fileInputRef.current) fileInputRef.current.click(); };

    // Execution pipeline handling internal data parses for .vtk and .vtp files
    const handleFileChange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const isVTK = file.name.endsWith(".vtk");
        const isVTP = file.name.endsWith(".vtp");
        if (!isVTK && !isVTP) { alert("Only supports .vtk or .vtp files"); return; }

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const polyData = isVTK
                    ? new VTKLegacyReader().parse(event.target.result)
                    : new VTPReader().parse(event.target.result);

                const mapper = new PolyDataMapper().setInputData(polyData).setLookupTable(new LookupTable());
                mapper.setInterpolateScalarsBeforeMapping(true);
                mapper.getLookupTable().setNumberOfColors(12);
                
                const actor = new Actor(mapper, file.name);
                actor.showModelWithEdges();

                if (sceneController && typeof sceneController.AddToRenderer === "function") {
                    sceneController.AddToRenderer(actor, { showContour: showContour });
                } else {
                    sceneController.scene.add(actor);
                    sceneController.updateClipping();
                    sceneController.fitView();
                }
                applyClipRef.current?.();
                onSceneChanged?.();
            } catch (err) {
                console.error(err);
                alert(`Cannot read file: ${err.message}`);
            }
        };
        if (isVTK) reader.readAsText(file); else reader.readAsArrayBuffer(file);
        e.target.value = "";
    };

    const handleFitView = () => {
        const tryFitView = () => {
            if (!sceneController || typeof sceneController.fitView !== "function") return false;
            sceneController.fitView();
            return true;
        };
        if (tryFitView()) return;
        requestAnimationFrame(() => { if (!tryFitView()) window.setTimeout(tryFitView, 50); });
    };

    const handleSetView = (viewName) => {
        if (!sceneController || typeof sceneController.setView !== "function") return;
        sceneController.setView(viewName);
    };

    const handleResetView = () => {
        if (!sceneController || typeof sceneController.resetView !== "function") return;
        sceneController.resetView();
    };

    // Drops and flushes out loaded simulation components inside the visualization context
    const handleClearScene = () => {
        if (!sceneController || !sceneController.scene) return;
        const scene = sceneController.scene;
        for (let i = scene.children.length - 1; i >= 0; i--) {
            const child = scene.children[i];
            if (child.isActor) {
                scene.remove(child);
                if (child.geometry) child.geometry.dispose();
                if (child.material) {
                    if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
                    else child.material.dispose();
                }
            }
        }
        if (sceneController._actorCounter !== undefined) sceneController._actorCounter = 0;
        if (typeof sceneController.updateClipping === "function") sceneController.updateClipping();
        if (sceneController.scalarBar) sceneController.scalarBar.setVisible(false);
        onSceneChanged?.();
    };

    const handleOpenBoxDialog = () => setIsOpenDialog(true);
    const handleConfirmAddBox = () => {
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
    const handleInputChange = (e) => {
        const { name, value } = e.target;
        setBoxDimensions(prev => ({ ...prev, [name]: value }));
    };

    const handleToggleContour = () => {
        if (!sceneController) return;
        const nextState = !showContour;
        setShowContour(nextState);
        if (typeof sceneController.PlotContour === "function") sceneController.PlotContour(nextState);
        onSceneChanged?.();
    };

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
        <div className="ribbon-toolbar" style={{ background: toolbarBg, borderBottom: borderStyle, color: textColor, transition: "all 0.15s ease" }}>
            <input type="file" ref={fileInputRef} style={{ display: "none" }} accept=".vtk,.vtp" onChange={handleFileChange} />

            {/* Ribbon Interface Header Tab Switchers */}
            <div className="ribbon-tabs" style={{ display: "flex", gap: "2px", padding: "4px 4px 0 4px" }}>
                {["home", "modify", "shape", "view", "help"].map((tab) => {
                    const isActive = activeTab === tab;
                    let tabStyle = {
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
                        >
                            {tab.charAt(0).toUpperCase() + tab.slice(1)}
                        </button>
                    );
                })}
            </div>

            {/* Ribbon Segment Container Control Groups */}
            <div className="ribbon-body" style={{ background: bodyBg, borderTop: borderStyle, display: "flex", gap: "10px", padding: "6px", marginTop: "-1px" }}>
                
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
                                    onClick={handleOpenClick}
                                />
                                <RibbonButton 
                                    icon="fitcontent" 
                                    label="Reset" 
                                    hotkey="Esc"
                                    instruction="Restore target view position vector alignments back to default coordinates state parameters."
                                    textColor={textColor}
                                    onClick={handleResetView}
                                />
                            </div>
                            <div className="ribbon-group-title" style={{ backgroundColor: groupTitleBg, color: groupTitleColor }}>File & Reset</div>
                        </div>
                        <div className="ribbon-group" style={{ borderRight: borderStyle, paddingRight: "8px" }}>
                            <div className="ribbon-group-content" style={{ display: "flex", gap: "6px" }}>
                                <RibbonButton 
                                    icon="setting" 
                                    label="Settings" 
                                    instruction="Open systems parameters configurations window panel to adapt default renderer targets."
                                    textColor={textColor}
                                    onClick={onOpenSettings}
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
                                    onClick={handleClearScene}
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
                                    onClick={openClipDialog}
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
                                onClick={handleOpenBoxDialog}
                            />
                        </div>
                        <div className="ribbon-group-title" style={{ backgroundColor: groupTitleBg, color: groupTitleColor }}>Primitives</div>
                    </div>
                )}

                {/* Viewport Projection Category */}
                {activeTab === "view" && (
                    <>
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
                                        onClick={() => handleSetView(view)}
                                    />
                                ))}

                                <div className="ribbon-separator" style={{ borderLeft: borderStyle, height: "20px", margin: "0 4px" }}></div>
                                
                                <RibbonButton 
                                    icon="fit-view" 
                                    label="Fit" 
                                    instruction="Re-scale camera viewing frustum bounds parameters encapsulating every existing model geometry."
                                    textColor={textColor}
                                    onClick={handleFitView}
                                />
                            </div>
                            <div className="ribbon-group-title" style={{ backgroundColor: groupTitleBg, color: groupTitleColor }}>Orientations & Camera</div>
                        </div>

                        {/* Viewport Split Partition Layout Controls */}
                        <div className="ribbon-group" style={{ borderRight: borderStyle, paddingRight: "8px" }}>
                            <div className="ribbon-group-content" style={{ display: "flex", gap: "6px" }}>
                                <RibbonButton 
                                    icon="split" 
                                    label="Split View" 
                                    instruction="Toggle multi-view viewport configuration layout dividing the central render node space horizontally."
                                    textColor={textColor}
                                    active={isSplit}
                                    activeBtnBg={activeBtnBg}
                                    onClick={onToggleSplit}
                                />
                                <RibbonButton 
                                    icon="link" 
                                    label="Link View" 
                                    instruction="Synchronize rotation, panning, and zoom transforms variables across dual partitioned viewports."
                                    textColor={textColor}
                                    active={(isViewLinked && isSplit)}
                                    activeBtnBg={activeBtnBg}
                                    disabled={!isSplit}
                                    onClick={onToggleViewLink}
                                />
                            </div>
                            <div className="ribbon-group-title" style={{ backgroundColor: groupTitleBg, color: groupTitleColor }}>Layouts</div>
                        </div>

                        {/* Structural Layer Auxiliary Visibility Elements */}
                        <div className="ribbon-group" style={{ borderRight: borderStyle, paddingRight: "8px" }}>
                            <div className="ribbon-group-content" style={{ display: "flex", gap: "6px" }}>
                                <RibbonButton 
                                    icon="grid" label="Grid" textColor={textColor} active={showGrid} activeBtnBg={activeBtnBg} onClick={onToggleGrid}
                                    instruction="Toggle global reference coordinate workspace base ground grid visibility status."
                                />
                                <RibbonButton 
                                    icon="axes" label="Axes" textColor={textColor} active={showAxes} activeBtnBg={activeBtnBg} onClick={onToggleAxes}
                                    instruction="Toggle visible local origin coordinate tracking system directional vector arrow indicators."
                                />
                                <RibbonButton 
                                    icon="camera-orientation" label="Cam Nav" textColor={textColor} active={sceneController?.showCameraNav} activeBtnBg={activeBtnBg}
                                    instruction="Toggle navigation direction orientation interactive block cube inside active view views."
                                    onClick={() => {
                                        if (sceneController && typeof sceneController.ToggleCameraNav === "function") {
                                            sceneController.ToggleCameraNav();
                                            onSceneChanged?.(); 
                                        }
                                    }}
                                />
                                <RibbonButton 
                                    icon="ruler" label="Ruler" textColor={textColor} active={showRuler} activeBtnBg={activeBtnBg} onClick={onToggleRuler}
                                    instruction="Toggle mouse pointer metrics measuring tool to determine distance between surface coordinates nodes."
                                />
                                <RibbonButton 
                                    icon="notes" label="Notes" textColor={textColor} active={showTextBlock} activeBtnBg={activeBtnBg} onClick={onToggleTextBlock}
                                    instruction="Display on-screen presentation text fields editor block for context tracking documentation."
                                />
                                <RibbonButton 
                                    icon="L-contour-3d" label="Contour" textColor={textColor} active={showContour} activeBtnBg={activeBtnBg} onClick={handleToggleContour}
                                    instruction="Render post-processing continuous isoline color map gradients derived from calculated node arrays."
                                />
                            </div>
                            <div className="ribbon-group-title" style={{ backgroundColor: groupTitleBg, color: groupTitleColor }}>Display Toggles</div>
                        </div>
                    </>
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
                                onClick={() => alert("FEA Viewer Version 1.0.0")}
                            />
                        </div>
                        <div className="ribbon-group-title" style={{ backgroundColor: groupTitleBg, color: groupTitleColor }}>Support</div>
                    </div>
                )}
            </div>

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
            />
        </div>
    );
}