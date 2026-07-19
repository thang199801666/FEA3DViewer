import { useState } from "react";
import FEAViewerModule from "./modules/fea-viewer/FEAViewerModule";
import BaseplateCalculationModule from "./modules/baseplate/BaseplateCalculationModule";
import StartPage from "./app/start-page/StartPage";

export type AppModule = "start-page" | "baseplate-calculation" | "fea-viewer";

export default function App() {
    const [activeModule, setActiveModule] = useState<AppModule>("start-page");

    if (activeModule === "start-page") {
        return <StartPage onModuleChange={setActiveModule} />;
    }

    if (activeModule === "baseplate-calculation") {
        return <BaseplateCalculationModule activeModule={activeModule} onModuleChange={setActiveModule} />;
    }

    return <FEAViewerModule activeModule={activeModule} onModuleChange={setActiveModule} />;
}
