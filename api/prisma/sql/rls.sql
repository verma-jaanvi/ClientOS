-- Optional hardening (Part 7): turn on row-level security as a second safety net.
-- The API connects with the table owner/service role, which bypasses RLS, so this
-- protects against anyone reaching the tables through Supabase's public API keys.
-- With RLS enabled and no policies, the anon/authenticated roles can read nothing.
do $$
declare t text;
begin
  for t in select unnest(array[
    'workspaces','users','invites','clients','contacts','projects','milestones',
    'deliverables','deliverable_versions','progress_updates','approvals','requests',
    'magic_links','audit_log','email_failures'])
  loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;
