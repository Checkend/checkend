-- Migration 0004: people who use the web UI. Members, their passkeys, sessions, WebAuthn
-- challenges, and sign-in attempts (rate limit).
-- Rules (AGENTS.md): valid on D1 and SQLite; forward-only and additive; no triggers.
-- These tables are separate from the API tokens (0003): a session is for a browser only.

CREATE TABLE members (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  -- The WebAuthn user handle (random, base64url). Not personal data.
  user_handle TEXT NOT NULL UNIQUE,
  created_at  TEXT NOT NULL
);

CREATE TABLE passkeys (
  id            INTEGER PRIMARY KEY,
  member_id     INTEGER NOT NULL REFERENCES members (id),
  credential_id TEXT NOT NULL UNIQUE,
  -- COSE public key.
  public_key    BLOB NOT NULL,
  sign_count    INTEGER NOT NULL DEFAULT 0,
  transports    TEXT,
  backed_up     INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  last_used_at  TEXT
);
CREATE INDEX passkeys_member ON passkeys (member_id);

-- Only the SHA-256 hash of the session ID is stored; the ID is in the cookie only.
CREATE TABLE sessions (
  id_hash    TEXT PRIMARY KEY,
  member_id  INTEGER NOT NULL REFERENCES members (id),
  csrf_token TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX sessions_expires ON sessions (expires_at);

-- WebAuthn challenges. Each one is used once, then deleted.
CREATE TABLE auth_challenges (
  challenge  TEXT PRIMARY KEY,
  purpose    TEXT NOT NULL,
  data       TEXT,
  expires_at TEXT NOT NULL
);

-- Sign-in and setup attempts per client and time window.
CREATE TABLE auth_attempts (
  key          TEXT NOT NULL,
  window_start TEXT NOT NULL,
  count        INTEGER NOT NULL,
  PRIMARY KEY (key, window_start)
);
