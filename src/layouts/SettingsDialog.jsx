import DialogTemplate from "./DialogTemplate";
import {
    THEME_OPTIONS,
    NAV_STYLE_OPTIONS,
    DISPLAY_MODE_OPTIONS,
    createDefaultSettings,
} from "./settingsConfig";

// ---------------------------------------------------------------------------
// Small, reusable field components updated with tighter, compact styling
// ---------------------------------------------------------------------------

function SectionHeader({ children }) {
    return (
        <h4
            style={{
                color: "#1e293b",
                margin: "6px 0 2px 0",
                fontSize: "13px",
                fontWeight: "600",
                letterSpacing: "0.3px",
            }}
        >
            {children}
        </h4>
    );
}

function ToggleField({ id, label, checked, onChange }) {
    return (
        <div style={{ display: "flex", alignItems: "center", gap: "8px", margin: "3px 0" }}>
            <input
                type="checkbox"
                id={id}
                checked={checked}
                onChange={(e) => onChange(e.target.checked)}
                style={{ cursor: "pointer", width: "14px", height: "14px", accentColor: "#3b82f6" }}
            />
            <label htmlFor={id} style={{ cursor: "pointer", fontWeight: 500, fontSize: "13px", color: "#334155" }}>
                {label}
            </label>
        </div>
    );
}

function SelectField({ label, value, options, onChange }) {
    return (
        <div className="input-group" style={{ display: "flex", alignItems: "center", gap: "10px", margin: "4px 0" }}>
            <label style={{ minWidth: "130px", fontSize: "13px", fontWeight: "500", color: "#475569" }}>{label}</label>
            <select
                value={value}
                onChange={(e) => onChange(e.target.value)}
                style={{
                    flex: 1,
                    cursor: "pointer",
                    padding: "6px 10px",
                    borderRadius: "6px",
                    border: "1px solid #e2e8f0",
                    backgroundColor: "#f8fafc",
                    fontSize: "13px",
                    color: "#0f172a",
                    outline: "none"
                }}
            >
                {options.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                        {opt.label}
                    </option>
                ))}
            </select>
        </div>
    );
}

function ColorField({ label, value, onChange, disabled = false }) {
    return (
        <div className="input-group" style={{ display: "flex", alignItems: "center", gap: "10px", margin: "4px 0", opacity: disabled ? 0.4 : 1 }}>
            <label style={{ minWidth: "130px", fontSize: "13px", fontWeight: "500", color: "#475569" }}>{label}</label>
            <input
                type="color"
                value={value}
                disabled={disabled}
                onChange={(e) => onChange(e.target.value)}
                style={{
                    cursor: disabled ? "not-allowed" : "pointer",
                    border: "1px solid #e2e8f0",
                    borderRadius: "5px",
                    width: "36px",
                    height: "24px",
                    padding: 0,
                    backgroundColor: "transparent"
                }}
            />
        </div>
    );
}

