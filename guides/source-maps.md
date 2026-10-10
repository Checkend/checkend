# Source maps

The JavaScript that runs in a browser is usually minified: its stack frames point to lines like
`app.min.js:1:48213`. Upload your source maps, and the issue brief shows the original file, line
and source lines, so that an agent can find the cause.

## Set up storage

Checkend keeps source maps in an R2 bucket. It is optional: without it, uploads give `400`
`storage_not_configured`.

1. Create the bucket:

   ```sh
   npx wrangler r2 bucket create checkend-blobs
   ```

2. Add it to your Worker config (`wrangler.<name>.jsonc`), then deploy:

   ```jsonc
   "r2_buckets": [{ "binding": "BLOBS", "bucket_name": "checkend-blobs" }]
   ```

## Upload the source maps

Upload them in CI, after the build, with a token that has the `releases:write` scope. For each
`.map` file:

```sh
curl -X POST "$CHECKEND_URL/v1/sourcemaps?project=my-app&release=$RELEASE&name=~/static/app.min.js" \
  -H "Authorization: Bearer $CHECKEND_DEPLOY_TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary @dist/static/app.min.js.map
```

> **Caution:** `release` must be the same as the release in your SDK (the `release` option of
> `Sentry.init`). Checkend uses only the maps of the release of the event.

`name` is the minified file, as the browser loads it. It can be:

- its URL, for example `https://cdn.example/static/app.min.js`
- `~/static/app.min.js` (any host)
- a path, for example `/static/app.min.js`

Checkend keeps only the URL path, so these three are the same: `/static/app.min.js`. A project
has one map for each release and path: a new upload replaces the old map.

The body is the source map (version 3), at most 30 MB. See
[`POST /v1/sourcemaps`](api.md#post-v1sourcemaps) for the responses.

## What the brief shows

For each frame with a line and a column, Checkend looks for a map of the release of the event.
A map matches when it has the same path, or else the same file name when only one map of the
release has that name.

- A mapped frame shows the original file, line and source lines.
- In the JSON brief, the frame has a field `minified`: the old `<file>:<line>:<column>` when a
  map gave the frame, else `null`.
- The issue in the brief has `source_maps`: `{"frames": ..., "mapped": ...}`, the frames that
  can be mapped and the frames that were mapped.
- A mapped frame whose original file is in `node_modules` is not in-app.
- Without a map, or with a map that is not valid, the frame stays as it was.
- Function names stay as the minified names. Checkend does not rename functions yet.

## How it stays fast

Checkend reads the source map once, at upload, and stores a compact index with the source
contents. When it builds a brief, a lookup is a binary search, with no JSON parsing, so it fits
the CPU limit of the Workers Free plan.

> **Note:** on the Workers Free plan (10 ms of CPU for each request), building the index of a
> large map at upload can be above the limit. Then use a paid plan, or upload a prebuilt index
> (`Content-Type: application/x-checkend-sourcemap-index`), so that the Worker does no work.
