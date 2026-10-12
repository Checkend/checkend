# The ce CLI

`ce` is the command-line interface of Checkend, for people, scripts and coding agents. It has
two names: `ce` (short) and `checkend`. On a terminal, it prints short tables and cards. When
its output is not a terminal (an agent, a script, a pipe), or with `--json`, it prints the API
JSON.

The source and the full list of commands are in the
[checkend-cli repository](https://github.com/Checkend/checkend-cli).

## Install ce

`ce` is one binary for macOS, Linux and Windows. Install it with one of these.

The install script:

```sh
curl -fsSL https://raw.githubusercontent.com/Checkend/checkend-cli/main/install.sh | sh
```

npm (or run it once with `npx @checkend/cli`):

```sh
npm install -g @checkend/cli
```

Homebrew (two commands: Homebrew does not tap on install):

```sh
brew tap checkend/tap
brew install checkend/tap/checkend
```

From source, with Go 1.26 or later:

```sh
go install github.com/Checkend/checkend-cli/cmd/ce@latest
```

Then run `ce --version`. The install script and the npm package first check the SSH signature of
the checksums of the release, then the SHA-256 of the binary. Without a valid signature, they
install nothing.

`go install` puts `ce` in `$(go env GOBIN)` when it is set, else in `$(go env GOPATH)/bin`. This
folder is often not on PATH. If `ce --version` says "command not found", add the folder to PATH
in `~/.zshrc` (zsh) or `~/.bashrc` (bash), then open a new terminal:

```sh
export PATH="$PATH:$(go env GOPATH)/bin"
```

## Update ce

```sh
ce update
```

`ce update` looks for the newest release of `ce`, and it updates `ce` in the same way that you
installed it: Homebrew, npm, the install script or `go install`.

## Log in

```sh
ce login
```

`ce login` asks for the URL of your Checkend and an API token: a token from
[Settings → Tokens](web-ui.md#tokens), a token from [`POST /v1/tokens`](api.md#post-v1tokens), or
the `ADMIN_TOKEN` of a self-hosted install. It checks the URL and the token before it saves them.

In CI or a script, give the token on stdin, never as an argument:

```sh
echo "$CHECKEND_TOKEN" | ce login --url https://<your-checkend> --with-token
```

`ce logout` removes the saved token of the current instance. A saved token goes only to the URL
that it was saved for.

## The keychain

`ce` keeps tokens in the keychain of the operating system: the macOS Keychain, the Windows
Credential Manager, or the Secret Service on Linux. The URL goes to
`~/.config/checkend/config.json`. Without a keychain, the token goes to that file (mode 600), and
`ce` tells you. Set `CHECKEND_NO_KEYCHAIN=1` to keep the token in the file.

`ce setup` (see [Set up with an agent](agent-setup.md)) saves the agent token of an app in the
keychain too. `ce mcp` reads it from there, so the token never goes into a config file of the
agent.

`ce` never prints a token, and never writes one to `.checkend.json`. `.checkend.json` has the
project link only, so you can commit it.

## Settings for all commands

| Option | Environment | Meaning |
|---|---|---|
| `--url <url>` | `CHECKEND_URL` | Your Checkend. It can have a base path (a hosted space). |
| `--token <token>` | `CHECKEND_TOKEN` | The API token. |
| `--json` | | Print JSON, also on a terminal. |

`ce` looks for a setting in this order: the option, the environment, `.checkend.json` (the
project only), then the saved login.

## Install and manage a server

`ce server` installs and manages a Checkend server that you run yourself:

| Command | What it does |
|---|---|
| `ce server install cloudflare` | A Worker and a D1 database on your Cloudflare account |
| `ce server install docker` | `compose.yaml` and `.env` for Docker on this machine |
| `ce server install ssh <user@host> --domain <domain>` | An Ubuntu or Debian LTS server over SSH (see [On a server over SSH](self-host.md#on-a-server-over-ssh)) |
| `ce server upgrade` | Back up, then upgrade to a newer release |
| `ce server backup` | Back up the database |
| `ce server status` | The version, the health, and whether a newer release exists |
| `ce server uninstall` | Remove the server. The data stays, unless you add `--delete-data`. |

These commands install only a signed server release (see
[Server releases](operations.md#server-releases)). They show the plan and ask first (`--yes` for
agents), and they end with the setup link of the web UI. The manual steps stay an alternative:
[deploy to Cloudflare](quick-start.md#2-or-deploy-it-to-your-cloudflare-account) or
[run without Cloudflare](self-host.md#with-docker).

A hosted space does not use `ce server`: it updates itself.
