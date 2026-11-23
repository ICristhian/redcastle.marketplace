-- Post-deployment review: simplify product SELECT policies and index references.
drop policy if exists "Visible active products" on public.products;
drop policy if exists "Admins see all products" on public.products;
create policy "Visible products or administrator" on public.products
for select to anon,authenticated
using (active or (select private.is_admin()));
create index if not exists idx_reservation_items_product
on public.reservation_items(product_id);
