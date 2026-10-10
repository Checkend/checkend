# CPU benchmark on Workers

`npm run test:perf` measures the CPU path in Node, as a proxy. This benchmark measures the real
CPU time on Cloudflare Workers: a separate Worker (`checkend-bench`) with its own D1 database runs
the same code, and `bench/run.ts` sends the golden fixtures, the worst event of a real SDK and the
largest event that ingest accepts. It reads the CPU time of each request from `wrangler tail`.

**Deploying the benchmark Worker is a person's decision** (it creates resources on the account).
Agents prepare and run the script; they do not deploy.

## Steps

1. Create the database, and put its ID into a local copy of `bench/wrangler.jsonc`:

   ```sh
   npx wrangler d1 create checkend-bench
   ```

2. Apply the migrations and set the admin token:

   ```sh
   npx wrangler d1 migrations apply DB --remote --config bench/wrangler.jsonc
   npx wrangler secret put ADMIN_TOKEN --config bench/wrangler.jsonc
   ```

3. Deploy (a person):

   ```sh
   npx wrangler deploy --config bench/wrangler.jsonc
   ```

4. Measure. Right after a deploy, `--cold` sends one request per case (mostly new isolates);
   without it, each case is sent `--repeat` times (warm isolates):

   ```sh
   node bench/run.ts --url https://checkend-bench.<subdomain>.workers.dev --token <ADMIN_TOKEN> --cold
   node bench/run.ts --url https://checkend-bench.<subdomain>.workers.dev --token <ADMIN_TOKEN> --repeat 30
   ```

   The table has, per case: samples, CPU time p50, p99 and max (ms), the samples above 10 ms
   (the Workers Free plan limit), and errors. If the tail has no CPU times, use Workers
   Observability (query builder: filter the URL by `bench=<case>`, CPU time p50/p99/max).

5. For the Free plan test, repeat steps 1-4 on a Workers Free account.

6. Remove the Worker and the database:

   ```sh
   npx wrangler delete --config bench/wrangler.jsonc
   npx wrangler d1 delete checkend-bench
   ```

The benchmark has no rate limiter and no cron, so it measures ingest only.
