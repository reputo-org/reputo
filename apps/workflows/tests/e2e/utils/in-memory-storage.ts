import { ObjectNotFoundError, type Storage } from '@reputo/storage';

/**
 * The bucket every e2e test seeds and reads from. Must match the value the
 * `config` mock returns for `config.storage.bucket` in each test file.
 */
export const TEST_BUCKET = 'test-bucket';

/**
 * A `Map`-backed stand-in for `@reputo/storage`'s `Storage` class. It implements
 * only the methods the algorithm compute path and the community dataset engine
 * actually call — `getObject`, `putObject`, `verify`, `listObjectsByPrefix`,
 * `deleteObjects` — plus a few read helpers so tests can assert on the bytes
 * that compute wrote back. Cast to `Storage` the same way the rest of the
 * suite does (`as unknown as Storage`); no S3/MinIO is involved.
 */
export interface InMemoryStorage extends Storage {
  /** Raw stored bytes for a key (undefined if absent). */
  readObject(key: string, bucket?: string): Buffer | undefined;
  /** Stored bytes decoded as UTF-8 text (undefined if absent). */
  readText(key: string, bucket?: string): string | undefined;
  /** Stored bytes parsed as JSON (throws if absent). */
  readJson<T = unknown>(key: string, bucket?: string): T;
  /** Seed an object (string | Buffer | object-as-JSON) under a key. */
  seed(key: string, body: Buffer | Uint8Array | string, bucket?: string): void;
  has(key: string, bucket?: string): boolean;
  keys(): string[];
  /** Keys of every putObject call, in order — lets tests assert write ordering. */
  putLog(): string[];
}

function toBuffer(body: Buffer | Uint8Array | string): Buffer {
  if (typeof body === 'string') {
    return Buffer.from(body, 'utf-8');
  }
  if (Buffer.isBuffer(body)) {
    return body;
  }
  return Buffer.from(body);
}

export function createInMemoryStorage(): InMemoryStorage {
  const store = new Map<string, Buffer>();
  const puts: string[] = [];
  const id = (bucket: string, key: string) => `${bucket}/${key}`;

  const fake = {
    async getObject({ bucket, key }: { bucket: string; key: string }): Promise<Buffer> {
      const buffer = store.get(id(bucket, key));
      if (buffer === undefined) {
        throw new ObjectNotFoundError(id(bucket, key));
      }
      return buffer;
    },

    async putObject({
      bucket,
      key,
      body,
    }: {
      bucket: string;
      key: string;
      body: Buffer | Uint8Array | string;
    }): Promise<string> {
      store.set(id(bucket, key), toBuffer(body));
      puts.push(key);
      return key;
    },

    async verify({ bucket, key }: { bucket: string; key: string }) {
      if (!store.has(id(bucket, key))) {
        throw new ObjectNotFoundError(id(bucket, key));
      }
      return { key, metadata: {} as never };
    },

    async listObjectsByPrefix({ bucket, prefix }: { bucket: string; prefix: string }): Promise<string[]> {
      const scoped = `${bucket}/`;
      return [...store.keys()]
        .filter((stored) => stored.startsWith(scoped) && stored.slice(scoped.length).startsWith(prefix))
        .map((stored) => stored.slice(scoped.length))
        .sort();
    },

    async deleteObjects({ bucket, keys }: { bucket: string; keys: string[] }) {
      for (const key of keys) {
        store.delete(id(bucket, key));
      }
      return { deleted: keys, errors: [] };
    },

    readObject(key: string, bucket: string = TEST_BUCKET) {
      return store.get(id(bucket, key));
    },

    readText(key: string, bucket: string = TEST_BUCKET) {
      return store.get(id(bucket, key))?.toString('utf-8');
    },

    readJson<T = unknown>(key: string, bucket: string = TEST_BUCKET): T {
      const text = store.get(id(bucket, key))?.toString('utf-8');
      if (text === undefined) {
        throw new Error(`InMemoryStorage: object not found: ${id(bucket, key)}`);
      }
      return JSON.parse(text) as T;
    },

    seed(key: string, body: Buffer | Uint8Array | string, bucket: string = TEST_BUCKET) {
      store.set(id(bucket, key), toBuffer(body));
    },

    has(key: string, bucket: string = TEST_BUCKET) {
      return store.has(id(bucket, key));
    },

    keys() {
      return [...store.keys()];
    },

    putLog() {
      return [...puts];
    },
  };

  return fake as unknown as InMemoryStorage;
}
