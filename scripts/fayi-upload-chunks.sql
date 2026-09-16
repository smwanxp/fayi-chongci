CREATE TABLE IF NOT EXISTS fayi_data_upload_chunks (
  id BIGSERIAL PRIMARY KEY,
  owner_user_id VARCHAR(128) NOT NULL,
  upload_id VARCHAR(64) NOT NULL,
  chunk_index INTEGER NOT NULL,
  chunk_data TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (owner_user_id, upload_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS fayi_data_upload_chunks_lookup_idx
  ON fayi_data_upload_chunks (owner_user_id, upload_id, chunk_index);
