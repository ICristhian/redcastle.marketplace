-- Redcastle Marketplace: public product imagery + admin-maintained contact.
-- Intended for redcastle-marketplace-dev; secure API/RLS on every exposed table.

create table public.site_settings (
  singleton boolean primary key default true check (singleton),
  whatsapp_number text not null check (whatsapp_number ~ '^[0-9]{8,15}$'),
  updated_at timestamptz not null default now()
);
-- Initial contact row is configured by administrators, never stored in public source control.

create table public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  storage_path text not null unique
    check (storage_path ~ '^[a-f0-9-]{36}/[a-f0-9-]{36}\.(jpg|jpeg|png|webp)$'
      and split_part(storage_path,'/',1)=product_id::text),
  alt_text text not null default '' check (char_length(alt_text)<=180),
  sort_order integer not null default 0 check (sort_order between 0 and 9999),
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);
create index idx_product_images_order on public.product_images(product_id,sort_order,created_at);
create unique index idx_product_images_one_primary
  on public.product_images(product_id) where is_primary=true;

alter table public.site_settings enable row level security;
alter table public.product_images enable row level security;

create policy "Public contact number" on public.site_settings
  for select to anon,authenticated using (true);
create policy "Administrator contact settings" on public.site_settings
  for update to authenticated using ((select private.is_admin()))
  with check ((select private.is_admin()));

create policy "Public images of active products" on public.product_images
  for select to anon using
  (exists (select 1 from public.products p where p.id=product_id and p.active));
create policy "Authenticated product image visibility" on public.product_images
  for select to authenticated using
  (exists (select 1 from public.products p where p.id=product_id
             and (p.active or (select private.is_admin()))));
create policy "Admin upload metadata" on public.product_images
  for insert to authenticated with check ((select private.is_admin()));
create policy "Admin update metadata" on public.product_images
  for update to authenticated using ((select private.is_admin()))
  with check ((select private.is_admin()));
create policy "Admin delete metadata" on public.product_images
  for delete to authenticated using ((select private.is_admin()));

revoke all on public.site_settings,public.product_images from anon,authenticated;
grant select on public.site_settings,public.product_images to anon,authenticated;
grant update (whatsapp_number,updated_at) on public.site_settings to authenticated;
grant insert,update,delete on public.product_images to authenticated;

-- Maximum 8 images per product, including concurrent admin operations.
create or replace function private.limit_product_images()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.product_id::text,148));
  if (select count(*) from public.product_images where product_id=new.product_id)>=8 then
     raise exception 'IMAGE_LIMIT_REACHED';
  end if;
  return new;
end;
$$;
create trigger redcastle_image_limit before insert on public.product_images
for each row execute function private.limit_product_images();
revoke all on function private.limit_product_images() from public,anon,authenticated;

-- Store originals in a public read-only bucket, limited to raster formats.
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('product-images','product-images',true,3145728,
  array['image/jpeg','image/png','image/webp']::text[]);

-- Storage APIs enforce bucket-level file size and MIME restrictions.
create policy "Admins list product image objects" on storage.objects
for select to authenticated using
 (bucket_id='product-images' and (select private.is_admin()));
create policy "Admins upload product image objects" on storage.objects
for insert to authenticated with check (
  bucket_id='product-images'
  and (select private.is_admin())
  and name ~ '^[a-f0-9-]{36}/[a-f0-9-]{36}\.(jpg|jpeg|png|webp)$'
);
create policy "Admins remove product image objects" on storage.objects
for delete to authenticated using
 (bucket_id='product-images' and (select private.is_admin()));

create or replace function private.set_primary_product_image(p_product_id uuid,p_image_id uuid)
returns void language plpgsql security definer set search_path=''
as $$
begin
  if not private.is_admin() then raise exception 'FORBIDDEN'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_product_id::text,149));
  if not exists (
      select 1 from public.product_images
      where id=p_image_id and product_id=p_product_id
    ) then raise exception 'IMAGE_NOT_FOUND'; end if;
  update public.product_images set is_primary=false
    where product_id=p_product_id and is_primary=true;
  update public.product_images set is_primary=true
    where id=p_image_id and product_id=p_product_id;
end;
$$;
revoke all on function private.set_primary_product_image(uuid,uuid) from public,anon,authenticated;
grant execute on function private.set_primary_product_image(uuid,uuid) to authenticated;
create or replace function public.set_primary_product_image(p_product_id uuid,p_image_id uuid)
returns void language sql security invoker set search_path=''
as $$
  select private.set_primary_product_image(p_product_id,p_image_id);
$$;
revoke all on function public.set_primary_product_image(uuid,uuid) from public,anon;
grant execute on function public.set_primary_product_image(uuid,uuid) to authenticated;
