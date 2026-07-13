// State-driven navigation as Tier-2 PROPOSALS (NOT base edges — the golden
// invariant forbids minting a `must` transition for a state change that has no
// deterministic static witness of where the app "goes"). This module analyzes
// Redux Toolkit slices and conditional-render witnesses, and emits QUARANTINED
// proposals (source:'proposal') describing the "screens" an enum-like state var
// selects and the dispatch that selects them.
//
// SOUND scope (proposal-eligible): an ENUM-LIKE state var with a FINITE declared
// value set, mutated by a LITERAL assignment in a reducer (state.x = Enum.MEMBER
// or state.x = payload.<field> where the payload is the known enum), AND keyed on
// by a conditional render (x === Enum.MEMBER). Anything assigned from a function
// call (thunk/saga/selector/memoized/helper like getFirstNoteId) is NOT statically
// decidable and becomes a `state-driven-dynamic` SOUNDINESS NOTE instead.
//
// Proposal ids derive ONLY from the stable (state-var name, value) pair — never a
// runtime value or a node id — so re-maps are stable.

import { Node, SyntaxKind } from 'ts-morph'
import type { Project, SourceFile } from 'ts-morph'
import { relative } from 'node:path'
import type { Proposal, SoundinessNote } from '@ui-graph/core'

/** A reducer assignment to an enum-state var, classified as a literal member or a payload field. */
interface EnumAssignment {
  /** The enum member literally assigned (e.g. 'CATEGORY'), or null for a payload-field assignment. */
  member: string | null
  reducerName: string
  file: string
  loc: { line: number; col: number }
}

/** A conditional-render witness: a `<stateVar> === Enum.<member>` comparison gating JSX. */
interface RenderWitness {
  member: string
  file: string
  loc: { line: number; col: number }
}

/** The result of scanning one app for state-driven navigation. */
export interface StateNavResult {
  proposals: Proposal[]
  soundiness: SoundinessNote[]
}

/** Is this a TS `enum` declaration with string/finite members? Returns its member-name set. */
function enumMembers(decl: Node): Set<string> | null {
  if (!Node.isEnumDeclaration(decl)) return null
  const out = new Set<string>()
  for (const m of decl.getMembers()) out.add(m.getName())
  return out.size > 0 ? out : null
}

/**
 * Map every imported/locally-declared enum name to its member-name set, across the
 * whole project. Used to recognize an enum-typed state var and enumerate its finite
 * value space (the candidate "screens").
 */
function collectEnums(project: Project): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  for (const sf of project.getSourceFiles()) {
    for (const decl of sf.getDescendantsOfKind(SyntaxKind.EnumDeclaration)) {
      const members = enumMembers(decl)
      if (members) out.set(decl.getName(), members)
    }
  }
  return out
}

/** The `Enum.MEMBER` parts of a property-access expression, or null when not that shape. */
function enumAccessParts(node: Node | undefined): { enumName: string; member: string } | null {
  if (!node || !Node.isPropertyAccessExpression(node)) return null
  const obj = node.getExpression()
  if (!Node.isIdentifier(obj)) return null
  return { enumName: obj.getText(), member: node.getName() }
}

/**
 * Find the reducers object of a `createSlice({...})` call and return each reducer's
 * name + body function. Returns an empty list when the file declares no slice.
 */
function sliceReducers(sf: SourceFile): { name: string; body: Node }[] {
  const out: { name: string; body: Node }[] = []
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (call.getExpression().getText() !== 'createSlice') continue
    const arg = call.getArguments()[0]
    if (!arg || !Node.isObjectLiteralExpression(arg)) continue
    const reducersProp = arg.getProperty('reducers')
    if (!reducersProp || !Node.isPropertyAssignment(reducersProp)) continue
    const reducersObj = reducersProp.getInitializer()
    if (!reducersObj || !Node.isObjectLiteralExpression(reducersObj)) continue
    for (const p of reducersObj.getProperties()) {
      if (Node.isPropertyAssignment(p)) {
        const init = p.getInitializer()
        if (init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init))) out.push({ name: p.getName(), body: init })
      } else if (Node.isMethodDeclaration(p)) {
        out.push({ name: p.getName(), body: p })
      }
    }
  }
  return out
}

/** Whether an assignment target is `state.<var>` (the reducer's draft state field). */
function stateFieldName(target: Node): string | null {
  if (!Node.isPropertyAccessExpression(target)) return null
  const obj = target.getExpression()
  if (Node.isIdentifier(obj) && obj.getText() === 'state') return target.getName()
  return null
}

