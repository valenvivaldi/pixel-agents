# Multiuser Pixel Agents — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add multiuser support so multiple VS Code users share the same office layout and see each other's agents in real time.

**Architecture:** Self-hosted Node.js server with HTTP (layout CRUD with ETag) + WebSocket (agent presence broadcast). Extension gets a new `syncClient.ts` that connects when `pixel-agents.serverUrl` is configured. Webview renders remote agents with nicks underneath all characters.

**Tech Stack:** Node.js, `ws` library, `http` module, TypeScript, existing VS Code extension + React webview.

---

### Task 1: Server Package Setup

**Files:**
- Create: `server/package.json`
- Create: `server/tsconfig.json`
- Create: `server/src/types.ts`

**Step 1: Create server package.json**

```json
{
  "name": "pixel-agents-server",
  "version": "1.0.0",
  "description": "Multiuser sync server for Pixel Agents",
  "main": "dist/index.js",
  "bin": { "pixel-agents-server": "dist/index.js" },
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsc --watch"
  },
  "dependencies": {
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "@types/ws": "^8.5.13",
    "@types/node": "^22.0.0",
    "typescript": "^5.7.0"
  }
}
```

**Step 2: Create server tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true
  },
  "include": ["src"]
}
```

**Step 3: Create server/src/types.ts**

```typescript
import type { WebSocket } from 'ws';

export interface RemoteAgent {
  id: number;
  name: string;
  status: 'active' | 'idle' | 'waiting' | 'permission';
  activeTool?: string;
  seatId?: string;
  palette: number;
  hueShift: number;
}

export interface ClientState {
  ws: WebSocket;
  clientId: string;
  userName: string;
  agents: RemoteAgent[];
  lastHeartbeat: number;
}

export interface PresenceClient {
  clientId: string;
  userName: string;
  agents: RemoteAgent[];
}

// WebSocket message types
export interface JoinMessage {
  type: 'join';
  userName: string;
}

export interface HeartbeatMessage {
  type: 'heartbeat';
  agents: RemoteAgent[];
}

export type ClientMessage = JoinMessage | HeartbeatMessage;

export interface PresenceMessage {
  type: 'presence';
  clients: PresenceClient[];
}

export interface LayoutChangedMessage {
  type: 'layoutChanged';
  etag: string;
}

export type ServerMessage = PresenceMessage | LayoutChangedMessage;
```

**Step 4: Install dependencies**

Run: `cd server && npm install`

**Step 5: Commit**

```bash
git add server/
git commit -m "feat(server): scaffold multiuser server package with types"
```

---

### Task 2: Server HTTP + WebSocket Implementation

**Files:**
- Create: `server/src/index.ts`

**Step 1: Implement the server**

```typescript
#!/usr/bin/env node
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { WebSocketServer, WebSocket } from 'ws';
import type { ClientState, ClientMessage, PresenceClient, RemoteAgent } from './types.js';

const PORT = parseInt(process.argv.find((_, i, a) => a[i - 1] === '--port') || '4200', 10);
const DATA_DIR = process.argv.find((_, i, a) => a[i - 1] === '--data') || 'server-data';
const LAYOUT_FILE = path.join(DATA_DIR, 'layout.json');
const HEARTBEAT_TIMEOUT_MS = 10_000;
const CLEANUP_INTERVAL_MS = 5_000;

// ── State ──────────────────────────────────────────────────────
let layoutJson = '{}';
let layoutEtag = '';
const clients = new Map<string, ClientState>();

function computeEtag(json: string): string {
  return crypto.createHash('md5').update(json).digest('hex');
}

// ── Layout persistence ─────────────────────────────────────────
function loadLayout(): void {
  try {
    if (fs.existsSync(LAYOUT_FILE)) {
      layoutJson = fs.readFileSync(LAYOUT_FILE, 'utf-8');
      layoutEtag = computeEtag(layoutJson);
      console.log(`[Server] Layout loaded from ${LAYOUT_FILE} (etag: ${layoutEtag.slice(0, 8)})`);
    }
  } catch (err) {
    console.error('[Server] Failed to load layout:', err);
  }
}

