/**
 * Single-source-of-truth env loader for local development.
 *
 * Loads the repo-root `.env` into `process.env` (without overwriting values
 * already set in the shell), then execs the rest of argv as a child process.
 * Used by `pnpm dev` and `pnpm docker:dev` so that:
 *
 *   - Every app spawned under `pnpm dev` inherits a populated `process.env`
 *     before its Zod env module runs.
 *   - `docker compose` sees the same vars in its process env for `${VAR}`
 *     interpolation inside `docker/compose/dev.yml`.
 *
 * Operators who need an ad-hoc override can still set vars in their shell
 * (`LOG_LEVEL=debug pnpm dev`) — shell vars take precedence over `.env`.
 *
 * Refuses to start when `.env` is missing and `CI` is unset, so devs get a
 * clear next step instead of a cryptic Zod failure deep inside an app.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const envPath = resolve(repoRoot, '.env');

if (existsSync(envPath)) {
  // process.loadEnvFile is Node 20.6+. It does NOT overwrite values already
  // set in process.env, which is exactly what we want.
  process.loadEnvFile(envPath);
} else if (process.env.CI !== 'true') {
  process.stderr.write(
    `\n  Missing ${envPath}\n` +
      `  Run:\n` +
      `    cp .env.example .env\n` +
      `  then fill in the placeholders.\n\n`,
  );
  process.exit(1);
}

const args = process.argv.slice(2);
if (args.length === 0) {
  process.stderr.write(
    'Usage: tsx scripts/env/load.ts <command> [args...]\n',
  );
  process.exit(1);
}

const [cmd, ...cmdArgs] = args;
const child = spawn(cmd, cmdArgs, { stdio: 'inherit', shell: false });

for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.on(sig, () => {
    child.kill(sig);
  });
}

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? 0);
  }
});

child.on('error', (err) => {
  process.stderr.write(`\nFailed to spawn ${cmd}: ${err.message}\n`);
  process.exit(127);
});
