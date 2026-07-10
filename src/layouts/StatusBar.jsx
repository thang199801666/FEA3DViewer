export default function StatusBar({ 
    sceneController, 
    theme, 
    onThemeChange,
    mouseStyle = "Blender",
    onMouseStyleChange,
    displayMode = "modelWithEdges",
    onDisplayModeChange 
}) {
    // Dynamic styles depending on light, dark, or Blue Office look
    let containerBg = "#e0e0e0";
    let containerColor = "#333";
    let borderTopColor = "#ccc";
    let selectBg = "#ffffff";
    let selectColor = "#000000";
    let selectBorder = "1px solid #bbb";

    if (theme === "dark") {
        containerBg = "#1e1e1e";
        containerColor = "#aaa";
        borderTopColor = "#333";
        selectBg = "#2d2d2d";
        selectColor = "#ffffff";
        selectBorder = "1px solid #444";
    } else if (theme === "blue") {
        containerBg = "#bfdbfe"; 
        containerColor = "#1e3a8a"; 
        borderTopColor = "#93c5fd";
        selectBg = "#f8fafc";
        selectColor = "#1e3a8a";
        selectBorder = "1px solid #7dd3fc";
    }

    const selectStyle = {
        background: selectBg,
        color: selectColor,
        border: selectBorder,
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
            background: containerBg,
            borderTop: `1px solid ${borderTopColor}`,
            color: containerColor,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 15px",
            fontSize: "12px",
            userSelect: "none",
            transition: "background 0.2s, color 0.2s"
        }}>
            <div>Status: <span style={{ color: theme === "blue" ? "#047857" : "#4caf50", fontWeight: "bold" }}>● Ready</span></div>

            <div style={{ display: "flex", alignItems: "center", gap: "15px" }}>
                {/* Display Mode Selector */}
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <span style={{ fontSize: "11px", opacity: 0.8 }}>Display:</span>
                    <select
                        value={displayMode}
                        onChange={(e) => onDisplayModeChange?.(e.target.value)}
                        style={selectStyle}
                    >
                        <option value="modelWithEdges">Surfaces + Edges</option>
                        <option value="modelWithoutEdges">Surfaces</option>
                        <option value="mesh">Mesh</option>
                        <option value="wireframe">Wireframe</option>
                        <option value="boundaryEdges">Edges</option>
                    </select>
                </div>

                {/* Mouse Input Style Selector */}
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <span style={{ fontSize: "11px", opacity: 0.8 }}>Mouse:</span>
                    <select 
                        value={mouseStyle} 
                        onChange={(e) => onMouseStyleChange?.(e.target.value)}
                        style={selectStyle}
                    >
                        <option value="Abaqus">Abaqus</option>
                        <option value="Blender">Blender</option>
                        <option value="Inventor">Inventor</option>
                        <option value="NX">NX</option>
                    </select>
                </div>

                {/* Theme Selector Component */}
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <span style={{ fontSize: "11px", opacity: 0.8 }}>Theme:</span>
                    <select 
                        value={theme} 
                        onChange={(e) => onThemeChange?.(e.target.value)}
                        style={selectStyle}
                    >
                        <option value="light">Light Mode</option>
                        <option value="dark">Dark Mode</option>
                        <option value="blue">Blue Theme</option>
                    </select>
                </div>
            </div>
        </div>
    );
}