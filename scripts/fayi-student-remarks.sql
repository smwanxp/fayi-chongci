CREATE TABLE IF NOT EXISTS fayi_student_remarks (
  id BIGSERIAL PRIMARY KEY,
  admin_user_id VARCHAR(128) NOT NULL,
  student_user_id VARCHAR(128) NOT NULL,
  remark TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (admin_user_id, student_user_id)
);

CREATE INDEX IF NOT EXISTS fayi_student_remarks_admin_user_id_idx
  ON fayi_student_remarks (admin_user_id);
