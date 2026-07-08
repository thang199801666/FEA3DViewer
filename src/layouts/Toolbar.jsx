import { useState, useRef, useEffect, useCallback } from "react"; 
import * as THREE from "three";
import "./Toolbar.css"; 
import { VTKLegacyReader, VTPReader, LookupTable, PolyDataMapper, Actor } from "../threejsVTK";
import SectionDialog from "./SectionDialog"; 

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

    // ------------------------------------------------------------------
    // SECTION / CLIP PLANES STATE
    // ------------------------------------------------------------------
    const [isClipOpen, setIsClipOpen] = useState(false);
    const [clip, setClip] = useState({
        x: { on: false, pos: 0, flip: false },
        y: { on: false, pos: 0, flip: false },
        z: { on: false, pos: 0, flip: false },
    });
    const [clipBounds, setClipBounds] = useState({ min: [-1, -1, -1], max: [1, 1, 1] });

    const clipPlanesRef = useRef({
        x: new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0),
        y: new THREE.Plane(new THREE.Vector3(0, -1, 0), 0),
        z: new THREE.Plane(new THREE.Vector3(0, 0, -1), 0),
    });
    const clipHelpersRef = useRef({ x: null, y: null, z: null });
    const clipLastCountRef = useRef(0);
    const applyClipRef = useRef(null);

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
            x: { on: false, pos: 0, flip: false },
            y: { on: false, pos: 0, flip: false },
            z: { on: false, pos: 0, flip: false },
        });
    };

    const handleOpenClick = () => { if (fileInputRef.current) fileInputRef.current.click(); };

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


                console.log("externalSurface =", actor.externalSurface, "| keepOuterShell =", actor.keepOuterShell);

                const surfTris = actor.surface.geometry.index
                    ? actor.surface.geometry.index.count / 3
                    : actor.surface.geometry.attributes.position.count / 3;
                console.log("surface tris (đã lọc) =", surfTris);

                if (actor.mapper) {
                    const raw = actor.mapper.buildGeometry();
                    const rawTris = raw.index ? raw.index.count / 3 : raw.attributes.position.count / 3;
                    console.log("raw mapper tris =", rawTris);
                }

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

    return (
        <div className={`ribbon-toolbar ${theme === "dark" ? "theme-dark" : "theme-light"}`}>
            <input type="file" ref={fileInputRef} style={{ display: "none" }} accept=".vtk" onChange={handleFileChange} />

            {/* TABS HEADER */}
            <div className="ribbon-tabs">
                <button className={`ribbon-tab-btn ${activeTab === "home" ? "active" : ""}`} onClick={() => setActiveTab("home")}>Home</button>
                <button className={`ribbon-tab-btn ${activeTab === "modify" ? "active" : ""}`} onClick={() => setActiveTab("modify")}>Modify</button>
                <button className={`ribbon-tab-btn ${activeTab === "shape" ? "active" : ""}`} onClick={() => setActiveTab("shape")}>Shape</button>
                <button className={`ribbon-tab-btn ${activeTab === "view" ? "active" : ""}`} onClick={() => setActiveTab("view")}>View</button>
                <button className={`ribbon-tab-btn ${activeTab === "help" ? "active" : ""}`} onClick={() => setActiveTab("help")}>Help</button>
            </div>

            {/* RIBBON BODY */}
            <div className="ribbon-body">
                {activeTab === "home" && (
                    <>
                        <div className="ribbon-group">
                            <div className="ribbon-group-content">
                                <button className="ribbon-btn" onClick={handleOpenClick} title="Open VTK file from computer">
                                    <span className="ribbon-icon">📂</span>
                                    <span className="ribbon-label">Open</span>
                                </button>
                                <button className="ribbon-btn" onClick={handleResetView} title="Reset to default orientation view">
                                    <span className="ribbon-icon">🏠</span>
                                    <span className="ribbon-label">Reset</span>
                                </button>
                            </div>
                            <div className="ribbon-group-title">File & Reset</div>
                        </div>
                        <div className="ribbon-group">
                            <div className="ribbon-group-content">
                                <button className="ribbon-btn" onClick={onOpenSettings} title="System configuration">
                                    <span className="ribbon-icon">⚙️</span>
                                    <span className="ribbon-label">Settings</span>
                                </button>
                            </div>
                            <div className="ribbon-group-title">Configuration</div>
                        </div>
                    </>
                )}

                {activeTab === "modify" && (
                    <>
                        <div className="ribbon-group">
                            <div className="ribbon-group-content">
                                <button className="ribbon-btn" onClick={handleClearScene} title="Clear all objects in the scene">
                                    <span className="ribbon-icon">🗑️</span>
                                    <span className="ribbon-label">Clear All</span>
                                </button>
                            </div>
                            <div className="ribbon-group-title">Scene Actions</div>
                        </div>
                        <div className="ribbon-group">
                            <div className="ribbon-group-content">
                                <button
                                    className={`ribbon-btn ${(clip.x.on || clip.y.on || clip.z.on) ? "active" : ""}`}
                                    onClick={openClipDialog}
                                    title="Cut model using X/Y/Z planes and shift via sliders"
                                >
                                    <span className="ribbon-icon">✂️</span>
                                    <span className="ribbon-label">Section</span>
                                </button>
                            </div>
                            <div className="ribbon-group-title">Clipping</div>
                        </div>
                    </>
                )}

                {activeTab === "shape" && (
                    <div className="ribbon-group">
                        <div className="ribbon-group-content">
                            <button className="ribbon-btn" onClick={handleOpenBoxDialog} title="Add a primitive Box shape">
                                <span className="ribbon-icon">📦</span>
                                <span className="ribbon-label">Box</span>
                            </button>
                        </div>
                        <div className="ribbon-group-title">Primitives</div>
                    </div>
                )}

                {activeTab === "view" && (
                    <>
                        <div className="ribbon-group">
                            {/* HORIZONTAL LAYOUT FOR 7 VIEW ORIENTATIONS + FIT VIEW */}
                            <div className="ribbon-group-content horizontal-views-layout">
                                <button className="ribbon-btn ribbon-btn-geo" onClick={() => handleSetView("front")}>FRONT</button>
                                <button className="ribbon-btn ribbon-btn-geo" onClick={() => handleSetView("back")}>BACK</button>
                                <button className="ribbon-btn ribbon-btn-geo" onClick={() => handleSetView("top")}>TOP</button>
                                <button className="ribbon-btn ribbon-btn-geo" onClick={() => handleSetView("bottom")}>BOTTOM</button>
                                <button className="ribbon-btn ribbon-btn-geo" onClick={() => handleSetView("left")}>LEFT</button>
                                <button className="ribbon-btn ribbon-btn-geo" onClick={() => handleSetView("right")}>RIGHT</button>
                                <button className="ribbon-btn ribbon-btn-geo ISO" onClick={() => handleSetView("iso")}>ISO</button>
                                
                                <div className="ribbon-separator"></div>

                                <button className="ribbon-btn" onClick={handleFitView} title="Zoom to fit window screen">
                                    <span className="ribbon-icon">🔍</span>
                                    <span className="ribbon-label">Fit</span>
                                </button>
                            </div>
                            <div className="ribbon-group-title">Orientations & Camera</div>
                        </div>
                        <div className="ribbon-group">
                            <div className="ribbon-group-content">
                                <button className={`ribbon-btn ${isSplit ? "active" : ""}`} onClick={onToggleSplit}>
                                    <span className="ribbon-icon">🥞</span>
                                    <span className="ribbon-label">Split View</span>
                                </button>
                                <button 
                                    className={`ribbon-btn ${isViewLinked && isSplit ? "active" : ""}`} 
                                    onClick={onToggleViewLink}
                                    disabled={!isSplit}
                                    title={isSplit ? "Link cameras between different views" : "Only available when Split View is enabled"}
                                >
                                    <span className="ribbon-icon">🔗</span>
                                    <span className="ribbon-label">Link View</span>
                                </button>
                            </div>
                            <div className="ribbon-group-title">Layouts</div>
                        </div>
                        <div className="ribbon-group">
                            <div className="ribbon-group-content">
                                <button className={`ribbon-btn ${showGrid ? "active" : ""}`} onClick={onToggleGrid}>
                                    <span className="ribbon-icon">🌐</span>
                                    <span className="ribbon-label">Grid</span>
                                </button>
                                
                                {/* SEPARATE: AXES BUTTON (ORIGIN AXES) */}
                                <button className={`ribbon-btn ${showAxes ? "active" : ""}`} onClick={onToggleAxes} title="Show/hide origin coordinate axes">
                                    <span className="ribbon-icon">📐</span>
                                    <span className="ribbon-label">Axes</span>
                                </button>

                                {/* SEPARATE: CAM NAV TOGGLE BUTTON (ENABLED BY DEFAULT) */}
                                <button 
                                    className={`ribbon-btn ${sceneController?.showCameraNav ? "active" : ""}`} 
                                    onClick={() => {
                                        if (sceneController && typeof sceneController.ToggleCameraNav === "function") {
                                            sceneController.ToggleCameraNav();
                                            onSceneChanged?.(); // Trigger toolbar re-render to synchronize active state class
                                        }
                                    }} 
                                    title="Show/hide camera navigation block (Cube / Compass / Navigation)"
                                >
                                    <span className="ribbon-icon">🧭</span>
                                    <span className="ribbon-label">Cam Nav</span>
                                </button>

                                <button className={`ribbon-btn ${showRuler ? "active" : ""}`} onClick={onToggleRuler}>
                                    <span className="ribbon-icon">📏</span>
                                    <span className="ribbon-label">Ruler</span>
                                </button>
                                <button className={`ribbon-btn ${showTextBlock ? "active" : ""}`} onClick={onToggleTextBlock}>
                                    <span className="ribbon-icon">📝</span>
                                    <span className="ribbon-label">Notes</span>
                                </button>
                                <button className={`ribbon-btn ${showContour ? "active" : ""}`} onClick={handleToggleContour} title="Activate Plot Contour to show/hide scalar color data field">
                                    <span className="ribbon-icon">🌈</span>
                                    <span className="ribbon-label">Contour</span>
                                </button>
                            </div>
                            <div className="ribbon-group-title">Display Toggles</div>
                        </div>
                    </>
                )}

                {activeTab === "help" && (
                    <div className="ribbon-group">
                        <div className="ribbon-group-content">
                            <a className="ribbon-btn" href="#documentation" target="_blank" rel="noreferrer">
                                <span className="ribbon-icon">📖</span>
                                <span className="ribbon-label">Docs</span>
                            </a>
                            <button className="ribbon-btn" onClick={() => alert("FEA Viewer Version 1.0.0")}>
                                <span className="ribbon-icon">ℹ️</span>
                                <span className="ribbon-label">About</span>
                            </button>
                        </div>
                        <div className="ribbon-group-title">Support</div>
                    </div>
                )}
            </div>

            {/* BOX PRIMITIVE DIALOG */}
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