function saveLayout(json: string): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const tmpPath = LAYOUT_FILE + '.tmp';
    fs.writeFileSync(tmpPath, json, 'utf-8');
    fs.renameSync(tmpPath, LAYOUT_FILE);
  } catch (err) {
    console.error('[Server] Failed to save layout:', err);
  }
}

// ── Presence broadcast ─────────────────────────────────────────
function buildPresenceList(excludeClientId?: string): PresenceClient[] {
  const result: PresenceClient[] = [];
  for (const [id, client] of clients) {
    if (id === excludeClientId) continue;
    result.push({
      clientId: client.clientId,
      userName: client.userName,
      agents: client.agents,
    });
  }
  return result;
}

function broadcastPresence(): void {
  for (const [id, client] of clients) {
    if (client.ws.readyState !== WebSocket.OPEN) continue;
    const msg = JSON.stringify({
      type: 'presence',
      clients: buildPresenceList(id),
    });
    client.ws.send(msg);
  }
}

// ── Cleanup stale clients ──────────────────────────────────────
function cleanupStaleClients(): void {
  const now = Date.now();
  let removed = false;
  for (const [id, client] of clients) {
    if (now - client.lastHeartbeat > HEARTBEAT_TIMEOUT_MS) {
      console.log(`[Server] Client ${id} (${client.userName}) timed out`);
      client.ws.close();
      clients.delete(id);
      removed = true;
    }
  }
  if (removed) {
    broadcastPresence();
  }
}

// ── HTTP Server ────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, If-None-Match');
  res.setHeader('Access-Control-Expose-Headers', 'ETag');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url === '/layout' && req.method === 'GET') {
    const ifNoneMatch = req.headers['if-none-match'];
    if (ifNoneMatch && ifNoneMatch === layoutEtag) {
      res.writeHead(304);
      res.end();
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'ETag': layoutEtag,
    });
    res.end(layoutJson);
    return;
  }

  if (req.url === '/layout' && req.method === 'PUT') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        JSON.parse(body); // validate JSON
        layoutJson = body;
        layoutEtag = computeEtag(layoutJson);
        saveLayout(layoutJson);

        res.writeHead(200, {
          'Content-Type': 'application/json',
          'ETag': layoutEtag,
        });
        res.end(JSON.stringify({ etag: layoutEtag }));

        // Notify all WS clients
        const msg = JSON.stringify({ type: 'layoutChanged', etag: layoutEtag });
        for (const client of clients.values()) {
          if (client.ws.readyState === WebSocket.OPEN) {
            client.ws.send(msg);
          }
        }
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }

  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, clients: clients.size }));
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

// ── WebSocket Server ───────────────────────────────────────────
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  const clientId = crypto.randomUUID();
  const client: ClientState = {
    ws,
    clientId,
    userName: 'Anonymous',
    agents: [],
    lastHeartbeat: Date.now(),
  };
  clients.set(clientId, client);
  console.log(`[Server] Client connected: ${clientId}`);

  // Send current presence to new client
  ws.send(JSON.stringify({
    type: 'presence',
    clients: buildPresenceList(clientId),
  }));

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString()) as ClientMessage;
      client.lastHeartbeat = Date.now();

      if (msg.type === 'join') {
        client.userName = msg.userName || 'Anonymous';
        console.log(`[Server] Client ${clientId} joined as "${client.userName}"`);
        broadcastPresence();
      } else if (msg.type === 'heartbeat') {
        client.agents = msg.agents || [];
        broadcastPresence();
      }
    } catch (err) {
      console.error('[Server] Bad message from client:', err);
    }
  });

  ws.on('close', () => {
    console.log(`[Server] Client disconnected: ${clientId} (${client.userName})`);
    clients.delete(clientId);
    broadcastPresence();
  });

  ws.on('error', (err) => {
    console.error(`[Server] WS error for ${clientId}:`, err);
  });
});

