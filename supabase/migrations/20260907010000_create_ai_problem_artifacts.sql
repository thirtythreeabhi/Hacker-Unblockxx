create table if not exists public.ai_problem_artifacts (
  id uuid primary key default gen_random_uuid(),
  problem_id text not null,
  content_id text,
  artifact_type text not null check (artifact_type in ('cleaned_question', 'boilerplate', 'approaches', 'generated_tests', 'hint_ladder', 'complexity_target', 'simple_explanation')),
  language text,
  language_key text generated always as (coalesce(language, '')) stored,
  source_hash text not null,
  payload jsonb not null,
  model text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ai_problem_artifacts_identity_idx
  on public.ai_problem_artifacts (problem_id, artifact_type, language_key, source_hash);

create index if not exists ai_problem_artifacts_problem_idx
  on public.ai_problem_artifacts (problem_id, artifact_type);

alter table public.ai_problem_artifacts enable row level security;
grant select on public.ai_problem_artifacts to authenticated;

drop policy if exists "Authenticated users can read shared AI artifacts" on public.ai_problem_artifacts;
create policy "Authenticated users can read shared AI artifacts"
  on public.ai_problem_artifacts for select
  to authenticated
  using (true);

create or replace function public.set_ai_problem_artifacts_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_ai_problem_artifacts_updated_at on public.ai_problem_artifacts;
create trigger set_ai_problem_artifacts_updated_at
before update on public.ai_problem_artifacts
for each row execute function public.set_ai_problem_artifacts_updated_at();