/**
 * Scan a slice's reducers for assignments to enum-state vars. Each assignment is
 * either: a LITERAL enum member (`state.x = Enum.MEMBER`) → proposal-eligible; a
 * payload-field passthrough (`state.x = payload.f`) → eligible (member unknown,
 * fans out over the enum's value set); or a CALL/derived rhs (`state.x = helper()`)
 * → recorded as a dynamic note. Returns the eligible assignments per var name, and
 * the set of (var,reducer,file,loc) that were dynamic.
 */
function scanReducers(
  sf: SourceFile,
  projectDir: string,
  enumOf: (varName: string) => string | null,
): { byVar: Map<string, EnumAssignment[]>; dynamic: SoundinessNote[] } {
  const byVar = new Map<string, EnumAssignment[]>()
  const dynamic: SoundinessNote[] = []
  const file = relative(projectDir, sf.getFilePath())
  for (const { name: reducerName, body } of sliceReducers(sf)) {
    for (const assign of body.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
      if (assign.getOperatorToken().getText() !== '=') continue
      const varName = stateFieldName(assign.getLeft())
      const enumName = varName === null ? null : enumOf(varName)
      if (varName === null || enumName === null) continue
      const lc = sf.getLineAndColumnAtPos(assign.getStart())
      const loc = { line: lc.line, col: lc.column }
      const rhs = assign.getRight()
      // A payload-field passthrough (state.x = payload.folder / action.payload.folder)
      // is a literal-typed enum write — eligible, fanning out over the enum's values.
      // Checked BEFORE enum-access so `payload.folder` is not mis-read as an Enum.MEMBER.
      if (isPayloadAccess(rhs)) {
        push(byVar, varName, { member: null, reducerName, file, loc })
        continue
      }
      // A literal `state.x = Enum.MEMBER` is eligible only when the accessed object is
      // the SAME enum the var is bound to (a different enum/object is not a state value).
      const access = enumAccessParts(rhs)
      if (access && access.enumName === enumName) {
        push(byVar, varName, { member: access.member, reducerName, file, loc })
        continue
      }
      // Anything else writing the enum var (a call, a ternary, a non-literal helper) is
      // not statically decidable to a single state — a soundiness note, never a proposal.
      dynamic.push({ kind: 'state-driven-dynamic', file, loc, detail: `reducer ${reducerName} assigns enum-state '${varName}' from a non-literal expression; the resulting "screen" is not statically extractable` })
    }
  }
  return { byVar, dynamic }
}

/** Whether an expression reads a field of the reducer's `payload`/`action.payload`. */
function isPayloadAccess(node: Node): boolean {
  if (!Node.isPropertyAccessExpression(node)) return false
  const head = node.getExpression().getText()
  return head === 'payload' || head.endsWith('.payload') || head === 'action'
}

function push<T>(map: Map<string, T[]>, key: string, value: T): void {
  const arr = map.get(key)
  if (arr) arr.push(value)
  else map.set(key, [value])
}

/**
 * Find conditional-render witnesses keying on a state var: `<varName> === Enum.MEMBER`
 * (either operand order). Restricted to `.tsx`/`.jsx` source so a comparison in plain
 * logic doesn't count as a render witness. Returns witnesses grouped by var name.
 */
function collectRenderWitnesses(project: Project, projectDir: string, varNames: Set<string>): Map<string, RenderWitness[]> {
  const out = new Map<string, RenderWitness[]>()
  for (const sf of project.getSourceFiles()) {
    const fp = sf.getFilePath()
    if (!/\.[jt]sx$/.test(fp)) continue
    const file = relative(projectDir, fp)
    for (const cmp of sf.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
      const op = cmp.getOperatorToken().getText()
      if (op !== '===' && op !== '==') continue
      const left = cmp.getLeft()
      const right = cmp.getRight()
      const varSide = identifierTail(left) ?? identifierTail(right)
      if (varSide === null || !varNames.has(varSide)) continue
      const access = enumAccessParts(left) ?? enumAccessParts(right)
      if (!access) continue
      const lc = sf.getLineAndColumnAtPos(cmp.getStart())
      push(out, varSide, { member: access.member, file, loc: { line: lc.line, col: lc.column } })
    }
  }
  return out
}

/** The trailing identifier name of an expression (`x` or `obj.x`), or null. */
function identifierTail(node: Node): string | null {
  if (Node.isIdentifier(node)) return node.getText()
  if (Node.isPropertyAccessExpression(node)) return node.getName()
  return null
}