// ── Start ──────────────────────────────────────────────────────
loadLayout();
setInterval(cleanupStaleClients, CLEANUP_INTERVAL_MS);

server.listen(PORT, () => {
  console.log(`[Pixel Agents Server] Running on port ${PORT}`);
  console.log(`[Pixel Agents Server] Layout file: ${path.resolve(LAYOUT_FILE)}`);
});
```

**Step 2: Build and verify server starts**

Run: `cd server && npm run build && node dist/index.js --port 4200`
Expected: `[Pixel Agents Server] Running on port 4200`
Stop with Ctrl+C.

**Step 3: Commit**

```bash
git add server/src/index.ts
git commit -m "feat(server): implement HTTP layout API + WebSocket presence server"
```

---

### Task 3: Extension Settings for Server URL and Username

**Files:**
- Modify: `package.json` (root — VS Code extension manifest, `contributes.configuration` section)
- Modify: `src/constants.ts`

**Step 1: Add VS Code settings to package.json**

In root `package.json`, inside `contributes`, add a `configuration` block (or extend existing):

```json
"configuration": {
  "title": "Pixel Agents",
  "properties": {
    "pixel-agents.serverUrl": {
      "type": "string",
      "default": "",
      "description": "URL of the Pixel Agents multiuser server (e.g. ws://localhost:4200). Leave empty for offline mode."
    },
    "pixel-agents.userName": {
      "type": "string",
      "default": "",
      "description": "Your display name shown under your agents in the shared office."
    }
  }
}
```

**Step 2: Add constants for the new settings**

In `src/constants.ts`, add:

```typescript
// ── Multiuser Sync ────────────────────────────────────────
export const SYNC_HEARTBEAT_INTERVAL_MS = 2000;
export const SYNC_LAYOUT_POLL_INTERVAL_MS = 3000;
export const SYNC_RECONNECT_BASE_MS = 1000;
export const SYNC_RECONNECT_MAX_MS = 10000;
export const CONFIG_KEY_SERVER_URL = 'pixel-agents.serverUrl';
export const CONFIG_KEY_USER_NAME = 'pixel-agents.userName';
```

**Step 3: Commit**

```bash
git add package.json src/constants.ts
git commit -m "feat: add VS Code settings for multiuser server URL and username"
```

---

### Task 4: Sync Client (Extension Side)

**Files:**
- Create: `src/syncClient.ts`

**Step 1: Implement the sync client**

```typescript
import * as http from 'http';
import * as https from 'https';
import WebSocket from 'ws';
import type { AgentState, MessageEmitter } from './types.js';
import {
  SYNC_HEARTBEAT_INTERVAL_MS,
  SYNC_LAYOUT_POLL_INTERVAL_MS,
  SYNC_RECONNECT_BASE_MS,
  SYNC_RECONNECT_MAX_MS,
} from './constants.js';

interface RemoteAgent {
  id: number;
  name: string;
  status: 'active' | 'idle' | 'waiting' | 'permission';
  activeTool?: string;
  seatId?: string;
  palette: number;
  hueShift: number;
}

interface PresenceClient {
  clientId: string;
  userName: string;
  agents: RemoteAgent[];
}

export class SyncClient {
  private ws: WebSocket | null = null;
  private serverUrl: string;
  private httpBaseUrl: string;
  private userName: string;
  private agents: Map<number, AgentState>;
  private webview: MessageEmitter | undefined;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private layoutPollTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = SYNC_RECONNECT_BASE_MS;
  private layoutEtag = '';
  private disposed = false;
  private onRemoteLayoutChanged: ((layout: Record<string, unknown>) => void) | null = null;

  constructor(
    serverUrl: string,
    userName: string,
    agents: Map<number, AgentState>,
    webview: MessageEmitter | undefined,
    onRemoteLayoutChanged?: (layout: Record<string, unknown>) => void,
  ) {
    this.serverUrl = serverUrl;
    this.userName = userName;
    this.agents = agents;
    this.webview = webview;
    this.onRemoteLayoutChanged = onRemoteLayoutChanged || null;

    // Derive HTTP base URL from WS URL
    this.httpBaseUrl = serverUrl
      .replace(/^ws:/, 'http:')
      .replace(/^wss:/, 'https:');

    this.connect();
    this.startLayoutPolling();
  }

