import { useState, useCallback, useEffect, useRef } from "react";
import Toolbar from "../layouts/Toolbar"; 
import Scene from "../viewer/Scene";
import Sidebar from "./Sidebar";
import StatusBar from "./StatusBar";

export default function MainLayout() {
    const [sceneController, setSceneController] = useState(null);
    const [isDragging, setIsDragging] = useState(false);
    
    const workspaceRef = useRef(null);
    const sidebarRef = useRef(null);
    const currentWidthRef = useRef(290); // Default CAD sidebar width

    // Handler to initiate sidebar resizing
    const startResizing = useCallback((e) => {
        e.preventDefault();
        setIsDragging(true);
    }, []);

    // 1. Hotkeys Hook: Handles Ctrl+S (Save) and F11 (Toggle Fullscreen)
    useEffect(() => {
        const handleGlobalHotkeys = async (e) => {
            // Save Hotkey: Ctrl+S or Cmd+S
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
                e.preventDefault();
                // Put your custom serialization or data-saving logic here
                // console.log("Workspace layout/mesh saved!");
            }

            // Fullscreen Hotkey: F11
            if (e.key === "F11") {
                e.preventDefault(); // Stop native browser window fullscreen zoom

                try {
                    if (document.fullscreenElement) {
                        await document.exitFullscreen();
                    } else {
                        // Requests fullscreen for the whole app workspace
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

    // 2. Dragging Hook: Listens to mouse movements ONLY while actively dragging the splitter
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
                
                if (sceneController && typeof sceneController.onResize === "function") {
                    sceneController.onResize();
                }
            }
        };

        const stopDrag = () => {
            setIsDragging(false);
            window.dispatchEvent(new Event('resize'));
        };

        window.addEventListener("mousemove", doDrag);
        window.addEventListener("mouseup", stopDrag);

        return () => {
            window.removeEventListener("mousemove", doDrag);
            window.removeEventListener("mouseup", stopDrag);
        };
    }, [isDragging, sceneController]);

    // 3. Fullscreen Canvas Adjuster: Fires when entering/leaving full screen to let WebGL handle container shifts
    useEffect(() => {
        const handleFullscreenResize = () => {
            if (sceneController && typeof sceneController.onResize === "function") {
                sceneController.onResize();
            }
        };

        document.addEventListener("fullscreenchange", handleFullscreenResize);
        return () => document.removeEventListener("fullscreenchange", handleFullscreenResize);
    }, [sceneController]);

    return (
        <div className="main-layout" style={{ 
            display: "flex", 
            flexDirection: "column", 
            height: "100vh", 
            width: "100vw",
            background: "#f3f3f3", // SpaceClaim inspired clean workspace background
            fontFamily: "Segoe UI, Tahoma, Geneva, Verdana, sans-serif",
            overflow: "hidden",
            userSelect: isDragging ? "none" : "auto" 
        }}>
            
            {/* SpaceClaim Ribbon / Header */}
            <Toolbar sceneController={sceneController} />
            
            {/* Main Content Area */}
            <div 
                ref={workspaceRef}
                className="workspace-container" 
                style={{ 
                    display: "flex", 
                    flexGrow: 1, 
                    minHeight: 0,
                    width: "100%",
                    position: "relative"
                }}
            >
                
                {/* Left Stacked Sidebar (Structure Tree + Properties) */}
                <aside 
                    ref={sidebarRef}
                    style={{ 
                        width: `${currentWidthRef.current}px`, 
                        minWidth: 0,
                        flexShrink: 0,
                        background: "#fcfcfc", 
                        borderRight: "1px solid #d0d0d0",
                        display: "flex",
                        flexDirection: "column",
                        overflow: "hidden"
                    }}
                >
                    <Sidebar sceneController={sceneController} />
                </aside>

                {/* Vertical Workspace Splitter */}
                <div
                    className="sidebar-splitter"
                    onMouseDown={startResizing}
                    style={{
                        width: "4px",
                        cursor: "col-resize",
                        background: isDragging ? "#007acc" : "transparent",
                        zIndex: 10,
                        position: "relative",
                        flexShrink: 0,
                        transition: "background 0.15s ease",
                    }}
                    onMouseEnter={(e) => { if (!isDragging) e.currentTarget.style.background = "#e0e0e0"; }}
                    onMouseLeave={(e) => { if (!isDragging) e.currentTarget.style.background = "transparent"; }}
                />

                {/* 3D Viewport container */}
                <main className="scene-view-container" style={{ 
                    flexGrow: 1, 
                    flexShrink: 1,
                    minWidth: 0,
                    position: "relative",
                    background: "#eef2f7", // Clean CAD canvas color block
                    pointerEvents: isDragging ? "none" : "auto" 
                }}>
                    <Scene onControllerReady={setSceneController} />
                </main>
                
            </div>

            {/* Bottom Status Information */}
            <StatusBar sceneController={sceneController} />

        </div>
    );
}