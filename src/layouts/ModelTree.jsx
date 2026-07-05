import { useEffect, useState } from "react";

export default function ModelTree({ sceneController }) {
    const [nodes, setNodes] = useState([]);

    useEffect(() => {
        if (!sceneController || !sceneController.scene) return;

        // Function to parse Three.js scene hierarchy
        const updateTree = () => {
            const list = [];
            sceneController.scene.traverse((object) => {
                // Filter out utility objects like GridHelpers or Lights if desired
                if (object.name || object.type === "Mesh") {
                    list.push({
                        id: object.uuid,
                        name: object.name || `Unnamed ${object.type}`,
                        type: object.type,
                    });
                }
            });
            setNodes(list);
        };

        // Initial scan
        updateTree();

        // Optional: If your SceneController emits an event when models load, listen to it here
    }, [sceneController]);

    return (
        <div style={{ padding: "15px", color: "#fff", height: "100%", overflowY: "auto" }}>
            <h3 style={{ fontSize: "14px", textTransform: "uppercase", letterSpacing: "1px", marginBottom: "15px", color: "#888" }}>
                Model Tree
            </h3>
            <ul style={{ listStyle: "none", padding: 0, margin: 0, fontSize: "13px" }}>
                {nodes.map((node) => (
                    <li 
                        key={node.id} 
                        style={{ padding: "6px 8px", cursor: "pointer", borderRadius: "4px", hover: { background: "#333" } }}
                        onClick={() => console.log("Selected item UUID:", node.id)}
                    >
                        📁 {node.name} <span style={{ fontSize: "10px", color: "#666" }}>({node.type})</span>
                    </li>
                ))}
                {nodes.length === 0 && <li style={{ color: "#666", fontStyle: "italic" }}>No models loaded</li>}
            </ul>
        </div>
    );
}