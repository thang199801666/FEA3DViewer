import { useState, useRef, useEffect } from "react";
import ModelTree from "./ModelTree";
import PropertyPanel from "./PropertyPanel";
import "./Sidebar.css"; 

export default function Sidebar({ sceneController, sceneVersion, theme }) {
    // Increase the initial model tree height to leave less room for the property panel.
    const [treeHeight, setTreeHeight] = useState(480); 
    const [isResizing, setIsResizing] = useState(false);
    const [isHovered, setIsHovered] = useState(false);
    const containerRef = useRef(null);

    useEffect(() => {
        if (!isResizing) return;

        const doResize = (e) => {
            if (!containerRef.current) return;
            const containerRect = containerRef.current.getBoundingClientRect();
            // Compute the new height from the mouse position inside the container.
            const newHeight = e.clientY - containerRect.top;

            // Clamp the drag range so both the tree and property panel keep usable space.
            if (newHeight > 150 && newHeight < containerRect.height - 100) {
                setTreeHeight(newHeight);
            }
        };

        const stopResize = () => setIsResizing(false);

        window.addEventListener("mousemove", doResize);
        window.addEventListener("mouseup", stopResize);
        return () => {
            window.removeEventListener("mousemove", doResize);
            window.removeEventListener("mouseup", stopResize);
        };
    }, [isResizing]);

    const isDark = theme === "dark";

    return (
        <div 
            ref={containerRef} 
            style={{ 
                display: "flex", 
                flexDirection: "column", 
                height: "100%", 
                overflow: "hidden",
                userSelect: isResizing ? "none" : "auto"
            }}
        >
            {/* Model tree area using state-driven height */}
            <div style={{ height: `${treeHeight}px`, overflowY: "auto", flexShrink: 0 }}>
                <ModelTree sceneController={sceneController} sceneVersion={sceneVersion} theme={theme} />
            </div>
            
            {/* Vertical splitter between the model tree and property panel */}
            <div 
                onMouseDown={() => setIsResizing(true)}
                onMouseEnter={() => setIsHovered(true)}
                onMouseLeave={() => setIsHovered(false)}
                style={{ 
                    height: "7px",
                    cursor: "row-resize",
                    backgroundColor: isResizing ? "rgba(33, 150, 243, 0.15)" : "transparent",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    position: "relative",
                    zIndex: 10,
                    flexShrink: 0
                }}
            >
                {/* Thin separator line */}
                <div style={{
                    width: "100%",
                    height: "1px",
                    backgroundColor: isResizing || isHovered ? "#2196F3" : (isDark ? "#2d2d2d" : "#ccc")
                }} />

                {/* Drag handle indicator */}
                <div style={{
                    position: "absolute",
                    width: "18px",
                    height: "4px",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                    opacity: isHovered || isResizing ? 1 : 0.3,
                    transition: "opacity 0.15s"
                }}>
                    <div style={{ height: "1px", backgroundColor: isResizing || isHovered ? "#2196F3" : (isDark ? "#888" : "#555") }} />
                    <div style={{ height: "1px", backgroundColor: isResizing || isHovered ? "#2196F3" : (isDark ? "#888" : "#555") }} />
                </div>
            </div>

            {/* Property panel title */}
            <div style={{ 
                padding: "6px 15px 4px 15px",
                fontSize: "11px", 
                fontWeight: "bold",
                letterSpacing: "0.5px",
                color: isDark ? "#777" : "#666",
                backgroundColor: isDark ? "#151515" : "#eaeaea",
                flexShrink: 0
            }}>
                PROPERTIES
            </div>

            {/* Property panel area fills the remaining lower space */}
            <div style={{ flex: 1, overflowY: "auto", backgroundColor: isDark ? "#151515" : "#eaeaea" }}>
                <PropertyPanel theme={theme} />
            </div>
        </div>
    );
}