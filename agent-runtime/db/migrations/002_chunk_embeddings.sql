CREATE TABLE IF NOT EXISTS chunk_embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chunk_id UUID NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
  embedding_model_id UUID REFERENCES embedding_models(id) ON DELETE SET NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  embedding vector NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(chunk_id, provider, model, dimensions)
);

CREATE INDEX IF NOT EXISTS idx_chunk_embeddings_chunk
  ON chunk_embeddings(chunk_id);
CREATE INDEX IF NOT EXISTS idx_chunk_embeddings_scope
  ON chunk_embeddings(provider, model, dimensions);
CREATE INDEX IF NOT EXISTS idx_chunk_embeddings_model
  ON chunk_embeddings(embedding_model_id);
CREATE INDEX IF NOT EXISTS idx_chunk_embeddings_metadata
  ON chunk_embeddings USING GIN(metadata);

INSERT INTO chunk_embeddings (
  chunk_id,
  embedding_model_id,
  provider,
  model,
  dimensions,
  embedding,
  metadata,
  created_at,
  updated_at
)
SELECT
  chunks.id,
  chunks.embedding_model_id,
  chunks.embedding_provider,
  chunks.embedding_model,
  chunks.embedding_dimensions,
  chunks.embedding,
  jsonb_build_object('migrated_from', 'chunks.embedding'),
  chunks.updated_at,
  now()
FROM chunks
WHERE chunks.embedding IS NOT NULL
  AND chunks.embedding_provider IS NOT NULL
  AND chunks.embedding_model IS NOT NULL
  AND chunks.embedding_dimensions IS NOT NULL
ON CONFLICT (chunk_id, provider, model, dimensions) DO UPDATE SET
  embedding_model_id = COALESCE(excluded.embedding_model_id, chunk_embeddings.embedding_model_id),
  embedding = excluded.embedding,
  metadata = chunk_embeddings.metadata || excluded.metadata,
  updated_at = now();
