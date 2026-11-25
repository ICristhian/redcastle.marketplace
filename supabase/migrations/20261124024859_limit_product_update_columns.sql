-- Product UUIDs are immutable internal identifiers referenced by cart, stock, images and reservations.
-- Commercial SKU is editable by administrators; UUID/created_at are not browser-updatable.
revoke update on public.products from authenticated;
grant update (sku,name,description,category,price,active,updated_at) on public.products to authenticated;

