-- Two fixes to os_releases found while writing the import job. The table is empty when
-- this runs, so replacing constraints is safe.
--
-- 1. Uniqueness treated NULL as "always different", so re-running the import would insert
--    duplicate rows for final releases (which have no pre-release number). Use NULLS NOT
--    DISTINCT (PostgreSQL 15+) so a re-run updates the existing row instead.
-- 2. The check required a pre-release number for every beta/RC, but Apple often ships a
--    single unnumbered "RC". Only final releases must have no number.

do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.os_releases'::regclass and contype in ('u', 'c')
  loop
    execute format('alter table public.os_releases drop constraint %I', c.conname);
  end loop;
end $$;

alter table os_releases
  add constraint os_releases_identity_key
  unique nulls not distinct (major_version_id, version, build, kind, pre_release_number);

alter table os_releases
  add constraint os_releases_number_check
  check (kind <> 'release' or pre_release_number is null);
