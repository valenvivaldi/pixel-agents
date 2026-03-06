#!/usr/bin/env node
import * as http from 'http';
import * as path from 'path';
import { WebSocketServer } from 'ws';
import { ClientStore } from './ClientStore.js';
import { LayoutStore } from './LayoutStore.js';
import { UserStore } from './UserStore.js';
import type { ClientMessage, RemoteAgent } from './types.js';

const HEARTBEAT_TIMEOUT_MS = 10_000;
const CLEANUP_INTERVAL_MS = 5_000;

function log(event: string, details?: Record<string, unknown>): void {
  const ts = new Date().toISOString();
  const extra = details ? ' ' + JSON.stringify(details) : '';
  console.log(`[${ts}] ${event}${extra}`);
}

export function createServer(port: number, dataDir: string): http.Server {
  const clients = new ClientStore();
  const layout = new LayoutStore(dataDir);
  const userStore = new UserStore(dataDir);

  const server = http.createServer((req, res) => {
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
      if (ifNoneMatch && ifNoneMatch === layout.getEtag()) {
        res.writeHead(304);
        res.end();
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'ETag': layout.getEtag(),
      });
      res.end(layout.getJson());
      return;
    }

    if (req.url === '/layout' && req.method === 'PUT') {
      let body = '';
      req.on('data', (chunk: string) => { body += chunk; });
      req.on('end', () => {
        try {
          const etag = layout.update(body);
          log('layout.updated', { etag: etag.slice(0, 8), bytes: body.length });

          res.writeHead(200, {
            'Content-Type': 'application/json',
            'ETag': etag,
          });
          res.end(JSON.stringify({ etag }));

          clients.broadcastToAll(JSON.stringify({ type: 'layoutChanged', etag }));
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

  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws) => {
    const clientId = clients.add(ws);
    log('client.connected', { clientId, total: clients.size });

    ws.send(JSON.stringify({
      type: 'welcome',
      clientId,
      layoutJson: layout.getJson(),
      layoutEtag: layout.getEtag(),
    }));

    ws.send(JSON.stringify({
      type: 'presence',
      clients: clients.buildPresenceList(clientId),
    }));

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString()) as ClientMessage;
        clients.touchHeartbeat(clientId);

        if (msg.type === 'join') {
          const userName = msg.userName || 'Anonymous';
          clients.setUserName(clientId, userName);
          const client = clients.get(clientId);
          log('client.joined', { clientId, userName: client?.userName });
          // Send saved agent data (seat + appearance) for this user
          const savedAgents = userStore.getUserAgents(userName);
          if (savedAgents.length > 0) {
            ws.send(JSON.stringify({
              type: 'savedAgents',
              agents: savedAgents,
            }));
          }
          clients.broadcastPresence();
        } else if (msg.type === 'heartbeat') {
          clients.updateAgents(clientId, msg.agents || []);
          // Persist agent seats + appearance
          const client = clients.get(clientId);
          if (client && client.userName !== 'Anonymous') {
            const agentsToSave = (msg.agents || []).map((a: RemoteAgent) => ({
              agentId: a.id,
              seatId: a.seatId,
              palette: a.palette,
              hueShift: a.hueShift,
            }));
            userStore.saveUserAgents(client.userName, agentsToSave);
          }
          clients.broadcastPresence();
        } else if (msg.type === 'layoutPut') {
          try {
            const etag = layout.update(msg.layout);
            log('layout.updated_ws', { clientId, etag: etag.slice(0, 8), bytes: msg.layout.length });

            clients.broadcastToAll(JSON.stringify({
              type: 'layoutFull',
              layoutJson: layout.getJson(),
              layoutEtag: layout.getEtag(),
            }));
          } catch {
            log('layout.invalid_json', { clientId });
          }
        } else if (msg.type === 'chat') {
          const client = clients.get(clientId);
          if (client && msg.msg && typeof msg.msg === 'string') {
            const chatBroadcast = JSON.stringify({
              type: 'chat',
              clientId,
              agentId: msg.agentId,
              userName: client.userName,
              msg: msg.msg.slice(0, 500),
            });
            clients.broadcastToAll(chatBroadcast);
            log('chat', { clientId, agentId: msg.agentId, msgLength: msg.msg.length });
          }
        }
      } catch (err) {
        log('ws.message_error', { clientId, error: String(err) });
      }
    });

    ws.on('close', () => {
      const client = clients.get(clientId);
      log('client.disconnected', { clientId, userName: client?.userName, remaining: clients.size - 1 });
      clients.remove(clientId);
      clients.broadcastPresence();
    });

    ws.on('error', (err) => {
      log('ws.error', { clientId, error: String(err) });
    });
  });

  layout.load();
  userStore.load();

  const cleanupInterval = setInterval(() => {
    if (clients.cleanupStale(HEARTBEAT_TIMEOUT_MS)) {
      clients.broadcastPresence();
    }
  }, CLEANUP_INTERVAL_MS);

  server.on('close', () => {
    clearInterval(cleanupInterval);
    wss.close();
  });

  return server;
}

const isMain = process.argv[1]?.endsWith('index.js');
if (isMain) {
  const PORT = parseInt(process.argv.find((_, i, a) => a[i - 1] === '--port') || '4200', 10);
  const DATA_DIR = process.argv.find((_, i, a) => a[i - 1] === '--data') || 'server-data';

  const server = createServer(PORT, DATA_DIR);
  server.listen(PORT, () => {
    log('server.started', { port: PORT, layoutFile: path.resolve(path.join(DATA_DIR, 'layout.json')) });
  });
}
