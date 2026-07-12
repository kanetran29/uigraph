// Shared data types for the react extraction pipeline: navigation-target
// classifications, pre-discovered route seeds, raw nav targets, control metadata,
// success/error branch context, and interprocedural nav calls — imported across
// the sibling extractor modules so they stay decoupled.

import type { Node, SourceFile } from 'ts-morph'
import type { ControlInput, ControlSelector } from '@uigraph/core'

/** A literal/template/enum/dynamic classification of a navigation target expression. */
export type TargetInfo =
  | { kind: 'literal'; value: string }
  | { kind: 'template'; staticPrefix: string }
  | { kind: 'enum'; values: string[] }
  | { kind: 'dynamic'; expr?: string }

/** A discovered route: its IR path, node id, backing component, and (for inline-JSX routes) the element subtree to scan. */
export interface RouteInfo {
  fullPath: string
  nodeId: string
  componentName: string | null
  componentFile: SourceFile | undefined
  /** The route was declared with an inline JSX element (e.g. element={<div>…}) rather
   *  than a component reference, so there is no component file to scan for navigation.
   *  `file` is the absolute declaration path (relativized when the note is emitted);
   *  `exprNode` is the whole `element={…}` expression (the ternary/&& container, used to
   *  read guards) and `roots` are the lowercase JSX element subtree(s) to walk for
   *  inline Link/Navigate/useNavigate targets. */
  inlineElement?: { file: string; loc: { line: number; col: number }; tag: string; exprNode: Node; roots: Node[] }
}

/** A raw navigation target collected from a JSX element or programmatic call, before route resolution. */
export interface RawTarget {
  ti: TargetInfo
  event: string
  effect: string
  node: Node
  guard: string | null
  ruleId?: string
}

/** Extracted metadata for a single interactive control (element, type, name, selector, input constraints). */
export interface ControlInfo {
  element: string
  controlType: string
  name?: string
  selector: ControlSelector
  input?: ControlInput
}

/** Whether a node sits on the success or error branch of an async flow (or neither). */
export type BranchContext = 'success' | 'error' | null

/** A navigation sink found by the interprocedural handler walk: its target, guard, node, branch context, and whether it was reached below the entry function. */
export interface NavCall {
  ti: TargetInfo
  guard: string | null
  node: Node
  ctx: BranchContext
  interprocedural?: boolean
}
