import { useEffect, useState } from "react";

export default function ModelTree({ sceneController, sceneVersion, theme }) {
    const [nodes, setNodes] = useState([]);
    const isDark = theme === "dark";

    useEffect(() => {
        if (!sceneController || !sceneController.scene) {
            setNodes([]);
            return;
        }

        const list = [];
        sceneController.scene.traverse((object) => {
            if (object && object.isActor) {
                list.push({
                    id: object.uuid,
                    name: object.name || `Unnamed Actor`,
                    type: "Actor",
                });
            }
        });
        
        setNodes(list);
    }, [sceneController, sceneVersion]);

    return (
        <div style={{ 
            padding: "15px", 
            color: isDark ? "#e0e0e0" : "#111111", // Đổi màu chữ theo theme
            height: "100%", 
            overflowY: "auto",
            transition: "color 0.2s"
        }}>
            <h3 style={{ 
                fontSize: "14px", 
                textTransform: "uppercase", 
                letterSpacing: "1px", 
                marginBottom: "15px", 
                color: isDark ? "#888888" : "#666666" 
            }}>
                Model Tree
            </h3>
            <ul style={{ listStyle: "none", padding: 0, margin: 0, fontSize: "13px" }}>
                {nodes.map((node) => (
                    <li key={node.id} style={{ 
                        padding: "6px 8px", 
                        borderRadius: "4px",
                        backgroundColor: isDark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)",
                        marginBottom: "4px"
                    }}>
                        📦 {node.name} <span style={{ fontSize: "10px", color: isDark ? "#777" : "#888" }}>({node.type})</span>
                    </li>
                ))}
                {nodes.length === 0 && <li style={{ color: isDark ? "#555" : "#666", fontStyle: "italic" }}>No actors loaded</li>}
            </ul>
        </div>
    );
}