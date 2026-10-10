# Contributing to Checkend

Thank you for your help. This guide tells you how to make a change that we can merge.

## Before you start

- For a large change, open an issue first, so that we can agree on the approach.
- Read [AGENTS.md](AGENTS.md). It has the architecture rules (ports and adapters), the build
  rules, and the commands. The same rules apply to humans and to coding agents.

## Set up

1. Install Node 22.18 or later.
2. Clone the repository and install the dependencies:

   ```sh
   npm ci
   git config core.hooksPath .githooks
   ```

3. Run the checks:

   ```sh
   npm run check
   ```

## Make a change

1. Write a failing test first. Put it in `test/node/` (Node) or `test/workers/` (`workerd`).
   A new port also needs contract tests in `test/contract/`.
2. Write the smallest code that makes the test pass, then refactor.
3. Run `npm run check`. Lint, types and all tests must pass.
4. Keep each commit small, with a message that says why the change is necessary.

## Sign your commits (DCO)

Checkend uses the [Developer Certificate of Origin](https://developercertificate.org) (DCO).
Each commit must have a `Signed-off-by` line with your name and email:

```sh
git commit -s -m "Explain the change"
```

The sign-off states that you have the right to submit the change under the project license.
CI rejects a pull request with an unsigned commit. To sign off commits that you already made:

```sh
git rebase --signoff main
```

## License

By contributing, you agree that your contributions are licensed under the
[Apache License 2.0](LICENSE).

## Security

Do not report security problems in public issues. See [SECURITY.md](SECURITY.md).
