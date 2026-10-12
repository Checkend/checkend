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

## Server releases

A server release is a GitHub release of Checkend with a signed manifest
(`checkend-release.json`). The manifest lists the Worker bundle, the migrations and the digest of
the Docker image. `ce server install` and `ce server upgrade` install only a release that `ce`
checks, in this order:

1. the SSH signature of the exact manifest bytes, with a key that `ce` trusts (the namespace
   `checkend-server-release`)
2. the manifest itself
3. its tag and commit, against the GitHub release
4. the size and the SHA-256 of each file, when `ce` downloads it

The releases are on the [releases page](https://github.com/Checkend/checkend/releases). The first
release is 0.8.0 (tag `v0.8.0`). Its image is `ghcr.io/checkend/checkend:0.8.0`.

### How a release is made

A maintainer pushes a version tag, for example `v0.9.0`. The workflow
`.github/workflows/release.yml` then:

1. runs the checks (`npm run check`)
2. builds the multi-arch image (`linux/amd64` and `linux/arm64`) and pushes it to
   `ghcr.io/checkend/checkend` by its digest only, with no tag
3. builds the Worker bundle (`checkend-worker-<version>.tar.gz`, one ES module `worker.js`) and
   the migrations (`checkend-migrations-<version>.tar.gz`), and pins the Caddy and cloudflared
   images by their multi-arch digest
4. writes the manifest (`scripts/release-manifest.ts`) and `SHA256SUMS`, and makes a draft
   release with them
5. in the environment `release`, after a maintainer approves the job: signs the manifest
   (`checkend-release.json.sig`), checks the signature with `release/allowed_signers`, and
   publishes the release
6. after the release is published: checks the signed manifest again, then adds the tags
   `:<version>`, `:<major>.<minor>` and `:latest` to the image digest that the manifest pins,
   and checks that each tag points to that digest

So no image tag points to a release that a maintainer did not approve.

The manifest never has a secret or a default value of a secret. A release that is not signed
stays a draft, so `ce` never sees it.

### Upgrade with ce

For a server that `ce server install` installed:

```sh
ce server status     # the version, the health, and whether a newer release exists
ce server backup     # a backup (Cloudflare: a D1 Time Travel bookmark)
ce server upgrade    # a backup, then the newer release
```

`ce server upgrade` does not go to an older version, unless you add `--allow-downgrade` and the
older version has the same migrations. `ce server uninstall` removes the server; the data stays,
unless you add `--delete-data`.

A hosted space updates itself: it does not use `ce server`.

## Check an install

`scripts/free-plan-check.ts` runs a full-flow check against a deployed install (8 steps, each
PASS or FAIL). It creates one project and deletes it at the end. `scripts/free-plan-check.md`
has a checklist for the Cloudflare dashboard.
