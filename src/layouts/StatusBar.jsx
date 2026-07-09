export default function StatusBar({ 
    sceneController, 
    theme, 
    onThemeChange,
    mouseStyle = "Blender",
    onMouseStyleChange,
    displayMode = "modelWithEdges",
    onDisplayModeChange 
}) {
    const isDark = theme === "dark";

    // Style dùng chung cho tất cả các <select> trong StatusBar
    const selectStyle = {
        background: isDark ? "#2d2d2d" : "#ffffff",
        color: isDark ? "#fff" : "#000",
        border: isDark ? "1px solid #444" : "1px solid #bbb",
        borderRadius: "3px",
        padding: "2px 6px",
        fontSize: "11px",
        outline: "none",
        cursor: "pointer",
        fontFamily: "inherit"
    };

    return (
        <div style={{
            height: "28px",
            background: isDark ? "#1e1e1e" : "#e0e0e0",
            borderTop: isDark ? "1px solid #333" : "1px solid #ccc",
            color: isDark ? "#aaa" : "#333",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 15px",
            fontSize: "12px",
            userSelect: "none",
            transition: "background 0.2s, color 0.2s"
        }}>
            {/* Bên trái */}
            <div>Status: <span style={{ color: "#4caf50", fontWeight: "bold" }}>● Ready</span></div>

            {/* Bên phải: Các cấu hình hệ thống */}
            <div style={{ display: "flex", alignItems: "center", gap: "15px" }}>

                {/* Combobox cấu hình Display Mode của Actor (đứng trước Mouse) */}
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <span style={{ fontSize: "11px", opacity: 0.8 }}>Display:</span>
                    <select
                        value={displayMode}
                        onChange={(e) => {
                            if (onDisplayModeChange) onDisplayModeChange(e.target.value);
                        }}
                        style={selectStyle}
                    >
                        <option value="modelWithEdges">Model + Edges</option>
                        <option value="modelWithoutEdges">Model</option>
                        <option value="mesh">Mesh</option>
                        <option value="wireframe">Wireframe</option>
                        <option value="boundaryEdges">Boundary Edges</option>
                    </select>
                </div>

                {/* Combobox cấu hình Mouse Input Style */}
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <span style={{ fontSize: "11px", opacity: 0.8 }}>Mouse:</span>
                    <select 
                        value={mouseStyle} 
                        onChange={(e) => {
                            if (onMouseStyleChange) onMouseStyleChange(e.target.value);
                        }}
                        style={selectStyle}
                    >
                        <option value="Abaqus">Abaqus</option>
                        <option value="Blender">Blender</option>
                        <option value="Inventor">Inventor</option>
                        <option value="NX">NX</option>
                    </select>
                </div>

                {/* Combobox chuyển đổi Theme */}
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <span style={{ fontSize: "11px", opacity: 0.8 }}>Theme:</span>
                    <select 
                        value={theme} 
                        onChange={(e) => onThemeChange(e.target.value)}
                        style={selectStyle}
                    >
                        <option value="dark">Dark Mode</option>
                        <option value="light">Light Mode</option>
                    </select>
                </div>
                
            </div>
        </div>
    );
}