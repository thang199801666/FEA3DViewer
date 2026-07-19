import type { AppModule } from "../../App";
import "./startPage.css";

interface Props {
    onModuleChange: (module: AppModule) => void;
}

const modules: Array<{
    id: Exclude<AppModule, "start-page">;
    badge: string;
    title: string;
    description: string;
    features: string[];
    status: string;
}> = [
    {
        id: "baseplate-calculation",
        badge: "BP",
        title: "Baseplate Calculation",
        description: "Design steel column base plates by combining structural component checks with a Three.js finite element workflow.",
        features: ["Geometry, materials and load cases", "Component checks and utilization", "3D model prepared for nonlinear FEA"],
        status: "Design module",
    },
    {
        id: "fea-viewer",
        badge: "FEA",
        title: "FEA Viewer",
        description: "Open and inspect VTK/VTP finite element models, contours, deformation, clipping and result fields.",
        features: ["Large VTK/VTP model support", "Contour and deformed results", "Picking, measuring and section tools"],
        status: "Viewer module",
    },
];

export default function StartPage({ onModuleChange }: Props) {
    return <main className="start-page">
        <div className="start-page-glow" />
        <header className="start-header">
            <div className="start-brand"><img src="/FEA.svg" alt="" /><div><strong>FEA Engineering Platform</strong><span>Structural analysis & finite element tools</span></div></div>
            <span className="start-version">Workspace</span>
        </header>

        <section className="start-content">
            <div className="start-intro"><span className="start-eyebrow">START PAGE</span><h1>Choose a module</h1><p>Select the engineering workspace you want to use. Each module keeps its own tools and workflow while sharing the same threejsVTK rendering foundation.</p></div>
            <div className="start-module-grid">
                {modules.map((module, index) => <button key={module.id} type="button" className="start-module-card" onClick={() => onModuleChange(module.id)}>
                    <span className="start-card-index">0{index + 1}</span>
                    <span className={`start-card-icon ${module.id}`}><b>{module.badge}</b></span>
                    <span className="start-card-copy"><small>{module.status}</small><strong>{module.title}</strong><span>{module.description}</span></span>
                    <span className="start-card-features">{module.features.map((feature) => <span key={feature}>✓ {feature}</span>)}</span>
                    <span className="start-card-open">Open module <b>→</b></span>
                </button>)}
            </div>
        </section>

        <footer className="start-footer"><span>threejsVTK rendering core</span><span>Ready</span></footer>
    </main>;
}
