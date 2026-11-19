# Claude upload and Oracle7 12.0.3 integration

## What is ready

The engine-side edit layer, AI provider interface, transport-independent tool dispatch, persistence adapter and existing specialist request transport are implemented and tested. Claude owns the MCP server/client integration and the real Oracle connection. No MCP server or hosted inference endpoint is silently started by this package.

## Host setup

After `npm ci && npm run build`:

```js
import {WorldEditService, createWorldTools} from './lib/index.js';
import {NodeFileWorldStore} from './lib/nodeFileStore.js';

const store = new NodeFileWorldStore('/host-controlled/path/demo.world.json');
const service = new WorldEditService(store, (principal, action, worldId) => {
  // Replace with your authenticated host ACL, not model-provided identity.
  return principal.id === 'local-owner' && worldId === 'local-world';
});
const tools = createWorldTools(service, {id:'local-owner'}, oracleProvider);
// Register thin MCP wrappers calling tools.call(name, arguments).
```

`oracleProvider` implements:
```ts
plan(text, context, signal): Promise<{
  execution_authorized: false;
  edits: Array<{type:'put'; recipe:BuildRecipe} | {type:'remove';entityId:string}>;
  explanation?:string;
}>
```

Use the actual Oracle7 12.0.3 interface from that distribution. Do not invent an endpoint or put API keys in browser code. The provider receives a scoped snapshot, must honor cancellation where possible, and returns data—not executable code. Timeout, bad output, changed world revision and revoked write authority cannot commit an edit.

## Exact callable tool contracts

All tools take a plain object. Unexpected arguments are rejected. The principal is bound by the host, never accepted in tool arguments.

| Tool | Arguments |
| --- | --- |
| world.inspect | {} |
| world.export | {} |
| world.describe | {text:string} |
| world.preview | {expectedRevision:integer, edits:Edit[]} |
| world.commit | {previewId:string, expectedRevision:integer, idempotencyKey:string} |
| world.undo | {receiptId:string, expectedRevision:integer, idempotencyKey:string} |

`world.describe` returns the same preview as `world.preview`, plus explanatory text. It never commits. Show the proposed scene and warnings to the user. `world.commit` returns receiptId, revision and entityIds after the store accepts the write. `world.export` returns current entities but not private receipt history.

Keep the same idempotency key when retrying an uncertain commit. Retained receipts default to 128 operations; preview retention defaults to five minutes. A duplicate committed request can be recovered after process restart while its receipt remains retained. A missing/expired preview requires inspection and a fresh preview, not an automatic replay of the original action.

Undo only applies to the latest world revision and original actor. This deliberately rejects undo across another user's newer work.

## Reuse the existing WanderAround route

`src/specialistRequests.ts` is copied from the game, not a parallel rewrite. It supports the existing `specialist_conversation`, creation, furnishing, room and dimension message families. Instantiate it with the host transport's send function, route correlated replies to receive(), and call cancel() on disconnect or world change.

The audited server has separate world-action and Oracle12 resident-dialogue paths. Resident dialogue explicitly cannot authorize edits. Existing conversation results may carry an action brief rather than a BuildRecipe; retain the existing planner that translates that brief, then pass its supported recipe edits through WorldEditService. Never cast an arbitrary conversation reply to Edit[].

For a direct Oracle7/other model integration, implement LanguageProvider.plan with structured recipe output. This is an integration option, not a claim that the supplied Oracle model already emits this schema.

## Supported recipe subset and safety

Use emptyRecipe() to create required fields. Supported visual kinds: box, shaft_cylinder, sphere, cone, plane. Materials: marble, concrete, wood, brick, stone, bark, cloth, leather, fur, skin, grass, crystal, plaster, rune_glow, glass, steel, gold, copper, water, _default. Use WANDER_TOON_PHYSICAL style. Sockets, handles and behavior arrays must be empty in validated edits. Unknown fields are rejected.

The validator checks finite/bounded transforms, combined hierarchy bounds, duplicate IDs, nesting/part/entity budgets, dimensions, materials, collider shapes and bounded JSON. Host-defined world authorization is checked again at commit. Never expose the low-level projector as an unvalidated public write endpoint.

File storage uses a host-configured path, exclusive lock and atomic replacement. It contains world history and must not be web-served. For distributed production, supply a database-backed WorldStore with a genuinely atomic compareAndSwap; don't substitute separate read and write calls.

The host is still responsible for gameplay controllers, collider registration, physics acceptance, account/session authentication, per-tenant rate limits and backups. Model prose and preview meshes are not proof of working gameplay.

## Required integration acceptance

1. Start without a provider: world.describe must say not connected.
2. Connect the actual Oracle runtime and record its version.
3. Describe a four-column pavilion; preview, confirm, inspect IDs, restart host and inspect again.
4. Revise its roof; undo the latest revision.
5. Verify unsupported mechanics are explained and rejected rather than silently substituted.
6. Test denied authority, duplicate retries, timeout, stale revisions and concurrent writes.
7. Test collider registration and walking separately.
8. Test two independently authenticated clients before claiming multiplayer creation.

The repository tests use deterministic provider doubles to verify the boundary. They do not certify live Oracle output quality or MCP transport.
