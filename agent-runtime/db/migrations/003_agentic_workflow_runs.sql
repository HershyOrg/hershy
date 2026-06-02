CREATE TABLE IF NOT EXISTS workflow_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  prompt TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  intent_sketch JSONB NOT NULL DEFAULT '{}'::jsonb,
  current_phase TEXT,
  model_name TEXT,
  planner_version TEXT,
  labeler_version TEXT,
  validator_version TEXT,
  reproducibility_seed TEXT,
  trace_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workflow_runs_status_updated
  ON workflow_runs(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_prompt_trgm
  ON workflow_runs USING GIN(prompt gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_metadata
  ON workflow_runs USING GIN(metadata);

CREATE TABLE IF NOT EXISTS workflow_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  evidence_type TEXT NOT NULL,
  source_uri TEXT,
  internal_uri TEXT,
  previous_internal_uri TEXT,
  title TEXT,
  content_hash TEXT,
  raw_content TEXT,
  normalized_content TEXT,
  summary TEXT,
  source_trust_score DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  freshness_score DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  relevance_score DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_updated_at TIMESTAMPTZ,
  valid_from TIMESTAMPTZ,
  valid_to TIMESTAMPTZ,
  superseded_by UUID REFERENCES workflow_evidence(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workflow_evidence_run_type
  ON workflow_evidence(run_id, evidence_type);
CREATE INDEX IF NOT EXISTS idx_workflow_evidence_source
  ON workflow_evidence(source_uri);
CREATE INDEX IF NOT EXISTS idx_workflow_evidence_internal_uri
  ON workflow_evidence(internal_uri);
CREATE INDEX IF NOT EXISTS idx_workflow_evidence_metadata
  ON workflow_evidence USING GIN(metadata);

CREATE TABLE IF NOT EXISTS adaptive_labels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  normalized_label TEXT NOT NULL,
  label_type TEXT NOT NULL DEFAULT 'unknown',
  scope TEXT NOT NULL DEFAULT 'run',
  source TEXT NOT NULL DEFAULT 'unknown',
  confidence DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  importance DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  evidence_ids UUID[] NOT NULL DEFAULT '{}',
  entity_ids UUID[] NOT NULL DEFAULT '{}',
  artifact_ids UUID[] NOT NULL DEFAULT '{}',
  valid_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_to TIMESTAMPTZ,
  superseded_by UUID REFERENCES adaptive_labels(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active',
  rejection_reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_adaptive_labels_run_norm_source
  ON adaptive_labels(run_id, normalized_label, source);
CREATE INDEX IF NOT EXISTS idx_adaptive_labels_run_type
  ON adaptive_labels(run_id, label_type);
CREATE INDEX IF NOT EXISTS idx_adaptive_labels_status
  ON adaptive_labels(status);
CREATE INDEX IF NOT EXISTS idx_adaptive_labels_metadata
  ON adaptive_labels USING GIN(metadata);

CREATE TABLE IF NOT EXISTS label_clusters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  canonical_label TEXT NOT NULL,
  normalized_canonical_label TEXT NOT NULL,
  label_type TEXT,
  member_label_ids UUID[] NOT NULL DEFAULT '{}',
  confidence DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  evidence_ids UUID[] NOT NULL DEFAULT '{}',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_label_clusters_run_norm
  ON label_clusters(run_id, normalized_canonical_label);
CREATE INDEX IF NOT EXISTS idx_label_clusters_metadata
  ON label_clusters USING GIN(metadata);

CREATE TABLE IF NOT EXISTS entity_label_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  label_id UUID REFERENCES adaptive_labels(id) ON DELETE CASCADE,
  entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  link_type TEXT NOT NULL,
  confidence DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  evidence_ids UUID[] NOT NULL DEFAULT '{}',
  valid_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_to TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_entity_label_links_run
  ON entity_label_links(run_id);
CREATE INDEX IF NOT EXISTS idx_entity_label_links_label
  ON entity_label_links(label_id);
CREATE INDEX IF NOT EXISTS idx_entity_label_links_entity
  ON entity_label_links(entity_id);

CREATE TABLE IF NOT EXISTS capabilities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  description TEXT,
  capability_type TEXT NOT NULL DEFAULT 'workflow',
  input_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
  safety_level TEXT NOT NULL DEFAULT 'read_only',
  is_stable BOOLEAN NOT NULL DEFAULT true,
  version TEXT NOT NULL DEFAULT '1',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_capabilities_type
  ON capabilities(capability_type);
CREATE INDEX IF NOT EXISTS idx_capabilities_metadata
  ON capabilities USING GIN(metadata);

CREATE TABLE IF NOT EXISTS capability_label_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  capability_id UUID NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
  label_id UUID NOT NULL REFERENCES adaptive_labels(id) ON DELETE CASCADE,
  relation TEXT NOT NULL DEFAULT 'suggests',
  score DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  confidence DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  evidence_ids UUID[] NOT NULL DEFAULT '{}',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_capability_label_links_unique
  ON capability_label_links(run_id, capability_id, label_id, relation);
CREATE INDEX IF NOT EXISTS idx_capability_label_links_run
  ON capability_label_links(run_id);

CREATE TABLE IF NOT EXISTS workflow_research_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  task_type TEXT NOT NULL,
  query TEXT,
  target_entity_ids UUID[] NOT NULL DEFAULT '{}',
  target_label_ids UUID[] NOT NULL DEFAULT '{}',
  required_capability_ids UUID[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  priority INTEGER NOT NULL DEFAULT 50,
  input JSONB NOT NULL DEFAULT '{}'::jsonb,
  output JSONB NOT NULL DEFAULT '{}'::jsonb,
  evidence_ids UUID[] NOT NULL DEFAULT '{}',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workflow_research_tasks_run_status
  ON workflow_research_tasks(run_id, status, priority DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_research_tasks_type
  ON workflow_research_tasks(task_type);
CREATE INDEX IF NOT EXISTS idx_workflow_research_tasks_metadata
  ON workflow_research_tasks USING GIN(metadata);

CREATE TABLE IF NOT EXISTS tool_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  capability_id UUID REFERENCES capabilities(id) ON DELETE SET NULL,
  tool_name TEXT NOT NULL,
  adapter_name TEXT,
  adapter_version TEXT,
  candidate_reason TEXT,
  required_label_ids UUID[] NOT NULL DEFAULT '{}',
  supporting_evidence_ids UUID[] NOT NULL DEFAULT '{}',
  estimated_reliability DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  estimated_cost DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  estimated_latency DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  safety_level TEXT NOT NULL DEFAULT 'read_only',
  status TEXT NOT NULL DEFAULT 'candidate',
  rejection_reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tool_candidates_run_status
  ON tool_candidates(run_id, status);
CREATE INDEX IF NOT EXISTS idx_tool_candidates_capability
  ON tool_candidates(capability_id);
CREATE INDEX IF NOT EXISTS idx_tool_candidates_metadata
  ON tool_candidates USING GIN(metadata);

CREATE TABLE IF NOT EXISTS adapter_selections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  capability_id UUID REFERENCES capabilities(id) ON DELETE SET NULL,
  selected_tool_candidate_id UUID REFERENCES tool_candidates(id) ON DELETE SET NULL,
  selection_reason TEXT NOT NULL,
  confidence DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  evidence_ids UUID[] NOT NULL DEFAULT '{}',
  fallback_tool_candidate_ids UUID[] NOT NULL DEFAULT '{}',
  safety_status TEXT NOT NULL DEFAULT 'read_only',
  selected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_adapter_selections_run
  ON adapter_selections(run_id);
CREATE INDEX IF NOT EXISTS idx_adapter_selections_capability
  ON adapter_selections(capability_id);

CREATE TABLE IF NOT EXISTS workflow_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  plan_status TEXT NOT NULL DEFAULT 'draft',
  plan_json JSONB NOT NULL,
  assumptions JSONB NOT NULL DEFAULT '[]'::jsonb,
  open_questions JSONB NOT NULL DEFAULT '[]'::jsonb,
  risk_notes JSONB NOT NULL DEFAULT '[]'::jsonb,
  label_ids UUID[] NOT NULL DEFAULT '{}',
  capability_ids UUID[] NOT NULL DEFAULT '{}',
  evidence_ids UUID[] NOT NULL DEFAULT '{}',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workflow_plans_run_status
  ON workflow_plans(run_id, plan_status);
CREATE INDEX IF NOT EXISTS idx_workflow_plans_metadata
  ON workflow_plans USING GIN(metadata);

CREATE TABLE IF NOT EXISTS workflow_graphs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  workflow_plan_id UUID REFERENCES workflow_plans(id) ON DELETE SET NULL,
  graph_status TEXT NOT NULL DEFAULT 'draft',
  graph_json JSONB NOT NULL,
  node_count INTEGER NOT NULL DEFAULT 0,
  edge_count INTEGER NOT NULL DEFAULT 0,
  used_capability_ids UUID[] NOT NULL DEFAULT '{}',
  used_adapter_selection_ids UUID[] NOT NULL DEFAULT '{}',
  used_evidence_ids UUID[] NOT NULL DEFAULT '{}',
  used_label_ids UUID[] NOT NULL DEFAULT '{}',
  validation_result JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workflow_graphs_run_status
  ON workflow_graphs(run_id, graph_status);
CREATE INDEX IF NOT EXISTS idx_workflow_graphs_metadata
  ON workflow_graphs USING GIN(metadata);
