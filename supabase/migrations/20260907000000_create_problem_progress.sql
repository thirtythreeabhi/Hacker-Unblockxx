create table if not exists public.problem_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  problem_id text not null,
  content_id text,
  bookmarked boolean not null default false,
  completed boolean not null default false,
  notes text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, problem_id)
);

alter table public.problem_progress enable row level security;

grant select, insert, update, delete on public.problem_progress to authenticated;

drop policy if exists "Users can view their own progress" on public.problem_progress;
create policy "Users can view their own progress"
  on public.problem_progress for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert their own progress" on public.problem_progress;
create policy "Users can insert their own progress"
  on public.problem_progress for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own progress" on public.problem_progress;
create policy "Users can update their own progress"
  on public.problem_progress for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their own progress" on public.problem_progress;
create policy "Users can delete their own progress"
  on public.problem_progress for delete
  to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.set_problem_progress_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_problem_progress_updated_at on public.problem_progress;
create trigger set_problem_progress_updated_at
before update on public.problem_progress
for each row execute function public.set_problem_progress_updated_at();
