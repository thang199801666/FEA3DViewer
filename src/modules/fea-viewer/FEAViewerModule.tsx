import type { AppModule } from "../../App";
import MainLayout from "./layouts/MainLayout";

interface FEAViewerModuleProps {
    activeModule: AppModule;
    onModuleChange: (module: AppModule) => void;
}

export default function FEAViewerModule(props: FEAViewerModuleProps) {
    return <MainLayout {...props} />;
}
