// Public entry point for @uigraph/core: the framework-agnostic IR, the adapter
// contract, and the pure graph operations. Browser-safe — no node:fs here; the
// node-only IO helpers live in the "./node" subpath export.

export const CORE_VERSION = '0.1.0'

export type {
  Modality,
  Source,
  NodeKind,
  ControlMeta,
  SelectorStrategy,
  ControlSelector,
  ControlInput,
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
export { confirmedEdges, applyObservations, runtimeEdgeId, type Observation } from './runtime'
export { validateGraphShape, validateOverlayShape, assertGraphShape, assertOverlayShape } from './schema'
export { validateGraph, validateMerged, validateOverlay, type ValidationError } from './validate'
export { mergeOverlay, emptyOverlay, exportOverlaySpec } from './overlay'
export {
  validateProposals,
  emptyProposals,
  materializeProposalGraph,
  type Proposal,
  type Proposals,
  type ProposalKind,
  type ProposalStatus,
  type ProposalError,
  type ProposalGraph,
  type ProposalGraphNode,
  type ProposalGraphEdge,
} from './proposals'
export {
  buildGrounding,
  type Grounding,
  type ScreenGrounding,
  type GroundedControl,
  type GroundedEdge,
} from './grounding'
export {
  buildCoverage,
  nextToVerify,
  type CoverageReport,
  type EdgeCoverage,
  type VerifyTarget,
  type ParkedEdge,
} from './coverage'
export { nodeForUrl } from './coverage'
export { reconcileProposals, buildResolution, type ResolutionReport } from './reconcile'
export {
  buildSpecPlan,
  renderPlaywrightSpec,
  locatorFor,
  type SpecPlan,
  type SpecLeg,
  type SpecAction,
  type SpecAssertion,
} from './codegen'
export {
  parseApiEffect,
  summarizeApiEffect,
  collectApiEffects,
  buildApiBindings,
  type ApiField,
  type ApiResponseSummary,
  type ApiOperationSummary,
  type ApiBindings,
} from './openapi'
export { diffGraphs, diffSinceLast, type GraphDiff, type EdgeChange, type NodeChange, type SinceLastDiff } from './diff'
export {
  buildAdjacency,
  reachableFrom,
  planPath,
  type PlanStep,
  type PlanPathOptions,
} from './algorithms'
