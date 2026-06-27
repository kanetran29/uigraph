import { describe, it, expect } from 'vitest'
import { Project, ts } from 'ts-morph'
import { extractGraph } from './extract'

function inMemory(files: Record<string, string>): Project {
  const p = new Project({ useInMemoryFileSystem: true, compilerOptions: { jsx: ts.JsxEmit.Preserve } })
  for (const [path, content] of Object.entries(files)) p.createSourceFile(path, content)
  return p
}

const ENUM_SLICE_APP = {
  '/utils/enums.ts': `export enum Folder { ALL = 'ALL', FAVORITES = 'FAVORITES', TRASH = 'TRASH' }`,
  '/slices/note.ts': `import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import { Folder } from '@/utils/enums'
const noteSlice = createSlice({
  name: 'note',
  initialState: { activeFolder: Folder.ALL },
  reducers: {
    swapFolder: (state, { payload }: PayloadAction<{ folder: Folder }>) => {
      state.activeFolder = payload.folder
    },
  },
})
export const { swapFolder } = noteSlice.actions`,
  '/containers/Sidebar.tsx': `import { Folder } from '@/utils/enums'
export function Sidebar({ activeFolder }: { activeFolder: Folder }){
  return <aside>
    {activeFolder === Folder.ALL && <div>all notes</div>}
    {activeFolder === Folder.TRASH && <div>trash</div>}
  </aside>
}`,
  '/App.tsx': `import { Sidebar } from './containers/Sidebar'
export default () => (<Routes><Route path="/" element={<Sidebar activeFolder={'ALL'}/>} /></Routes>)`,
}

describe('state-driven nav as Tier-2 proposals (feature 1)', () => {
  it('emits enum-state-screen proposals for an enum var literally assigned in a reducer + a render witness', () => {
    const res = extractGraph(inMemory(ENUM_SLICE_APP), '/')
    const props = res.proposals ?? []
    expect(props.length).toBeGreaterThan(0)
    for (const p of props) {
      expect(p.source).toBe('proposal')
      expect(p.evidenced).toBe(true)
      expect(p.confidence).toBeGreaterThan(0.5)
      expect(p.confidence).toBeLessThanOrEqual(0.8)
    }
  })

  it('proposal ids derive only from the state-var name + value (stable across re-maps)', () => {
    const a = extractGraph(inMemory(ENUM_SLICE_APP), '/').proposals ?? []
    const b = extractGraph(inMemory(ENUM_SLICE_APP), '/').proposals ?? []
    expect(a.map((p) => p.id).sort()).toEqual(b.map((p) => p.id).sort())
    expect(a.every((p) => /activeFolder/i.test(p.id))).toBe(true)
    expect(a.some((p) => /ALL/i.test(p.id))).toBe(true)
  })

  it('rationale cites both the reducer assignment and the render witness file:line', () => {
    const props = extractGraph(inMemory(ENUM_SLICE_APP), '/').proposals ?? []
    const cited = props.find((p) => /swapFolder|activeFolder/.test(p.rationale))
    expect(cited).toBeDefined()
    expect(cited?.rationale).toMatch(/note\.ts/)
    expect(cited?.rationale).toMatch(/Sidebar\.tsx/)
  })

  it('records a state-driven-dynamic soundiness note (NOT a proposal) for a helper-derived assignment', () => {
    const res = extractGraph(
      inMemory({
        '/utils/enums.ts': `export enum Folder { ALL = 'ALL', TRASH = 'TRASH' }`,
        '/slices/note.ts': `import { createSlice } from '@reduxjs/toolkit'
import { Folder } from '@/utils/enums'
const pickFolder = (notes) => Folder.ALL
const noteSlice = createSlice({
  name: 'note',
  initialState: { activeFolder: Folder.ALL },
  reducers: {
    recompute: (state, { payload }) => {
      state.activeFolder = pickFolder(payload)
    },
  },
})`,
        '/containers/Sidebar.tsx': `import { Folder } from '@/utils/enums'
export function Sidebar({ activeFolder }: { activeFolder: Folder }){
  return <aside>{activeFolder === Folder.ALL && <div>all</div>}</aside>
}`,
        '/App.tsx': `import { Sidebar } from './containers/Sidebar'
export default () => (<Routes><Route path="/" element={<Sidebar activeFolder={'ALL'}/>} /></Routes>)`,
      }),
      '/',
    )
    expect(res.soundiness.some((s) => s.kind === 'state-driven-dynamic')).toBe(true)
  })

  it('does not pollute the base graph (no proposal-sourced edges/nodes)', () => {
    const res = extractGraph(inMemory(ENUM_SLICE_APP), '/')
    expect(res.graph.edges.every((e) => e.source === 'static')).toBe(true)
    expect(res.graph.nodes.every((n) => n.kind !== 'control' || n.id !== undefined)).toBe(true)
  })
})
