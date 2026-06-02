# @reputo/storage

Framework-agnostic S3 storage layer: get/put objects and presigned upload/download URLs.

It exists as the single path to object storage (MinIO in local dev, S3 in production). Algorithms and
services go through it instead of calling the AWS SDK directly, so bucket and credential wiring lives in one place.

Public API is `src/index.ts` (`storage.ts` is the layer, `s3-client.ts` wraps the AWS SDK).
