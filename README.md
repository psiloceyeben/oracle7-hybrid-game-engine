# Oracle7 Hybrid Game Engine — Dev Preview

A reusable MIT-licensed extraction of WanderAround's composable world foundations, with validated world editing and an AI-provider integration boundary.

## Start

Node.js 20+ and npm are required.

```sh
npm ci
npm run check
npm test
npm run build
npm run dev
```

Open the loopback address printed by Vite. On exFAT use `npm ci --no-bin-links`. The scripts invoke binaries directly.

The workshop renders recipes through the existing Three.js projector. Build a preview, confirm it, undo it, or preview clearing the world. Export downloads the **committed** snapshot, not an unconfirmed preview. Workshop storage is in memory; the Node adapter provides file persistence for a host application.

## What is included

- Declarative recipes with parts, materials, collider metadata and stable entity IDs.
- Three.js rendering and procedural clay-style materials.
- Fixed-step clock, component lifecycle and adapter selection.
- Existing Rapier character/dynamic-body integration and stair helpers.
- Validated preview, commit, remove, undo, revision conflict detection and bounded idempotent retry history.
- Atomic file replacement and exclusive write locking for a local Node host.
- AI-provider proposals that never commit themselves.
- Transport-independent tool handlers for Claude's MCP wrapper.
- The game's existing `SpecialistRequests` correlated transport, including disconnect cancellation.
- 53 passing tests at packaging, strict type checking, and a runnable browser workshop.

Build emits reusable JavaScript/types in `lib/` and the static workshop in `dist/`. Import the engine from `lib/index.js`; import the Node-only store separately from `lib/nodeFileStore.js`.

## Natural language

The intended flow is description → connected model/planner → declarative edits → validated preview → explicit confirmation → saved world. A connected AI may compose a new object from the supported parts rather than select a preset.

The engine does **not** include Oracle weights or pretend that a model is connected. Claude supplies the MCP transport and Oracle7 12.0.3 provider. Existing game planning routes can be retained through the included specialist transport, but their game-specific action payloads must be translated using the corresponding existing planners—not guessed or treated as already-built recipes. See [MCP-INTEGRATION.md](MCP-INTEGRATION.md).

## Preview limits

Validated geometry currently supports boxes, cylinders, spheres, cones and planes, nested into compositions with the documented material palette. Arbitrary scripts, unknown geometry kinds, behavioral declarations, sockets, editor handles and unsupported aesthetic/LOD requests are rejected by the **edit service**, even though the inherited recipe type describes wider future capabilities.

A rendered vehicle is not automatically drivable. A rendered room is not automatically navigable. A host must register colliders and attach supported gameplay controllers. This package is not the full WanderAround catalogue, multiplayer server, asset library, wallet system or production editor.

Authorization is provided by the host callback. The local file adapter is for trusted development hosts, not distributed multi-server storage. Back up state; a leftover lock after a process crash requires operator review. Atomic rename does not guarantee recovery from every power-loss/filesystem failure. Preview drafts expire and do not survive restart; committed state, retained receipts and latest-edit undo do.

## License and release

Original distributable source is MIT licensed. Dependencies retain their own licenses; see THIRD-PARTY-NOTICES.txt. Model weights, private game/player data, deployment credentials, website corpus and branded/meme assets are excluded. `private: true` prevents accidental npm publication; it does not prevent GitHub upload.

WanderAround: https://wanderaround.io/
