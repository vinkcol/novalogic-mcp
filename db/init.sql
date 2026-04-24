-- Novalogic MCP Database Initialization
-- Vector extension for semantic memory
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================
-- MEMORY SYSTEM (Librarian Agent)
-- ============================================

CREATE TABLE IF NOT EXISTS memories (
    id SERIAL PRIMARY KEY,
    agent VARCHAR(50) NOT NULL DEFAULT 'librarian',
    category VARCHAR(100) NOT NULL,
    title VARCHAR(500) NOT NULL,
    content TEXT NOT NULL,
    metadata JSONB DEFAULT '{}',
    tags TEXT[] DEFAULT '{}',
    embedding vector(768),
    relevance_score FLOAT DEFAULT 0.0,
    access_count INTEGER DEFAULT 0,
    last_accessed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_memories_agent ON memories(agent);
CREATE INDEX idx_memories_category ON memories(category);
CREATE INDEX idx_memories_tags ON memories USING gin(tags);
CREATE INDEX idx_memories_metadata ON memories USING gin(metadata);
CREATE INDEX idx_memories_content_trgm ON memories USING gin(content gin_trgm_ops);
CREATE INDEX idx_memories_title_trgm ON memories USING gin(title gin_trgm_ops);

-- ============================================
-- PROJECT MANAGEMENT (PM Agent)
-- ============================================

DO $$ BEGIN
    CREATE TYPE task_status AS ENUM ('backlog', 'todo', 'in_progress', 'in_review', 'done', 'blocked', 'cancelled');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE task_priority AS ENUM ('critical', 'high', 'medium', 'low');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE task_type AS ENUM ('feature', 'bug', 'tech_debt', 'improvement', 'spike', 'epic');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS sprints (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    goal TEXT,
    start_date DATE,
    end_date DATE,
    status VARCHAR(20) DEFAULT 'planning',
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tasks (
    id SERIAL PRIMARY KEY,
    sprint_id INTEGER REFERENCES sprints(id),
    title VARCHAR(500) NOT NULL,
    description TEXT,
    type task_type DEFAULT 'feature',
    status task_status DEFAULT 'backlog',
    priority task_priority DEFAULT 'medium',
    domain VARCHAR(100),
    assigned_agent VARCHAR(50),
    story_points INTEGER,
    acceptance_criteria JSONB DEFAULT '[]',
    tags TEXT[] DEFAULT '{}',
    parent_id INTEGER REFERENCES tasks(id),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_sprint ON tasks(sprint_id);
CREATE INDEX IF NOT EXISTS idx_tasks_domain ON tasks(domain);
CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority);

-- ============================================
-- QA SYSTEM (QA Agent)
-- ============================================

DO $$ BEGIN
    CREATE TYPE issue_severity AS ENUM ('critical', 'major', 'minor', 'trivial');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE issue_status AS ENUM ('open', 'investigating', 'confirmed', 'fixed', 'wont_fix', 'closed');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS qa_issues (
    id SERIAL PRIMARY KEY,
    title VARCHAR(500) NOT NULL,
    description TEXT,
    severity issue_severity DEFAULT 'minor',
    status issue_status DEFAULT 'open',
    domain VARCHAR(100),
    file_path VARCHAR(1000),
    line_number INTEGER,
    category VARCHAR(100),
    reproduction_steps JSONB DEFAULT '[]',
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW(),
    resolved_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS qa_checklists (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    domain VARCHAR(100),
    items JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================
-- ARCHITECTURE DECISIONS (Architect Agent)
-- ============================================

CREATE TABLE IF NOT EXISTS architecture_decisions (
    id SERIAL PRIMARY KEY,
    title VARCHAR(500) NOT NULL,
    context TEXT,
    decision TEXT NOT NULL,
    consequences TEXT,
    status VARCHAR(20) DEFAULT 'proposed',
    domain VARCHAR(100),
    tags TEXT[] DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================
-- CODE PATTERNS (Backend/Frontend Agents)
-- ============================================

CREATE TABLE IF NOT EXISTS code_patterns (
    id SERIAL PRIMARY KEY,
    agent VARCHAR(50) NOT NULL,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    pattern_type VARCHAR(50),
    code_example TEXT,
    file_patterns TEXT[] DEFAULT '{}',
    domain VARCHAR(100),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================
-- CONTEXT SNAPSHOTS (Cross-agent)
-- ============================================

CREATE TABLE IF NOT EXISTS context_snapshots (
    id SERIAL PRIMARY KEY,
    session_id VARCHAR(100),
    agent VARCHAR(50),
    context_type VARCHAR(50) NOT NULL,
    content TEXT NOT NULL,
    embedding vector(768),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_context_session ON context_snapshots(session_id);
CREATE INDEX IF NOT EXISTS idx_context_type ON context_snapshots(context_type);

-- ============================================
-- QA BROWSER TESTING (QA Agent)
-- ============================================

CREATE TABLE IF NOT EXISTS qa_test_flows (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL UNIQUE,
    description TEXT,
    domain VARCHAR(100),
    tags TEXT[] DEFAULT '{}',
    preconditions JSONB DEFAULT '[]',
    steps JSONB NOT NULL DEFAULT '[]',
    test_data JSONB DEFAULT '{}',
    expected_url VARCHAR(500),
    timeout_ms INTEGER DEFAULT 30000,
    enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS qa_test_suites (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL UNIQUE,
    description TEXT,
    flow_ids INTEGER[] NOT NULL DEFAULT '{}',
    setup_flow_id INTEGER REFERENCES qa_test_flows(id),
    teardown_flow_id INTEGER REFERENCES qa_test_flows(id),
    tags TEXT[] DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS qa_test_results (
    id SERIAL PRIMARY KEY,
    flow_id INTEGER REFERENCES qa_test_flows(id),
    suite_id INTEGER REFERENCES qa_test_suites(id),
    flow_name VARCHAR(200) NOT NULL,
    status VARCHAR(20) NOT NULL,
    total_steps INTEGER NOT NULL,
    passed_steps INTEGER NOT NULL,
    failed_steps INTEGER NOT NULL,
    elapsed_ms INTEGER,
    step_results JSONB NOT NULL DEFAULT '[]',
    error_message TEXT,
    screenshot_on_failure TEXT,
    final_url VARCHAR(500),
    test_data_used JSONB DEFAULT '{}',
    environment JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_test_results_flow ON qa_test_results(flow_id);
CREATE INDEX IF NOT EXISTS idx_test_results_status ON qa_test_results(status);
CREATE INDEX IF NOT EXISTS idx_test_results_created ON qa_test_results(created_at DESC);

-- ============================================
-- UX/UI DESIGNER AGENT
-- ============================================

CREATE TABLE IF NOT EXISTS design_tokens (
    id SERIAL PRIMARY KEY,
    project VARCHAR(100) NOT NULL DEFAULT 'novalogic',
    category VARCHAR(50) NOT NULL,  -- colors, typography, spacing, breakpoints, shadows, borders
    name VARCHAR(200) NOT NULL,
    value TEXT NOT NULL,
    description TEXT,
    css_variable VARCHAR(200),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(project, category, name)
);

CREATE INDEX IF NOT EXISTS idx_design_tokens_project ON design_tokens(project);
CREATE INDEX IF NOT EXISTS idx_design_tokens_category ON design_tokens(category);

CREATE TABLE IF NOT EXISTS design_components (
    id SERIAL PRIMARY KEY,
    project VARCHAR(100) NOT NULL DEFAULT 'novalogic',
    name VARCHAR(200) NOT NULL,
    component_type VARCHAR(50) NOT NULL,  -- atom, molecule, organism, template, page
    description TEXT,
    usage_guidelines TEXT,
    accessibility_notes TEXT,
    props_schema JSONB DEFAULT '{}',
    variants JSONB DEFAULT '[]',
    do_dont JSONB DEFAULT '{"do": [], "dont": []}',
    figma_url VARCHAR(500),
    tags TEXT[] DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(project, name)
);

CREATE INDEX IF NOT EXISTS idx_design_components_type ON design_components(component_type);
CREATE INDEX IF NOT EXISTS idx_design_components_project ON design_components(project);

CREATE TABLE IF NOT EXISTS design_layouts (
    id SERIAL PRIMARY KEY,
    project VARCHAR(100) NOT NULL DEFAULT 'novalogic',
    name VARCHAR(200) NOT NULL,
    page_type VARCHAR(50) NOT NULL,  -- landing, dashboard, form, detail, list, auth, error
    description TEXT,
    sections JSONB NOT NULL DEFAULT '[]',
    responsive_notes TEXT,
    wireframe_url VARCHAR(500),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(project, name)
);

-- ============================================
-- SALES B2B AGENT
-- ============================================

CREATE TABLE IF NOT EXISTS sales_personas (
    id SERIAL PRIMARY KEY,
    project VARCHAR(100) NOT NULL DEFAULT 'novalogic',
    name VARCHAR(200) NOT NULL,
    role VARCHAR(200),
    company_size VARCHAR(100),  -- startup, pyme, enterprise
    industry VARCHAR(200),
    pain_points JSONB DEFAULT '[]',
    goals JSONB DEFAULT '[]',
    objections JSONB DEFAULT '[]',
    buying_triggers JSONB DEFAULT '[]',
    decision_criteria JSONB DEFAULT '[]',
    demographics JSONB DEFAULT '{}',
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(project, name)
);

CREATE TABLE IF NOT EXISTS sales_content (
    id SERIAL PRIMARY KEY,
    project VARCHAR(100) NOT NULL DEFAULT 'novalogic',
    content_type VARCHAR(50) NOT NULL,  -- value_prop, objection, competitor, pricing, cta, testimonial, case_study, faq
    title VARCHAR(500) NOT NULL,
    content TEXT NOT NULL,
    target_persona VARCHAR(200),
    funnel_stage VARCHAR(50),  -- awareness, consideration, decision, retention
    tags TEXT[] DEFAULT '{}',
    metadata JSONB DEFAULT '{}',
    priority INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sales_content_type ON sales_content(content_type);
CREATE INDEX IF NOT EXISTS idx_sales_content_project ON sales_content(project);
CREATE INDEX IF NOT EXISTS idx_sales_content_stage ON sales_content(funnel_stage);

CREATE TABLE IF NOT EXISTS sales_pricing (
    id SERIAL PRIMARY KEY,
    project VARCHAR(100) NOT NULL DEFAULT 'novalogic',
    plan_name VARCHAR(200) NOT NULL,
    plan_slug VARCHAR(100) NOT NULL,
    price_monthly DECIMAL(10,2),
    price_yearly DECIMAL(10,2),
    currency VARCHAR(10) DEFAULT 'COP',
    features JSONB NOT NULL DEFAULT '[]',
    limits JSONB DEFAULT '{}',
    target_persona VARCHAR(200),
    is_popular BOOLEAN DEFAULT false,
    cta_text VARCHAR(200),
    sort_order INTEGER DEFAULT 0,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(project, plan_slug)
);

CREATE TABLE IF NOT EXISTS pricing_experiments (
    id SERIAL PRIMARY KEY,
    project VARCHAR(100) NOT NULL DEFAULT 'novalogic',
    experiment_name VARCHAR(200) NOT NULL,
    target_segment VARCHAR(200),
    hypothesis TEXT,
    pricing_surface VARCHAR(100), -- landing, checkout, sales_call, proposal
    status VARCHAR(50) NOT NULL DEFAULT 'draft', -- draft, running, paused, completed, archived
    variants JSONB NOT NULL DEFAULT '[]',
    success_metrics JSONB DEFAULT '[]',
    baseline JSONB DEFAULT '{}',
    results JSONB DEFAULT '{}',
    start_date DATE,
    end_date DATE,
    owner VARCHAR(200),
    notes TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(project, experiment_name)
);

CREATE INDEX IF NOT EXISTS idx_pricing_experiments_project ON pricing_experiments(project);
CREATE INDEX IF NOT EXISTS idx_pricing_experiments_status ON pricing_experiments(status);

CREATE TABLE IF NOT EXISTS growth_channel_metrics (
    id SERIAL PRIMARY KEY,
    project VARCHAR(100) NOT NULL DEFAULT 'novalogic',
    channel VARCHAR(100) NOT NULL,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    spend DECIMAL(12,2) DEFAULT 0,
    impressions INTEGER DEFAULT 0,
    clicks INTEGER DEFAULT 0,
    leads INTEGER DEFAULT 0,
    opportunities INTEGER DEFAULT 0,
    customers INTEGER DEFAULT 0,
    revenue DECIMAL(12,2) DEFAULT 0,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(project, channel, period_start, period_end)
);

CREATE INDEX IF NOT EXISTS idx_growth_channel_metrics_project ON growth_channel_metrics(project);
CREATE INDEX IF NOT EXISTS idx_growth_channel_metrics_channel ON growth_channel_metrics(channel);

CREATE TABLE IF NOT EXISTS growth_funnel_snapshots (
    id SERIAL PRIMARY KEY,
    project VARCHAR(100) NOT NULL DEFAULT 'novalogic',
    funnel_name VARCHAR(100) NOT NULL DEFAULT 'default',
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    stages JSONB NOT NULL DEFAULT '[]',
    totals JSONB DEFAULT '{}',
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(project, funnel_name, period_start, period_end)
);

CREATE INDEX IF NOT EXISTS idx_growth_funnel_snapshots_project ON growth_funnel_snapshots(project);

CREATE TABLE IF NOT EXISTS growth_landing_metrics (
    id SERIAL PRIMARY KEY,
    project VARCHAR(100) NOT NULL DEFAULT 'novalogic',
    page_slug VARCHAR(200) NOT NULL,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    sessions INTEGER DEFAULT 0,
    unique_visitors INTEGER DEFAULT 0,
    bounce_rate DECIMAL(5,2),
    avg_time_seconds INTEGER,
    conversions INTEGER DEFAULT 0,
    conversion_rate DECIMAL(6,2),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(project, page_slug, period_start, period_end)
);

CREATE INDEX IF NOT EXISTS idx_growth_landing_metrics_project ON growth_landing_metrics(project);
CREATE INDEX IF NOT EXISTS idx_growth_landing_metrics_page_slug ON growth_landing_metrics(page_slug);

CREATE TABLE IF NOT EXISTS growth_experiments (
    id SERIAL PRIMARY KEY,
    project VARCHAR(100) NOT NULL DEFAULT 'novalogic',
    experiment_name VARCHAR(200) NOT NULL,
    experiment_type VARCHAR(100) NOT NULL, -- landing, channel, lifecycle, funnel
    target_page VARCHAR(200),
    hypothesis TEXT,
    status VARCHAR(50) NOT NULL DEFAULT 'draft', -- draft, running, paused, completed, archived
    variants JSONB NOT NULL DEFAULT '[]',
    primary_metric VARCHAR(100),
    secondary_metrics JSONB DEFAULT '[]',
    results JSONB DEFAULT '{}',
    start_date DATE,
    end_date DATE,
    owner VARCHAR(200),
    notes TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(project, experiment_name)
);

CREATE INDEX IF NOT EXISTS idx_growth_experiments_project ON growth_experiments(project);
CREATE INDEX IF NOT EXISTS idx_growth_experiments_status ON growth_experiments(status);

-- ============================================
-- CONTENT & SEO AGENT
-- ============================================

CREATE TABLE IF NOT EXISTS content_pages (
    id SERIAL PRIMARY KEY,
    project VARCHAR(100) NOT NULL DEFAULT 'novalogic',
    page_slug VARCHAR(200) NOT NULL,
    page_title VARCHAR(500) NOT NULL,
    description TEXT,
    sections JSONB NOT NULL DEFAULT '[]',
    status VARCHAR(20) DEFAULT 'draft',  -- draft, review, published
    locale VARCHAR(10) DEFAULT 'es',
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(project, page_slug, locale)
);

CREATE INDEX IF NOT EXISTS idx_content_pages_project ON content_pages(project);
CREATE INDEX IF NOT EXISTS idx_content_pages_status ON content_pages(status);

CREATE TABLE IF NOT EXISTS content_copy_variants (
    id SERIAL PRIMARY KEY,
    project VARCHAR(100) NOT NULL DEFAULT 'novalogic',
    page_slug VARCHAR(200) NOT NULL,
    section VARCHAR(200) NOT NULL,
    variant_name VARCHAR(100) NOT NULL DEFAULT 'default',
    headline VARCHAR(500),
    subheadline VARCHAR(500),
    body TEXT,
    cta_text VARCHAR(200),
    cta_url VARCHAR(500),
    locale VARCHAR(10) DEFAULT 'es',
    is_active BOOLEAN DEFAULT true,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(project, page_slug, section, variant_name, locale)
);

CREATE TABLE IF NOT EXISTS content_seo_config (
    id SERIAL PRIMARY KEY,
    project VARCHAR(100) NOT NULL DEFAULT 'novalogic',
    page_slug VARCHAR(200) NOT NULL,
    meta_title VARCHAR(200),
    meta_description VARCHAR(320),
    canonical_url VARCHAR(500),
    og_title VARCHAR(200),
    og_description VARCHAR(320),
    og_image VARCHAR(500),
    keywords TEXT[] DEFAULT '{}',
    structured_data JSONB DEFAULT '{}',
    robots VARCHAR(100) DEFAULT 'index, follow',
    locale VARCHAR(10) DEFAULT 'es',
    score INTEGER DEFAULT 0,
    suggestions JSONB DEFAULT '[]',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(project, page_slug, locale)
);

CREATE INDEX IF NOT EXISTS idx_seo_config_project ON content_seo_config(project);

-- ============================================
-- SCRAPING AREA (Prospector Agent)
-- ============================================

DO $$ BEGIN
    CREATE TYPE scrape_campaign_status AS ENUM ('draft', 'active', 'paused', 'completed', 'failed');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE scrape_job_status AS ENUM ('pending', 'running', 'completed', 'failed', 'skipped');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE scrape_sync_action AS ENUM ('created', 'updated', 'skipped', 'failed');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Campaigns define what to scrape and where
CREATE TABLE IF NOT EXISTS scrape_campaigns (
    id SERIAL PRIMARY KEY,
    name VARCHAR(300) NOT NULL,
    source_id VARCHAR(100) NOT NULL,
    status scrape_campaign_status DEFAULT 'draft',
    geography JSONB NOT NULL DEFAULT '{}',
    categories TEXT[] DEFAULT '{}',
    queries TEXT[] DEFAULT '{}',
    priority INTEGER DEFAULT 0,
    max_pages INTEGER DEFAULT 5,
    scheduling JSONB DEFAULT '{"runOnce": true}',
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scrape_campaigns_source ON scrape_campaigns(source_id);
CREATE INDEX IF NOT EXISTS idx_scrape_campaigns_status ON scrape_campaigns(status);

-- Jobs track each execution unit (source+query+geo+page+window)
CREATE TABLE IF NOT EXISTS scrape_jobs (
    id SERIAL PRIMARY KEY,
    campaign_id INTEGER REFERENCES scrape_campaigns(id),
    source_id VARCHAR(100) NOT NULL,
    idempotency_key VARCHAR(1000) NOT NULL UNIQUE,
    status scrape_job_status DEFAULT 'pending',
    search_query VARCHAR(500) NOT NULL,
    country VARCHAR(100) NOT NULL,
    department VARCHAR(200) NOT NULL,
    city VARCHAR(200) NOT NULL,
    category VARCHAR(200) NOT NULL,
    cursor VARCHAR(200),
    time_window VARCHAR(50) NOT NULL,
    findings_count INTEGER DEFAULT 0,
    prospects_created INTEGER DEFAULT 0,
    prospects_merged INTEGER DEFAULT 0,
    error_message TEXT,
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scrape_jobs_campaign ON scrape_jobs(campaign_id);
CREATE INDEX IF NOT EXISTS idx_scrape_jobs_status ON scrape_jobs(status);
CREATE INDEX IF NOT EXISTS idx_scrape_jobs_source ON scrape_jobs(source_id);
CREATE INDEX IF NOT EXISTS idx_scrape_jobs_idem ON scrape_jobs(idempotency_key);

-- Raw findings straight from extraction (untouched)
CREATE TABLE IF NOT EXISTS scrape_raw_findings (
    id SERIAL PRIMARY KEY,
    job_id INTEGER REFERENCES scrape_jobs(id),
    source_id VARCHAR(100) NOT NULL,
    raw_business_name VARCHAR(500) NOT NULL,
    raw_address TEXT,
    raw_phone VARCHAR(100),
    raw_email VARCHAR(300),
    raw_website VARCHAR(500),
    raw_category VARCHAR(300),
    raw_rating DECIMAL(3,2),
    raw_review_count INTEGER,
    raw_hours TEXT,
    source_url VARCHAR(1000),
    raw_payload JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scrape_raw_findings_job ON scrape_raw_findings(job_id);
CREATE INDEX IF NOT EXISTS idx_scrape_raw_findings_source ON scrape_raw_findings(source_id);

-- Normalized prospects (canonical ProspectRecord)
CREATE TABLE IF NOT EXISTS scrape_prospects (
    id SERIAL PRIMARY KEY,
    fingerprint VARCHAR(500) NOT NULL UNIQUE,
    business_name VARCHAR(500) NOT NULL,
    business_name_normalized VARCHAR(500) NOT NULL,
    phone VARCHAR(100),
    phone_normalized VARCHAR(50),
    email VARCHAR(300),
    email_normalized VARCHAR(300),
    website VARCHAR(500),
    domain VARCHAR(300),
    address TEXT,
    country VARCHAR(100) NOT NULL,
    department VARCHAR(200) NOT NULL,
    city VARCHAR(200) NOT NULL,
    city_normalized VARCHAR(200) NOT NULL,
    category VARCHAR(200) NOT NULL,
    category_normalized VARCHAR(200) NOT NULL,
    rating DECIMAL(3,2),
    review_count INTEGER,
    hours TEXT,
    source_ids TEXT[] DEFAULT '{}',
    source_urls TEXT[] DEFAULT '{}',
    first_seen_at TIMESTAMP DEFAULT NOW(),
    last_seen_at TIMESTAMP DEFAULT NOW(),
    enrichment_version INTEGER DEFAULT 0,
    quality_score INTEGER DEFAULT 0,
    icp_match VARCHAR(20),
    commercial_signals JSONB DEFAULT '{}',
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scrape_prospects_fingerprint ON scrape_prospects(fingerprint);
CREATE INDEX IF NOT EXISTS idx_scrape_prospects_domain ON scrape_prospects(domain);
CREATE INDEX IF NOT EXISTS idx_scrape_prospects_phone ON scrape_prospects(phone_normalized);
CREATE INDEX IF NOT EXISTS idx_scrape_prospects_email ON scrape_prospects(email_normalized);
CREATE INDEX IF NOT EXISTS idx_scrape_prospects_city ON scrape_prospects(city_normalized);
CREATE INDEX IF NOT EXISTS idx_scrape_prospects_name ON scrape_prospects USING gin(business_name_normalized gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_scrape_prospects_quality ON scrape_prospects(quality_score DESC);

-- Enrichment history (incremental snapshots)
CREATE TABLE IF NOT EXISTS scrape_enrichment_snapshots (
    id SERIAL PRIMARY KEY,
    prospect_id INTEGER REFERENCES scrape_prospects(id),
    version INTEGER NOT NULL,
    enrichment_type VARCHAR(50) NOT NULL,
    data_before JSONB DEFAULT '{}',
    data_after JSONB DEFAULT '{}',
    source VARCHAR(100),
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scrape_enrichment_prospect ON scrape_enrichment_snapshots(prospect_id);

-- CRM sync ledger (tracks what was sent and when)
CREATE TABLE IF NOT EXISTS scrape_sync_ledger (
    id SERIAL PRIMARY KEY,
    prospect_id INTEGER REFERENCES scrape_prospects(id),
    crm_directory_id VARCHAR(100),
    action scrape_sync_action NOT NULL,
    sync_hash VARCHAR(256) NOT NULL,
    material_changes TEXT[] DEFAULT '{}',
    payload JSONB DEFAULT '{}',
    response_data JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scrape_sync_prospect ON scrape_sync_ledger(prospect_id);
CREATE INDEX IF NOT EXISTS idx_scrape_sync_action ON scrape_sync_ledger(action);
CREATE INDEX IF NOT EXISTS idx_scrape_sync_hash ON scrape_sync_ledger(sync_hash);

-- Observability metrics
CREATE TABLE IF NOT EXISTS scrape_metrics (
    id SERIAL PRIMARY KEY,
    source_id VARCHAR(100) NOT NULL,
    campaign_id INTEGER,
    metric_type VARCHAR(100) NOT NULL,
    value DECIMAL(12,2) DEFAULT 0,
    dimensions JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scrape_metrics_source ON scrape_metrics(source_id);
CREATE INDEX IF NOT EXISTS idx_scrape_metrics_type ON scrape_metrics(metric_type);
CREATE INDEX IF NOT EXISTS idx_scrape_metrics_created ON scrape_metrics(created_at DESC);

-- ============================================================
-- WORK SESSIONS (Session Manager Agent)
-- ============================================================

DO $$ BEGIN
    CREATE TYPE session_status AS ENUM ('active', 'paused', 'completed');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS work_sessions (
    id SERIAL PRIMARY KEY,
    slug VARCHAR(200) NOT NULL UNIQUE,        -- e.g. "vink-2026-04-18-ecommerce"
    tenant VARCHAR(100),                       -- novalogic | vink | simora | null for cross-tenant
    title VARCHAR(500) NOT NULL,
    focus TEXT,                                -- short description of current focus
    status session_status DEFAULT 'active',
    context TEXT,                              -- free-form running context / notes
    pending_items JSONB DEFAULT '[]',          -- [{id, title, priority?, done}]
    completed_items JSONB DEFAULT '[]',        -- items moved here when done
    prior_session_slug VARCHAR(200),
    tags TEXT[] DEFAULT '{}',
    metadata JSONB DEFAULT '{}',
    started_at TIMESTAMP DEFAULT NOW(),
    paused_at TIMESTAMP,
    completed_at TIMESTAMP,
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_work_sessions_tenant ON work_sessions(tenant);
CREATE INDEX IF NOT EXISTS idx_work_sessions_status ON work_sessions(status);
CREATE INDEX IF NOT EXISTS idx_work_sessions_updated ON work_sessions(updated_at DESC);

-- Vector indexes (created after initial data exists for better performance)
-- These will be created when enough data is present:
-- CREATE INDEX idx_memories_embedding ON memories USING ivfflat (embedding vector_cosine_ops) WITH (lists = 50);
-- CREATE INDEX idx_context_embedding ON context_snapshots USING ivfflat (embedding vector_cosine_ops) WITH (lists = 50);

-- ============================================================================
-- Graphs (knowledge graphs, topologies, trees)
-- ============================================================================
CREATE TABLE IF NOT EXISTS graphs (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL UNIQUE,
    type VARCHAR(32) NOT NULL DEFAULT 'knowledge',
    description TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS graph_nodes (
    id SERIAL PRIMARY KEY,
    graph_id INTEGER NOT NULL REFERENCES graphs(id) ON DELETE CASCADE,
    key VARCHAR(500) NOT NULL,
    name VARCHAR(500),
    type VARCHAR(64),
    properties JSONB DEFAULT '{}',
    parent_key VARCHAR(500),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (graph_id, key)
);

CREATE INDEX IF NOT EXISTS idx_graph_nodes_parent
    ON graph_nodes (graph_id, parent_key);
CREATE INDEX IF NOT EXISTS idx_graph_nodes_type
    ON graph_nodes (graph_id, type);

CREATE TABLE IF NOT EXISTS graph_edges (
    id SERIAL PRIMARY KEY,
    graph_id INTEGER NOT NULL REFERENCES graphs(id) ON DELETE CASCADE,
    from_key VARCHAR(500) NOT NULL,
    to_key VARCHAR(500) NOT NULL,
    rel_type VARCHAR(64) NOT NULL DEFAULT 'relates_to',
    properties JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (graph_id, from_key, to_key, rel_type)
);

CREATE INDEX IF NOT EXISTS idx_graph_edges_from
    ON graph_edges (graph_id, from_key, rel_type);
CREATE INDEX IF NOT EXISTS idx_graph_edges_to
    ON graph_edges (graph_id, to_key, rel_type);
