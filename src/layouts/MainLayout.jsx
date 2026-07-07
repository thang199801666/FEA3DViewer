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
    
    // Quản lý kéo ngang (Sidebar & Scene)
    const [isDragging, setIsDragging] = useState(false);
    const [isHoveredSplitter, setIsHoveredSplitter] = useState(false);
    
    // --- State quản lý Theme ---
    const [theme, setTheme] = useState("dark");
    const isDark = theme === "dark";

    // --- State quản lý Mouse Navigation Style ---
    const [mouseStyle, setMouseStyle] = useState("Blender"); // Mặc định là Blender theo yêu cầu

    // --- State quản lý Display Mode của Actor ---
    const [displayMode, setDisplayMode] = useState("modelWithEdges"); // Mặc định khớp với Actor

    const [sceneVersion, setSceneVersion] = useState(0);

    const [showTextBlock, setShowTextBlock] = useState(false); 
    const [showAxes, setShowAxes] = useState(true);
    const [showRuler, setShowRuler] = useState(true);
    const [showGrid, setShowGrid] = useState(false); 
    
    const workspaceRef = useRef(null);
    const sidebarRef = useRef(null);
    const sceneContainerRef = useRef(null); 
    const currentWidthRef = useRef(290); 

    const sharedSceneRef = useRef(new THREE.Scene());

    const triggerSceneUpdate = useCallback(() => {
        setSceneVersion(v => v + 1);
    }, []);

    // --- Hàm xử lý khi thay đổi Mouse Style từ StatusBar ---
    const handleMouseStyleChange = useCallback((style) => {
        setMouseStyle(style);
        
        // Cập nhật cấu hình xuống Core Engine tương tác của Viewport 1
        if (sceneController1?.interactionController) {
            sceneController1.interactionController.setNavigationStyle(style);
        }
        // Cập nhật cấu hình xuống Core Engine tương tác của Viewport 2 (nếu đang bật Split)
        if (sceneController2?.interactionController) {
            sceneController2.interactionController.setNavigationStyle(style);
        }
    }, [sceneController1, sceneController2]);

    // --- Hàm xử lý khi thay đổi Display Mode từ StatusBar ---
    const handleDisplayModeChange = useCallback((mode) => {
        setDisplayMode(mode);

        // Actors nằm trong shared scene, duyệt 1 lần là đủ.
        // Ưu tiên scene của controller (đảm bảo đúng scene đang render), fallback về sharedScene.
        const scene = sceneController1?.scene || sceneController2?.scene || sharedSceneRef.current;
        if (scene) {
            scene.traverse((obj) => {
                if (obj.isActor && typeof obj.setDisplayMode === "function") {
                    obj.setDisplayMode(mode);
                }
            });
        }

        // Refresh cả hai viewport
        sceneController1?.requestRender?.();
        sceneController2?.requestRender?.();
    }, [sceneController1, sceneController2]);

    // Lắng nghe khi các controller vừa khởi tạo xong để map đúng style mặc định ban đầu
    useEffect(() => {
        if (sceneController1?.interactionController) {
            sceneController1.interactionController.setNavigationStyle(mouseStyle);
        }
    }, [sceneController1, mouseStyle]);

    useEffect(() => {
        if (sceneController2?.interactionController) {
            sceneController2.interactionController.setNavigationStyle(mouseStyle);
        }
    }, [sceneController2, mouseStyle]);


    const startResizing = useCallback((e) => {
        e.preventDefault();
        setIsDragging(true);
    }, []);

    const stopResizing = useCallback(() => {
        setIsDragging(false);
    }, []);

    const resize = useCallback((e) => {
        if (!isDragging || !workspaceRef.current || !sidebarRef.current || !sceneContainerRef.current) return;
        
        const containerRect = workspaceRef.current.getBoundingClientRect();
        let newWidth = e.clientX - containerRect.left;
        
        if (newWidth < 240) newWidth = 240;
        if (newWidth > 500) newWidth = 500;
        
        currentWidthRef.current = newWidth;
        sidebarRef.current.style.width = `${newWidth}px`;
        sceneContainerRef.current.style.width = `calc(100% - ${newWidth}px)`;
    }, [isDragging]);

    useEffect(() => {
        if (isDragging) {
            window.addEventListener("mousemove", resize);
            window.addEventListener("mouseup", stopResizing);
        } else {
            window.removeEventListener("mousemove", resize);
            window.removeEventListener("mouseup", stopResizing);
        }
        return () => {
            window.removeEventListener("mousemove", resize);
            window.removeEventListener("mouseup", stopResizing);
        };
    }, [isDragging, resize, stopResizing]);

    const handleToggleSplit = useCallback(() => {
        setIsSplit(prev => !prev);
    }, []);

    const handleToggleViewLink = useCallback(() => {
        setIsViewLinked(prev => !prev);
    }, []);

    return (
        <div 
            ref={workspaceRef}
            style={{ 
                display: "flex", 
                flexDirection: "column", 
                height: "100vh", 
                width: "100vw", 
                overflow: "hidden",
                boxSizing: "border-box",
                backgroundColor: isDark ? "#121212" : "#ffffff", 
                color: isDark ? "#e0e0e0" : "#111111",           
                fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
                userSelect: isDragging ? "none" : "auto",
                transition: "background-color 0.2s, color 0.2s"
            }}
        >
            <Toolbar 
                theme={theme}
                sceneController={sceneController1} 
                onSceneChanged={triggerSceneUpdate}
                isSplit={isSplit}
                onToggleSplit={handleToggleSplit}
                isViewLinked={isViewLinked}
                onToggleViewLink={handleToggleViewLink}
                showTextBlock={showTextBlock}
                onToggleTextBlock={() => setShowTextBlock(p => !p)}
                showAxes={showAxes}
                onToggleAxes={() => setShowAxes(p => !p)}
                showRuler={showRuler}
                onToggleRuler={() => setShowRuler(p => !p)}
                showGrid={showGrid}
                onToggleGrid={() => setShowGrid(p => !p)}
            />

            <div style={{ display: "flex", flex: 1, width: "100%", overflow: "hidden", position: "relative", backgroundColor: isDark ? "#181818" : "#f0f0f0" }}>
                
                {/* SIDEBAR */}
                <aside 
                    ref={sidebarRef} 
                    style={{ 
                        width: `${currentWidthRef.current}px`, 
                        height: "100%", 
                        background: isDark ? "#181818" : "#f0f0f0", 
                        flexShrink: 0,
                        position: "relative",
                        zIndex: 10,
                        borderRight: isDark ? "1px solid #2d2d2d" : "1px solid #ccc",
                        display: "flex",
                        flexDirection: "column",
                        overflow: "hidden",
                        transition: "background 0.2s, border-right 0.2s"
                    }}
                >
                    <Sidebar sceneController={sceneController1} sceneVersion={sceneVersion} theme={theme} />
                </aside>

                {/* --- SPLITTER CHÍNH --- */}
                <div 
                    onMouseDown={startResizing}
                    onMouseEnter={() => setIsHoveredSplitter(true)}
                    onMouseLeave={() => setIsHoveredSplitter(false)}
                    style={{
                        width: "8px",
                        cursor: "col-resize",
                        background: isDragging ? "rgba(33, 150, 243, 0.08)" : "transparent",
                        position: "relative",
                        zIndex: 20,
                        flexShrink: 0,
                        marginLeft: "-4px",
                        marginRight: "-4px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center"
                    }}
                >
                    <div style={{
                        position: "absolute",
                        left: "3px",
                        top: 0,
                        bottom: 0,
                        width: isDragging || isHoveredSplitter ? "2px" : "1px",
                        backgroundColor: isDragging || isHoveredSplitter ? "#2196F3" : (isDark ? "#2d2d2d" : "#ccc"),
                        transition: "background-color 0.15s, width 0.15s"
                    }} />

                    <div style={{
                        position: "absolute",
                        display: "flex",
                        flexDirection: "column",
                        gap: "3px",
                        zIndex: 25,
                        opacity: isHoveredSplitter || isDragging ? 1 : 0.25,
                        transition: "opacity 0.15s"
                    }}>
                        {[1, 2, 3].map((item) => (
                            <div key={item} style={{
                                width: "3px",
                                height: "3px",
                                borderRadius: "50%",
                                backgroundColor: isDragging || isHoveredSplitter ? "#ffffff" : (isDark ? "#888" : "#555")
                            }} />
                        ))}
                    </div>
                </div>

                <main 
                    ref={sceneContainerRef}
                    style={{ 
                        width: `calc(100% - ${currentWidthRef.current}px)`, 
                        height: "100%", 
                        display: "flex", 
                        position: "relative",
                        overflow: "hidden",
                        gap: isSplit ? "2px" : "0", 
                        backgroundColor: isDark ? "#2d2d2d" : "#ccc"  
                    }}
                >
                    {/* Viewport 1 */}
                    <div style={{ flex: "1 1 50%", width: isSplit ? "50%" : "100%", height: "100%", position: "relative", boxSizing: "border-box", background: isDark ? "#1e1e1e" : "#f5f5f5" }}>
                        <Scene 
                            viewportIndex={1}
                            sharedScene={sharedSceneRef.current}
                            onControllerReady={setSceneController1} 
                            otherController={sceneController2} 
                            isViewLinked={isViewLinked} 
                            showTextBlock={showTextBlock}
                            showAxes={showAxes}
                            showRuler={showRuler}
                            showGrid={showGrid}
                        />
                        {isSplit && (
                            <div style={{ 
                                position: 'absolute', top: 12, left: 12, 
                                background: isDark ? 'rgba(30, 30, 30, 0.75)' : 'rgba(255, 255, 255, 0.85)', 
                                color: isDark ? '#aaaaaa' : '#333333', 
                                padding: '4px 10px', fontSize: 11, borderRadius: 4, 
                                border: isDark ? '1px solid #444444' : '1px solid #bbb', pointerEvents: 'none', 
                                fontWeight: 500, letterSpacing: '0.5px', zIndex: 100 
                            }}>
                                VIEWPORT 1
                            </div>
                        )}
                    </div>

                    {/* Viewport 2 */}
                    {isSplit && (
                        <div style={{ flex: "1 1 50%", width: "50%", height: "100%", position: "relative", boxSizing: "border-box", background: isDark ? "#1e1e1e" : "#f5f5f5" }}>
                            <Scene 
                                viewportIndex={2}
                                sharedScene={sharedSceneRef.current}
                                onControllerReady={setSceneController2} 
                                otherController={sceneController1}
                                isViewLinked={isViewLinked}
                                showTextBlock={showTextBlock}
                                showAxes={showAxes}
                                showRuler={showRuler}
                                showGrid={showGrid}
                            />
                            <div style={{ 
                                position: 'absolute', top: 12, left: 12, 
                                background: isDark ? 'rgba(30, 30, 30, 0.75)' : 'rgba(255, 255, 255, 0.85)', 
                                color: isDark ? '#aaaaaa' : '#333333', 
                                padding: '4px 10px', fontSize: 11, borderRadius: 4, 
                                border: isDark ? '1px solid #444444' : '1px solid #bbb', pointerEvents: 'none', 
                                fontWeight: 500, letterSpacing: '0.5px', zIndex: 100 
                            }}>
                                VIEWPORT 2
                            </div>
                        </div>
                    )}
                </main>
                
            </div>

            {/* Cập nhật StatusBar để nhận các thuộc tính điều khiển Mouse Style + Display Mode */}
            <StatusBar 
                sceneController={sceneController1} 
                theme={theme} 
                onThemeChange={setTheme} 
                mouseStyle={mouseStyle}
                onMouseStyleChange={handleMouseStyleChange}
                displayMode={displayMode}
                onDisplayModeChange={handleDisplayModeChange}
            />
        </div>
    );
}