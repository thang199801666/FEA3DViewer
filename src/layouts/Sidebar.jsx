import { useState, useRef, useEffect } from "react";
import ModelTree from "./ModelTree";
import PropertyPanel from "./PropertyPanel";
import "./Sidebar.css"; 

export default function Sidebar({ sceneController, sceneVersion, theme }) {
    // Tăng chiều cao mặc định ban đầu của Model Tree lên (ví dụ: 480px) để giảm chiều cao Property Panel xuống
    const [treeHeight, setTreeHeight] = useState(480); 
    const [isResizing, setIsResizing] = useState(false);
    const [isHovered, setIsHovered] = useState(false);
    const containerRef = useRef(null);

    useEffect(() => {
        if (!isResizing) return;

        const doResize = (e) => {
            if (!containerRef.current) return;
            const containerRect = containerRef.current.getBoundingClientRect();
            // Tính toán chiều cao mới dựa trên vị trí chuột đối với container
            const newHeight = e.clientY - containerRect.top;

            // Giới hạn vùng kéo: Giữ khoảng trống tối thiểu cho cả Tree và Property Panel
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
            {/* Vùng Model Tree (Sử dụng chiều cao động từ state) */}
            <div style={{ height: `${treeHeight}px`, overflowY: "auto", flexShrink: 0 }}>
                <ModelTree sceneController={sceneController} sceneVersion={sceneVersion} theme={theme} />
            </div>
            
            {/* --- SPLITTER DỌC GIỮA MODEL TREE VÀ PROPERTY PANEL --- */}
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
                {/* Đường line mảnh phân cách */}
                <div style={{
                    width: "100%",
                    height: "1px",
                    backgroundColor: isResizing || isHovered ? "#2196F3" : (isDark ? "#2d2d2d" : "#ccc")
                }} />

                {/* Dấu hiệu nhận biết kéo thả (Gân sọc 2 dòng mảnh) */}
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

            {/* Tiêu đề Property Panel */}
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

            {/* Vùng Property Panel (Tự động chiếm trọn phần diện tích còn lại ở bên dưới) */}
            <div style={{ flex: 1, overflowY: "auto", backgroundColor: isDark ? "#151515" : "#eaeaea" }}>
                <PropertyPanel theme={theme} />
            </div>
        </div>
    );
}