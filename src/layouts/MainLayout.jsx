import { useState, useCallback, useEffect, useRef } from "react";
import Toolbar from "../layouts/Toolbar"; 
import Scene from "../viewer/Scene";
import Sidebar from "./Sidebar";
import StatusBar from "./StatusBar";
import * as THREE from "three";

export default function MainLayout() {
    const [sceneController1, setSceneController1] = useState(null);
    const [sceneController2, setSceneController2] = useState(null);
    const [isSplit, setIsSplit] = useState(false);
    const [isViewLinked, setIsViewLinked] = useState(true);
    const [isDragging, setIsDragging] = useState(false);
    
    // --- Các trạng thái hiển thị thanh công cụ ---
    const [showTextBlock, setShowTextBlock] = useState(false); 
    const [showAxes, setShowAxes] = useState(true);
    const [showRuler, setShowRuler] = useState(true);
    const [showGrid, setShowGrid] = useState(false); 
    
    const workspaceRef = useRef(null);
    const sidebarRef = useRef(null);
    const sceneContainerRef = useRef(null); 
    const currentWidthRef = useRef(290); 

    // TẠO SCENE DÙNG CHUNG CHO CẢ 2 VIEWPORTS
    const sharedSceneRef = useRef(new THREE.Scene());
    useEffect(() => {
        sharedSceneRef.current.background = new THREE.Color(0xffffff);
    }, []);

    const startResizing = useCallback((e) => {
        e.preventDefault();
        setIsDragging(true);

        if (sceneContainerRef.current) {
            const currentRect = sceneContainerRef.current.getBoundingClientRect();
            sceneContainerRef.current.style.width = `${currentRect.width}px`;
            sceneContainerRef.current.style.flexGrow = "0";
            sceneContainerRef.current.style.flexShrink = "0";
        }
    }, []);

    useEffect(() => {
        const handleGlobalHotkeys = async (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
                e.preventDefault();
            }

            if (e.key === "F11") {
                e.preventDefault();
                try {
                    if (document.fullscreenElement) {
                        await document.exitFullscreen();
                    } else {
                        await document.documentElement.requestFullscreen();
                    }
                } catch (err) {
                    console.error(`Error transitioning to fullscreen mode: ${err.message}`);
                }
            }
        };

        window.addEventListener("keydown", handleGlobalHotkeys);
        return () => window.removeEventListener("keydown", handleGlobalHotkeys);
    }, []);

    useEffect(() => {
        if (!isDragging) return;

        const doDrag = (e) => {
            if (!workspaceRef.current) return;

            const workspaceRect = workspaceRef.current.getBoundingClientRect();
            const newWidth = e.clientX - workspaceRect.left;
            const minAllowedWidth = 200;
            const maxAllowedWidth = 500; 

            if (newWidth >= minAllowedWidth && newWidth <= maxAllowedWidth) {
                currentWidthRef.current = newWidth;
                if (sidebarRef.current) {
                    sidebarRef.current.style.width = `${newWidth}px`;
                }
            }
        };

        const stopDrag = () => {
            setIsDragging(false);
            
            if (sceneContainerRef.current) {
                sceneContainerRef.current.style.width = "auto";
                sceneContainerRef.current.style.flexGrow = "1";
                sceneContainerRef.current.style.flexShrink = "1";
            }

            setTimeout(() => {
                if (sceneController1 && typeof sceneController1.onResize === "function") sceneController1.onResize();
                if (sceneController2 && typeof sceneController2.onResize === "function") sceneController2.onResize();
                window.dispatchEvent(new Event('resize'));
            }, 30);
        };

        window.addEventListener("mousemove", doDrag);
        window.addEventListener("mouseup", stopDrag);

        return () => {
            window.removeEventListener("mousemove", doDrag);
            window.removeEventListener("mouseup", stopDrag);
        };
    }, [isDragging, sceneController1, sceneController2]);

    // LẮNG NGHE IS_SPLIT ĐỂ ĐỒNG BỘ CAMERA KHI VỪA KHỞI CHẠY VIEWPORT 2
    useEffect(() => {
        const timer = setTimeout(() => {
            if (sceneController1 && typeof sceneController1.onResize === "function") {
                sceneController1.onResize();
            }
            if (sceneController2 && typeof sceneController2.onResize === "function") {
                sceneController2.onResize();
            }
            window.dispatchEvent(new Event('resize'));

            // Nếu chế độ Split hoạt động và cả 2 controller đã sẵn sàng
            if (isSplit && sceneController1 && sceneController2) {
                const camCtrl1 = sceneController1.cameraController;
                const camCtrl2 = sceneController2.cameraController;

                if (camCtrl1 && camCtrl2) {
                    // Ép camera 2 copy nguyên trạng thái (Vị trí, hướng xoay) từ camera 1
                    camCtrl2.state.copy(camCtrl1.state);
                    camCtrl2.camera.zoom = camCtrl1.camera.zoom;
                    camCtrl2.camera.updateProjectionMatrix();

                    // Yêu cầu bộ điều khiển camera 2 cập nhật lại ma trận hiển thị lập tức
                    if (typeof camCtrl2._applyStateToCamera === "function") camCtrl2._applyStateToCamera();
                    if (typeof camCtrl2._updateClipping === "function") camCtrl2._updateClipping();
                    if (typeof camCtrl2._requestRender === "function") camCtrl2._requestRender();
                }
            }
        }, 50);

        return () => clearTimeout(timer);
    }, [isSplit, sceneController1, sceneController2]);

    useEffect(() => {
        if (!isSplit || !isViewLinked || !sceneController1 || !sceneController2) return;

        const camCtrl1 = sceneController1.cameraController;
        const camCtrl2 = sceneController2.cameraController;
        if (!camCtrl1 || !camCtrl2) return;

        let isSyncing = false;

        const syncCameras = (sourceCtrl, targetCtrl) => {
            if (isSyncing) return;
            isSyncing = true;

            targetCtrl.state.copy(sourceCtrl.state);
            targetCtrl.camera.zoom = sourceCtrl.camera.zoom;
            targetCtrl.camera.updateProjectionMatrix();

            targetCtrl._applyStateToCamera();
            targetCtrl._updateClipping();
            targetCtrl._requestRender();

            isSyncing = false;
        };

        const handleCam1Change = () => syncCameras(camCtrl1, camCtrl2);
        const handleCam2Change = () => syncCameras(camCtrl2, camCtrl1);

        camCtrl1.addEventListener?.('change', handleCam1Change);
        camCtrl2.addEventListener?.('change', handleCam2Change);

        handleCam1Change();

        return () => {
            camCtrl1.removeEventListener?.('change', handleCam1Change);
            camCtrl2.removeEventListener?.('change', handleCam2Change);
        };
    }, [isSplit, isViewLinked, sceneController1, sceneController2]);

    return (
        <div className="main-layout" style={{ 
            display: "flex", flexDirection: "column", height: "100vh", width: "100vw",
            background: "#f3f3f3", fontFamily: "Segoe UI, Tahoma, Geneva, Verdana, sans-serif",
            overflow: "hidden", userSelect: isDragging ? "none" : "auto" 
        }}>
            
            <Toolbar 
                sceneController={sceneController1} 
                isSplit={isSplit} 
                onToggleSplit={() => setIsSplit(!isSplit)} 
                isViewLinked={isViewLinked}
                onToggleViewLink={() => setIsViewLinked((v) => !v)}
                showTextBlock={showTextBlock}
                onToggleTextBlock={() => setShowTextBlock(!showTextBlock)}
                showAxes={showAxes}
                onToggleAxes={() => setShowAxes(!showAxes)}
                showRuler={showRuler}
                onToggleRuler={() => setShowRuler(!showRuler)}
                showGrid={showGrid}
                onToggleGrid={() => setShowGrid(!showGrid)}
            />
            
            <div ref={workspaceRef} className="workspace-container" style={{ display: "flex", flexGrow: 1, minHeight: 0, width: "100%", position: "relative" }}>
                
                <aside ref={sidebarRef} style={{ width: `${currentWidthRef.current}px`, minWidth: 0, flexShrink: 0, background: "#fcfcfc", borderRight: "1px solid #d0d0d0", display: "flex", flexDirection: "column", overflow: "hidden" }}>
                    <Sidebar sceneController={sceneController1} />
                </aside>

                <div className="sidebar-splitter" onMouseDown={startResizing} style={{ width: "4px", cursor: "col-resize", background: isDragging ? "#007acc" : "transparent", zIndex: 10, position: "relative", flexShrink: 0, transition: "background 0.15s ease" }} onMouseEnter={(e) => { if (!isDragging) e.currentTarget.style.background = "#e0e0e0"; }} onMouseLeave={(e) => { if (!isDragging) e.currentTarget.style.background = "transparent"; }} />

                <main 
                    ref={sceneContainerRef}
                    className="scene-view-container" 
                    style={{ 
                        flexGrow: 1, flexShrink: 1, minWidth: 0, position: "relative",
                        background: "#eef2f7", pointerEvents: isDragging ? "none" : "auto",
                        overflow: "hidden", display: "flex", flexDirection: "row"
                    }}
                >
                    {/* Viewport 1 */}
                    <div style={{ flex: "1 1 50%", width: isSplit ? "50%" : "100%", height: "100%", position: "relative", borderRight: isSplit ? "2px solid #bbb" : "none", boxSizing: "border-box" }}>
                        <Scene 
                            viewportIndex={1}
                            sharedScene={sharedSceneRef.current}
                            onControllerReady={setSceneController1} 
                            showTextBlock={showTextBlock}
                            showAxes={showAxes}
                            showRuler={showRuler}
                            showGrid={showGrid}
                        />
                        {isSplit && <div style={{ position: 'absolute', top: 8, left: 8, background: 'rgba(0,0,0,0.6)', color: '#fff', padding: '4px 8px', fontSize: 11, borderRadius: 3, pointerEvents: 'none', fontWeight: 600, zIndex: 100 }}>Viewport 1</div>}
                    </div>

                    {/* Viewport 2 */}
                    {isSplit && (
                        <div style={{ flex: "1 1 50%", width: "50%", height: "100%", position: "relative", boxSizing: "border-box" }}>
                            <Scene 
                                viewportIndex={2}
                                sharedScene={sharedSceneRef.current}
                                onControllerReady={setSceneController2} 
                                showTextBlock={showTextBlock}
                                showAxes={showAxes}
                                showRuler={showRuler}
                                showGrid={showGrid}
                            />
                            <div style={{ position: 'absolute', top: 8, left: 8, background: 'rgba(0,0,0,0.6)', color: '#fff', padding: '4px 8px', fontSize: 11, borderRadius: 3, pointerEvents: 'none', fontWeight: 600, zIndex: 100 }}>Viewport 2</div>
                        </div>
                    )}
                </main>
                
            </div>

            <StatusBar sceneController={sceneController1} />
        </div>
    );
}