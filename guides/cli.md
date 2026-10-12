# The ce CLI

`ce` is the command-line interface of Checkend, for people, scripts and coding agents. It has
two names: `ce` (short) and `checkend`. On a terminal, it prints short tables and cards. When
its output is not a terminal (an agent, a script, a pipe), or with `--json`, it prints the API
JSON.

The source and the full list of commands are in the
[checkend-cli repository](https://github.com/Checkend/checkend-cli).

## Install ce

Today, build `ce` from source with Go (Go 1.26 or later):

```sh
go install github.com/Checkend/checkend-cli/cmd/ce@latest
ce --version
```

Release builds (Homebrew, an install script, an npm package) are not available yet.

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
installed it. No `ce` release is published yet, so today it prints the command to build the
latest version from source:

```sh
go install github.com/Checkend/checkend-cli/cmd/ce@latest
```

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

> **Note:** these commands install only a signed server release (see
> [Server releases](operations.md#server-releases)). No server release is published yet. Until
> then, use the manual steps: [deploy to Cloudflare](quick-start.md#2-or-deploy-it-to-your-cloudflare-account)
> or [run without Cloudflare](self-host.md).

A hosted space does not use `ce server`: it updates itself.
