---
paths:
  - "akhil_systems_backend/src/chat/**"
---

> Backend area guide (`akhil_systems_backend/src/chat`). Paths are relative to `akhil_systems_backend/`.

# src/chat

- The only module using Mongoose models: `ChatConnectionService.getModel(...)` returns a model bound to the tenant's database per request (no `@InjectModel`).
- Every message is sealed at rest (`ChatCryptoService`: per-tenant data keys in `CHAT_TENANT_KEY` wrapped by `CHAT_MASTER_KEY`, AES-GCM; files encrypted with per-file keys). Never store or return plaintext outside `toClientMessage`.
- Opt-in per tenant (`isChatServiceEnabled`) and per user/role ("Chat Service" additional permission); REST routes go through `ChatEnabledMiddleware` after Jwt + Tenant; the gateway re-checks on connect.
- REST owns persistence, the `/chat` gateway owns delivery; controllers emit after writes (`chat:message:new|updated|deleted`, `chat:conversation:*`).
- The attachment download route is intentionally outside JwtMiddleware and authorised by a signed token.
- Handshake (`ChatGateway.handleConnection`): token from `handshake.auth.token` or `Authorization: Bearer`, own `decryptToken` copy, rejects expired tokens, checks `isChatEnabledForTenant` + `userHasChatPermission` (emits `chat:error`, disconnects), stores `{ user, tenant_schema }` in the per-socket `sockets` map and joins `tenant_<id>` / `user_<id>`; `chat:join` adds `conversation_<id>` after `assertMember`.
- Adding a socket event: (1) `@SubscribeMessage('chat:<verb>')`; take identity and `tenant_schema` from `this.sockets.get(socket.id)`, never the payload; (2) authorise (`ChatService.assertMember`); (3) persist through `ChatService` (shared with REST); (4) emit via `emitToMembers` / `emitToConversation` / `emitToUsers` (one `server.to([...])` call so a socket gets it once); on error emit `chat:error`. Add the matching REST emit if REST can make the same change.
- Emits and presence (`fetchSockets`) are per process: no Socket.IO cluster adapter, and Redis presence keys are no-ops while Redis is disconnected.
- Skill: `be-rules-alerts-notifications`.
