import { env } from './env.js';

const config = {
  app: {
    nodeEnv: env.NODE_ENV,
  },
  logger: {
    level: env.LOG_LEVEL,
  },
  temporal: {
    address: env.TEMPORAL_ADDRESS,
    namespace: env.TEMPORAL_NAMESPACE,
    orchestratorTaskQueue: env.TEMPORAL_ORCHESTRATOR_TASK_QUEUE,
    algorithmTypescriptTaskQueue: env.TEMPORAL_ALGORITHM_TYPESCRIPT_TASK_QUEUE,
    algorithmPythonTaskQueue: env.TEMPORAL_ALGORITHM_PYTHON_TASK_QUEUE,
    onchainDataTaskQueue: env.TEMPORAL_ONCHAIN_DATA_TASK_QUEUE,
    communityTaskQueue: env.TEMPORAL_COMMUNITY_TASK_QUEUE,
  },
  aws: {
    region: env.AWS_REGION,
  },
  storage: {
    bucket: env.STORAGE_BUCKET,
    endpoint: env.STORAGE_ENDPOINT,
    forcePathStyle: env.STORAGE_FORCE_PATH_STYLE,
    presignPutTtl: env.STORAGE_PRESIGN_PUT_TTL,
    presignGetTtl: env.STORAGE_PRESIGN_GET_TTL,
    maxSizeBytes: env.STORAGE_MAX_SIZE_BYTES,
  },
  deepfundingPortalApi: {
    apiBaseUrl: env.DEEPFUNDING_API_BASE_URL,
    apiKey: env.DEEPFUNDING_API_KEY,
    requestTimeoutMs: env.DEEPFUNDING_API_REQUEST_TIMEOUT_MS,
    concurrency: env.DEEPFUNDING_API_CONCURRENCY,
    defaultPageLimit: env.DEEPFUNDING_API_DEFAULT_PAGE_LIMIT,
    retryMaxAttempts: env.DEEPFUNDING_API_RETRY_MAX_ATTEMPTS,
    retryBaseDelayMs: env.DEEPFUNDING_API_RETRY_BASE_DELAY_MS,
    retryMaxDelayMs: env.DEEPFUNDING_API_RETRY_MAX_DELAY_MS,
  },
  onchainData: {
    uri: env.ONCHAIN_DATABASE_URL,
    alchemyApiKey: env.ALCHEMY_API_KEY,
    blockfrostAPIKey: env.BLOCKFROST_API_KEY,
  },
  community: {
    discordBotToken: env.DISCORD_BOT_TOKEN,
    githubAppId: env.GITHUB_APP_ID,
    githubAppPrivateKey: env.GITHUB_APP_PRIVATE_KEY,
    requestTimeoutMs: env.COMMUNITY_API_REQUEST_TIMEOUT_MS,
    retryMaxAttempts: env.COMMUNITY_API_RETRY_MAX_ATTEMPTS,
    retryBaseDelayMs: env.COMMUNITY_API_RETRY_BASE_DELAY_MS,
    retryMaxDelayMs: env.COMMUNITY_API_RETRY_MAX_DELAY_MS,
  },
  deepId: {
    identityBaseUrl: env.DEEP_ID_ISSUER_URL,
    appBaseUrl: env.DEEP_ID_APP_BASE_URL,
    clientId: env.DEEP_ID_CLIENT_ID,
    clientSecret: env.DEEP_ID_CLIENT_SECRET,
    scopes: env.DEEP_ID_SCOPES,
    requestTimeoutMs: env.DEEP_ID_REQUEST_TIMEOUT_MS,
    concurrency: env.DEEP_ID_CONCURRENCY,
    usersPageSize: env.DEEP_ID_USERS_PAGE_SIZE,
    retryMaxAttempts: env.DEEP_ID_RETRY_MAX_ATTEMPTS,
    retryBaseDelayMs: env.DEEP_ID_RETRY_BASE_DELAY_MS,
    retryMaxDelayMs: env.DEEP_ID_RETRY_MAX_DELAY_MS,
  },
};

export default config;
