# create-checkend

Sets up [Checkend](https://github.com/Checkend/checkend), error tracking for coding agents, on your
own Cloudflare account with Wrangler:

```sh
npx wrangler login
npx create-checkend my-errors
```

It needs git, Node.js 22.18 or later, and a Wrangler login. It:

1. clones the newest Checkend release into `./my-errors`
2. installs the dependencies
3. creates the D1 database `my-errors`
4. writes `wrangler.my-errors.jsonc` (git-ignored, with your account's database ID)
5. applies the migrations and deploys the Worker
6. prints how to sign in for the first time

It runs on the Workers Free plan. To deploy an update later, run
`npx wrangler deploy --config wrangler.my-errors.jsonc` in the folder.
