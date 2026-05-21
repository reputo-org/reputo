# Access-Control Rollout Runbook

Use this runbook when deploying the access allowlist gate, owner bootstrap, or an `OWNER_EMAIL` handoff.

## Required Environment

Set `OWNER_EMAIL` before deploying an OAuth environment. It is the email seeded as the single owner allowlist row.

Environment handling:

- Local dev: set `OWNER_EMAIL` in `apps/api/envs.example` or copied local env files. For Docker dev, copy `docker/env/examples/api.env.example` into `docker/env/api.env` and fill the value.
- PullPreview: `.github/workflows/pull-preview.yml` and `docker/compose/preview.yml` set `OWNER_EMAIL=preview@example.com` for the mock preview user.
- Staging: set `STAGING_OWNER_EMAIL` in Komodo variables before deploying `reputo-apps-staging`.
- Production: set `PRODUCTION_OWNER_EMAIL` in Komodo variables before running `promote-production`.

If `AUTH_MODE=oauth` and `OWNER_EMAIL` is missing, the API fails startup. If `OWNER_EMAIL` differs from the existing active owner allowlist row, startup fails with an owner conflict. Fix the env value or perform the owner handoff below before restarting.

## One-Time Session Wipe

This rollout must force every existing user to authenticate through the new allowlist gate. Run this once per affected environment after the new API code and env are deployed, before declaring the deploy complete.

Connect to the API PostgreSQL database (`DATABASE_URL`) and run:

```sql
DELETE FROM auth_session;
```

Expected result: all existing browser sessions are invalidated. Users must sign in again; denied users are redirected to `/access-denied`.

Include this deploy note in the PR description:

```text
Required deploy step: run `DELETE FROM auth_session;` once in each rolled-out environment after deploying the access-control code/env so all existing sessions re-authenticate through the allowlist gate.
```

## Owner Handoff

There is no owner handoff endpoint by design. Change ownership with a manual DB edit and a matching env update.

1. Pick the new owner email and normalize it to lowercase.
2. Stage the environment update: `OWNER_EMAIL=<new-owner-email>`. Do not restart the API with the new env until the DB edit is complete.
3. During the same maintenance window, update the allowlist row in PostgreSQL.
4. Deploy or restart the API with the new env and confirm it starts without an owner conflict.
5. Run `DELETE FROM auth_session;` so old sessions reload their access role.

PostgreSQL handoff script (run as a single transaction):

```sql
BEGIN;

-- Promote the target email (or insert it) and demote the current owner. The
-- (provider, email) unique index keeps both branches safe — the upsert and
-- the demotion both target a single row.

WITH old_owner AS (
  SELECT id, email
  FROM access_allowlist
  WHERE provider = 'deep-id'
    AND role = 'owner'
    AND revoked_at IS NULL
  LIMIT 1
)
INSERT INTO access_allowlist (id, provider, email, role, invited_at, created_at, updated_at)
VALUES (
  gen_random_uuid(),
  'deep-id',
  'new-owner@example.com',
  'owner',
  now(),
  now(),
  now()
)
ON CONFLICT (provider, email) DO UPDATE
SET role = 'owner',
    revoked_at = NULL,
    revoked_by = NULL,
    updated_at = now();

UPDATE access_allowlist
SET role = 'admin',
    revoked_at = now(),
    updated_at = now()
WHERE provider = 'deep-id'
  AND role = 'owner'
  AND revoked_at IS NULL
  AND email <> 'new-owner@example.com';

COMMIT;
```

Verify exactly one active owner remains:

```sql
SELECT email
FROM access_allowlist
WHERE provider = 'deep-id'
  AND role = 'owner'
  AND revoked_at IS NULL;
```

## Add The First Admin

After the configured owner signs in, add the first admin through the UI:

1. Open the UI as the owner.
2. Go to `/admins`.
3. Use "Invite an administrator" and enter the admin email.
4. Ask the new admin to sign in with DeepID.

Curl alternative, using the owner's authenticated session cookie:

```bash
curl --fail-with-body \
  --request POST "$API_ORIGIN/api/v1/admins" \
  --header "Content-Type: application/json" \
  --header "Cookie: reputo_auth_session=<owner-session-cookie>" \
  --data '{"email":"admin@example.com"}'
```

If `AUTH_COOKIE_NAME` differs from `reputo_auth_session`, use the configured cookie name.

## Verification

- API starts without `OWNER_EMAIL` validation or owner-conflict errors.
- `GET /api/v1/admins` returns the owner first.
- A non-allowlisted OAuth user lands on `/access-denied?reason=not_allowlisted`.
- The one-time session wipe has been run in every rolled-out environment.
