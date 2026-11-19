# Live integration results — Oracle7 Hybrid Game Engine, Developer Preview v0.1.0

Run on 19 November 2026 (04:15 UTC). Engine source: this repository's files, on a clean `npm ci`.

How it was run: an agent (a test script standing in for Claude Code, Codex or Cursor) spoke MCP to the Oracle7 12.0.2
satellite door (`orbiters/hybrid-game-engine/door_mcp.py`). The door spoke to two things: the running Oracle7 12.0.2 harness,
over its own chat (`/api/chat`), and this engine's world tools over MCP (`mcp_server.mjs`, wrapping `createWorldTools` and a
`NodeFileWorldStore` with a principal bound by the host). Every row is judged by what came back and by the world file on disk.

Before it: on the same clean extraction, `npm run check` (strict TypeScript) passed, `npm test` passed 53 of 53 tests in 6
files, and `npm run build` passed.

| # | Check | Result | Detail |
|---|---|---|---|
| 1 | read mode lists chat, chat_new and only read-only world tools | pass | `["chat", "chat_new", "world_inspect", "world_export", "world_describe", "world_preview"]` |
| 2 | Oracle7 chat through the door: a question is answered and checked | pass | `"answered / Paris. Paris (nicknamed the \"City of light\") is the capital city of France, and "` |
| 3 | Oracle7 /why through the door explains the last reply | pass | `"My last reply, to \"What is the capital of France?\", went: Front door -> Organ dispatch -> Relation store -> Speaker -> F"` |
| 4 | 1. no provider: world_describe says not connected | pass | `"language provider not connected"` |
| 5 | read mode refuses a commit | pass | `"{\"error\": \"this door is read-only and world_commit does not declare itself read-only\"}"` |
| 6 | read mode refuses a chat turn that would build | pass | `"door:read-only"` |
| 7 | 3. pavilion preview validates and is not committed | pass | `{"previewId": "179783c3-389c-4b00-a50d-2ac30cdf773f", "revision": 0, "warnings": ["Collider declarations require host physics registration; behavior execution is not provided by th` |
| 8 | 3. confirm commits revision 1 with stable entity IDs | pass | `{"receiptId": "21731f75-d5b1-49e9-a4e0-7638b314f1eb", "revision": 1, "entityIds": ["pavilion"]}` |
| 9 | 6. duplicate retry with the same key returns the same receipt, no second write | pass | `"21731f75-d5b1-49e9-a4e0-7638b314f1eb"` |
| 10 | 3. after restart the pavilion is there, same ID and revision | pass | `{"revision": 1, "ids": ["pavilion"]}` |
| 11 | 6. duplicate retry after restart recovers the receipt | pass | `"21731f75-d5b1-49e9-a4e0-7638b314f1eb"` |
| 12 | 6. a stale revision is refused | pass | `"revision conflict"` |
| 13 | 4. the roof is revised (revision 2, roof 0.8 high) | pass | `2` |
| 14 | 4. undo takes back the latest revision (roof 0.3 again) | pass | `3` |
| 15 | undo of an older revision across newer work is refused | pass | `"undo conflict: newer edits exist"` |
| 16 | 5. an unsupported mechanic (a behavior script) is rejected, not substituted | pass | `"unsupported capability: sockets, behaviors, handles, modifiers or LOD"` |
| 17 | 5. an unsupported part kind (elevator) is rejected | pass | `"unsupported part kind: elevator"` |
| 18 | Oracle7 conversation is never taken as a world change | pass | `"chat path claim:barred>converse:claim:receive; world revision 3"` |
| 19 | 6. denied authority: inspect and preview refused for an unauthorised world | pass | `["permission denied", "permission denied"]` |
| 20 | 6. concurrent writes: one commit wins, the other is refused on revision | pass | `{"a": 4, "b": "revision conflict", "ids": ["pavilion", "kiosk-a"]}` |

20 of 20 passed. The numbered rows map to the "Required integration acceptance" steps in
[MCP-INTEGRATION.md](MCP-INTEGRATION.md).

## Not tested here, and not claimed

- A language provider: none is connected in this release, so natural language does not go straight to a world change.
  `world.describe` reports that it is not connected; an agent composes recipe edits and previews them with `world.preview`.
  Provider timeouts were therefore not exercised.
- Collider registration and walking (step 7).
- Two independently authenticated clients, so multiplayer creation is not claimed (step 8).
