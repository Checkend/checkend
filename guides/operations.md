# Backup and upgrade

## Back up

### Docker or Node

```sh
node scripts/backup.ts /data/backup-20261010.sqlite
```

In Docker Compose:

```sh
docker compose exec checkend node scripts/backup.ts /data/backup-20261010.sqlite
```

The script makes a consistent copy of the SQLite database (SQLite `VACUUM INTO`), also while
Checkend runs. It does not overwrite a file that exists. Then copy the backup file off the volume.

> **Caution:** do not copy `checkend.sqlite` itself while Checkend runs. The database is in WAL
> mode: the newest writes are in the `-wal` file, so a plain copy can be incomplete.

### Cloudflare

D1 has Time Travel: you can restore the database to an earlier point. How far back depends on
your plan: 30 days on Workers Paid and 7 days on Workers Free (October 2026). See
[Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/) and the
[D1 limits](https://developers.cloudflare.com/d1/platform/limits/) for the current values.

Before each deploy, record a bookmark:

```sh
node scripts/d1-bookmark.ts --config wrangler.<name>.jsonc
```

It prints the bookmark and the command that restores it, and it keeps a log in
`.wrangler/d1-bookmarks.jsonl`. If a deploy goes wrong, restore with the printed command:

```sh
npx wrangler d1 time-travel restore DB --bookmark=<bookmark> --config wrangler.<name>.jsonc
```

## Upgrade

The migrations only go forward. To go back to an older version after an upgrade, you need the
backup (or the bookmark) from before the upgrade.

### Docker

1. Back up.
2. Change the image tag, for example in `compose.yaml`.
3. Run `docker compose up -d`. The migrations run at start.

### A copy of Checkend on GitHub

If you cloned Checkend into your own repository, the workflow
`.github/workflows/upstream-sync.yml` helps you upgrade. Once a week (or when you run it), it
opens a pull request "Update Checkend from vA to vB" with the changes of the newest release. It
never merges: you review the pull request.

- It needs the repository setting **Actions → General → Workflow permissions → Allow GitHub
  Actions to create and approve pull requests**.
- It takes the release of your copy from the version in `package.json`, or from the input `base`
  of a manual run (for example `v0.8`).
- On a conflict, the run fails, and its summary lists the steps to finish the upgrade by hand.

### Cloudflare

1. Record a bookmark (see above).
2. Apply the migrations, and deploy:

   ```sh
   npx wrangler d1 migrations apply DB --remote --config wrangler.<name>.jsonc
   npx wrangler deploy --config wrangler.<name>.jsonc
   ```

## Check an install

`scripts/free-plan-check.ts` runs a full-flow check against a deployed install (8 steps, each
PASS or FAIL). It creates one project and deletes it at the end. `scripts/free-plan-check.md`
has a checklist for the Cloudflare dashboard.
