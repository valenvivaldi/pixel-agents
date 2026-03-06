import { describe, it, expect } from 'vitest'
import { CharacterKind, CHARACTER_BEHAVIORS } from '../types.js'
import type { CharacterBehavior } from '../types.js'

describe('CHARACTER_BEHAVIORS', () => {
  it('has a behavior entry for every CharacterKind', () => {
    for (const kind of Object.values(CharacterKind)) {
      expect(CHARACTER_BEHAVIORS[kind]).toBeDefined()
    }
  })

  it('all behaviors have positive scale', () => {
    for (const [kind, b] of Object.entries(CHARACTER_BEHAVIORS)) {
      expect(b.scale, `${kind}.scale`).toBeGreaterThan(0)
    }
  })

  it('all behaviors have positive walk speed', () => {
    for (const [kind, b] of Object.entries(CHARACTER_BEHAVIORS)) {
      expect(b.walkSpeed, `${kind}.walkSpeed`).toBeGreaterThan(0)
    }
  })

  it('all behaviors have positive walk frame duration', () => {
    for (const [kind, b] of Object.entries(CHARACTER_BEHAVIORS)) {
      expect(b.walkFrameDuration, `${kind}.walkFrameDuration`).toBeGreaterThan(0)
    }
  })

  it('all behaviors have pauseMin <= pauseMax', () => {
    for (const [kind, b] of Object.entries(CHARACTER_BEHAVIORS)) {
      expect(b.pauseMin, `${kind}.pauseMin <= pauseMax`).toBeLessThanOrEqual(b.pauseMax)
    }
  })

  // ── Agent-specific ──────────────────────────────────────────

  describe('agent', () => {
    const b = CHARACTER_BEHAVIORS[CharacterKind.AGENT]

    it('has full-size scale', () => {
      expect(b.scale).toBe(1)
    })

    it('can sit, interact, use bathroom, chat, and fight', () => {
      expect(b.canSit).toBe(true)
      expect(b.canInteractFurniture).toBe(true)
      expect(b.canUseBathroom).toBe(true)
      expect(b.canChat).toBe(true)
      expect(b.canFight).toBe(true)
    })
  })

  // ── Subagent-specific ───────────────────────────────────────

  describe('subagent', () => {
    const b = CHARACTER_BEHAVIORS[CharacterKind.SUBAGENT]

    it('is smaller than agent', () => {
      expect(b.scale).toBeLessThan(CHARACTER_BEHAVIORS[CharacterKind.AGENT].scale)
    })

    it('walks faster than agent', () => {
      expect(b.walkSpeed).toBeGreaterThan(CHARACTER_BEHAVIORS[CharacterKind.AGENT].walkSpeed)
    })

    it('has shorter pauses than agent', () => {
      expect(b.pauseMax).toBeLessThan(CHARACTER_BEHAVIORS[CharacterKind.AGENT].pauseMin)
    })

    it('cannot sit, interact, use bathroom, chat, or fight', () => {
      expect(b.canSit).toBe(false)
      expect(b.canInteractFurniture).toBe(false)
      expect(b.canUseBathroom).toBe(false)
      expect(b.canChat).toBe(false)
      expect(b.canFight).toBe(false)
    })
  })

  // ── Pet-specific ────────────────────────────────────────────

  describe('pet', () => {
    const b = CHARACTER_BEHAVIORS[CharacterKind.PET]

    it('is smaller than agent', () => {
      expect(b.scale).toBeLessThan(CHARACTER_BEHAVIORS[CharacterKind.AGENT].scale)
    })

    it('is smaller than subagent', () => {
      expect(b.scale).toBeLessThan(CHARACTER_BEHAVIORS[CharacterKind.SUBAGENT].scale)
    })

    it('cannot sit, interact, use bathroom, chat, or fight', () => {
      expect(b.canSit).toBe(false)
      expect(b.canInteractFurniture).toBe(false)
      expect(b.canUseBathroom).toBe(false)
      expect(b.canChat).toBe(false)
      expect(b.canFight).toBe(false)
    })

    it('has moderate speed between agent and subagent', () => {
      const agent = CHARACTER_BEHAVIORS[CharacterKind.AGENT]
      const sub = CHARACTER_BEHAVIORS[CharacterKind.SUBAGENT]
      expect(b.walkSpeed).toBeGreaterThan(agent.walkSpeed)
      expect(b.walkSpeed).toBeLessThan(sub.walkSpeed)
    })
  })

  // ── Extensibility contract ──────────────────────────────────

  it('adding a new kind requires all behavior fields', () => {
    const requiredKeys: (keyof CharacterBehavior)[] = [
      'scale', 'walkSpeed', 'walkFrameDuration',
      'pauseMin', 'pauseMax',
      'canSit', 'canInteractFurniture', 'canUseBathroom', 'canChat', 'canFight',
    ]
    for (const kind of Object.values(CharacterKind)) {
      for (const key of requiredKeys) {
        expect(CHARACTER_BEHAVIORS[kind], `${kind} missing ${key}`).toHaveProperty(key)
      }
    }
  })
})
