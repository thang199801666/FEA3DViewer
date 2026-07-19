# Source architecture

The application is organized by feature. A module may depend on `shared` and
`threejsVTK`, but modules must not import implementation files from each other.

```text
src/
  app/start-page/           Module selection and application entry UI
  modules/
    baseplate/              Base plate input, domain rules, checks and 3D model
      analysis/             Structural/component calculation functions
      domain/               Types, defaults and future design-code models
      viewer/               Baseplate-to-renderer adapter and scene lifecycle
    fea-viewer/             VTK/VTP post-processing feature
      layouts/              FEA ribbon, panels, dialogs and workspace layout
  shared/
    controllers/            Application-level scene and interaction controllers
    viewer/                 Reusable React viewport adapter
  threejsVTK/               Rendering library; independent of application modules
```

## Dependency direction

`App -> module -> shared viewer/controllers -> threejsVTK`

- Put Baseplate equations and design-code logic in `baseplate/analysis`.
- Put Baseplate data contracts in `baseplate/domain`.
- Put FEA-only UI and commands in `fea-viewer`.
- Put code in `shared` only when both modules genuinely use it.
- Keep React application imports out of the `threejsVTK/src` library.
