-- Secure image visibility for inactive products without exposing private product records to anon.
create or replace function private.product_is_public(p_id uuid)
returns boolean language sql stable security definer set search_path=''
as $body$
  select exists(select 1 from public.products where id=p_id and active=true);
$body$;
revoke all on function private.product_is_public(uuid) from public;
grant execute on function private.product_is_public(uuid) to anon,authenticated;

drop policy if exists "Public images of active products" on public.product_images;
create policy "Public images of active products" on public.product_images
for select to anon using ((select private.product_is_public(product_id)));

drop policy if exists "Authenticated product image visibility" on public.product_images;
create policy "Authenticated product image visibility" on public.product_images
for select to authenticated
using (private.product_is_public(product_id) or (select private.is_admin()));