  setWebview(webview: MessageEmitter | undefined): void {
    this.webview = webview;
  }

  updateUserName(userName: string): void {
    this.userName = userName;
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'join', userName }));
    }
  }

  // ── WebSocket connection ─────────────────────────────────────
  private connect(): void {
    if (this.disposed) return;

    try {
      this.ws = new WebSocket(this.serverUrl);

      this.ws.on('open', () => {
        console.log('[SyncClient] Connected to server');
        this.reconnectDelay = SYNC_RECONNECT_BASE_MS;
        this.ws!.send(JSON.stringify({ type: 'join', userName: this.userName }));
        this.startHeartbeat();
      });

      this.ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'presence') {
            this.handlePresence(msg.clients as PresenceClient[]);
          } else if (msg.type === 'layoutChanged') {
            this.fetchLayout();
          }
        } catch (err) {
          console.error('[SyncClient] Bad server message:', err);
        }
      });

      this.ws.on('close', () => {
        console.log('[SyncClient] Disconnected');
        this.stopHeartbeat();
        this.scheduleReconnect();
      });

      this.ws.on('error', (err) => {
        console.error('[SyncClient] WS error:', err);
      });
    } catch (err) {
      console.error('[SyncClient] Connection failed:', err);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.disposed) return;
    if (this.reconnectTimer) return;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectDelay);

    this.reconnectDelay = Math.min(this.reconnectDelay * 2, SYNC_RECONNECT_MAX_MS);
  }

  // ── Heartbeat ────────────────────────────────────────────────
  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.sendHeartbeat(); // immediate first beat
    this.heartbeatTimer = setInterval(() => this.sendHeartbeat(), SYNC_HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private sendHeartbeat(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const agents: RemoteAgent[] = [];
    for (const [id, agent] of this.agents) {
      if (agent.isExternal) continue; // don't broadcast external sessions
      const isActive = agent.activeToolIds.size > 0 || agent.hadToolsInTurn;
      const isWaiting = agent.isWaiting;
      const isPermission = agent.permissionSent;

      let status: RemoteAgent['status'] = 'idle';
      if (isPermission) status = 'permission';
      else if (isWaiting) status = 'waiting';
      else if (isActive) status = 'active';

      // Get first active tool name
      let activeTool: string | undefined;
      for (const toolName of agent.activeToolNames.values()) {
        activeTool = toolName;
        break;
      }

      agents.push({
        id,
        name: agent.terminalRef?.name || `Agent ${id}`,
        status,
        activeTool,
        palette: 0, // will be enriched from webview state
        hueShift: 0,
      });
    }

    this.ws.send(JSON.stringify({ type: 'heartbeat', agents }));
  }

  // ── Presence handling ────────────────────────────────────────
  private handlePresence(clients: PresenceClient[]): void {
    this.webview?.postMessage({
      type: 'remoteAgents',
      clients,
    });
  }

  // ── Layout polling ───────────────────────────────────────────
  private startLayoutPolling(): void {
    this.layoutPollTimer = setInterval(() => this.fetchLayout(), SYNC_LAYOUT_POLL_INTERVAL_MS);
  }

  private fetchLayout(): void {
    const url = new URL('/layout', this.httpBaseUrl);
    const mod = url.protocol === 'https:' ? https : http;

    const headers: Record<string, string> = {};
    if (this.layoutEtag) {
      headers['If-None-Match'] = this.layoutEtag;
    }

    const req = mod.get(url.toString(), { headers }, (res) => {
      if (res.statusCode === 304) return; // not modified

      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode === 200) {
          const newEtag = res.headers['etag'] as string;
          if (newEtag && newEtag !== this.layoutEtag) {
            this.layoutEtag = newEtag;
            try {
              const layout = JSON.parse(body) as Record<string, unknown>;
              this.onRemoteLayoutChanged?.(layout);
            } catch (err) {
              console.error('[SyncClient] Bad layout JSON:', err);
            }
          }
        }
      });
    });

    req.on('error', (err) => {
      console.error('[SyncClient] Layout fetch error:', err);
    });
  }

  putLayout(layout: Record<string, unknown>): void {
    const json = JSON.stringify(layout);
    const url = new URL('/layout', this.httpBaseUrl);
    const mod = url.protocol === 'https:' ? https : http;

    const req = (mod === https ? https : http).request(url.toString(), {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(json),
      },
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const result = JSON.parse(body);
            this.layoutEtag = result.etag;
          } catch { /* ignore */ }
        }
      });
    });

    req.on('error', (err) => {
      console.error('[SyncClient] Layout PUT error:', err);
    });

    req.write(json);
    req.end();
  }

  dispose(): void {
    this.disposed = true;
    this.stopHeartbeat();
    if (this.layoutPollTimer) {
      clearInterval(this.layoutPollTimer);
      this.layoutPollTimer = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
```

**Step 2: Verify it compiles**

Run: `npm run build` (from root)
Expected: No TypeScript errors related to syncClient.

**Step 3: Commit**

```bash
git add src/syncClient.ts
git commit -m "feat: add SyncClient for multiuser server connection"
```

---

### Task 5: Integrate SyncClient into PixelAgentsViewProvider

**Files:**
- Modify: `src/PixelAgentsViewProvider.ts`

**Step 1: Add SyncClient lifecycle to the provider**

Add import at top:
```typescript
import { SyncClient } from './syncClient.js';
import { CONFIG_KEY_SERVER_URL, CONFIG_KEY_USER_NAME } from './constants.js';
```

Add member to class:
```typescript
private syncClient: SyncClient | null = null;
```

In `resolveWebviewView`, after `webviewReady` handling (after `sendExistingAgents`), add sync client initialization:
```typescript
// Initialize multiuser sync if server URL is configured
this.initSyncClient();
```

Add method to class:
```typescript
private initSyncClient(): void {
  const config = vscode.workspace.getConfiguration('pixel-agents');
  const serverUrl = config.get<string>('serverUrl', '');
  const userName = config.get<string>('userName', '') || os.userInfo().username || 'Anonymous';

  if (!serverUrl) {
    console.log('[Pixel Agents] No server URL — offline mode');
    return;
  }

  this.syncClient = new SyncClient(
    serverUrl,
    userName,
    this.agents,
    this.webview,
    (layout) => {
      // Remote layout change — push to webview
      console.log('[Pixel Agents] Remote layout change from server');
      this.webview?.postMessage({ type: 'layoutLoaded', layout });
      // Also write locally
      this.layoutWatcher?.markOwnWrite();
      writeLayoutToFile(layout);
    },
  );

  // Send local userName to webview
  this.webview?.postMessage({ type: 'localUserName', userName });
}
```

In the `saveLayout` message handler, after writing locally, also push to server:
```typescript
} else if (message.type === 'saveLayout') {
  this.layoutWatcher?.markOwnWrite();
  writeLayoutToFile(message.layout as Record<string, unknown>);
  // Push to multiuser server if connected
  this.syncClient?.putLayout(message.layout as Record<string, unknown>);
}
```

In `dispose()`, add cleanup:
```typescript
this.syncClient?.dispose();
this.syncClient = null;
```

Listen for config changes to update userName:
```typescript
// Inside the existing onDidChangeConfiguration handler, add:
if (e.affectsConfiguration('pixel-agents.serverUrl') || e.affectsConfiguration('pixel-agents.userName')) {
  const newUrl = vscode.workspace.getConfiguration('pixel-agents').get<string>('serverUrl', '');
  const newName = vscode.workspace.getConfiguration('pixel-agents').get<string>('userName', '') || os.userInfo().username || 'Anonymous';
  if (this.syncClient) {
    this.syncClient.updateUserName(newName);
  }
  this.webview?.postMessage({ type: 'localUserName', userName: newName });
}
```

**Step 2: Verify it compiles**

Run: `npm run build`

**Step 3: Commit**

```bash
git add src/PixelAgentsViewProvider.ts
git commit -m "feat: integrate SyncClient into extension provider"
```

---

### Task 6: Add `remote` and `userName` Fields to Character Type

**Files:**
- Modify: `webview-ui/src/office/types.ts`

**Step 1: Add fields to Character interface**

In the `Character` interface (around line 166), add after `isExternal?`:

```typescript
  /** Whether this character belongs to a remote user (multiuser mode) */
  isRemote?: boolean
  /** Display name of the user who owns this character */
  userName?: string
```

**Step 2: Commit**

```bash
git add webview-ui/src/office/types.ts
git commit -m "feat: add isRemote and userName fields to Character type"
```

---

### Task 7: Handle `remoteAgents` Message in Webview

**Files:**
- Modify: `webview-ui/src/hooks/useExtensionMessages.ts`
- Modify: `webview-ui/src/office/engine/officeState.ts`

**Step 1: Add state for local userName**

In `useExtensionMessages.ts`, add state:
```typescript
const [localUserName, setLocalUserName] = useState<string>('')
```

Add to the return object:
```typescript
return { agents, selectedAgent, agentTools, agentStatuses, subagentTools, subagentCharacters, layoutReady, loadedAssets, workspaceFolders, externalSessionsSettings, showLabelsAlways, localUserName }
```

Update the `ExtensionMessageState` interface:
```typescript
localUserName: string
```

**Step 2: Handle `localUserName` message**

In the message handler, add:
```typescript
} else if (msg.type === 'localUserName') {
  const name = msg.userName as string
  setLocalUserName(name)
  // Update all local characters with the userName
  for (const ch of os.characters.values()) {
    if (!ch.isRemote && !ch.isSubagent) {
      ch.userName = name
    }
  }
}
```

**Step 3: Handle `remoteAgents` message**

In the message handler, add:
```typescript
} else if (msg.type === 'remoteAgents') {
  const clients = msg.clients as Array<{
    clientId: string
    userName: string
    agents: Array<{
      id: number
      name: string
      status: string
      activeTool?: string
      seatId?: string
      palette: number
      hueShift: number
    }>
  }>
  os.updateRemoteAgents(clients)
}
```

**Step 4: Add `updateRemoteAgents` to OfficeState**

In `officeState.ts`, add a new method and tracking map:

Add member to class:
```typescript
/** Track remote character IDs for cleanup. Maps "clientId:agentId" → character ID */
remoteCharacterMap: Map<string, number> = new Map()
private nextRemoteId = -10000 // start far from subagent IDs
```

Add method:
```typescript
updateRemoteAgents(clients: Array<{
  clientId: string
  userName: string
  agents: Array<{
    id: number
    name: string
    status: string
    activeTool?: string
    seatId?: string
    palette: number
    hueShift: number
  }>
}>): void {
  // Build set of expected remote keys
  const expectedKeys = new Set<string>()
  for (const client of clients) {
    for (const agent of client.agents) {
      expectedKeys.add(`${client.clientId}:${agent.id}`)
    }
  }

  // Remove remote characters no longer present
  for (const [key, charId] of this.remoteCharacterMap) {
    if (!expectedKeys.has(key)) {
      const ch = this.characters.get(charId)
      if (ch) {
        ch.matrixEffect = 'despawn'
        ch.matrixEffectTimer = 0
        ch.matrixEffectSeeds = matrixEffectSeeds()
      }
      this.remoteCharacterMap.delete(key)
    }
  }

  // Add or update remote characters
  for (const client of clients) {
    for (const agent of client.agents) {
      const key = `${client.clientId}:${agent.id}`
      let charId = this.remoteCharacterMap.get(key)

      if (charId !== undefined && this.characters.has(charId)) {
        // Update existing
        const ch = this.characters.get(charId)!
        ch.isActive = agent.status === 'active'
        ch.currentTool = agent.activeTool || null
        ch.userName = client.userName

        if (agent.status === 'permission') {
          ch.bubbleType = 'permission'
        } else if (agent.status === 'waiting') {
          if (ch.bubbleType !== 'waiting') {
            ch.bubbleType = 'waiting'
            ch.bubbleTimer = 2
          }
        } else {
          if (ch.bubbleType === 'permission') {
            ch.bubbleType = null
          }
        }
      } else {
        // Create new remote character
        charId = this.nextRemoteId--
        const seat = this.findFreeSeat()
        const seatObj = seat ? this.seats.get(seat) : null
        if (seatObj) seatObj.assigned = true

        const ch = createCharacter(charId, agent.palette, seat, seatObj, agent.hueShift)
        ch.isRemote = true
        ch.userName = client.userName
        ch.isActive = agent.status === 'active'
        ch.currentTool = agent.activeTool || null
        ch.matrixEffect = 'spawn'
        ch.matrixEffectTimer = 0
        ch.matrixEffectSeeds = matrixEffectSeeds()

        this.characters.set(charId, ch)
        this.remoteCharacterMap.set(key, charId)
      }
    }
  }
}
```

Also modify `addAgent` to set `userName` on local characters. In the `addAgent` method, after creating the character, add:
```typescript
// Tag local characters with the local username (set via localUserName message)
ch.isRemote = false
```

**Step 5: Verify it compiles**

Run: `cd webview-ui && npx tsc --noEmit`

**Step 6: Commit**

```bash
git add webview-ui/src/hooks/useExtensionMessages.ts webview-ui/src/office/engine/officeState.ts
git commit -m "feat: handle remoteAgents message and manage remote characters"
```

---

### Task 8: Render Nicks Under Characters

**Files:**
- Modify: `webview-ui/src/office/engine/renderer.ts`
- Modify: `webview-ui/src/constants.ts` (webview)

**Step 1: Add constants for nick rendering**

In `webview-ui/src/constants.ts`, add:

```typescript
// ── Nick Labels ─────────────────────────────────────────────
export const NICK_FONT_SIZE_PX = 5
export const NICK_VERTICAL_OFFSET_PX = 2
export const NICK_BG_COLOR = 'rgba(30, 30, 46, 0.7)'
export const NICK_TEXT_COLOR = '#e0e0e0'
export const NICK_PADDING_X_PX = 2
export const NICK_PADDING_Y_PX = 1
export const NICK_REMOTE_TEXT_COLOR = '#90caf9'
```

**Step 2: Add `renderNicks` function to renderer.ts**

Import the new constants and add after `renderBubbles`:

```typescript
import {
  NICK_FONT_SIZE_PX,
  NICK_VERTICAL_OFFSET_PX,
  NICK_BG_COLOR,
  NICK_TEXT_COLOR,
  NICK_PADDING_X_PX,
  NICK_PADDING_Y_PX,
  NICK_REMOTE_TEXT_COLOR,
} from '../../constants.js'

