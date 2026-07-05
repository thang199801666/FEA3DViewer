export default function StatusBar({ sceneController }) {
    return (
        <div style={{
            height: "28px",
            background: "#1e1e1e",
            borderTop: "1px solid #333",
            color: "#aaa",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 15px",
            fontSize: "12px",
            userSelect: "none"
        }}>
            <div>Status: <span style={{ color: "#4caf50" }}>● Ready</span></div>
            <div>Three.js Viewer v1.0</div>
        </div>
    );
}