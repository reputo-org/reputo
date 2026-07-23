/**
 * Target range every normalized child score of a combined `custom_score`
 * snapshot maps onto: the observed cohort minimum maps to `min`, the maximum
 * to `max`. Fixed by the parent design; `min` must stay `0` — the encrypted
 * evaluator relies on it to keep the normalization affine map two-term.
 */
export const CUSTOM_SCORE_TARGET_RANGE = Object.freeze({ min: 0, max: 100 });

/**
 * Upper bound on users accepted by one encrypted-evaluation batch. Callers
 * page DeepID reads at up to 1000 users, so one batch never exceeds one page
 * and per-batch WASM memory stays bounded.
 */
export const CUSTOM_SCORE_EVALUATION_BATCH_LIMIT = 1000;
