import { useState } from "react";

export default function Toolbar({ sceneController }) {
    // State to track the active ribbon tab
    const [activeTab, setActiveTab] = useState("home");
    
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

    const handleResetView = () => {
        if (!sceneController || !sceneController.controls) return;
        sceneController.controls.reset();
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
    };

    return (
        <div className="ribbon-bar">
            {/* 1. SpaceClaim Style Tab Headers Header */}
            <div className="ribbon-tabs">
                <button 
                    className={`ribbon-tab-header ${activeTab === "home" ? "active" : ""}`}
                    onClick={() => setActiveTab("home")}
                >
                    Home
                </button>
                <button 
                    className={`ribbon-tab-header ${activeTab === "display" ? "active" : ""}`}
                    onClick={() => setActiveTab("display")}
                >
                    Display
                </button>
            </div>

            {/* 2. Ribbon Content Panel */}
            <div className="ribbon-content-panel">
                
                {/* --- HOME TAB --- */}
                {activeTab === "home" && (
                    <div className="ribbon-tab-pane animate-fade-in">
                        
                        {/* Group 1: Orient (Buttons align horizontally, text below icons) */}
                        <div className="ribbon-group">
                            <div className="ribbon-group-content">
                                <button className="ribbon-btn" onClick={handleFitView}>
                                    <span className="ribbon-icon">🔍</span>
                                    <span className="ribbon-label">Fit View</span>
                                </button>
                                <button className="ribbon-btn" onClick={handleResetView}>
                                    <span className="ribbon-icon">🔄</span>
                                    <span className="ribbon-label">Reset View</span>
                                </button>
                            </div>
                            <div className="ribbon-group-title">Orient</div>
                        </div>

                        <div className="ribbon-divider" />

                        {/* Group 2: Edit Geometry */}
                        <div className="ribbon-group">
                            <div className="ribbon-group-content">
                                <button className="ribbon-btn ribbon-btn-danger" onClick={handleClearScene}>
                                    <span className="ribbon-icon">🗑️</span>
                                    <span className="ribbon-label">Clear Scene</span>
                                </button>
                            </div>
                            <div className="ribbon-group-title">Edit Geometry</div>
                        </div>

                    </div>
                )}

                {/* --- DISPLAY TAB --- */}
                {activeTab === "display" && (
                    <div className="ribbon-tab-pane animate-fade-in">
                        
                        {/* Group 1: Visibility Controls */}
                        <div className="ribbon-group">
                            <div className="ribbon-group-content">
                                <button className="ribbon-btn" onClick={() => console.log("Toggle Grid")}>
                                    <span className="ribbon-icon">🌐</span>
                                    <span className="ribbon-label">Toggle Grid</span>
                                </button>
                                <button className="ribbon-btn" onClick={() => console.log("Wireframe")}>
                                    <span className="ribbon-icon">🕸️</span>
                                    <span className="ribbon-label">Wireframe</span>
                                </button>
                            </div>
                            <div className="ribbon-group-title">Visibility</div>
                        </div>

                    </div>
                )}

            </div>
        </div>
    );
}