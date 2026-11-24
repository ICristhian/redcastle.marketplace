-- Keep product image positions gapless after removals and auto-assign on inserts.
create or replace function private.limit_product_images()
returns trigger language plpgsql security definer set search_path=''
as $$
declare n integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.product_id::text,148)
  );
  select count(*) into n from public.product_images
   where product_id=new.product_id;
  if n>=8 then raise exception 'IMAGE_LIMIT_REACHED'; end if;
  new.sort_order:=n;
  if n=0 then
    new.is_primary:=true;
  end if;
  return new;
end;
$$;

create or replace function private.normalize_product_images_after_delete()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(old.product_id::text,148)
  );
  with numbered as (
    select id,(row_number() over (
      order by sort_order,created_at,id
    )-1)::integer as new_position
    from public.product_images where product_id=old.product_id
  )
  update public.product_images img
  set sort_order=numbered.new_position
  from numbered where img.id=numbered.id
    and img.sort_order is distinct from numbered.new_position;
  if not exists(
    select 1 from public.product_images
     where product_id=old.product_id and is_primary=true
  ) then
    update public.product_images set is_primary=true
    where id=(
      select id from public.product_images
      where product_id=old.product_id
      order by sort_order,created_at,id limit 1
    );
  end if;
  return old;
end;
$$;
drop trigger if exists redcastle_normalize_images_after_delete on public.product_images;
create trigger redcastle_normalize_images_after_delete
after delete on public.product_images
for each row execute function private.normalize_product_images_after_delete();

revoke all on function private.normalize_product_images_after_delete()
from public,anon,authenticated;
