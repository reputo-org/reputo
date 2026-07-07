export { HttpError } from './errors/index.js';
export { createLogger } from './logging/index.js';
export {
  DEFAULT_CONFIG,
  type DeepIdApiConfig,
  type DeepIdApiConfigInput,
  type RetryConfig,
} from './types/api-config.js';
export { chunk, isValidDid, sleep, trimTrailingSlash } from './utils/index.js';
