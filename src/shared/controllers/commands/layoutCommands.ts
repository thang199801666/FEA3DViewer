// commands.ts

export interface CommandContext {
    sceneController: any;
    settings: any;
    updateSetting: (key: string, value: any) => void;
    toggleSetting: (key: string) => void;
}

export interface Command {
    execute(context: CommandContext, payload?: any): void;
}

// 1. View Manipulation Commands
export const ResetViewCommand: Command = {
    execute({ sceneController }) {
        if (!sceneController) return;
        if (typeof sceneController.resetView === "function") sceneController.resetView();
        else if (typeof sceneController.resetCamera === "function") sceneController.resetCamera();
    }
};

export const FitViewCommand: Command = {
    execute({ sceneController }) {
        if (sceneController?.fitView) sceneController.fitView();
    }
};

export const SetOrientationCommand: Command = {
    execute({ sceneController }, viewName: string) {
        const normalized = viewName.toLowerCase() === "isometric" ? "iso" : viewName;
        sceneController?.setView?.(normalized);
    }
};

// 2. UI Layout Commands
export const ToggleSplitViewCommand: Command = {
    execute({ toggleSetting }) {
        toggleSetting("isSplit");
    }
};

export const ToggleViewLinkCommand: Command = {
    execute({ toggleSetting }) {
        toggleSetting("isViewLinked");
    }
};

// Command Map Registry for dynamic lookup
export const CommandRegistry: Record<string, Command> = {
    "view.reset": ResetViewCommand,
    "view.fit": FitViewCommand,
    "view.setOrientation": SetOrientationCommand,
    "layout.toggleSplit": ToggleSplitViewCommand,
    "layout.toggleLink": ToggleViewLinkCommand,
};
