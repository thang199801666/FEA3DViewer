import { useState, useRef, useEffect } from "react";
import ModelTree from "./ModelTree";
import PropertyPanel from "./PropertyPanel";

export default function Sidebar({ sceneController }) {
    const [treeHeight, setTreeHeight] = useState(350); // initial height for Structure Tree
    const [isResizing, setIsResizing] = useState(false);
    const containerRef = useRef(null);

    useEffect(() => {
        if (!isResizing) return;

        const doResize = (e) => {
            if (!containerRef.current) return;
            const containerRect = containerRef.current.getBoundingClientRect();
            const newHeight = e.clientY - containerRect.top;

            // Restrict bounds so neither panel disappears completely
            if (newHeight > 100 && newHeight < containerRect.height - 100) {
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

    return (
        <div ref={containerRef} style={{ display: "flex", flexDirection: "column", height: "100%", width: "100%" }}>
            
            {/* Top Section: Structure Tree */}
            <div style={{ height: `${treeHeight}px`, minHeight: 0, display: "flex", flexDirection: "column" }}>
                <div style={panelHeaderStyle}>Structure Tree</div>
                <div style={{ flexGrow: 1, overflowY: "auto", background: "#ffffff" }}>
                    <ModelTree sceneController={sceneController} />
                </div>
            </div>

            {/* Horizontal Sub-Splitter */}
            <div 
                onMouseDown={() => setIsResizing(true)}
                style={{
                    height: "5px",
                    cursor: "row-resize",
                    background: isResizing ? "#007acc" : "#e5e5e5",
                    borderTop: "1px solid #d0d0d0",
                    borderBottom: "1px solid #d0d0d0",
                    transition: "background 0.15s"
                }}
            />

            {/* Bottom Section: Properties Panel */}
            <div style={{ flexGrow: 1, minHeight: 0, display: "flex", flexDirection: "column", background: "#fcfcfc" }}>
                <div style={panelHeaderStyle}>Properties</div>
                <div style={{ flexGrow: 1, overflowY: "auto", padding: "10px" }}>
                    <PropertyPanel sceneController={sceneController} />
                </div>
            </div>
        </div>
    );
}

const panelHeaderStyle = {
    background: "#eaeaea",
    color: "#333",
    fontSize: "11px",
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: "0.5px",
    padding: "6px 12px",
    borderBottom: "1px solid #d0d0d0",
    userSelect: "none"
};