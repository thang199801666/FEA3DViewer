export type ToolbarCommandId =
    | "file.open"
    | "view.reset"
    | "result.toggleContour"
    | "app.openSettings"
    | "scene.clear"
    | "clip.open"
    | "shape.addBox"
    | "view.setOrientation"
    | "view.fit"
    | "layout.toggleSplit"
    | "layout.toggleLink"
    | "display.toggleGrid"
    | "display.toggleAxes"
    | "display.toggleCameraNav"
    | "display.toggleRuler"
    | "display.toggleNotes"
    | "help.about";

export type ToolbarAction = (...args: any[]) => void;

export interface ToolbarCommandContext {
    actions: Record<string, ToolbarAction | undefined>;
}

export interface ToolbarCommand<TPayload = unknown> {
    id: ToolbarCommandId;
    execute: (context: ToolbarCommandContext, payload?: TPayload) => void;
    canExecute?: (context: ToolbarCommandContext, payload?: TPayload) => boolean;
}

const runAction = (
    context: ToolbarCommandContext,
    actionName: string,
    ...args: any[]
): void => {
    context.actions[actionName]?.(...args);
};

export const toolbarCommands: Record<ToolbarCommandId, ToolbarCommand> = {
    "file.open": {
        id: "file.open",
        execute: (context) => runAction(context, "openFile"),
    },
    "view.reset": {
        id: "view.reset",
        execute: (context) => runAction(context, "resetView"),
    },
    "result.toggleContour": {
        id: "result.toggleContour",
        execute: (context) => runAction(context, "toggleContour"),
    },
    "app.openSettings": {
        id: "app.openSettings",
        execute: (context) => runAction(context, "openSettings"),
    },
    "scene.clear": {
        id: "scene.clear",
        execute: (context) => runAction(context, "clearScene"),
    },
    "clip.open": {
        id: "clip.open",
        execute: (context) => runAction(context, "openClipDialog"),
    },
    "shape.addBox": {
        id: "shape.addBox",
        execute: (context) => runAction(context, "openBoxDialog"),
    },
    "view.setOrientation": {
        id: "view.setOrientation",
        execute: (context, payload) => runAction(context, "setView", payload),
    },
    "view.fit": {
        id: "view.fit",
        execute: (context) => runAction(context, "fitView"),
    },
    "layout.toggleSplit": {
        id: "layout.toggleSplit",
        execute: (context) => runAction(context, "toggleSplit"),
    },
    "layout.toggleLink": {
        id: "layout.toggleLink",
        execute: (context) => runAction(context, "toggleViewLink"),
    },
    "display.toggleGrid": {
        id: "display.toggleGrid",
        execute: (context) => runAction(context, "toggleGrid"),
    },
    "display.toggleAxes": {
        id: "display.toggleAxes",
        execute: (context) => runAction(context, "toggleAxes"),
    },
    "display.toggleCameraNav": {
        id: "display.toggleCameraNav",
        execute: (context) => runAction(context, "toggleCameraNav"),
    },
    "display.toggleRuler": {
        id: "display.toggleRuler",
        execute: (context) => runAction(context, "toggleRuler"),
    },
    "display.toggleNotes": {
        id: "display.toggleNotes",
        execute: (context) => runAction(context, "toggleNotes"),
    },
    "help.about": {
        id: "help.about",
        execute: (context) => runAction(context, "showAbout"),
    },
};

export const executeToolbarCommand = (
    commandId: ToolbarCommandId,
    context: ToolbarCommandContext,
    payload?: unknown
): void => {
    const command = toolbarCommands[commandId];
    if (!command) return;
    if (command.canExecute?.(context, payload) === false) return;
    command.execute(context, payload);
};