/**
 * Resolve which enum each state var holds, by reading the slice's `initialState`
 * object: a field initialized to `Enum.MEMBER` binds that var to that enum. Returns
 * a var→enumName map (only vars whose enum is known project-wide).
 */
function enumStateVars(sf: SourceFile, enums: Map<string, Set<string>>): Map<string, string> {
  const out = new Map<string, string>()
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (call.getExpression().getText() !== 'createSlice') continue
    const arg = call.getArguments()[0]
    if (!arg || !Node.isObjectLiteralExpression(arg)) continue
    const initProp = arg.getProperty('initialState')
    let initObj: Node | undefined
    if (initProp && Node.isPropertyAssignment(initProp)) initObj = initProp.getInitializer()
    else if (initProp && Node.isShorthandPropertyAssignment(initProp)) initObj = resolveInitialStateRef(sf, initProp.getName())
    if (!initObj || !Node.isObjectLiteralExpression(initObj)) continue
    for (const p of initObj.getProperties()) {
      if (!Node.isPropertyAssignment(p)) continue
      const access = enumAccessParts(p.getInitializer())
      if (access && enums.has(access.enumName)) out.set(p.getName(), access.enumName)
    }
  }
  return out
}

/** Resolve a `initialState: foo` shorthand reference to its declared object literal. */
function resolveInitialStateRef(sf: SourceFile, name: string): Node | undefined {
  for (const v of sf.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    if (v.getName() !== name) continue
    const init = v.getInitializer()
    if (init && Node.isObjectLiteralExpression(init)) return init
  }
  return undefined
}

/**
 * Analyze a project for state-driven navigation. Emits Tier-2 proposals for
 * enum-state "screens" that have BOTH a literal reducer assignment AND a
 * conditional-render witness, and soundiness notes for dynamic (helper/call-derived)
 * assignments. Pure-static + deterministic: same input → same proposal ids.
 */
export function analyzeStateNav(project: Project, projectDir: string): StateNavResult {
  const enums = collectEnums(project)
  if (enums.size === 0) return { proposals: [], soundiness: [] }

  const proposals: Proposal[] = []
  const soundiness: SoundinessNote[] = []
  const seenIds = new Set<string>()

  for (const sf of project.getSourceFiles()) {
    const stateVars = enumStateVars(sf, enums)
    if (stateVars.size === 0) continue
    const enumOf = (v: string): string | null => stateVars.get(v) ?? null
    const { byVar, dynamic } = scanReducers(sf, projectDir, enumOf)
    soundiness.push(...dynamic)
    if (byVar.size === 0) continue

    const witnesses = collectRenderWitnesses(project, projectDir, new Set(byVar.keys()))

    for (const [varName, assigns] of byVar) {
      const enumName = stateVars.get(varName)
      if (!enumName) continue
      const allMembers = enums.get(enumName)
      if (!allMembers) continue
      const wits = witnesses.get(varName) ?? []
      if (wits.length === 0) continue
      // The members this var is actually assigned: explicit members, plus the whole
      // enum when a payload-passthrough means any member is reachable.
      const passthrough = assigns.some((a) => a.member === null)
      const assignedMembers = new Set(assigns.map((a) => a.member).filter((m): m is string => m !== null))
      const targetMembers = passthrough ? new Set(allMembers) : assignedMembers
      const witByMember = new Map(wits.map((w) => [w.member, w]))
      for (const member of targetMembers) {
        const wit = witByMember.get(member)
        if (!wit) continue
        // Cite the reducer that drives THIS member: the one literally assigning it if
        // present, else the first payload-passthrough reducer (which can set any value).
        const reducer = assigns.find((a) => a.member === member) ?? assigns.find((a) => a.member === null)
        if (reducer === undefined) continue
        const id = `pstate_${varName}__${member}`
        if (seenIds.has(id)) continue
        seenIds.add(id)
        proposals.push({
          id,
          kind: 'interaction',
          category: 'state-driven-nav',
          screen: '',
          title: `${varName} = ${enumName}.${member}`,
          event: `dispatch:${reducer.reducerName}`,
          effect: `state:${varName}=${member}`,
          rationale: `enum-state '${varName}' (${enumName}) set to ${member} in reducer ${reducer.reducerName} (${reducer.file}:${reducer.loc.line}); a conditional render keys on ${varName} === ${enumName}.${member} (${wit.file}:${wit.loc.line})`,
          evidenced: true,
          confidence: 0.7,
          source: 'proposal',
          status: 'proposed',
        })
      }
    }
  }

  return { proposals, soundiness }
}
