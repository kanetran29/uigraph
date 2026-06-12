import { describe, it, expect } from 'vitest'
import { parseApiEffect, summarizeApiEffect, buildApiBindings } from './openapi'
import { edge, graph, node } from './fixtures'

const spec = {
  info: { title: 'Shop API', version: '1.2.0' },
  paths: {
    '/api/orders': {
      post: {
        operationId: 'createOrder',
        summary: 'Place an order',
        requestBody: {
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Order' } } },
        },
        responses: {
          '201': { description: 'created', content: { 'application/json': { schema: { $ref: '#/components/schemas/Order' } } } },
          '400': { description: 'invalid order' },
        },
      },
    },
    '/api/products/{id}': {
      get: { operationId: 'getProduct', responses: { '200': { description: 'ok' } } },
    },
  },
  components: {
    schemas: {
      Order: {
        type: 'object',
        required: ['email'],
        properties: { email: { type: 'string' }, notes: { type: 'string' }, items: { type: 'array', items: { type: 'number' } } },
      },
    },
  },
}

describe('parseApiEffect', () => {
  it('splits method and path', () => {
    expect(parseApiEffect('api:POST /api/orders')).toEqual({ method: 'POST', path: '/api/orders' })
  })
  it('returns null for non-api effects', () => {
    expect(parseApiEffect('state:setX')).toBeNull()
  })
})

describe('summarizeApiEffect', () => {
  it('resolves request fields ($ref) and responses', () => {
    const s = summarizeApiEffect(spec, 'api:POST /api/orders')
    expect(s?.operationId).toBe('createOrder')
    expect(s?.request.map((f) => f.name).sort()).toEqual(['email', 'items', 'notes'])
    expect(s?.request.find((f) => f.name === 'email')?.required).toBe(true)
    expect(s?.request.find((f) => f.name === 'items')?.type).toBe('array<number>')
    expect(s?.responses.map((r) => r.status).sort()).toEqual(['201', '400'])
  })

  it('matches templated paths', () => {
    expect(summarizeApiEffect(spec, 'api:GET /api/products/42')?.operationId).toBe('getProduct')
  })

  it('returns null for an endpoint not in the spec', () => {
    expect(summarizeApiEffect(spec, 'api:POST /api/unknown')).toBeNull()
  })
})

describe('buildApiBindings', () => {
  it('binds matched effects and reports drift for unmatched', () => {
    const g = graph(
      [node('a'), node('b', { kind: 'control', parent: 'a', control: { element: 'form', controlType: 'form', effects: ['api:POST /api/orders', 'api:POST /api/ghost'] } })],
      [edge('e1', 'a', 'a', { effect: 'api:POST /api/orders' })],
    )
    const b = buildApiBindings(g, spec, 'h')
    expect(b.spec).toBe('Shop API 1.2.0')
    expect(b.bindings.map((x) => x.effect)).toEqual(['api:POST /api/orders'])
    expect(b.unmatched).toEqual(['api:POST /api/ghost'])
  })
})
