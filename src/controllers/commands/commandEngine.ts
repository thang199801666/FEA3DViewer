export interface CommandContext {
    sceneController: any;
    settings: any;
    setSettings: React.Dispatch<React.SetStateAction<any>>;
    triggerSceneUpdate: () => void;
}

export interface Command {
    execute(context: CommandContext, payload?: any): boolean; // Returns true if state changed (is undoable)
    undo(context: CommandContext): void;
}

class CommandHistory {
    private undoStack: Command[] = [];
    private redoStack: Command[] = [];

    public push(command: Command) {
        this.undoStack.push(command);
        this.redoStack = []; // Clear redo stack on new action
    }

    public undo(context: CommandContext) {
        const command = this.undoStack.pop();
        if (command) {
            command.undo(context);
            this.redoStack.push(command);
            context.triggerSceneUpdate();
        }
    }

    public redo(context: CommandContext) {
        const command = this.redoStack.pop();
        if (command) {
            // Re-run the command with its internal saved parameters
            command.execute(context);
            this.undoStack.push(command);
            context.triggerSceneUpdate();
        }
    }
}

export const commandHistory = new CommandHistory();