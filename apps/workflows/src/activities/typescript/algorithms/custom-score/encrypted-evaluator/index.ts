export { createEncryptedCustomScoreEvaluator } from './evaluator.js';
export {
  applyChildWeights,
  buildAggregationPlan,
  buildEncryptedEvaluationPlan,
  buildNormalizationPlan,
} from './plan.js';
export { type EncryptedNormalizationStrategy, resolveNormalizationStrategy } from './strategies.js';
export type {
  ChildContribution,
  ChildNormalization,
  ChildWeighting,
  CreateEncryptedCustomScoreEvaluatorInput,
  EncryptedCustomScoreChild,
  EncryptedCustomScoreEvaluator,
  EncryptedCustomScoreEvaluatorStats,
  EncryptedCustomScoreResult,
  EncryptedCustomScoreUser,
  EncryptedEvaluationPlan,
  PlannedChild,
  ZeroFallback,
} from './types.js';
