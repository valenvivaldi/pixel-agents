# Multiuser Pixel Agents — Design

## Goal

Shared office layout with full agent presence visibility across multiple users. Each user runs their own VS Code + agents, but everyone sees the same office and each other's characters in real time.

## Requirements

- Shared layout (floor, walls, furniture) synced via server
- Full presence: all users see each other's agents with real status (typing, idle, waiting)
- All users can edit the layout (last-write-wins)
- No authentication — users pick a nickname displayed under their characters
- Self-hosted server (Docker or direct binary)
- Near real-time sync (polling every few seconds for layout, WebSocket for presence)

## Architecture

```
VS Code A ──┐
VS Code B ──┼── WS + HTTP ──► Node.js Server
VS Code C ──┘                  (layout on disk + presence in memory)
```

### Server (`server/`)

Independent Node.js/TypeScript package. HTTP + WebSocket, no frameworks.

**State:**
```typescript
interface ServerState {
  layout: OfficeLayout;
  layoutEtag: string;              // MD5 of layout JSON
  clients: Map<string, ClientState>;
}

interface ClientState {
  ws: WebSocket;
  userName: string;
  agents: RemoteAgent[];
  lastHeartbeat: number;
}

interface RemoteAgent {
  id: number;
  name: string;
  status: 'active' | 'idle' | 'waiting' | 'permission';
  activeTool?: string;
  seatId?: string;
  palette: number;
  hueShift: number;
}
```

**HTTP:**
- `GET /layout` — Returns layout JSON with `ETag` header. Respects `If-None-Match` (304).
- `PUT /layout` — Receives layout JSON, saves to memory + disk. Returns new ETag.

**WebSocket messages:**

| Direction | Type | Payload |
|-----------|------|---------|
| Client -> Server | `join` | `{ userName }` |
| Client -> Server | `heartbeat` | `{ agents: RemoteAgent[] }` |
| Server -> Client | `presence` | `{ clients: [{ userName, agents }] }` (excludes sender) |
| Server -> Client | `layoutChanged` | `{ etag }` |

**Persistence:** Layout saved to `server-data/layout.json` on every PUT. Loaded on startup.

**Cleanup:** Every 5s, removes clients with no heartbeat in >10s and broadcasts updated presence.

**Run:** `npx pixel-agents-server --port 4200` or Docker.

### Sync Client (`src/syncClient.ts`)

New module in the extension.

**VS Code settings:**
```json
{
  "pixel-agents.serverUrl": "",
  "pixel-agents.userName": "Player 1"
}
```

Empty `serverUrl` = offline mode (current behavior unchanged).

**Connection:** WebSocket with auto-reconnect (backoff: 1s, 2s, 4s, max 10s). Sends `join` on connect.

**Heartbeat (every 2s):** Collects local agent state from AgentManager, sends `RemoteAgent[]`.

**Presence reception:** Transforms remote agents into webview-compatible format, sends `remoteAgents` postMessage.

**Layout sync:**
- On editor save: PUT to server + local save.
- Polling GET every 3s with ETag (304 = no change).
- On `layoutChanged` WS message: immediate GET (shortcut to polling).

### Webview Changes

**Remote agents as Characters:**
- `useExtensionMessages.ts` handles new `remoteAgents` message.
- Each remote agent becomes a `Character` with `remote: true` and `userName: string`.
- Remote IDs namespaced: `clientId * 1000 + agentId`.
- Same palette/hueShift as reported by remote client.
- Click on remote agent: no terminal focus (shows tooltip with name + status).

**Nicks under characters:**
- `renderer.ts` draws `userName` below every character (local and remote).
- Small pixel font, centered, semi-transparent background.
- Local agents use `pixel-agents.userName` setting.
- Remote agents use the name from the server.

**Remote agents don't affect local state:**
- Seat positions are informational (rendered where the owning client reports).
- Don't block local pathfinding.
- Spawn/despawn with normal matrix effect.

## Changed Files

| Component | Change |
|---|---|
| `server/` | New package. HTTP + WS server. ~400 lines |
| `src/syncClient.ts` | New. WS connection + HTTP polling |
| `src/PixelAgentsViewProvider.ts` | Integrate syncClient, new `remoteAgents` message |
| `src/agentManager.ts` | Expose agent state for heartbeat |
| `webview-ui/` hooks | Handle `remoteAgents` message |
| `webview-ui/` renderer | Draw nicks, render remote agents |
| `webview-ui/` officeState | Remote characters with `remote` flag |
