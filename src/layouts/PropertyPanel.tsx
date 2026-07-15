export default function PropertyPanel({ theme }) {
    const isDark = theme === "dark";

    const rowStyle = { borderBottom: isDark ? "1px solid #2d2d2d" : "1px solid #ededed" };
    const labelStyle = { padding: "6px 4px", color: isDark ? "#888" : "#666", width: "40%", userSelect: "none" };
    const valueStyle = { padding: "6px 4px", fontWeight: "500", color: isDark ? "#e0e0e0" : "#111" };

    return (
        <div style={{ padding: "10px 15px" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                <tbody>
                    <tr style={rowStyle}><td style={labelStyle}>Name</td><td style={valueStyle}>Cube_Component</td></tr>
                    <tr style={rowStyle}><td style={labelStyle}>Vertices</td><td style={valueStyle}>8</td></tr>
                    <tr style={rowStyle}><td style={labelStyle}>Faces</td><td style={valueStyle}>12</td></tr>
                    <tr style={rowStyle}><td style={labelStyle}>Material Type</td><td style={valueStyle}>Isotropic</td></tr>
                </tbody>
            </table>
        </div>
    );
}