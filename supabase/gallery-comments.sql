-- Run once in the Supabase SQL Editor, as the project owner.
-- The browser only receives public comment columns and permission to call the RPC.
begin;

create table public.gallery_comment_images (
    id integer primary key,
    title text not null
);

insert into public.gallery_comment_images (id, title) values
    (1, 'ぞう'), (2, 'こねこ'), (3, 'プリンとUFOの類似性'), (4, 'さかな'),
    (5, 'たてあなしきじゅうきょ'), (6, 'かめ'), (7, 'ねこ'), (8, 'わに'),
    (9, 'いか'), (10, 'ひらめ'), (11, 'ひと'), (12, 'でんきくらげ'),
    (13, 'ひとで'), (14, 'MEGAひとで'), (15, 'へび'), (16, 'すぷーとにくん'),
    (17, 'みかん'), (18, 'サイクスピコピコハンマー中東分割案'), (19, 'ばなな'),
    (20, 'ばなな(本気)'), (21, 'ぎょらい'), (22, 'イラレで描いた謎ウサギ'),
    (23, 'アフリカ'), (24, 'ぞうさん'), (25, 'えい'), (26, 'ばりう'),
    (27, 'れたす'), (28, 'ペットボトル'), (29, 'らーめんまん');

-- Only dashboard administrators can read or modify this table.
create table public.gallery_comment_authors (
    user_id uuid primary key references auth.users(id) on delete cascade,
    author_label text not null unique default ('匿名-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
    is_banned boolean not null default false,
    last_posted_at timestamptz,
    created_at timestamptz not null default now()
);

create table public.gallery_comments (
    id uuid primary key default gen_random_uuid(),
    image_id integer not null references public.gallery_comment_images(id),
    user_id uuid references auth.users(id) on delete set null,
    author_label text not null,
    body text not null check (char_length(body) between 1 and 500 and body ~ '[^[:space:]]'),
    is_hidden boolean not null default false,
    created_at timestamptz not null default now()
);

create index gallery_comments_visible_image_date
    on public.gallery_comments(image_id, created_at desc, id desc) where is_hidden = false;

alter table public.gallery_comment_images enable row level security;
alter table public.gallery_comment_authors enable row level security;
alter table public.gallery_comments enable row level security;

revoke all on public.gallery_comment_images from public, anon, authenticated;
revoke all on public.gallery_comment_authors from public, anon, authenticated;
revoke all on public.gallery_comments from public, anon, authenticated;
grant select (id, image_id, author_label, body, created_at)
    on public.gallery_comments to anon, authenticated;

create policy "Read visible gallery comments"
    on public.gallery_comments for select to anon, authenticated
    using (is_hidden = false);

-- No browser INSERT/UPDATE/DELETE policies or grants. Server-side validation
-- cannot be bypassed by calling the REST API directly.
create function public.post_gallery_comment(p_image_id integer, p_body text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := auth.uid();
    v_author public.gallery_comment_authors%rowtype;
    v_body text := btrim(p_body, E' \t\r\n');
    v_now timestamptz;
begin
    if v_user_id is null or (auth.jwt()->>'is_anonymous')::boolean is not true then
        raise exception using errcode = '42501', message = 'GALLERY_AUTH_REQUIRED';
    end if;
    if v_body is null or char_length(v_body) not between 1 and 500 or v_body !~ '[^[:space:]]' then
        raise exception using errcode = '22023', message = 'GALLERY_INVALID_BODY';
    end if;
    if not exists (select 1 from public.gallery_comment_images where id = p_image_id) then
        raise exception using errcode = '22023', message = 'GALLERY_INVALID_IMAGE';
    end if;

    insert into public.gallery_comment_authors (user_id) values (v_user_id)
        on conflict (user_id) do nothing;
    -- Lock the author across all images, so concurrent requests cannot defeat
    -- the interval check. Deleted/hidden comments do not reset the interval.
    select * into strict v_author from public.gallery_comment_authors
        where user_id = v_user_id for update;
    v_now := clock_timestamp();
    if v_author.is_banned then
        raise exception using errcode = '42501', message = 'GALLERY_BLOCKED';
    end if;
    if v_author.last_posted_at > v_now - interval '60 seconds' then
        raise exception using errcode = 'P0001', message = 'GALLERY_RATE_LIMIT';
    end if;

    insert into public.gallery_comments (image_id, user_id, author_label, body, created_at)
        values (p_image_id, v_user_id, v_author.author_label, v_body, v_now);
    update public.gallery_comment_authors set last_posted_at = v_now where user_id = v_user_id;
end;
$$;

revoke all on function public.post_gallery_comment(integer, text) from public, anon, authenticated;
grant execute on function public.post_gallery_comment(integer, text) to authenticated;

commit;
