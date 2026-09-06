create extension if not exists vector with schema extensions;

create table if not exists public.problem_search (
  problem_id text primary key,
  content_id text not null,
  contest_id text not null,
  name text not null,
  difficulty integer check (difficulty is null or difficulty between 1 and 3),
  description text,
  constraints text,
  input_format text,
  output_format text,
  topics text[] not null default '{}',
  primary_topics text[] not null default '{}',
  domain text,
  source_hash text not null,
  embedding extensions.vector(768),
  embedding_model text,
  embedded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists problem_search_embedding_hnsw_idx
  on public.problem_search using hnsw (embedding extensions.vector_cosine_ops)
  with (m = 16, ef_construction = 64);

alter table public.problem_search enable row level security;
grant select on public.problem_search to anon, authenticated;

drop policy if exists "Anyone can read problem search records" on public.problem_search;
create policy "Anyone can read problem search records"
  on public.problem_search for select
  to anon, authenticated
  using (true);

create or replace function public.set_problem_search_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_problem_search_updated_at on public.problem_search;
create trigger set_problem_search_updated_at
before update on public.problem_search
for each row execute function public.set_problem_search_updated_at();

create or replace function public.match_problems(
  query_embedding extensions.vector(768),
  match_count integer default 20,
  min_similarity real default 0,
  filter_domain text default null,
  filter_difficulty integer default null
)
returns table (
  problem_id text,
  name text,
  difficulty integer,
  topics text[],
  domain text,
  similarity real
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  select
    ps.problem_id,
    ps.name,
    ps.difficulty,
    ps.topics,
    ps.domain,
    (1 - (ps.embedding <=> query_embedding))::real as similarity
  from public.problem_search ps
  where ps.embedding is not null
    and (filter_domain is null or ps.domain = filter_domain)
    and (filter_difficulty is null or ps.difficulty = filter_difficulty)
    and (1 - (ps.embedding <=> query_embedding)) >= min_similarity
  order by ps.embedding <=> query_embedding
  limit least(greatest(match_count, 1), 100);
$$;

grant execute on function public.match_problems(extensions.vector(768), integer, real, text, integer) to anon, authenticated;
