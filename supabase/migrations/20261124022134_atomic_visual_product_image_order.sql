-- Visual ordering is the sole authority for image position.
-- Normalize historical orders before enforcing one position per product.
with numbered as (
  select id, (row_number() over (
    partition by product_id order by sort_order,created_at,id
  ) - 1)::integer as new_order
  from public.product_images
)
update public.product_images as img
set sort_order=numbered.new_order
from numbered
where img.id=numbered.id and img.sort_order is distinct from numbered.new_order;

alter table public.product_images
  add constraint product_images_unique_position
  unique(product_id,sort_order) deferrable initially deferred;

-- The frontend must not choose a numeric position by issuing direct UPDATEs.
-- Alternative operations (text and image replacements) remain available to admins.
revoke update on public.product_images from authenticated;
grant update (alt_text,storage_path) on public.product_images to authenticated;

create or replace function private.reorder_product_images(
  p_product_id uuid, p_image_ids uuid[]
) returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  existing_count integer;
  supplied_count integer;
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception 'FORBIDDEN';
  end if;
  if p_product_id is null or p_image_ids is null then
    raise exception 'INVALID_IMAGE_ORDER';
  end if;
  -- Serialize reorders with the image limit trigger used by uploads.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_product_id::text,148)
  );
  select count(*) into existing_count
  from public.product_images where product_id=p_product_id;
  supplied_count:=pg_catalog.cardinality(p_image_ids);
  if supplied_count<>existing_count or supplied_count>8
     or supplied_count<>(
       select count(distinct u.image_id)
       from pg_catalog.unnest(p_image_ids) as u(image_id)
     )
     or exists(
       select 1
       from pg_catalog.unnest(p_image_ids) as u(image_id)
       left join public.product_images as img
         on img.id=u.image_id and img.product_id=p_product_id
       where img.id is null
     )
  then
    raise exception 'INVALID_IMAGE_ORDER';
  end if;
  update public.product_images as img
  set sort_order=(ordered.ordinality-1)::integer
  from pg_catalog.unnest(p_image_ids) with ordinality
    as ordered(image_id,ordinality)
  where img.id=ordered.image_id and img.product_id=p_product_id;
end;
$$;

revoke all on function private.reorder_product_images(uuid,uuid[])
  from public,anon,authenticated;
grant execute on function private.reorder_product_images(uuid,uuid[])
  to authenticated;

create or replace function public.reorder_product_images(
  p_product_id uuid,p_image_ids uuid[]
) returns void language sql security invoker set search_path=''
as $$
  select private.reorder_product_images(p_product_id,p_image_ids);
$$;
revoke all on function public.reorder_product_images(uuid,uuid[])
  from public,anon,authenticated;
grant execute on function public.reorder_product_images(uuid,uuid[])
  to authenticated;
