import { useState, useRef } from "react"; 
import "./Toolbar.css"; 
import { VTKLegacyReader, VTPReader, LookupTable, PolyDataMapper, Actor } from "../threejsVTK";

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
    // Trạng thái bật/tắt hiển thị scalar (contour). MẶC ĐỊNH: TẮT.
    const [showContour, setShowContour] = useState(false);
    
    const fileInputRef = useRef(null);

    const handleOpenClick = () => {
        if (fileInputRef.current) {
            fileInputRef.current.click();
        }
    };

    const handleFileChange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const isVTK = file.name.endsWith(".vtk");
        const isVTP = file.name.endsWith(".vtp");
        if (!isVTK && !isVTP) { alert("Chỉ hỗ trợ .vtk hoặc .vtp"); return; }

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const polyData = isVTK
                    ? new VTKLegacyReader().parse(event.target.result)
                    : new VTPReader().parse(event.target.result);

                const mapper = new PolyDataMapper()
                    .setInputData(polyData)
                    .setLookupTable(new LookupTable());

                mapper.setInterpolateScalarsBeforeMapping(true);
                mapper.getLookupTable().setNumberOfColors(12);
                
                const actor = new Actor(mapper, file.name);
                actor.showModelWithEdges();

                if (sceneController && typeof sceneController.AddToRenderer === "function") {
                    sceneController.AddToRenderer(actor, {
                        showContour: showContour
                    });
                } else {
                    sceneController.scene.add(actor);
                    sceneController.updateClipping();
                    sceneController.fitView();
                }

                onSceneChanged?.();
            } catch (err) {
                console.error(err);
                alert(`Không đọc được file: ${err.message}`);
            }
        };

        if (isVTK) reader.readAsText(file);
        else reader.readAsArrayBuffer(file);
        e.target.value = "";
    };

    const handleFitView = () => {
        const tryFitView = () => {
            if (!sceneController || typeof sceneController.fitView !== "function") return false;
            sceneController.fitView();
            return true;
        };
        if (tryFitView()) return;
        requestAnimationFrame(() => {
            if (!tryFitView()) window.setTimeout(tryFitView, 50);
        });
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
                    if (Array.isArray(child.material)) {
                        child.material.forEach(m => m.dispose());
                    } else {
                        child.material.dispose();
                    }
                }
            }
        }

        if (sceneController._actorCounter !== undefined) {
            sceneController._actorCounter = 0;
        }

        if (typeof sceneController.updateClipping === "function") {
            sceneController.updateClipping();
        }

        if (sceneController.scalarBar) {
            sceneController.scalarBar.setVisible(false);
        }

        if (typeof onSceneChanged === "function") {
            onSceneChanged();
        }
    };

    const handleOpenBoxDialog = () => {
        setIsOpenDialog(true);
    };

    const handleConfirmAddBox = () => {
        if (sceneController && typeof sceneController.addBoxActor === "function") {
            const { length, width, height } = boxDimensions;
            const boxActor = sceneController.addBoxActor(Number(length), Number(width), Number(height));

            if (boxActor) {
                if (typeof sceneController.AddToRenderer === "function") {
                    sceneController.AddToRenderer(boxActor, {
                        showContour: showContour
                    });
                }
            }

            if (typeof onSceneChanged === "function") {
                onSceneChanged();
            }
        }
        setIsOpenDialog(false);
    };

    const handleInputChange = (e) => {
        const { name, value } = e.target;
        setBoxDimensions(prev => ({ ...prev, [name]: value }));
    };

    // CHUYỂN SANG GỌI PHƯƠNG THỨC TRUNG TÂM PlotContour TRONG SCENE
    const handleToggleContour = () => {
        if (!sceneController) return;
        const nextState = !showContour;
        setShowContour(nextState);

        if (typeof sceneController.PlotContour === "function") {
            sceneController.PlotContour(nextState);
        }
        onSceneChanged?.();
    };

    return (
        <div className={`ribbon-toolbar ${theme === "dark" ? "theme-dark" : "theme-light"}`}>
            <input 
                type="file" 
                ref={fileInputRef} 
                style={{ display: "none" }} 
                accept=".vtk" 
                onChange={handleFileChange} 
            />

            <div className="ribbon-tabs">
                <button className={`ribbon-tab-btn ${activeTab === "home" ? "active" : ""}`} onClick={() => setActiveTab("home")}>Home</button>
                <button className={`ribbon-tab-btn ${activeTab === "modify" ? "active" : ""}`} onClick={() => setActiveTab("modify")}>Modify</button>
                <button className={`ribbon-tab-btn ${activeTab === "shape" ? "active" : ""}`} onClick={() => setActiveTab("shape")}>Shape</button>
                <button className={`ribbon-tab-btn ${activeTab === "view" ? "active" : ""}`} onClick={() => setActiveTab("view")}>View</button>
                <button className={`ribbon-tab-btn ${activeTab === "help" ? "active" : ""}`} onClick={() => setActiveTab("help")}>Help</button>
            </div>

            <div className="ribbon-body">
                {activeTab === "home" && (
                    <>
                        <div className="ribbon-group">
                            <div className="ribbon-group-content">
                                <button className="ribbon-btn" onClick={handleOpenClick} title="Mở file VTK từ máy tính">
                                    <span className="ribbon-icon">📂</span>
                                    <span className="ribbon-label">Open</span>
                                </button>
                                <button className="ribbon-btn" onClick={handleResetView} title="Đặt lại hướng nhìn mặc định">
                                    <span className="ribbon-icon">🏠</span>
                                    <span className="ribbon-label">Reset</span>
                                </button>
                            </div>
                            <div className="ribbon-group-title">File & Reset</div>
                        </div>

                        <div className="ribbon-group">
                            <div className="ribbon-group-content">
                                <button className="ribbon-btn" onClick={onOpenSettings} title="Cấu hình hệ thống">
                                    <span className="ribbon-icon">⚙️</span>
                                    <span className="ribbon-label">Settings</span>
                                </button>
                            </div>
                            <div className="ribbon-group-title">Configuration</div>
                        </div>
                    </>
                )}

                {activeTab === "modify" && (
                    <div className="ribbon-group">
                        <div className="ribbon-group-content">
                            <button className="ribbon-btn" onClick={handleClearScene} title="Xóa toàn bộ đối tượng trong Scene">
                                <span className="ribbon-icon">🗑️</span>
                                <span className="ribbon-label">Clear All</span>
                            </button>
                        </div>
                        <div className="ribbon-group-title">Scene Actions</div>
                    </div>
                )}

                {activeTab === "shape" && (
                    <div className="ribbon-group">
                        <div className="ribbon-group-content">
                            <button className="ribbon-btn" onClick={handleOpenBoxDialog} title="Thêm một hình khối Box">
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
                            <div className="ribbon-group-content grid-views-layout">
                                <button className="ribbon-btn ribbon-btn-geo" onClick={() => handleSetView("front")}>FRONT</button>
                                <button className="ribbon-btn ribbon-btn-geo" onClick={() => handleSetView("back")}>BACK</button>
                                <button className="ribbon-btn ribbon-btn-geo" onClick={() => handleSetView("top")}>TOP</button>
                                <button className="ribbon-btn ribbon-btn-geo" onClick={() => handleSetView("bottom")}>BOTTOM</button>
                                <button className="ribbon-btn ribbon-btn-geo" onClick={() => handleSetView("left")}>LEFT</button>
                                <button className="ribbon-btn ribbon-btn-geo" onClick={() => handleSetView("right")}>RIGHT</button>
                                <button className="ribbon-btn ribbon-btn-geo ISO" onClick={() => handleSetView("iso")}>ISO</button>
                                <button className="ribbon-btn" onClick={handleFitView} title="Zoom vừa khít màn hình">
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
                                    title={isSplit ? "Liên kết Camera giữa các View" : "Chỉ dùng khi Split View đang mở"}
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
                                <button className={`ribbon-btn ${showAxes ? "active" : ""}`} onClick={onToggleAxes}>
                                    <span className="ribbon-icon">📐</span>
                                    <span className="ribbon-label">Axes</span>
                                </button>
                                <button className={`ribbon-btn ${showRuler ? "active" : ""}`} onClick={onToggleRuler}>
                                    <span className="ribbon-icon">📏</span>
                                    <span className="ribbon-label">Ruler</span>
                                </button>
                                <button className={`ribbon-btn ${showTextBlock ? "active" : ""}`} onClick={onToggleTextBlock}>
                                    <span className="ribbon-icon">📝</span>
                                    <span className="ribbon-label">Notes</span>
                                </button>
                                {/* THAY ĐỔI LABEL VÀ TITLE THEO YÊU CẦU */}
                                <button className={`ribbon-btn ${showContour ? "active" : ""}`} onClick={handleToggleContour} title="Kích hoạt Plot Contour ẩn/hiện trường dữ liệu màu sắc">
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
        </div>
    );
}