-- Read-only audit. No comment, user, credential, grant, or policy is changed.
-- Run as the project owner in SQL Editor. Every row should be passed = true.
begin read only;
set local statement_timeout = '5s';
set local lock_timeout = '1s';

with
expected_tables(name) as (
    values ('gallery_comments'), ('gallery_comment_authors'), ('gallery_comment_images')
),
tables as (
    select e.name, c.oid, c.relrowsecurity
    from expected_tables e
    left join pg_catalog.pg_namespace n on n.nspname = 'public'
    left join pg_catalog.pg_class c on c.relnamespace = n.oid and c.relname = e.name
),
roles(name) as (values ('anon'), ('authenticated')),
posting_function as (
    select p.* from pg_catalog.pg_proc p
    where p.oid = pg_catalog.to_regprocedure('public.post_gallery_comment(integer,text)')
),
checks(check_name, passed) as (
    select 'RLS: ' || name, coalesce(relrowsecurity, false) from tables
    union all
    select 'No direct writes: ' || r.name || '/' || t.name,
        t.oid is not null
        and not coalesce(has_table_privilege(r.name, t.oid, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'), true)
        and not coalesce(has_any_column_privilege(r.name, t.oid, 'INSERT,UPDATE,REFERENCES'), true)
    from roles r cross join tables t
    union all
    select 'Public columns only: ' || r.name,
        count(a.attnum) = 7 and bool_and(
            has_column_privilege(r.name, t.oid, a.attnum, 'SELECT') =
            (a.attname = any(array['id','image_id','author_label','body','created_at']))
        )
    from roles r cross join tables t
    left join pg_catalog.pg_attribute a on a.attrelid = t.oid and a.attnum > 0 and not a.attisdropped
    where t.name = 'gallery_comments' group by r.name
    union all
    select 'Private table unreadable: ' || r.name || '/' || t.name,
        t.oid is not null and not coalesce(has_any_column_privilege(r.name, t.oid, 'SELECT'), true)
    from roles r cross join tables t where t.name <> 'gallery_comments'
    union all
    select 'Only the visible-comments policy exists',
        count(*) = 1 and bool_and(
            tablename = 'gallery_comments' and cmd = 'SELECT' and permissive = 'PERMISSIVE'
            and roles @> array['anon','authenticated']::name[]
            and qual = '(is_hidden = false)' and with_check is null
        )
    from pg_catalog.pg_policies
    where schemaname = 'public' and tablename in (select name from expected_tables)
    union all
    select 'Posting function matches reviewed implementation',
        -- Ignore comments and whitespace differences introduced by pasting.
        coalesce((select md5(regexp_replace(regexp_replace(prosrc,
            '--[^' || chr(10) || ']*', '', 'g'), '[[:space:]]+', '', 'g'))
            = '0a9b5cd07460ade2fc63f91bb707701e' from posting_function), false)
    union all
    select 'Posting function uses definer and empty search_path',
        coalesce((select prosecdef and 'search_path=""' = any(proconfig) from posting_function), false)
    union all
    select 'Posting function requires authentication',
        coalesce((select not has_function_privilege('anon', oid, 'EXECUTE')
            and has_function_privilege('authenticated', oid, 'EXECUTE') from posting_function), false)
    union all
    select 'No extra application triggers on gallery tables', count(*) = 0
    from pg_catalog.pg_trigger
    where tgrelid in (select oid from tables) and not tgisinternal
    union all
    select 'Auto-RLS event trigger is not directly exposed', not exists (
        select 1 from pg_catalog.pg_proc
        where oid = pg_catalog.to_regprocedure('public.rls_auto_enable()')
          and (has_function_privilege('anon', oid, 'EXECUTE')
            or has_function_privilege('authenticated', oid, 'EXECUTE'))
    )
)
select check_name, coalesce(passed, false) as passed from checks order by check_name;

rollback;
