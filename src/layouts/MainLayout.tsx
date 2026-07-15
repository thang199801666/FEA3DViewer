import { useState, useCallback, useEffect, useRef } from "react";
import Toolbar from "../layouts/Toolbar";
import Scene from "../viewer/Scene";
import Sidebar from "./Sidebar";
import StatusBar from "./StatusBar";
import SettingsDialog from "./SettingsDialog";
import * as THREE from "three";
import { NAV_STYLE } from "../threejsVTK";
import { createDefaultSettings } from "./settingsConfig";

// Normalize a navigation style value into a NAV_STYLE enum member.
const resolveNavStyle = (s) => {
    if (!s) return NAV_STYLE.BLENDER;
    if (Object.values(NAV_STYLE).includes(s)) return s;
    return NAV_STYLE[String(s).toUpperCase()] ?? NAV_STYLE.BLENDER;
};

export default function MainLayout() {
    const [sceneController1, setSceneController1] = useState(null);
    const [sceneController2, setSceneController2] = useState(null);

    // --- Single source of truth for every app + scene property ---
    const [settings, setSettings] = useState(createDefaultSettings());
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [measurementMode, setMeasurementMode] = useState(null);

    // Horizontal drag state (Sidebar & Scene splitter).
    const [isDragging, setIsDragging] = useState(false);
    const [isHoveredSplitter, setIsHoveredSplitter] = useState(false);

    const [sceneVersion, setSceneVersion] = useState(0);

    // --- Scene context menu state ---
    const [contextMenu, setContextMenu] = useState({ isOpen: false, x: 0, y: 0 });

    const workspaceRef = useRef(null);
    const sidebarRef = useRef(null);
    const sceneContainerRef = useRef(null);
    const currentWidthRef = useRef(290);
    const rightClickStartPosRef = useRef({ x: 0, y: 0 });

    const toolbarFileInputRef = useRef(null);
    const sharedSceneRef = useRef(new THREE.Scene());

    // --- Derived values ---
    const isDark = settings.theme === "dark";
    const navStyleEnum = resolveNavStyle(settings.navStyle);

    // --- Generic setting updaters ---
    const updateSetting = useCallback((key, value) => {
        setSettings((prev) => ({ ...prev, [key]: value }));
    }, []);
    const toggleSetting = useCallback((key) => {
        setSettings((prev) => ({ ...prev, [key]: !prev[key] }));
    }, []);

    const triggerSceneUpdate = useCallback(() => {
        setSceneVersion((v) => v + 1);
    }, []);

    const resetApplication = useCallback(() => {
        setSettings(createDefaultSettings());
        setMeasurementMode(null);
        setIsSettingsOpen(false);
        setContextMenu({ isOpen: false, x: 0, y: 0 });
        currentWidthRef.current = 290;
        if (sidebarRef.current) sidebarRef.current.style.width = "290px";
        if (sceneContainerRef.current) sceneContainerRef.current.style.width = "calc(100% - 290px)";
        sceneController1?.resetView?.();
        sceneController2?.resetView?.();
        setSceneVersion((version) => version + 1);
    }, [sceneController1, sceneController2]);

    // Apply the active display mode to every actor whenever it changes.
    useEffect(() => {
        const scene = sceneController1?.scene || sceneController2?.scene || sharedSceneRef.current;
        if (scene) {
            scene.traverse((obj) => {
                if (obj.isActor && typeof obj.setDisplayMode === "function") {
                    obj.setDisplayMode(settings.displayMode);
                }
            });
        }
        sceneController1?.requestRender?.();
        sceneController2?.requestRender?.();
    }, [settings.displayMode, sceneController1, sceneController2]);

    // One-shot camera sync when linking is enabled and both viewports are ready.
    useEffect(() => {
        if (!settings.isViewLinked || !settings.isSplit) return;
        if (!sceneController1 || !sceneController2) return;
        sceneController2.applyLinkedCamera?.(sceneController1.camera);
    }, [settings.isViewLinked, settings.isSplit, sceneController1, sceneController2]);

    // --- Sidebar splitter resizing ---
    const startResizing = useCallback((e) => {
        e.preventDefault();
        setIsDragging(true);
    }, []);

    const stopResizing = useCallback(() => {
        setIsDragging(false);
    }, []);

    const resize = useCallback(
        (e) => {
            if (!isDragging || !workspaceRef.current || !sidebarRef.current || !sceneContainerRef.current) return;

            const containerRect = workspaceRef.current.getBoundingClientRect();
            let newWidth = e.clientX - containerRect.left;

            if (newWidth < 240) newWidth = 240;
            if (newWidth > 500) newWidth = 500;

            currentWidthRef.current = newWidth;
            sidebarRef.current.style.width = `${newWidth}px`;
            sceneContainerRef.current.style.width = `calc(100% - ${newWidth}px)`;
        },
        [isDragging]
    );

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

    // --- Separate 3D drag gestures from static right-click context menu opening ---
    const handleSceneMouseDown = useCallback((e) => {
        if (e.button === 2) {
            rightClickStartPosRef.current = { x: e.clientX, y: e.clientY };
        }
    }, []);

    const handleSceneMouseUp = useCallback((e) => {
        if (e.button === 2) {
            const deltaX = Math.abs(e.clientX - rightClickStartPosRef.current.x);
            const deltaY = Math.abs(e.clientY - rightClickStartPosRef.current.y);

            // Open the menu only when movement is small enough to count as a static click.
            if (deltaX < 4 && deltaY < 4) {
                setContextMenu({
                    isOpen: true,
                    x: e.clientX,
                    y: e.clientY
                });
            }
        }
    }, []);

    const handleSceneContextMenu = useCallback((e) => {
        e.preventDefault();
    }, []);

    // Disable the browser context menu on the model tree sidebar.
    const handleSidebarContextMenu = useCallback((e) => {
        e.preventDefault();
    }, []);

    useEffect(() => {
        const closeMenu = () => {
            if (contextMenu.isOpen) setContextMenu((prev) => ({ ...prev, isOpen: false }));
        };

        const handleKeyDown = (e) => {
            const isCtrlOrCmd = e.ctrlKey || e.metaKey;
            const key = e.key.toLowerCase();

            if (isCtrlOrCmd && key === "o") {
                e.preventDefault();
                if (toolbarFileInputRef.current) {
                    toolbarFileInputRef.current.click();
                }
            }

            if (e.key === "Escape") {
                e.preventDefault();
                if (sceneController1) {
                    if (typeof sceneController1.resetView === "function") {
                        sceneController1.resetView();
                    } else if (typeof sceneController1.resetCamera === "function") {
                        sceneController1.resetCamera();
                    }
                }
            }

            if (isCtrlOrCmd && key === "s") {
                e.preventDefault();
                console.log("Ctrl+S shortcut disabled.");
            }
        };

        window.addEventListener("click", closeMenu);
        window.addEventListener("keydown", handleKeyDown);

        return () => {
            window.removeEventListener("click", closeMenu);
            window.removeEventListener("keydown", handleKeyDown);
        };
    }, [contextMenu.isOpen, sceneController1]);

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
                transition: "background-color 0.2s, color 0.2s",
            }}
        >
            <Toolbar
                theme={settings.theme}
                sceneController={sceneController1}
                onSceneChanged={triggerSceneUpdate}
                fileInputRef={toolbarFileInputRef}
                isSplit={settings.isSplit}
                onToggleSplit={() => toggleSetting("isSplit")}
                isViewLinked={settings.isViewLinked}
                onToggleViewLink={() => toggleSetting("isViewLinked")}
                showTextBlock={settings.showTextBlock}
                onToggleTextBlock={() => toggleSetting("showTextBlock")}
                showAxes={settings.showAxes}
                onToggleAxes={() => toggleSetting("showAxes")}
                showRuler={settings.showRuler}
                onToggleRuler={() => toggleSetting("showRuler")}
                showGrid={settings.showGrid}
                onToggleGrid={() => toggleSetting("showGrid")}
                measurementMode={measurementMode}
                onSetMeasurementMode={setMeasurementMode}
                onClearMeasurements={() => {
                    sceneController1?.clearMeasurements?.();
                    sceneController2?.clearMeasurements?.();
                }}
                onOpenSettings={() => setIsSettingsOpen(true)}
                onResetApp={resetApplication}
            />

            <div
                style={{
                    display: "flex",
                    flex: 1,
                    width: "100%",
                    overflow: "hidden",
                    position: "relative",
                    backgroundColor: isDark ? "#181818" : "#f0f0f0",
                }}
            >
                {/* SIDEBAR */}
                <aside
                    ref={sidebarRef}
                    onContextMenu={handleSidebarContextMenu}
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
                        transition: "background 0.2s, border-right 0.2s",
                    }}
                >
                    <Sidebar sceneController={sceneController1} sceneVersion={sceneVersion} theme={settings.theme} />
                </aside>

                {/* MAIN SPLITTER */}
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
                        justifyContent: "center",
                    }}
                >
                    <div
                        style={{
                            position: "absolute",
                            left: "3px",
                            top: 0,
                            bottom: 0,
                            width: isDragging || isHoveredSplitter ? "2px" : "1px",
                            backgroundColor: isDragging || isHoveredSplitter ? "#2196F3" : isDark ? "#2d2d2d" : "#ccc",
                            transition: "background-color 0.15s, width 0.15s",
                        }}
                    />

                    <div
                        style={{
                            position: "absolute",
                            display: "flex",
                            flexDirection: "column",
                            gap: "3px",
                            zIndex: 25,
                            opacity: isHoveredSplitter || isDragging ? 1 : 0.25,
                            transition: "opacity 0.15s",
                        }}
                    >
                        {[1, 2, 3].map((item) => (
                            <div
                                key={item}
                                style={{
                                    width: "3px",
                                    height: "3px",
                                    borderRadius: "50%",
                                    backgroundColor: isDragging || isHoveredSplitter ? "#ffffff" : isDark ? "#888" : "#555",
                                }}
                            />
                        ))}
                    </div>
                </div>

                {/* MAIN SCENE CONTAINER */}
                <main
                    ref={sceneContainerRef}
                    onContextMenu={handleSceneContextMenu}
                    onMouseDown={handleSceneMouseDown}
                    onMouseUp={handleSceneMouseUp}
                    style={{
                        width: `calc(100% - ${currentWidthRef.current}px)`,
                        height: "100%",
                        display: "flex",
                        position: "relative",
                        overflow: "hidden",
                        gap: settings.isSplit ? "2px" : "0",
                        backgroundColor: isDark ? "#2d2d2d" : "#ccc",
                    }}
                >
                    {/* Viewport 1 */}
                    <div
                        style={{
                            flex: "1 1 50%",
                            width: settings.isSplit ? "50%" : "100%",
                            height: "100%",
                            position: "relative",
                            boxSizing: "border-box",
                            background: isDark ? "#1e1e1e" : "#f5f5f5",
                        }}
                    >
                        <Scene
                            viewportIndex={1}
                            sharedScene={sharedSceneRef.current}
                            onControllerReady={setSceneController1}
                            otherController={sceneController2}
                            isViewLinked={settings.isViewLinked}
                            navStyle={navStyleEnum}
                            showTextBlock={settings.showTextBlock}
                            showAxes={settings.showAxes}
                            showRuler={settings.showRuler}
                            showGrid={settings.showGrid}
                            isGradientBackground={settings.isGradientBackground}
                            topColor={settings.topColor}
                            bottomColor={settings.bottomColor}
                            antialias={settings.antialias}
                            addDefaultLights={settings.addDefaultLights}
                            ambientIntensity={settings.ambientIntensity}
                            directionalIntensity={settings.directionalIntensity}
                            selectionMode={settings.selectionMode}
                            measurementMode={measurementMode}
                        />
                        {settings.isSplit && (
                            <div
                                style={{
                                    position: "absolute",
                                    top: 12,
                                    left: 12,
                                    background: isDark ? "rgba(30, 30, 30, 0.75)" : "rgba(255, 255, 255, 0.85)",
                                    color: isDark ? "#aaaaaa" : "#333333",
                                    padding: "4px 10px",
                                    fontSize: 11,
                                    borderRadius: 4,
                                    border: isDark ? "1px solid #444444" : "1px solid #bbb",
                                    pointerEvents: "none",
                                    fontWeight: 500,
                                    letterSpacing: "0.5px",
                                    zIndex: 100,
                                }}
                            >
                                VIEWPORT 1
                            </div>
                        )}
                    </div>

                    {/* Viewport 2 */}
                    {settings.isSplit && (
                        <div
                            style={{
                                flex: "1 1 50%",
                                width: "50%",
                                height: "100%",
                                position: "relative",
                                boxSizing: "border-box",
                                background: isDark ? "#1e1e1e" : "#f5f5f5",
                            }}
                        >
                            <Scene
                                viewportIndex={2}
                                sharedScene={sharedSceneRef.current}
                                onControllerReady={setSceneController2}
                                otherController={sceneController1}
                                isViewLinked={settings.isViewLinked}
                                navStyle={navStyleEnum}
                                showTextBlock={settings.showTextBlock}
                                showAxes={settings.showAxes}
                                showRuler={settings.showRuler}
                                showGrid={settings.showGrid}
                                isGradientBackground={settings.isGradientBackground}
                                topColor={settings.topColor}
                                bottomColor={settings.bottomColor}
                                antialias={settings.antialias}
                                addDefaultLights={settings.addDefaultLights}
                                ambientIntensity={settings.ambientIntensity}
                                directionalIntensity={settings.directionalIntensity}
                                selectionMode={settings.selectionMode}
                                measurementMode={measurementMode}
                            />
                            <div
                                style={{
                                    position: "absolute",
                                    top: 12,
                                    left: 12,
                                    background: isDark ? "rgba(30, 30, 30, 0.75)" : "rgba(255, 255, 255, 0.85)",
                                    color: isDark ? "#aaaaaa" : "#333333",
                                    padding: "4px 10px",
                                    fontSize: 11,
                                    borderRadius: 4,
                                    border: isDark ? "1px solid #444444" : "1px solid #bbb",
                                    pointerEvents: "none",
                                    fontWeight: 500,
                                    letterSpacing: "0.5px",
                                    zIndex: 100,
                                }}
                            >
                                VIEWPORT 2
                            </div>
                        </div>
                    )}
                </main>
            </div>

            <StatusBar
                theme={settings.theme}
                onThemeChange={(t) => updateSetting("theme", t)}
                mouseStyle={settings.navStyle}
                onMouseStyleChange={(s) => updateSetting("navStyle", s)}
                displayMode={settings.displayMode}
                onDisplayModeChange={(m) => updateSetting("displayMode", m)}
                selectionMode={settings.selectionMode}
                onSelectionModeChange={(m) => updateSetting("selectionMode", m)}
            />

            <SettingsDialog
                isOpen={isSettingsOpen}
                onClose={() => setIsSettingsOpen(false)}
                settings={settings}
                onSettingsChange={setSettings}
            />

            {/* CUSTOM CONTEXT MENU UI */}
            {contextMenu.isOpen && (
                <div
                    style={{
                        position: "fixed",
                        top: contextMenu.y,
                        left: contextMenu.x,
                        backgroundColor: isDark ? "#242424" : "#ffffff",
                        color: isDark ? "#e0e0e0" : "#333333",
                        border: isDark ? "1px solid #3d3d3d" : "1px solid #cccccc",
                        boxShadow: "0px 4px 12px rgba(0,0,0,0.25)",
                        borderRadius: "4px",
                        zIndex: 1000,
                        padding: "4px 0",
                        minWidth: "160px",
                        fontSize: "13px",
                    }}
                >
                    <div
                        onClick={() => sceneController1?.resetCamera?.() || sceneController1?.resetView?.()}
                        style={{ padding: "8px 12px", cursor: "pointer", transition: "background 0.1s" }}
                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = isDark ? "#383838" : "#f0f0f0")}
                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                    >
                        Reset View
                    </div>
                    <div
                        onClick={() => toggleSetting("isSplit")}
                        style={{ padding: "8px 12px", cursor: "pointer", transition: "background 0.1s" }}
                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = isDark ? "#383838" : "#f0f0f0")}
                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                    >
                        {settings.isSplit ? "Unsplit Viewport" : "Split Viewport"}
                    </div>
                    <hr style={{ border: "none", borderTop: isDark ? "1px solid #3d3d3d" : "1px solid #eee", margin: "4px 0" }} />
                    <div
                        onClick={() => setIsSettingsOpen(true)}
                        style={{ padding: "8px 12px", cursor: "pointer", transition: "background 0.1s" }}
                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = isDark ? "#383838" : "#f0f0f0")}
                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                    >
                        Properties...
                    </div>
                </div>
            )}
        </div>
    );
}
