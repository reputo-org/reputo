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

Connect to the environment MongoDB database and run:

```javascript
db = db.getSiblingDB("<MONGODB_DB_NAME>");
db.authsessions.deleteMany({});
```

Expected result: all existing browser sessions are invalidated. Users must sign in again; denied users are redirected to `/access-denied`.

Include this deploy note in the PR description:

```text
Required deploy step: run db.authsessions.deleteMany({}) once in each rolled-out environment after deploying the access-control code/env so all existing sessions re-authenticate through the allowlist gate.
```

## Owner Handoff

There is no owner handoff endpoint by design. Change ownership with a manual DB edit and a matching env update.

1. Pick the new owner email and normalize it to lowercase.
2. Stage the environment update: `OWNER_EMAIL=<new-owner-email>`. Do not restart the API with the new env until the DB edit is complete.
3. During the same maintenance window, update the allowlist row in MongoDB.
4. Deploy or restart the API with the new env and confirm it starts without an owner conflict.
5. Run `db.authsessions.deleteMany({})` so old sessions reload their access role.

MongoDB handoff script:

```javascript
const provider = "deep-id";
const targetEmail = "new-owner@example.com";
const now = new Date();

const oldOwner = db.accessallowlists.findOne({
  provider,
  role: "owner",
  revokedAt: null,
});

if (!oldOwner) {
  throw new Error("No active owner row found.");
}

const targetRow = db.accessallowlists.findOne({
  provider,
  email: targetEmail,
});

if (targetRow && !targetRow._id.equals(oldOwner._id)) {
  db.accessallowlists.updateOne(
    { _id: targetRow._id },
    {
      $set: {
        role: "owner",
        revokedAt: null,
        revokedBy: null,
        updatedAt: now,
      },
    }
  );

  db.accessallowlists.updateOne(
    { _id: oldOwner._id },
    {
      $set: {
        role: "admin",
        revokedAt: now,
        updatedAt: now,
      },
    }
  );
} else if (!targetRow) {
  db.accessallowlists.updateOne(
    { _id: oldOwner._id },
    {
      $set: {
        email: targetEmail,
        updatedAt: now,
      },
    }
  );
} else {
  print("Target email is already the active owner.");
}
```

Verify exactly one active owner remains:

```javascript
db.accessallowlists.find({
  provider: "deep-id",
  role: "owner",
  revokedAt: null,
});
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
