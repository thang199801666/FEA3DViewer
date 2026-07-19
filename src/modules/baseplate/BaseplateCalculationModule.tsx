import { useCallback, useMemo, useRef, useState } from "react";
import type { AppModule } from "../../App";
import Scene from "../../shared/viewer/Scene";
import { NAV_STYLE, RenderingBackend } from "../../threejsVTK";
import { calculatePreliminaryChecks } from "./analysis/calculatePreliminaryChecks";
import type { BaseplateFEASummary } from "./analysis/solveBaseplateFEA";
import { DEFAULT_BASEPLATE_INPUTS } from "./domain/baseplateDefaults";
import type { BaseplateInputs, BoltPattern, ColumnType } from "./domain/baseplateTypes";
import { useBaseplateModel } from "./viewer/useBaseplateModel";
import BaseplateSymbols from "./viewer/BaseplateSymbols";
import { downloadFEAFile } from "./io/feaFile";
import "./baseplate.css";

interface Props {
    activeModule: AppModule;
    onModuleChange: (module: AppModule) => void;
}

type UnitSystemId = "imperial-kip" | "metric-mm" | "si" | "imperial-lbf";
type QuantityKind = "length" | "stress" | "force" | "moment";

const UNIT_SYSTEMS: Record<UnitSystemId, { label: string; description: string; units: Record<QuantityKind, string>; factors: Record<QuantityKind, number> }> = {
    "imperial-kip": { label: "Imperial — in, kip, ksi", description: "in · kip · ksi · kip·in", units: { length: "in", stress: "ksi", force: "kip", moment: "kip·in" }, factors: { length: 1 / 25.4, stress: 1 / 6.894757293, force: 1 / 4.448221615, moment: 8.850745792 } },
    "metric-mm": { label: "Metric — mm, N, MPa", description: "mm · N · MPa · N·mm", units: { length: "mm", stress: "MPa", force: "N", moment: "N·mm" }, factors: { length: 1, stress: 1, force: 1000, moment: 1_000_000 } },
    "si": { label: "SI — m, N, Pa", description: "m · N · Pa · N·m", units: { length: "m", stress: "Pa", force: "N", moment: "N·m" }, factors: { length: 0.001, stress: 1_000_000, force: 1000, moment: 1000 } },
    "imperial-lbf": { label: "Imperial — in, lbf, psi", description: "in · lbf · psi · lbf·in", units: { length: "in", stress: "psi", force: "lbf", moment: "lbf·in" }, factors: { length: 1 / 25.4, stress: 145.0377377, force: 224.8089439, moment: 8850.745792 } },
};

function NumberField({ label, unit, value, onChange }: { label: string; unit: string; value: number; onChange: (value: number) => void }) {
    return <label className="bp-field"><span>{label}</span><span className="bp-input-wrap"><input type="number" value={value} onChange={(e) => onChange(Number(e.target.value))} /><small>{unit}</small></span></label>;
}

function UnitNumberField({ label, kind, value, unitSystem, onChange }: { label: string; kind: QuantityKind; value: number; unitSystem: UnitSystemId; onChange: (value: number) => void }) {
    const preset = UNIT_SYSTEMS[unitSystem];
    const factor = preset.factors[kind];
    const shown = Number((value * factor).toPrecision(8));
    return <NumberField label={label} unit={preset.units[kind]} value={shown} onChange={(next) => onChange(next / factor)} />;
}

function SelectField<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: Array<{ value: T; label: string }>; onChange: (value: T) => void }) {
    return <label className="bp-field"><span>{label}</span><select className="bp-select" value={value} onChange={(event) => onChange(event.target.value as T)}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
}

function ModuleButton({ active, label, monogram, onClick }: { active: boolean; label: string; monogram: string; onClick: () => void }) {
    return <button type="button" className={`bp-module-btn${active ? " active" : ""}`} onClick={onClick}><b>{monogram}</b><span>{label}</span></button>;
}

type ModelSetupPanel = "baseplate" | "anchor" | "column";

function ModelToolButton({ label, icon, open, onClick }: { label: string; icon: string; open: boolean; onClick: () => void }) {
    return <button type="button" className={`bp-model-tool${open ? " open" : ""}`} aria-expanded={open} onClick={onClick}><b>{icon}</b><span>{label}</span><i>⌄</i></button>;
}

