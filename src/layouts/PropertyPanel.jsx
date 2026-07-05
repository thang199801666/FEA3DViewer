export default function PropertyPanel() {
    return (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px", color: "#333" }}>
            <tbody>
                <tr style={rowStyle}><td style={labelStyle}>Name</td><td style={valueStyle}>Cube_Component</td></tr>
                <tr style={rowStyle}><td style={labelStyle}>Vertices</td><td style={valueStyle}>8</td></tr>
                <tr style={rowStyle}><td style={labelStyle}>Faces</td><td style={valueStyle}>12</td></tr>
                <tr style={rowStyle}><td style={labelStyle}>Material Type</td><td style={valueStyle}>Isotropic</td></tr>
            </tbody>
        </table>
    );
}

const rowStyle = { borderBottom: "1px solid #ededed" };
const labelStyle = { padding: "6px 4px", color: "#666", width: "40%", windowSelect: "none" };
const valueStyle = { padding: "6px 4px", fontWeight: "500", color: "#111" };