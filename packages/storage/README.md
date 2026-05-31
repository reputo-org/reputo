# @reputo/storage

S3 storage abstraction used by the API and the workflow workers. Wraps the AWS SDK with presigned upload, presigned download, upload verification, and direct object access.

## What it exports

- `Storage` — class with presigned upload, presigned download, upload verification, and direct object read/write methods.
- `createS3Client(options)` — consistent AWS SDK client setup. Honours custom `endpoint` + `forcePathStyle` for MinIO and other S3-compatible servers.
- `generateKey(prefix, ...parts)` — key utility for predictable object paths.
- Shared error types and S3 types re-exported from the package root.

## Usage

```ts
import { Storage, createS3Client, generateKey } from '@reputo/storage';

const s3 = createS3Client({ region: 'eu-north-1' });
const storage = new Storage(s3);

const key = generateKey('snapshot', snapshotId, 'input.csv');
const { url } = await storage.createPresignedPutUrl({ bucket: 'reputo', key });
```

## Setup

Pass an `S3Client` to the `Storage` constructor. The SDK reads AWS credentials from the standard credential chain (environment, shared config files, IAM role).

For local MinIO or LocalStack, pass `endpoint` and `forcePathStyle: true` to `createS3Client`. In the Reputo Docker stack, this is wired through `STORAGE_ENDPOINT` and `STORAGE_FORCE_PATH_STYLE`. See [Docker stack — local development](../../docs/docker.md#local-development).

## Local commands

```bash
pnpm --filter @reputo/storage build
pnpm --filter @reputo/storage test
pnpm --filter @reputo/storage typecheck
pnpm --filter @reputo/storage docs
```

## More

- Generated API docs: [docs/README.md](docs/README.md)
