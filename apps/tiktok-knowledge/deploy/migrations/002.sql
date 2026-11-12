ALTER TABLE users ADD COLUMN IF NOT EXISTS username varchar(64);
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash text;
CREATE UNIQUE INDEX IF NOT EXISTS users_username_key ON users(lower(username)) WHERE username IS NOT NULL;

CREATE TABLE IF NOT EXISTS auth_login_limits (
  key varchar(64) PRIMARY KEY,
  attempts integer NOT NULL DEFAULT 0,
  window_started_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auth_login_limits_window_idx ON auth_login_limits(window_started_at);
