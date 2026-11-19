CREATE TABLE course (
  id          INT PRIMARY KEY CHECK (id = 1),
  data        JSONB NOT NULL,
  version     INT NOT NULL DEFAULT 1,
  updated_by  BIGINT REFERENCES users(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
