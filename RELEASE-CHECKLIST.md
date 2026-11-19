# Dev Preview release checks

- MIT approved; original engine source selected without private game data.
- Existing game baseline compiled; 26 scoped game tests passed. The game vehicle suite remains dependent on its external catalogue and is not a standalone-engine pass.
- Standalone strict TypeScript compilation passed.
- Standalone 53 tests passed: physics, stairs, clock, recipes, edit validation, permission/revision/retry handling, file persistence, natural-language adapter and specialist correlation.
- Workshop production build passed; bundle-size advisory remains (~504 kB uncompressed).
- Rapier reports a deprecation warning for its current initialization call; physics tests pass.
- Browser rendering/add/clear verified before edit-layer wiring. Final preview/confirm/undo/export browser verification is recorded in ACCEPTANCE.txt.
- Live Oracle/MCP integration is intentionally Claude's handoff task, not marked complete.
- No GitHub upload or engine production deployment performed.

Known limitations: constrained visual recipe vocabulary; wider inherited behavior/socket/LOD schema is not admitted by the edit layer; no distributed storage, account service or automatic gameplay-controller synthesis. No universal performance guarantee.

Source hashes in SOURCE-PROVENANCE.json record the original extraction; RELEASE-MANIFEST.json records the final distributable files. Additional changes include portable imports/types, nested collider transform correction, world edits, provider/tools adapter, persistence, tests and workshop integration.
