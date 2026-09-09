# @reputo/storage

S3 storage abstraction used by the API and the workflow workers. Wraps the AWS SDK with presigned upload, presigned download, upload verification, and direct object access.

## Main exports

- `Storage`: class with presigned upload, presigned download, upload verification, and direct object read/write methods.
- `createS3Client(options)`: consistent AWS SDK client setup. Honours custom `endpoint` + `forcePathStyle` for MinIO and other S3-compatible servers.
- `generateKey(type, id, filename)`: creates a valid upload or snapshot object key.
- Shared error types and S3 types re-exported from the package root.

## Usage

```ts
import { Storage, createS3Client } from '@reputo/storage';

const s3 = createS3Client({ region: 'eu-north-1' });
const storage = new Storage(s3);

const upload = await storage.presignPut({
  bucket: 'reputo',
  filename: 'input.csv',
  contentType: 'text/csv',
  ttl: 120,
  maxSizeBytes: 50 * 1024 * 1024,
  contentTypeAllowlist: ['text/csv'],
});

console.log(upload.key, upload.url);
```

## Configuration

Pass an `S3Client` to the `Storage` constructor. The SDK reads AWS credentials from the standard credential chain (environment, shared config files, IAM role).

For local MinIO or LocalStack, pass `endpoint` and `forcePathStyle: true` to `createS3Client`. Reputo configures these values through `STORAGE_ENDPOINT` and `STORAGE_FORCE_PATH_STYLE`. See [Local development](../../docs/local-development.md).

## Commands

```bash
pnpm --filter @reputo/storage build
pnpm --filter @reputo/storage test
pnpm --filter @reputo/storage typecheck
pnpm --filter @reputo/storage docs
```

## Related documentation

- [Architecture](../../docs/architecture.md)
- [Local development](../../docs/local-development.md)
