import React, { useState, useRef, useEffect, ReactNode, ComponentPropsWithoutRef } from "react";
import Icon from "../components/Icon";

// Definition of complete interface requirements mapping to RibbonButton instances
interface RibbonButtonProps {
    icon: string | ReactNode;
    label: string;
    hotkey?: string;
    instruction?: string;
    onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
    disabled?: boolean;
    active?: boolean;
    textColor?: string;
    activeBtnBg?: string;
    href?: string;
    target?: string;
    rel?: string;
}

export default function RibbonButton({
    icon,
    label,
    hotkey,
    instruction,
    onClick,
    disabled = false,
    active = false,
    textColor = "#333333",
    activeBtnBg = "#e2e8f0",
    href,
    target,
    rel
}: RibbonButtonProps) {
    const [showTooltip, setShowTooltip] = useState<boolean>(false);
    const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Triggers custom enhanced tooltip display with a 400ms delay to avoid accidental hover triggers
    const handleMouseEnter = () => {
        if (disabled) return;
        timeoutRef.current = setTimeout(() => {
            setShowTooltip(true);
        }, 400); 
    };

    const handleMouseLeave = () => {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        setShowTooltip(false);
    };

    // Clean up timers on unmount to prevent memory leaks
    useEffect(() => {
        return () => {
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
        };
    }, []);

    const buttonStyle: React.CSSProperties = {
        color: textColor,
        background: active ? activeBtnBg : "transparent",
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? "not-allowed" : "pointer"
    };

    // Helper to render icon depending on whether it is a custom string name or a raw character
    const renderIcon = (size: number): ReactNode => {
        if (typeof icon === "string" && icon.length > 2) {
            return <Icon name={icon} size={size} className="ribbon-icon" />;
        }
        
        // --- CHANGE 1: Update fontSize configurations mapping strictly into text / emoji raw instances ---
        const emojiFontSize = size === 64 ? "52px" : (size === 20 ? "16px" : "28px"); 
        
        return <span style={{ fontSize: emojiFontSize, lineHeight: "20px" }}>{icon}</span>;
    };

    const isLink = !!href;

    if (isLink) {
        const linkProps: ComponentPropsWithoutRef<"a"> = {
            href,
            target,
            rel,
            style: { ...buttonStyle, textDecoration: "none" }
        };

        return (
            <div 
                className="ribbon-btn-wrapper"
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
                style={{ position: "relative", display: "inline-block" }}
            >
                <a className="ribbon-btn" {...linkProps}>
                    {renderIcon(20)}
                    <span className="ribbon-label">{label}</span>
                </a>

                {/* Custom Enhanced Tooltip Layout */}
                {showTooltip && (hotkey || instruction) && (
                    <div className="ribbon-tooltip-box">
                        {/* Left Panel: Upscaled Icon Visual */}
                        <div className="ribbon-tooltip-left">
                            {/* --- CHANGE 2: Double upscaled visualization element bounds parameters (32 -> 64) --- */}
                            {renderIcon(64)} 
                        </div>
                        {/* Right Panel: Functional Context & Shortcut Information */}
                        <div className="ribbon-tooltip-right">
                            <div className="ribbon-tooltip-header">
                                <span className="ribbon-tooltip-title">{label}</span>
                                {hotkey && <span className="ribbon-tooltip-hotkey">({hotkey})</span>}
                            </div>
                            {instruction && <p className="ribbon-tooltip-instruction">{instruction}</p>}
                        </div>
                    </div>
                )}
            </div>
        );
    }

    const buttonProps: ComponentPropsWithoutRef<"button"> = {
        onClick: disabled ? undefined : onClick,
        disabled,
        style: buttonStyle
    };

    return (
        <div 
            className="ribbon-btn-wrapper"
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            style={{ position: "relative", display: "inline-block" }}
        >
            <button className="ribbon-btn" {...buttonProps}>
                {renderIcon(20)}
                <span className="ribbon-label">{label}</span>
            </button>

            {/* Custom Enhanced Tooltip Layout */}
            {showTooltip && (hotkey || instruction) && (
                <div className="ribbon-tooltip-box">
                    {/* Left Panel: Upscaled Icon Visual */}
                    <div className="ribbon-tooltip-left">
                        {/* --- CHANGE 2: Double upscaled visualization element bounds parameters (32 -> 64) --- */}
                        {renderIcon(64)} 
                    </div>
                    {/* Right Panel: Functional Context & Shortcut Information */}
                    <div className="ribbon-tooltip-right">
                        <div className="ribbon-tooltip-header">
                            <span className="ribbon-tooltip-title">{label}</span>
                            {hotkey && <span className="ribbon-tooltip-hotkey">({hotkey})</span>}
                        </div>
                        {instruction && <p className="ribbon-tooltip-instruction">{instruction}</p>}
                    </div>
                </div>
            )}
        </div>
    );
}