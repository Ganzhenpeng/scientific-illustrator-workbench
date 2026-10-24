# Validation record

Date: **2026-10-24**, Asia/Shanghai. This record concerns the generated synthetic examples and tested paths, not every Illustrator capability.

| Check | Observed result |
| --- | --- |
| Platform | Windows; Illustrator 2025 **29.4.0**; Node **24.19.0** |
| Backend | illustrator-mcp-server **1.10.3**, SHA-512 checked against runtime-lock.json |
| Offline regression tests | **20 passed**, 0 failed |
| Official Skill Creator metadata validator | Passed; its PyYAML dependency was isolated in a local validation directory |
| Forward use test | A different three-stage request produced a valid 23-operation plan; source AI export was routed to a separate copy |
| Final MCP render | **44** measured native objects, **15** text frames, **0** raster/placed image objects |
| Measured layout | All planned objects returned native bounds; containment and text/connector checks passed |
| Native edit persistence | A copied AI was opened, one native text frame edited, saved, closed and reopened; edit persisted, source hash unchanged |
| Export-only protection | PDF was exported from a copied AI; original source hash unchanged |
| PNG | Actual Illustrator export, **1800 × 930 px**; visually reviewed |
| PDF | Exported and independently rasterized with Poppler; preview visually reviewed |
| SVG | Parsed XML; **15** native text elements, **0** image elements |
| Original native JSX route | Audit passed; registered objects=25; unregistered=0; text frames=8; paths=19; raster=0; placed=0 |
| Concurrent-entry protection | A JSX runner invocation was refused while the MCP session held the shared lock |
| Real document switch | An earlier run stopped when the active document changed to another saved file; partial output was retained and excluded from publication |

The public preview is copied from the successful final MCP run. Its SHA-256 is
`2e281cfa1704bfef15e38b180a396782cd42cebdf9f6c5d00ca0fd4b4c0dc88d`.

The curves, unit-cell shapes and colours in the examples are synthetic illustrations, not calculations or experimental observations. Runtime logs and local document paths are excluded from the public repository.

No claim is made here about macOS, Chinese font handling, complex formula assets, exact physical fidelity, journal final-size acceptance, or all 66 backend tools. The active-document guard and cooperative lock reduce accidental cross-document operations; they are not a sandbox or an atomic transaction against manual UI changes.

Workflow planning and layout helpers were independently written. The MIT backend remains a separately downloaded dependency. No source, template or style library from a project without a declared license is distributed here.
