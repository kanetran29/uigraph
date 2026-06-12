// Public entry point for @uigraph/core: the framework-agnostic IR, the adapter
// contract, and the pure graph operations. Browser-safe — no node:fs here; the
// node-only IO helpers live in the "./node" subpath export.

export const CORE_VERSION = '0.1.0'

export type {
  Modality,
  Source,
  NodeKind,
  ControlMeta,
  GraphNode,
  Witness,
  GraphEdge,
  UiGraphMeta,
  UiGraph,
  Overlay,
} from './ir'

export type {
  Logger,
  AdapterContext,
  ExtractOptions,
  SoundinessNote,
  ExtractResult,
  Adapter,
} from './adapter'

export { stableStringify, fnv1a, hashValue } from './hash'
export { validateGraphShape, validateOverlayShape, assertGraphShape, assertOverlayShape } from './schema'
export { validateGraph, validateOverlay, type ValidationError } from './validate'
export { mergeOverlay, emptyOverlay } from './overlay'
export {
  validateProposals,
  emptyProposals,
  type Proposal,
  type Proposals,
  type ProposalKind,
  type ProposalStatus,
  type ProposalError,
} from './proposals'
export { diffGraphs, type GraphDiff, type EdgeChange } from './diff'
export {
  buildAdjacency,
  reachableFrom,
  planPath,
  type PlanStep,
  type PlanPathOptions,
} from './algorithms'
