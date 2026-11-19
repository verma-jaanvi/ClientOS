-- Optional hardening (Part 7, step 3): make approvals and audit_log append-only
-- at the database level. Run once in the Supabase SQL editor AFTER the first migration.
create or replace function forbid_change() returns trigger as $$
begin
  raise exception '% is append-only', tg_table_name;
end;
$$ language plpgsql;

drop trigger if exists approvals_append_only on approvals;
create trigger approvals_append_only before update or delete on approvals
  for each row execute function forbid_change();

drop trigger if exists audit_log_append_only on audit_log;
create trigger audit_log_append_only before update or delete on audit_log
  for each row execute function forbid_change();
