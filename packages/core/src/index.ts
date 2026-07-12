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

export { stableStringify, fnv1a, hashValue, canonicalEdgeTag } from './hash'
export { confirmedEdges, applyObservations, runtimeEdgeId, validateEvidence, type Observation, type Evidence, type ObservationReporter, type ApplyObservationsOptions } from './runtime'
export {
  validateGraphShape,
  validateOverlayShape,
  validateObservationShape,
  assertGraphShape,
  assertOverlayShape,
  assertObservationShape,
} from './schema'
export { classifyEffectRisk } from './risk'
export { validateGraph, validateMerged, validateOverlay, type ValidationError } from './validate'
export {
  validateRefs,
  type StalenessReport,
  type StalenessIssue,
  type ValidateRefsInput,
} from './staleness'
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
export { buildFrontier, type Frontier } from './frontier'
export { reconcileProposals, buildResolution, type ResolutionReport } from './reconcile'
export {
  buildSpecPlan,
  renderPlaywrightSpec,
  locatorFor,
  isInteractionTriggeredEvent,
  isDirectNavEdge,
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
export {
  projectTrustTier,
  enrichEdgesWithTier,
  getTierLabel,
  type TrustTier,
  type EdgeWithTier,
} from './trust-tier'