function SliderField({ label, value, min, max, step, onChange }) {
    return (
        <div className="input-group" style={{ display: "flex", alignItems: "center", gap: "10px", margin: "4px 0" }}>
            <label style={{ minWidth: "130px", fontSize: "13px", fontWeight: "500", color: "#475569" }}>{label}</label>
            <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={value}
                onChange={(e) => onChange(Number(e.target.value))}
                style={{ flex: 1, accentColor: "#3b82f6", cursor: "pointer" }}
            />
            <span style={{ fontSize: "12px", fontWeight: "600", color: "#64748b", width: "30px", textAlign: "right" }}>{value}</span>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Main Settings Dialog Component
// ---------------------------------------------------------------------------

export default function SettingsDialog({ isOpen, onClose, settings, onSettingsChange }) {
    const handleChange = (key, value) => {
        onSettingsChange({ ...settings, [key]: value });
    };

    const handleReset = () => {
        onSettingsChange(createDefaultSettings());
    };

    // Footer actions
    const footerButtons = (
        <>
            <button 
                onClick={handleReset}
                style={{
                    padding: "8px 16px",
                    borderRadius: "8px",
                    border: "1.5px solid #ff9e9e",
                    backgroundColor: "#ffffff",
                    color: "#ff4d4d",
                    fontWeight: "700",
                    fontSize: "13px",
                    cursor: "pointer",
                    transition: "all 0.2s"
                }}
            >
                Default
            </button>
            
            <div style={{ flex: 1 }} /> 

            <button 
                onClick={onClose}
                style={{
                    padding: "8px 16px",
                    borderRadius: "8px",
                    border: "1px solid #cbd5e1",
                    backgroundColor: "#ffffff",
                    color: "#0f172a",
                    fontWeight: "700",
                    fontSize: "13px",
                    cursor: "pointer",
                    transition: "all 0.2s"
                }}
            >
                Cancel
            </button>

            <button 
                onClick={onClose}
                style={{
                    padding: "8px 20px",
                    borderRadius: "8px",
                    border: "none",
                    backgroundColor: "#2563eb",
                    color: "#ffffff",
                    fontWeight: "700",
                    fontSize: "13px",
                    cursor: "pointer",
                    transition: "all 0.2s",
                    boxShadow: "0 3px 10px rgba(37, 99, 235, 0.2)"
                }}
            >
                Confirm
            </button>
        </>
    );

    // Settings Icon SVG
    const settingsIcon = (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1e293b" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3"></circle>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
        </svg>
    );

    return (
        <DialogTemplate
            isOpen={isOpen}
            onClose={onClose}
            title="Settings Configuration"
            icon={settingsIcon}
            footerActions={footerButtons}
        >
            {/* GROUP 1: APPLICATION / INTERFACE */}
            <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                <SectionHeader>Application</SectionHeader>
                <SelectField
                    label="Theme:"
                    value={settings.theme}
                    options={THEME_OPTIONS}
                    onChange={(v) => handleChange("theme", v)}
                />
                <SelectField
                    label="Navigation style:"
                    value={settings.navStyle}
                    options={NAV_STYLE_OPTIONS}
                    onChange={(v) => handleChange("navStyle", v)}
                />
                <SelectField
                    label="Display mode:"
                    value={settings.displayMode}
                    options={DISPLAY_MODE_OPTIONS}
                    onChange={(v) => handleChange("displayMode", v)}
                />
                <ToggleField
                    id="isSplit"
                    label="Split view (two viewports)"
                    checked={settings.isSplit}
                    onChange={(v) => handleChange("isSplit", v)}
                />
                <ToggleField
                    id="isViewLinked"
                    label="Link cameras between viewports"
                    checked={settings.isViewLinked}
                    onChange={(v) => handleChange("isViewLinked", v)}
                />
            </div>

            <hr style={{ border: "none", borderTop: "1px solid #f1f5f9", margin: "2px 0" }} />

            {/* GROUP 2: SCENE / GRAPHICS */}
            <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                <SectionHeader>Scene (Graphics)</SectionHeader>
                <ToggleField
                    id="isGradientBackground"
                    label="Gradient Background"
                    checked={settings.isGradientBackground}
                    onChange={(v) => handleChange("isGradientBackground", v)}
                />
                <ColorField
                    label="Top color:"
                    value={settings.topColor}
                    disabled={!settings.isGradientBackground}
                    onChange={(v) => handleChange("topColor", v)}
                />
                <ColorField
                    label={settings.isGradientBackground ? "Bottom color:" : "Background color:"}
                    value={settings.bottomColor}
                    onChange={(v) => handleChange("bottomColor", v)}
                />
                <ToggleField
                    id="antialias"
                    label="Antialiasing (applied on reload)"
                    checked={settings.antialias}
                    onChange={(v) => handleChange("antialias", v)}
                />
            </div>

            <hr style={{ border: "none", borderTop: "1px solid #f1f5f9", margin: "2px 0" }} />

            {/* GROUP 3: LIGHTING */}
            <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                <SectionHeader>Lighting</SectionHeader>
                <ToggleField
                    id="addDefaultLights"
                    label="Use renderer default lights (applied on reload)"
                    checked={settings.addDefaultLights}
                    onChange={(v) => handleChange("addDefaultLights", v)}
                />
                <SliderField
                    label="Ambient light:"
                    value={settings.ambientIntensity}
                    min={0}
                    max={1}
                    step={0.05}
                    onChange={(v) => handleChange("ambientIntensity", v)}
                />
                <SliderField
                    label="Directional light:"
                    value={settings.directionalIntensity}
                    min={0}
                    max={2}
                    step={0.1}
                    onChange={(v) => handleChange("directionalIntensity", v)}
                />
            </div>

            <hr style={{ border: "none", borderTop: "1px solid #f1f5f9", margin: "2px 0" }} />

            {/* GROUP 4: OVERLAYS / HELPERS */}
            <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                <SectionHeader>Overlays</SectionHeader>
                <ToggleField
                    id="showAxes"
                    label="Origin axes (triad)"
                    checked={settings.showAxes}
                    onChange={(v) => handleChange("showAxes", v)}
                />
                <ToggleField
                    id="showRuler"
                    label="Measurement ruler"
                    checked={settings.showRuler}
                    onChange={(v) => handleChange("showRuler", v)}
                />
                <ToggleField
                    id="showGrid"
                    label="Ground grid"
                    checked={settings.showGrid}
                    onChange={(v) => handleChange("showGrid", v)}
                />
                <ToggleField
                    id="showTextBlock"
                    label="Notes overlay"
                    checked={settings.showTextBlock}
                    onChange={(v) => handleChange("showTextBlock", v)}
                />
            </div>
        </DialogTemplate>
    );
}