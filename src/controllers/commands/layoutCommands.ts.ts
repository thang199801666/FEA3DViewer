// commands.ts
import * as THREE from "three";

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
        if (!sceneController) return;
        const cadCam = sceneController.cadCamera;
        if (!cadCam?.three) return;

        const cam = cadCam.three;
        const target = new THREE.Vector3(0, 0, 0);
        const distance = cam.position.distanceTo(target) || 15;
        const newPos = new THREE.Vector3();
        const newUp = new THREE.Vector3(0, 1, 0);

        switch (viewName.toLowerCase()) {
            case "front": newPos.set(0, 0, distance); break;
            case "back": newPos.set(0, 0, -distance); break;
            case "top": newPos.set(0, distance, 0); newUp.set(0, 0, -1); break;
            case "bottom": newPos.set(0, -distance, 0); newUp.set(0, 0, 1); break;
            case "left": newPos.set(-distance, 0, 0); break;
            case "right": newPos.set(distance, 0, 0); break;
            case "iso":
            case "isometric":
                const iso = distance / Math.sqrt(3);
                newPos.set(iso, iso, iso);
                newUp.set(-1, 2, -1).normalize();
                break;
            default: return;
        }

        cam.position.copy(newPos);
        cam.up.copy(newUp);
        cam.lookAt(target);
        cam.updateMatrixWorld(true);

        if (typeof cadCam.setFromThree === "function") cadCam.setFromThree();
        if (typeof sceneController.updateClipping === "function") sceneController.updateClipping();
        if (typeof sceneController.fitView === "function") sceneController.fitView();
        if (typeof sceneController.requestRender === "function") sceneController.requestRender();
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