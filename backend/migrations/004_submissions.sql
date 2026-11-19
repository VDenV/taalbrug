CREATE TABLE submissions (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lesson_id   TEXT NOT NULL,
  item_idx    INT NOT NULL CHECK (item_idx >= 0),
  text        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','done')),
  grade       SMALLINT CHECK (grade BETWEEN 0 AND 2),
  feedback    TEXT,
  graded_by   BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  graded_at   TIMESTAMPTZ,
  UNIQUE (user_id, lesson_id, item_idx)
);
CREATE INDEX submissions_status_idx ON submissions(status, created_at);
