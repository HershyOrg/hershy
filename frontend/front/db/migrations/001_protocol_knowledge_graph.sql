CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS kg_migrations (
  name TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL,
  canonical_name TEXT,
  aliases TEXT[] NOT NULL DEFAULT '{}',
  chain_id BIGINT,
  address TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  confidence DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_entities_type_chain_address
  ON entities (type, chain_id, lower(address))
  WHERE address IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type);
CREATE INDEX IF NOT EXISTS idx_entities_name_trgm ON entities USING GIN(canonical_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_entities_aliases ON entities USING GIN(aliases);
CREATE INDEX IF NOT EXISTS idx_entities_metadata ON entities USING GIN(metadata);

CREATE TABLE IF NOT EXISTS protocols (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id UUID NOT NULL UNIQUE REFERENCES entities(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  website TEXT,
  docs_url TEXT,
  github_url TEXT,
  category TEXT,
  status TEXT NOT NULL DEFAULT 'candidate',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id UUID REFERENCES entities(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  uri TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  raw_text TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(type, uri, content_hash)
);

CREATE INDEX IF NOT EXISTS idx_artifacts_entity ON artifacts(entity_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_uri ON artifacts(uri);
CREATE INDEX IF NOT EXISTS idx_artifacts_metadata ON artifacts USING GIN(metadata);

CREATE TABLE IF NOT EXISTS knowledge_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id UUID REFERENCES entities(id) ON DELETE SET NULL,
  page_kind TEXT NOT NULL,
  internal_uri TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  current_revision_id UUID,
  content_hash TEXT NOT NULL,
  previous_internal_uri TEXT,
  modified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_knowledge_pages_entity ON knowledge_pages(entity_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_pages_kind_modified ON knowledge_pages(page_kind, modified_at DESC);
CREATE INDEX IF NOT EXISTS idx_knowledge_pages_metadata ON knowledge_pages USING GIN(metadata);

CREATE TABLE IF NOT EXISTS knowledge_page_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id UUID NOT NULL REFERENCES knowledge_pages(id) ON DELETE CASCADE,
  revision_number INTEGER NOT NULL,
  internal_uri TEXT NOT NULL UNIQUE,
  previous_internal_uri TEXT,
  superseded_by_internal_uri TEXT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  artifact_id UUID REFERENCES artifacts(id) ON DELETE SET NULL,
  modified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_to TIMESTAMPTZ,
  is_current BOOLEAN NOT NULL DEFAULT true,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(page_id, revision_number)
);

CREATE INDEX IF NOT EXISTS idx_page_revisions_page_current ON knowledge_page_revisions(page_id, is_current);
CREATE INDEX IF NOT EXISTS idx_page_revisions_modified ON knowledge_page_revisions(modified_at DESC);
CREATE INDEX IF NOT EXISTS idx_page_revisions_metadata ON knowledge_page_revisions USING GIN(metadata);

CREATE TABLE IF NOT EXISTS embedding_models (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  query_prefix TEXT,
  document_prefix TEXT,
  max_input_tokens INTEGER,
  distance_metric TEXT NOT NULL DEFAULT 'cosine',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(provider, model, dimensions)
);

CREATE INDEX IF NOT EXISTS idx_embedding_models_lookup
  ON embedding_models(provider, model, dimensions);
CREATE INDEX IF NOT EXISTS idx_embedding_models_metadata
  ON embedding_models USING GIN(metadata);

CREATE TABLE IF NOT EXISTS chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_id UUID REFERENCES artifacts(id) ON DELETE CASCADE,
  entity_id UUID REFERENCES entities(id) ON DELETE SET NULL,
  page_id UUID REFERENCES knowledge_pages(id) ON DELETE SET NULL,
  page_revision_id UUID REFERENCES knowledge_page_revisions(id) ON DELETE SET NULL,
  embedding_model_id UUID REFERENCES embedding_models(id) ON DELETE SET NULL,
  chunk_type TEXT NOT NULL,
  text TEXT NOT NULL,
  content_hash TEXT NOT NULL DEFAULT '',
  heading_path TEXT[] NOT NULL DEFAULT '{}',
  token_count INTEGER NOT NULL DEFAULT 0,
  embedding vector,
  embedding_provider TEXT,
  embedding_model TEXT,
  embedding_dimensions INTEGER,
  is_current BOOLEAN NOT NULL DEFAULT true,
  modified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_to TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  fts tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(text, ''))) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_chunks_revision_type_hash
  ON chunks(page_revision_id, chunk_type, content_hash)
  WHERE page_revision_id IS NOT NULL AND content_hash <> '';
CREATE INDEX IF NOT EXISTS idx_chunks_entity ON chunks(entity_id);
CREATE INDEX IF NOT EXISTS idx_chunks_page_current ON chunks(page_id, is_current, modified_at DESC);
CREATE INDEX IF NOT EXISTS idx_chunks_artifact ON chunks(artifact_id);
CREATE INDEX IF NOT EXISTS idx_chunks_type ON chunks(chunk_type);
CREATE INDEX IF NOT EXISTS idx_chunks_metadata ON chunks USING GIN(metadata);
CREATE INDEX IF NOT EXISTS idx_chunks_fts_current ON chunks USING GIN(fts) WHERE is_current = true;
CREATE INDEX IF NOT EXISTS idx_chunks_embedding_scope
  ON chunks(embedding_provider, embedding_model, embedding_dimensions)
  WHERE embedding IS NOT NULL AND is_current = true;
CREATE INDEX IF NOT EXISTS idx_chunks_embedding_model_current
  ON chunks(embedding_model_id, is_current, modified_at DESC)
  WHERE embedding IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_knowledge_pages_current_revision'
  ) THEN
    ALTER TABLE knowledge_pages
      ADD CONSTRAINT fk_knowledge_pages_current_revision
      FOREIGN KEY (current_revision_id)
      REFERENCES knowledge_page_revisions(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS edges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  src_entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  dst_entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL,
  evidence_chunk_id UUID REFERENCES chunks(id) ON DELETE SET NULL,
  confidence DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  valid_from TIMESTAMPTZ,
  valid_to TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_edges_unique_evidence
  ON edges (
    src_entity_id,
    dst_entity_id,
    relation_type,
    coalesce(evidence_chunk_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );
CREATE INDEX IF NOT EXISTS idx_edges_src_relation ON edges(src_entity_id, relation_type);
CREATE INDEX IF NOT EXISTS idx_edges_dst_relation ON edges(dst_entity_id, relation_type);
CREATE INDEX IF NOT EXISTS idx_edges_relation ON edges(relation_type);
CREATE INDEX IF NOT EXISTS idx_edges_metadata ON edges USING GIN(metadata);

CREATE TABLE IF NOT EXISTS facts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_entity_id UUID REFERENCES entities(id) ON DELETE CASCADE,
  predicate TEXT NOT NULL,
  object_entity_id UUID REFERENCES entities(id) ON DELETE SET NULL,
  object_value TEXT,
  evidence_chunk_ids UUID[] NOT NULL DEFAULT '{}',
  confidence DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_facts_subject_predicate ON facts(subject_entity_id, predicate);
CREATE UNIQUE INDEX IF NOT EXISTS idx_facts_unique_value
  ON facts (
    subject_entity_id,
    predicate,
    coalesce(object_entity_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(object_value, '')
  );
CREATE INDEX IF NOT EXISTS idx_facts_object ON facts(object_entity_id);
CREATE INDEX IF NOT EXISTS idx_facts_evidence ON facts USING GIN(evidence_chunk_ids);
CREATE INDEX IF NOT EXISTS idx_facts_metadata ON facts USING GIN(metadata);

CREATE TABLE IF NOT EXISTS deployments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  protocol_id UUID REFERENCES protocols(id) ON DELETE CASCADE,
  chain_id BIGINT NOT NULL,
  address TEXT NOT NULL,
  contract_entity_id UUID REFERENCES entities(id) ON DELETE SET NULL,
  version TEXT,
  source TEXT,
  verified BOOLEAN NOT NULL DEFAULT false,
  proxy_type TEXT,
  implementation_address TEXT,
  implementation_entity_id UUID REFERENCES entities(id) ON DELETE SET NULL,
  deployer_address TEXT,
  creation_tx_hash TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_deployments_unique_protocol_address
  ON deployments(chain_id, lower(address), protocol_id);
CREATE INDEX IF NOT EXISTS idx_deployments_protocol ON deployments(protocol_id);
CREATE INDEX IF NOT EXISTS idx_deployments_chain_address ON deployments(chain_id, lower(address));
CREATE INDEX IF NOT EXISTS idx_deployments_metadata ON deployments USING GIN(metadata);

CREATE TABLE IF NOT EXISTS contract_symbols (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  symbol_type TEXT NOT NULL,
  name TEXT,
  selector TEXT,
  signature TEXT,
  state_mutability TEXT,
  source_chunk_id UUID REFERENCES chunks(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contract_symbols_contract ON contract_symbols(contract_entity_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_contract_symbols_unique_signature
  ON contract_symbols(contract_entity_id, symbol_type, coalesce(signature, ''), coalesce(name, ''));
CREATE INDEX IF NOT EXISTS idx_contract_symbols_name ON contract_symbols(name);
CREATE INDEX IF NOT EXISTS idx_contract_symbols_signature ON contract_symbols(signature);
CREATE INDEX IF NOT EXISTS idx_contract_symbols_metadata ON contract_symbols USING GIN(metadata);

CREATE TABLE IF NOT EXISTS contract_storage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  slot TEXT,
  variable_name TEXT,
  variable_type TEXT,
  source_chunk_id UUID REFERENCES chunks(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contract_storage_contract ON contract_storage(contract_entity_id);

CREATE TABLE IF NOT EXISTS onchain_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id BIGINT NOT NULL,
  block_number BIGINT,
  tx_hash TEXT,
  contract_address TEXT,
  contract_entity_id UUID REFERENCES entities(id) ON DELETE SET NULL,
  event_signature TEXT,
  args JSONB NOT NULL DEFAULT '{}'::jsonb,
  timestamp TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_onchain_events_chain_contract ON onchain_events(chain_id, lower(contract_address));
CREATE INDEX IF NOT EXISTS idx_onchain_events_tx ON onchain_events(tx_hash);
CREATE INDEX IF NOT EXISTS idx_onchain_events_args ON onchain_events USING GIN(args);

CREATE TABLE IF NOT EXISTS contract_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_contract_id UUID REFERENCES entities(id) ON DELETE SET NULL,
  instance_entity_id UUID REFERENCES entities(id) ON DELETE SET NULL,
  instance_address TEXT NOT NULL,
  chain_id BIGINT NOT NULL,
  factory_address TEXT,
  factory_entity_id UUID REFERENCES entities(id) ON DELETE SET NULL,
  creation_tx_hash TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_contract_instances_unique_address
  ON contract_instances(chain_id, lower(instance_address));
CREATE INDEX IF NOT EXISTS idx_contract_instances_factory ON contract_instances(chain_id, lower(factory_address));

CREATE TABLE IF NOT EXISTS agent_research_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  priority INTEGER NOT NULL DEFAULT 100,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  locked_by TEXT,
  locked_at TIMESTAMPTZ,
  last_error TEXT,
  next_run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_research_tasks_queue
  ON agent_research_tasks(status, next_run_at, priority, created_at);
CREATE INDEX IF NOT EXISTS idx_agent_research_tasks_payload ON agent_research_tasks USING GIN(payload);

CREATE TABLE IF NOT EXISTS agent_research_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID REFERENCES agent_research_tasks(id) ON DELETE SET NULL,
  status TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_agent_research_runs_task ON agent_research_runs(task_id);

CREATE TABLE IF NOT EXISTS retrieval_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  query TEXT NOT NULL,
  mode TEXT NOT NULL,
  selected_entity_ids UUID[] NOT NULL DEFAULT '{}',
  selected_chunk_ids UUID[] NOT NULL DEFAULT '{}',
  rating INTEGER,
  notes TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO kg_migrations(name)
VALUES ('001_protocol_knowledge_graph.sql')
ON CONFLICT (name) DO NOTHING;
