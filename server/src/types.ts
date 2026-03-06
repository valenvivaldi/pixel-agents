import type { WebSocket } from 'ws';

export interface RemoteAgent {
  id: number;
  name: string;
  status: 'active' | 'idle' | 'waiting' | 'permission';
  activeTool?: string;
  seatId?: string;
  palette: number;
  hueShift: number;
  x?: number;
  y?: number;
  dir?: number;
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

export interface JoinMessage {
  type: 'join';
  userName: string;
}

export interface HeartbeatMessage {
  type: 'heartbeat';
  agents: RemoteAgent[];
}

export interface LayoutPutMessage {
  type: 'layoutPut';
  layout: string;
}

export interface ChatMessage {
  type: 'chat';
  agentId: number;
  msg: string;
}

export type ClientMessage = JoinMessage | HeartbeatMessage | LayoutPutMessage | ChatMessage;

export interface PresenceMessage {
  type: 'presence';
  clients: PresenceClient[];
}

export interface LayoutChangedMessage {
  type: 'layoutChanged';
  etag: string;
}

export interface SavedAgentInfo {
  agentId: number;
  seatId?: string;
  palette: number;
  hueShift: number;
}

export interface WelcomeMessage {
  type: 'welcome';
  clientId: string;
  layoutJson: string;
  layoutEtag: string;
  savedAgents?: SavedAgentInfo[];
}

export interface LayoutFullMessage {
  type: 'layoutFull';
  layoutJson: string;
  layoutEtag: string;
}

export interface ChatBroadcast {
  type: 'chat';
  clientId: string;
  agentId: number;
  userName: string;
  msg: string;
}

export interface SavedAgentsMessage {
  type: 'savedAgents';
  agents: SavedAgentInfo[];
}

export type ServerMessage = PresenceMessage | LayoutChangedMessage | WelcomeMessage | LayoutFullMessage | ChatBroadcast | SavedAgentsMessage;
