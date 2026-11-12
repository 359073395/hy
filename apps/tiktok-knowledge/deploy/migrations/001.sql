CREATE TABLE IF NOT EXISTS health_check (id serial PRIMARY KEY, updated_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name varchar(128) NOT NULL,
  token_hash varchar(128) NOT NULL UNIQUE, custom_token_hash varchar(128) UNIQUE,
  role varchar(24) NOT NULL DEFAULT 'employee', tier varchar(8) NOT NULL DEFAULT 'M2',
  status varchar(16) NOT NULL DEFAULT 'active', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz
);
CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash varchar(128) NOT NULL UNIQUE, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS chapters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), module varchar(16) NOT NULL, section_no varchar(16) NOT NULL,
  title varchar(255) NOT NULL, sort_order integer NOT NULL DEFAULT 0, is_public boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz
);
CREATE TABLE IF NOT EXISTS content_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), chapter_id uuid NOT NULL UNIQUE REFERENCES chapters(id) ON DELETE CASCADE,
  html text NOT NULL, version integer NOT NULL DEFAULT 1, updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS content_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), content_block_id uuid NOT NULL REFERENCES content_blocks(id) ON DELETE CASCADE,
  version integer NOT NULL, html text NOT NULL, created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action varchar(64) NOT NULL, detail jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), chapter_id uuid NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  sentence text NOT NULL, word varchar(128) NOT NULL, file_key text NOT NULL, file_type varchar(16) NOT NULL,
  file_name text, file_size integer DEFAULT 0, uploader_id uuid REFERENCES users(id) ON DELETE SET NULL,
  status varchar(16) NOT NULL DEFAULT 'active', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS exams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code varchar(32) NOT NULL UNIQUE, name varchar(128) NOT NULL,
  scope varchar(64) NOT NULL, pass_score integer NOT NULL DEFAULT 80, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), exam_id uuid NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  qtype varchar(16) NOT NULL, question_text text NOT NULL, options jsonb, answer varchar(255), explanation text,
  sort_order integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS exam_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), exam_id uuid NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, status varchar(24) NOT NULL DEFAULT 'pending',
  score integer, official_passed boolean DEFAULT false, practical_status varchar(16) NOT NULL DEFAULT 'pending',
  answers jsonb, question_snapshot jsonb, started_at timestamptz, submitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS user_tokens (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, token varchar(128) NOT NULL,
  token_custom varchar(128), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS bootstrap_removals (token_hash varchar(128) PRIMARY KEY, removed_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS app_state (key text PRIMARY KEY, value jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS knowledge_settings (key text PRIMARY KEY, value jsonb NOT NULL);

-- Additive upgrades for databases exported from the original application.
ALTER TABLE users ADD COLUMN IF NOT EXISTS custom_token_hash varchar(128);
ALTER TABLE user_tokens ADD COLUMN IF NOT EXISTS token_custom varchar(128);
ALTER TABLE questions ADD COLUMN IF NOT EXISTS explanation text;
ALTER TABLE exam_records ADD COLUMN IF NOT EXISTS question_snapshot jsonb;
CREATE UNIQUE INDEX IF NOT EXISTS users_custom_token_hash_key ON users(custom_token_hash);
CREATE UNIQUE INDEX IF NOT EXISTS chapters_module_section_key ON chapters(module, section_no);
CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS chapters_sort_idx ON chapters(sort_order);
CREATE INDEX IF NOT EXISTS content_snapshots_block_idx ON content_snapshots(content_block_id);
CREATE INDEX IF NOT EXISTS materials_chapter_idx ON materials(chapter_id);
CREATE INDEX IF NOT EXISTS materials_file_key_idx ON materials(file_key);
CREATE INDEX IF NOT EXISTS questions_exam_idx ON questions(exam_id);
CREATE INDEX IF NOT EXISTS exam_records_user_exam_idx ON exam_records(user_id, exam_id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'knowledge_api') THEN
    CREATE ROLE knowledge_api NOLOGIN;
  END IF;
END $$;
GRANT USAGE ON SCHEMA public TO knowledge_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  users, sessions, chapters, content_blocks, content_snapshots, audit_logs,
  materials, exams, questions, exam_records, health_check, knowledge_settings TO knowledge_api;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO knowledge_api;
