import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest'
import * as http from 'http'
import { WebSocket } from 'ws'
import { ClientStore } from '../ClientStore.js'

function mockWs(readyState = 1): any {
  return { readyState, send: vi.fn(), close: vi.fn() }
}

describe('Chat - Unit', () => {
  let store: ClientStore

  beforeEach(() => {
    store = new ClientStore()
  })

  it('broadcastToAll sends chat to all open clients', () => {
    const ws1 = mockWs()
    const ws2 = mockWs()
    const ws3 = mockWs(3) // CLOSED
    store.add(ws1)
    store.add(ws2)
    store.add(ws3)

    const chatMsg = JSON.stringify({
      type: 'chat',
      clientId: 'test-id',
      agentId: 1,
      userName: 'Alice',
      msg: 'Hello!',
    })
    store.broadcastToAll(chatMsg)

    expect(ws1.send).toHaveBeenCalledTimes(1)
    expect(ws1.send).toHaveBeenCalledWith(chatMsg)
    expect(ws2.send).toHaveBeenCalledTimes(1)
    expect(ws2.send).toHaveBeenCalledWith(chatMsg)
    expect(ws3.send).not.toHaveBeenCalled()
  })
})

const PORT = 14201
const URL = `ws://localhost:${PORT}`

function connectClient(): Promise<{ ws: WebSocket; messages: any[] }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL)
    const messages: any[] = []
    ws.on('message', (data) => {
      messages.push(JSON.parse(data.toString()))
    })
    ws.on('open', () => resolve({ ws, messages }))
    ws.on('error', reject)
  })
}

function waitForMessage(messages: any[], type: string, count = 1, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs
    const check = () => {
      if (messages.filter(m => m.type === type).length >= count) {
        resolve()
      } else if (Date.now() > deadline) {
        reject(new Error(`Timeout waiting for ${count} "${type}" messages, got ${messages.filter(m => m.type === type).length}`))
      } else {
        setTimeout(check, 50)
      }
    }
    check()
  })
}

describe('Chat - Integration', () => {
  let server: http.Server

  beforeAll(async () => {
    const { createServer } = await import('../index.js')
    server = createServer(PORT, '/tmp/pixel-agents-test-chat-' + Date.now())
    await new Promise<void>((resolve) => server.listen(PORT, resolve))
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  it('client A sends chat, client B receives it with correct fields', async () => {
    const a = await connectClient()
    const b = await connectClient()

    a.ws.send(JSON.stringify({ type: 'join', userName: 'Alice' }))
    // Wait for join to be processed
    await waitForMessage(a.messages, 'presence')

    a.ws.send(JSON.stringify({ type: 'chat', agentId: 42, msg: 'Hello world!' }))

    await waitForMessage(b.messages, 'chat')
    const chatMsg = b.messages.find(m => m.type === 'chat')
    expect(chatMsg).toBeDefined()
    expect(chatMsg.clientId).toBeDefined()
    expect(chatMsg.agentId).toBe(42)
    expect(chatMsg.userName).toBe('Alice')
    expect(chatMsg.msg).toBe('Hello world!')

    a.ws.close()
    b.ws.close()
  })

  it('sender also receives their own chat echo', async () => {
    const a = await connectClient()

    a.ws.send(JSON.stringify({ type: 'join', userName: 'Bob' }))
    await waitForMessage(a.messages, 'presence')

    a.ws.send(JSON.stringify({ type: 'chat', agentId: 7, msg: 'Echo test' }))

    await waitForMessage(a.messages, 'chat')
    const chatMsg = a.messages.find(m => m.type === 'chat')
    expect(chatMsg).toBeDefined()
    expect(chatMsg.userName).toBe('Bob')
    expect(chatMsg.agentId).toBe(7)
    expect(chatMsg.msg).toBe('Echo test')

    a.ws.close()
  })

  it('truncates messages longer than 500 characters', async () => {
    const a = await connectClient()
    const b = await connectClient()

    a.ws.send(JSON.stringify({ type: 'join', userName: 'Charlie' }))
    await waitForMessage(a.messages, 'presence')

    const longMsg = 'x'.repeat(1000)
    a.ws.send(JSON.stringify({ type: 'chat', agentId: 1, msg: longMsg }))

    await waitForMessage(b.messages, 'chat')
    const chatMsg = b.messages.find(m => m.type === 'chat')
    expect(chatMsg.msg).toHaveLength(500)

    a.ws.close()
    b.ws.close()
  })
})