export default function BaseplateCalculationModule({ onModuleChange }: Props) {
    const [inputs, setInputs] = useState(DEFAULT_BASEPLATE_INPUTS);
    const [controller, setController] = useState<any>(null);
    const [activeStep, setActiveStep] = useState<"model" | "loads" | "analysis" | "results">("model");
    const [activeRibbonTab, setActiveRibbonTab] = useState<"home" | "model" | "loads" | "analysis" | "results">("home");
    const [unitSystem, setUnitSystem] = useState<UnitSystemId>("imperial-kip");
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [openModelPanel, setOpenModelPanel] = useState<ModelSetupPanel | null>(null);
    const [hasCalculated, setHasCalculated] = useState(false);
    const [feaResults, setFeaResults] = useState<BaseplateFEASummary | null>(null);
    const sharedSceneRef = useRef(RenderingBackend.createScene());
    const update = useCallback((key: keyof BaseplateInputs, value: number) => {
        setInputs((prev) => ({ ...prev, [key]: Number.isFinite(value) ? value : 0 }));
        setHasCalculated(false);
    }, []);
    const updateChoice = useCallback(<K extends "columnType" | "boltPattern">(key: K, value: BaseplateInputs[K]) => {
        setInputs((prev) => ({ ...prev, [key]: value }));
        setHasCalculated(false);
    }, []);

    const checks = useMemo(() => calculatePreliminaryChecks(inputs), [inputs]);
    const receiveFEAResults = useCallback((results: BaseplateFEASummary | null) => setFeaResults(results), []);
    useBaseplateModel(controller, inputs, hasCalculated, receiveFEAResults);

    const calculate = useCallback(() => {
        setHasCalculated(true);
        setActiveStep("analysis");
        setActiveRibbonTab("analysis");
    }, []);
    const downloadResults = useCallback(() => {
        if (feaResults) downloadFEAFile(controller, inputs, feaResults, "BP-01-results.fea");
    }, [controller, feaResults, inputs]);

    const maxUtil = Math.max(checks.bearingUtil, checks.plateUtil, checks.anchorUtil);
    return <div className="bp-app">
        <header className="bp-ribbon">
            <div className="bp-ribbon-tabs"><span className="bp-product">Connection Design</span><button className={activeRibbonTab === "home" ? "active" : ""} onClick={() => setActiveRibbonTab("home")}>Home</button>{(["model", "loads", "analysis", "results"] as const).map((tab) => <button key={tab} className={activeRibbonTab === tab ? "active" : ""} onClick={() => { setActiveStep(tab); setActiveRibbonTab(tab); setOpenModelPanel(null); }}>{tab}</button>)}</div>
            <div className="bp-ribbon-body">
                {activeRibbonTab === "home" && <><button className="bp-open" type="button"><b>OPEN</b><span>Open project</span></button>
                    <ModuleButton monogram="⌂" label="Start Page" active={false} onClick={() => onModuleChange("start-page")} />
                    <div className="bp-ribbon-separator" /><button className="bp-action bp-settings-button" type="button" onClick={() => setIsSettingsOpen(true)}><b>⚙</b><span>Settings</span></button></>}
                {activeRibbonTab === "model" && <div className="bp-model-tools">
                    <ModelToolButton label="Baseplate" icon="BP" open={openModelPanel === "baseplate"} onClick={() => setOpenModelPanel((value) => value === "baseplate" ? null : "baseplate")} />
                    <ModelToolButton label="Column" icon="COL" open={openModelPanel === "column"} onClick={() => setOpenModelPanel((value) => value === "column" ? null : "column")} />
                    <ModelToolButton label="Anchor" icon="ANC" open={openModelPanel === "anchor"} onClick={() => setOpenModelPanel((value) => value === "anchor" ? null : "anchor")} />
                    {openModelPanel && <div className="bp-model-dropdown">
                        {openModelPanel === "baseplate" && <section><h3>Baseplate setup</h3><UnitNumberField label="Plate width Bp" kind="length" value={inputs.plateWidth} unitSystem={unitSystem} onChange={(v) => update("plateWidth", v)} /><UnitNumberField label="Plate length Lp" kind="length" value={inputs.plateLength} unitSystem={unitSystem} onChange={(v) => update("plateLength", v)} /><UnitNumberField label="Plate thickness tp" kind="length" value={inputs.plateThickness} unitSystem={unitSystem} onChange={(v) => update("plateThickness", v)} /><UnitNumberField label="Concrete height" kind="length" value={inputs.concreteHeight} unitSystem={unitSystem} onChange={(v) => update("concreteHeight", v)} /><UnitNumberField label="Steel fy" kind="stress" value={inputs.steelFy} unitSystem={unitSystem} onChange={(v) => update("steelFy", v)} /><UnitNumberField label="Concrete f'c" kind="stress" value={inputs.concreteFc} unitSystem={unitSystem} onChange={(v) => update("concreteFc", v)} /></section>}
                        {openModelPanel === "column" && <section><h3>Column setup</h3><SelectField<ColumnType> label="Column type" value={inputs.columnType} options={[{ value: "i-section", label: "I / H section" }, { value: "rhs", label: "RHS box" }, { value: "rectangular", label: "Rectangular solid" }]} onChange={(value) => updateChoice("columnType", value)} /><UnitNumberField label="Column width bc" kind="length" value={inputs.columnWidth} unitSystem={unitSystem} onChange={(v) => update("columnWidth", v)} /><UnitNumberField label="Column depth dc" kind="length" value={inputs.columnDepth} unitSystem={unitSystem} onChange={(v) => update("columnDepth", v)} /></section>}
                        {openModelPanel === "anchor" && <section><h3>Anchor setup</h3><SelectField<BoltPattern> label="Anchor pattern" value={inputs.boltPattern} options={[{ value: "4-bolt", label: "4 anchors · 2 × 2" }, { value: "6-bolt", label: "6 anchors · 2 × 3" }, { value: "8-bolt", label: "8 anchors · 2 × 4" }]} onChange={(value) => updateChoice("boltPattern", value)} /><UnitNumberField label="Anchor radius r" kind="length" value={inputs.boltRadius} unitSystem={unitSystem} onChange={(v) => update("boltRadius", v)} /></section>}
                    </div>}
                </div>}
                {activeRibbonTab === "analysis" && <button className="bp-action primary" onClick={calculate}><b>▶</b><span>Calculate</span></button>}
                {activeRibbonTab === "results" && <button className="bp-action" onClick={() => { setActiveStep("results"); setActiveRibbonTab("results"); }}><b>✓</b><span>Results</span></button>}
            </div>
        </header>

        {isSettingsOpen && <div className="bp-settings-backdrop" role="presentation" onMouseDown={() => setIsSettingsOpen(false)}>
            <div className="bp-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="bp-settings-title" onMouseDown={(event) => event.stopPropagation()}>
                <header><div><small>APPLICATION</small><h2 id="bp-settings-title">Settings</h2></div><button type="button" aria-label="Close settings" onClick={() => setIsSettingsOpen(false)}>×</button></header>
                <div className="bp-settings-content"><nav><button className="active" type="button">Units</button></nav><section><h3>Unit system</h3><p>Abaqus-style consistent unit presets. Values are converted for display while the engineering model remains unchanged.</p><label className="bp-setting-field"><span>Preset</span><select value={unitSystem} onChange={(event) => setUnitSystem(event.target.value as UnitSystemId)}>{(Object.entries(UNIT_SYSTEMS) as Array<[UnitSystemId, (typeof UNIT_SYSTEMS)[UnitSystemId]]>).map(([id, preset]) => <option key={id} value={id}>{preset.label}</option>)}</select></label><div className="bp-unit-preview"><small>ACTIVE UNITS</small><strong>{UNIT_SYSTEMS[unitSystem].description}</strong></div></section></div>
                <footer><button type="button" onClick={() => setIsSettingsOpen(false)}>Close</button></footer>
            </div>
        </div>}

        <div className={`bp-workspace${activeStep === "model" ? " bp-workspace-model" : ""}`}>
            {activeStep !== "model" && <aside className="bp-input-panel">
                <div className="bp-panel-heading"><div><small>BASE PLATE</small><strong>BP-01 / Column C1</strong></div><span className={maxUtil <= 1 ? "pass" : "fail"}>{maxUtil <= 1 ? "PASS" : "REVIEW"}</span></div>
                {activeStep === "loads" && <section className="bp-tab-section"><h3>Design actions</h3><UnitNumberField label="Axial Py" kind="force" value={inputs.axialForce} unitSystem={unitSystem} onChange={(v) => update("axialForce", v)} /><UnitNumberField label="Shear Vx" kind="force" value={inputs.shearX} unitSystem={unitSystem} onChange={(v) => update("shearX", v)} /><UnitNumberField label="Shear Vz" kind="force" value={inputs.shearZ} unitSystem={unitSystem} onChange={(v) => update("shearZ", v)} /><UnitNumberField label="Moment Mx" kind="moment" value={inputs.momentX} unitSystem={unitSystem} onChange={(v) => update("momentX", v)} /><UnitNumberField label="Moment My" kind="moment" value={inputs.momentY} unitSystem={unitSystem} onChange={(v) => update("momentY", v)} /><UnitNumberField label="Moment Mz" kind="moment" value={inputs.momentZ} unitSystem={unitSystem} onChange={(v) => update("momentZ", v)} /></section>}
                {activeStep === "analysis" && <section className="bp-tab-section bp-run-analysis"><h3>Analysis</h3><p>Run the component analysis using the current model and load setup.</p><button type="button" onClick={calculate}>Run analysis</button><small>{hasCalculated ? "Analysis completed. Open Results to review output." : "Ready to calculate."}</small></section>}
                {activeStep === "results" && <section className="bp-tab-section bp-results-message"><h3>Results</h3><p>{feaResults ? "Analysis is complete. The result file is ready to download." : "No results yet. Run the analysis first."}</p>{feaResults && <button type="button" onClick={downloadResults}>Download .fea results</button>}</section>}
            </aside>}

            <main className="bp-viewer"><Scene sharedScene={sharedSceneRef.current} onControllerReady={setController} navStyle={NAV_STYLE.BLENDER} showAxes showGrid showRuler={false} addDefaultLights /><BaseplateSymbols inputs={inputs} controller={controller} /><div className="bp-view-credit">threejsVTK</div></main>

        </div>
    </div>;
}
