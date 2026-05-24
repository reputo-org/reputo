import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const envPath = resolve(repoRoot, '.env');

if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
} else if (process.env.CI !== 'true') {
  process.stderr.write(
    `\n  Missing ${envPath}\n` + `  Run:\n` + `    cp .env.example .env\n` + `  then fill in the placeholders.\n\n`,
  );
  process.exit(1);
}

const args = process.argv.slice(2);
if (args.length === 0) {
  process.stderr.write('Usage: tsx scripts/env/load.ts <command> [args...]\n');
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
