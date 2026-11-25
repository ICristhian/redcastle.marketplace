-- Keep anonymous access separate from administrator role checks.
drop policy if exists "Visible active products" on public.products;
drop policy if exists "Admins see all products" on public.products;
drop policy if exists "Visible products or administrator" on public.products;
create policy "Anonymous catalog" on public.products
for select to anon using (active);
create policy "Authenticated catalog and admins" on public.products
for select to authenticated using (active or (select private.is_admin()));
create index if not exists idx_reservation_items_product
on public.reservation_items(product_id);
