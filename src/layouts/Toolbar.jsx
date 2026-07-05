import { useState } from "react";

export default function Toolbar({ 
    sceneController, 
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
    onToggleGrid
}) {
    const [activeTab, setActiveTab] = useState("view");
    
    const handleFitView = () => {
        const tryFitView = () => {
            if (!sceneController || typeof sceneController.fitView !== "function") {
                return false;
            }
            sceneController.fitView();
            return true;
        };

        if (tryFitView()) return;

        requestAnimationFrame(() => {
            if (!tryFitView()) {
                window.setTimeout(tryFitView, 50);
            }
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
        
        const toRemove = [];
        sceneController.scene.traverse((child) => {
            if (child.isMesh) toRemove.push(child);
        });
        
        toRemove.forEach((mesh) => {
            mesh.geometry.dispose();
            if (Array.isArray(mesh.material)) {
                mesh.material.forEach((m) => m.dispose());
            } else {
                mesh.material.dispose();
            }
            sceneController.scene.remove(mesh);
        });

        if (typeof sceneController.updateClipping === "function") {
            sceneController.updateClipping();
        }
    };

    const styles = {
        ribbonBar: {
            fontFamily: 'Segoe UI, Tahoma, Geneva, Verdana, sans-serif',
            border: '1px solid #ccc',
            backgroundColor: '#f5f5f5',
            padding: '5px'
        },
        tabHeaders: {
            borderBottom: '1px solid #ccc',
            paddingBottom: '2px'
        },
        tabHeaderBtn: {
            padding: '6px 15px',
            cursor: 'pointer',
            background: 'none',
            border: 'none',
            borderBottom: '2px solid transparent',
            fontWeight: '600'
        },
        tabHeaderBtnActive: {
            borderBottom: '2px solid #0078d4',
            color: '#0078d4'
        },
        contentPanel: {
            backgroundColor: '#fff',
            padding: '8px',
            minHeight: '95px'
        },
        group: {
            display: 'inline-block',
            verticalAlign: 'top',
            borderRight: '1px solid #ddd',
            paddingRight: '8px',
            marginRight: '8px',
            textAlign: 'center'
        },
        groupContent: {
            whiteSpace: 'nowrap'
        },
        groupTitle: {
            fontSize: '11px',
            color: '#666',
            marginTop: '5px',
            textAlign: 'center'
        },
        squareBtn: {
            display: 'inline-block',
            verticalAlign: 'top',
            width: '65px',
            height: '65px',
            padding: '5px',
            margin: '0 2px',
            border: '1px solid transparent',
            backgroundColor: 'transparent',
            cursor: 'pointer',
            textAlign: 'center',
            borderRadius: '3px',
            boxSizing: 'border-box',
            transition: 'all 0.15s ease'
        },
        activeSquareBtn: {
            backgroundColor: '#e0eef9',
            border: '1px solid #70b5e8'
        },
        icon: {
            display: 'block',
            fontSize: '20px',
            marginBottom: '4px',
            lineHeight: '1'
        },
        label: {
            display: 'block',
            fontSize: '11px',
            color: '#333',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
        }
    };

    return (
        <div className="ribbon-bar" style={styles.ribbonBar}>
            <div className="ribbon-tabs" style={styles.tabHeaders}>
                <button 
                    style={{ ...styles.tabHeaderBtn, ...(activeTab === "home" ? styles.tabHeaderBtnActive : {}) }}
                    onClick={() => setActiveTab("home")}
                >
                    Home
                </button>
                <button 
                    style={{ ...styles.tabHeaderBtn, ...(activeTab === "view" ? styles.tabHeaderBtnActive : {}) }}
                    onClick={() => setActiveTab("view")}
                >
                    View
                </button>
                <button 
                    style={{ ...styles.tabHeaderBtn, ...(activeTab === "display" ? styles.tabHeaderBtnActive : {}) }}
                    onClick={() => setActiveTab("display")}
                >
                    Display
                </button>
            </div>

            <div className="ribbon-content-panel" style={styles.contentPanel}>
                {activeTab === "home" && (
                    <div className="ribbon-tab-pane">
                        <div className="ribbon-group" style={styles.group}>
                            <div className="ribbon-group-content" style={styles.groupContent}>
                                <button className="ribbon-btn ribbon-btn-danger" style={styles.squareBtn} onClick={handleClearScene} title="Clear Scene">
                                    <span style={styles.icon}>🗑️</span>
                                    <span style={styles.label}>Clear</span>
                                </button>
                            </div>
                            <div className="ribbon-group-title" style={styles.groupTitle}>Edit Geometry</div>
                        </div>
                    </div>
                )}

                {activeTab === "view" && (
                    <div className="ribbon-tab-pane">
                        <div className="ribbon-group" style={styles.group}>
                            <div className="ribbon-group-content" style={styles.groupContent}>
                                <button className="ribbon-btn" style={styles.squareBtn} onClick={() => handleSetView("front")} title="Front View"><span style={styles.icon}>⏹️</span><span style={styles.label}>Front</span></button>
                                <button className="ribbon-btn" style={styles.squareBtn} onClick={() => handleSetView("back")} title="Back View"><span style={styles.icon}>⏹️</span><span style={styles.label}>Back</span></button>
                                <button className="ribbon-btn" style={styles.squareBtn} onClick={() => handleSetView("left")} title="Left View"><span style={styles.icon}>◀️</span><span style={styles.label}>Left</span></button>
                                <button className="ribbon-btn" style={styles.squareBtn} onClick={() => handleSetView("right")} title="Right View"><span style={styles.icon}>▶️</span><span style={styles.label}>Right</span></button>
                                <button className="ribbon-btn" style={styles.squareBtn} onClick={() => handleSetView("top")} title="Top View"><span style={styles.icon}>🔼</span><span style={styles.label}>Top</span></button>
                                <button className="ribbon-btn" style={styles.squareBtn} onClick={() => handleSetView("bottom")} title="Bottom View"><span style={styles.icon}>🔽</span><span style={styles.label}>Bottom</span></button>
                                <button className="ribbon-btn" style={styles.squareBtn} onClick={handleResetView} title="Iso View"><span style={styles.icon}>🏠</span><span style={styles.label}>Iso</span></button>
                                
                                <span style={{ display: 'inline-block', borderLeft: '1px dashed #ccc', height: '40px', margin: '0 6px', verticalAlign: 'middle' }} />

                                <button className="ribbon-btn" style={styles.squareBtn} onClick={handleFitView} title="Fit View">
                                    <span style={styles.icon}>🔍</span>
                                    <span style={styles.label}>Fit</span>
                                </button>
                            </div>
                            <div className="ribbon-group-title" style={styles.groupTitle}>Camera Navigate</div>
                        </div>
                    </div>
                )}

                {activeTab === "display" && (
                    <div className="ribbon-tab-pane">
                        <div className="ribbon-group" style={styles.group}>
                            <div className="ribbon-group-content" style={styles.groupContent}>
                                <button 
                                    className="ribbon-btn" 
                                    style={{ ...styles.squareBtn, ...(showTextBlock ? styles.activeSquareBtn : {}) }} 
                                    onClick={onToggleTextBlock}
                                    title="Toggle Text Block"
                                >
                                    <span style={styles.icon}>📝</span>
                                    <span style={styles.label}>Text Block</span>
                                </button>
                                <button 
                                    className="ribbon-btn" 
                                    style={{ ...styles.squareBtn, ...(showAxes ? styles.activeSquareBtn : {}) }} 
                                    onClick={onToggleAxes}
                                    title="Toggle Orientation Triad"
                                >
                                    <span style={styles.icon}>📐</span>
                                    <span style={styles.label}>Axes Triad</span>
                                </button>
                                <button 
                                    className="ribbon-btn" 
                                    style={{ ...styles.squareBtn, ...(showRuler ? styles.activeSquareBtn : {}) }} 
                                    onClick={onToggleRuler}
                                    title="Toggle Measurement Ruler"
                                >
                                    <span style={styles.icon}>📏</span>
                                    <span style={styles.label}>Ruler</span>
                                </button>
                            </div>
                            <div className="ribbon-group-title" style={styles.groupTitle}>Show/Hide</div>
                        </div>

                        <div className="ribbon-group" style={styles.group}>
                            <div className="ribbon-group-content" style={styles.groupContent}>
                                <button 
                                    className="ribbon-btn" 
                                    style={{ ...styles.squareBtn, ...(showGrid ? styles.activeSquareBtn : {}) }} 
                                    onClick={onToggleGrid}
                                    title="Toggle Infinite Plane Grid"
                                >
                                    <span style={styles.icon}>🌐</span>
                                    <span style={styles.label}>Grid</span>
                                </button>
                                <button className="ribbon-btn" style={styles.squareBtn} onClick={() => console.log("Wireframe")}>
                                    <span style={styles.icon}>🕸️</span>
                                    <span style={styles.label}>Wire</span>
                                </button>

                                <button 
                                    className="ribbon-btn" 
                                    style={{ ...styles.squareBtn, ...(isSplit ? styles.activeSquareBtn : {}) }} 
                                    onClick={onToggleSplit}
                                    title="Split Viewport Horizontally"
                                >
                                    <span style={styles.icon}>🥞</span>
                                    <span style={styles.label}>Split View</span>
                                </button>

                                <button 
                                    className="ribbon-btn" 
                                    style={{ 
                                        ...styles.squareBtn, 
                                        ...(isViewLinked && isSplit ? styles.activeSquareBtn : {}),
                                        opacity: isSplit ? 1 : 0.4,
                                        cursor: isSplit ? 'pointer' : 'not-allowed'
                                    }} 
                                    onClick={onToggleViewLink}
                                    disabled={!isSplit}
                                    title={isSplit ? "Link/Unlink Camera" : "Chỉ dùng khi Split View đang mở"}
                                >
                                    <span style={styles.icon}>🔗</span>
                                    <span style={styles.label}>Link View</span>
                                </button>
                            </div>
                            <div className="ribbon-group-title" style={styles.groupTitle}>Visibility & Layout</div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}