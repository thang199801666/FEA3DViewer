import { useState } from "react";

export default function Toolbar({ sceneController }) {
    // Đổi mặc định sang tab "view" hoặc giữ "home" tùy bạn, ở đây để mặc định là "view"
    const [activeTab, setActiveTab] = useState("view");
    
    // --- Action Handlers ---
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

    // --- Định kiểu CSS inline ---
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
            whiteSpace: 'nowrap' // Giữ các button trên cùng một hàng ngang
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
            boxSizing: 'border-box'
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
            {/* 1. Tab Headers */}
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

            {/* 2. Ribbon Content Panel */}
            <div className="ribbon-content-panel" style={styles.contentPanel}>
                
                {/* --- HOME TAB --- */}
                {activeTab === "home" && (
                    <div className="ribbon-tab-pane">
                        {/* Group: Edit Geometry */}
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

                {/* --- VIEW TAB (MỚI) --- */}
                {activeTab === "view" && (
                    <div className="ribbon-tab-pane">
                        <div className="ribbon-group" style={styles.group}>
                            <div className="ribbon-group-content" style={styles.groupContent}>
                                
                                {/* 1. 6 góc chiếu kỹ thuật mặc định (Nằm trước) */}
                                <button className="ribbon-btn" style={styles.squareBtn} onClick={() => handleSetView("front")} title="Front View">
                                    <span style={styles.icon}>⏹️</span>
                                    <span style={styles.label}>Front</span>
                                </button>
                                <button className="ribbon-btn" style={styles.squareBtn} onClick={() => handleSetView("back")} title="Back View">
                                    <span style={styles.icon}>⏹️</span>
                                    <span style={styles.label}>Back</span>
                                </button>
                                <button className="ribbon-btn" style={styles.squareBtn} onClick={() => handleSetView("left")} title="Left View">
                                    <span style={styles.icon}>◀️</span>
                                    <span style={styles.label}>Left</span>
                                </button>
                                <button className="ribbon-btn" style={styles.squareBtn} onClick={() => handleSetView("right")} title="Right View">
                                    <span style={styles.icon}>▶️</span>
                                    <span style={styles.label}>Right</span>
                                </button>
                                <button className="ribbon-btn" style={styles.squareBtn} onClick={() => handleSetView("top")} title="Top View">
                                    <span style={styles.icon}>🔼</span>
                                    <span style={styles.label}>Top</span>
                                </button>
                                <button className="ribbon-btn" style={styles.squareBtn} onClick={() => handleSetView("bottom")} title="Bottom View">
                                    <span style={styles.icon}>🔽</span>
                                    <span style={styles.label}>Bottom</span>
                                </button>

                                {/* 2. Góc ISO View */}
                                <button className="ribbon-btn" style={styles.squareBtn} onClick={handleResetView} title="Iso View">
                                    <span style={styles.icon}>🏠</span>
                                    <span style={styles.label}>Iso</span>
                                </button>

                                {/* Thanh chia nhỏ nội bộ (tùy chọn) */}
                                <span style={{ display: 'inline-block', borderLeft: '1px dashed #ccc', height: '40px', margin: '0 6px', verticalAlign: 'middle' }} />

                                {/* 3. Khung Fit View (Nằm cuối cùng) */}
                                <button className="ribbon-btn" style={styles.squareBtn} onClick={handleFitView} title="Fit View">
                                    <span style={styles.icon}>🔍</span>
                                    <span style={styles.label}>Fit</span>
                                </button>
                                
                            </div>
                            <div className="ribbon-group-title" style={styles.groupTitle}>Camera Navigate</div>
                        </div>
                    </div>
                )}

                {/* --- DISPLAY TAB --- */}
                {activeTab === "display" && (
                    <div className="ribbon-tab-pane">
                        {/* Group: Visibility Controls */}
                        <div className="ribbon-group" style={styles.group}>
                            <div className="ribbon-group-content" style={styles.groupContent}>
                                <button className="ribbon-btn" style={styles.squareBtn} onClick={() => console.log("Toggle Grid")}>
                                    <span style={styles.icon}>🌐</span>
                                    <span style={styles.label}>Grid</span>
                                </button>
                                <button className="ribbon-btn" style={styles.squareBtn} onClick={() => console.log("Wireframe")}>
                                    <span style={styles.icon}>🕸️</span>
                                    <span style={styles.label}>Wire</span>
                                </button>
                            </div>
                            <div className="ribbon-group-title" style={styles.groupTitle}>Visibility</div>
                        </div>
                    </div>
                )}

            </div>
        </div>
    );
}