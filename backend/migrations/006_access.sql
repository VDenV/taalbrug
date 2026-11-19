CREATE TABLE access_codes (
  id          BIGSERIAL PRIMARY KEY,
  code_hash   TEXT NOT NULL UNIQUE,
  level       TEXT NOT NULL CHECK (level IN ('A0','A1','A2','B1')),
  seats       INT NOT NULL CHECK (seats > 0),
  used        INT NOT NULL DEFAULT 0,
  label       TEXT,
  revoked     BOOLEAN NOT NULL DEFAULT false,
  expires_at  TIMESTAMPTZ,
  created_by  BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE code_redemptions (
  code_id      BIGINT NOT NULL REFERENCES access_codes(id) ON DELETE CASCADE,
  user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  redeemed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (code_id, user_id)
);

CREATE TABLE entitlements (
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  level       TEXT NOT NULL CHECK (level IN ('A0','A1','A2','B1')),
  source      TEXT NOT NULL CHECK (source IN ('manual','code','payment')),
  code_id     BIGINT REFERENCES access_codes(id) ON DELETE SET NULL,
  granted_by  BIGINT REFERENCES users(id) ON DELETE SET NULL,
  granted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, level)
);
