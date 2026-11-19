CREATE TABLE users (
  id          BIGSERIAL PRIMARY KEY,
  email       TEXT NOT NULL UNIQUE,
  name        TEXT,
  role        TEXT NOT NULL DEFAULT 'learner' CHECK (role IN ('learner','teacher','admin','client')),
  lang        TEXT NOT NULL DEFAULT 'nl' CHECK (lang IN ('nl','uk')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE login_tokens (
  token_hash  TEXT PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX login_tokens_user_idx ON login_tokens(user_id, created_at);

CREATE TABLE sessions (
  id_hash     TEXT PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
