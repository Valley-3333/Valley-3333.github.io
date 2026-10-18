-- Optional Supabase platform hardening. No data, trigger or function is removed.
-- The auto-RLS function runs as an event trigger; clients do not call it.
begin;
do $$
begin
    if exists (
        select 1 from pg_catalog.pg_proc
        where oid = pg_catalog.to_regprocedure('public.rls_auto_enable()')
          and prorettype = 'pg_catalog.event_trigger'::regtype
    ) then
        revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
    end if;
end;
$$;
commit;
