create table if not exists scope_objects (
    scope_type text not null,
    scope_id text not null,
    tenant_id text not null,
    parent_scope_type text null,
    parent_scope_id text null,
    root_scope_type text null,
    root_scope_id text null,
    scope_level int null,
    scope_kind text null,
    metadata jsonb default '{}'::jsonb,
    created_at timestamptz default now(),
    primary key (tenant_id, scope_type, scope_id)
);

create table if not exists memory_records (
    memory_id text primary key,
    tenant_id text not null,
    memory_type text not null,
    primary_scope_type text not null,
    primary_scope_id text not null,
    content_text text not null,
    content_json jsonb default '{}'::jsonb,
    source_type text not null,
    source_id text null,
    confidence numeric(5,4) null,
    created_by text null,
    created_at timestamptz default now(),
    expires_at timestamptz null
);

create table if not exists memory_scope_links (
    memory_id text not null,
    tenant_id text not null,
    scope_type text not null,
    scope_id text not null,
    link_role text default 'related',
    created_at timestamptz default now(),
    primary key (memory_id, tenant_id, scope_type, scope_id),
    foreign key (memory_id) references memory_records(memory_id)
);

create table if not exists memory_summaries (
    summary_id text primary key,
    tenant_id text not null,
    scope_type text not null,
    scope_id text not null,
    summary_type text not null,
    summary_text text not null,
    source_window jsonb default '{}'::jsonb,
    created_at timestamptz default now()
);

create index if not exists idx_memory_records_scope
on memory_records (tenant_id, primary_scope_type, primary_scope_id, memory_type, created_at desc);

create index if not exists idx_memory_scope_links_scope
on memory_scope_links (tenant_id, scope_type, scope_id);

create index if not exists idx_memory_summaries_scope
on memory_summaries (tenant_id, scope_type, scope_id, created_at desc);