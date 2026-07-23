// Backstop only: must outlast the workflow's own 24-hour encryption-readiness
// deadline plus pre/post work; the workflow fails the snapshot itself.
export const WORKFLOW_RUN_TIMEOUT = '30 hours';