export function renderNicks(
  ctx: CanvasRenderingContext2D,
  characters: Character[],
  offsetX: number,
  offsetY: number,
  zoom: number,
): void {
  const fontSize = Math.max(NICK_FONT_SIZE_PX * zoom, 8)
  ctx.font = `${fontSize}px "FS Pixel Sans", monospace`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'

  for (const ch of characters) {
    if (!ch.userName) continue
    if (ch.matrixEffect === 'despawn') continue
    if (ch.isSubagent) continue
    if (ch.state === CharacterState.BATHROOM) continue

    const sittingOff = ch.state === CharacterState.TYPE ? CHARACTER_SITTING_OFFSET_PX : 0
    const nickX = Math.round(offsetX + ch.x * zoom)
    const nickY = Math.round(offsetY + (ch.y + sittingOff) * zoom + NICK_VERTICAL_OFFSET_PX * zoom)

    const text = ch.userName
    const metrics = ctx.measureText(text)
    const padX = NICK_PADDING_X_PX * zoom
    const padY = NICK_PADDING_Y_PX * zoom
    const bgW = metrics.width + padX * 2
    const bgH = fontSize + padY * 2

    ctx.fillStyle = NICK_BG_COLOR
    ctx.fillRect(nickX - bgW / 2, nickY, bgW, bgH)

    ctx.fillStyle = ch.isRemote ? NICK_REMOTE_TEXT_COLOR : NICK_TEXT_COLOR
    ctx.fillText(text, nickX, nickY + padY)
  }
}
```

**Step 3: Call renderNicks in the main render function**

In the `renderOffice` function (around line 1045), after `renderTaskBadges`, add:

```typescript
// Nick labels under characters
renderNicks(ctx, characters, offsetX, offsetY, zoom)
```

**Step 4: Verify it compiles**

Run: `cd webview-ui && npx tsc --noEmit`

**Step 5: Commit**

```bash
git add webview-ui/src/office/engine/renderer.ts webview-ui/src/constants.ts
git commit -m "feat: render user nicks under characters"
```

---

### Task 9: Remote Agent Click Behavior

**Files:**
- Modify: `webview-ui/src/office/components/OfficeCanvas.tsx`

**Step 1: Skip terminal focus for remote characters**

In `OfficeCanvas.tsx`, find the click handler where `focusAgent` is called. Add a guard:

```typescript
// When clicking a remote character, don't focus terminal — just select for camera follow
if (ch.isRemote) {
  // Still select for camera follow / visual feedback, but don't send focusAgent
  return
}
```

**Step 2: Commit**

```bash
git add webview-ui/src/office/components/OfficeCanvas.tsx
git commit -m "feat: skip terminal focus when clicking remote agents"
```

---

### Task 10: Add `ws` Dependency to Extension

**Files:**
- Modify: `package.json` (root)

**Step 1: Add ws dependency**

Run: `npm install ws && npm install -D @types/ws`

The `ws` library is needed by `syncClient.ts` in the extension host (Node.js).

**Step 2: Update esbuild config to bundle ws**

Check `esbuild.js` — `ws` should be bundled or marked as external. Since `ws` is a native module, it should typically be external:

In `esbuild.js`, ensure `ws` is in the externals list alongside `vscode`.

**Step 3: Commit**

```bash
git add package.json package-lock.json esbuild.js
git commit -m "feat: add ws dependency for multiuser WebSocket client"
```

---

### Task 11: End-to-End Test

**Step 1: Build everything**

Run: `npm run build && cd server && npm run build`

**Step 2: Start the server**

Run: `cd server && node dist/index.js --port 4200`

**Step 3: Configure extension**

In VS Code settings:
```json
{
  "pixel-agents.serverUrl": "ws://localhost:4200",
  "pixel-agents.userName": "TestUser"
}
```

**Step 4: Test with F5 (Extension Dev Host)**

1. Open two Extension Dev Host windows (two VS Code instances)
2. Both should connect to the same server
3. Create agents in both — verify you see remote agents appear in each window
4. Edit layout in one — verify it syncs to the other within 3s
5. Verify nicks appear under characters
6. Verify clicking a remote agent doesn't open a terminal

**Step 5: Commit any fixes**

```bash
git add -A
git commit -m "feat: multiuser support complete — server + sync client + remote agents"
```

---

### Task 12: Dockerfile for Server

**Files:**
- Create: `server/Dockerfile`

**Step 1: Create Dockerfile**

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --production
COPY dist/ dist/
EXPOSE 4200
VOLUME /app/server-data
CMD ["node", "dist/index.js", "--port", "4200"]
```

**Step 2: Add .dockerignore**

Create `server/.dockerignore`:
```
node_modules
src
tsconfig.json
```

**Step 3: Commit**

```bash
git add server/Dockerfile server/.dockerignore
git commit -m "feat(server): add Dockerfile for self-hosted deployment"
```

---

Plan complete and saved to `docs/plans/2026-03-05-multiuser-plan.md`. Two execution options:

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

Which approach?