-- Redcastle Marketplace | schema inicial para portal de reservas
-- Revisar y ejecutar una sola vez en Supabase SQL Editor (proyecto de desarrollo).
-- No ejecutar como migración automática de producción sin revisión.

create extension if not exists pgcrypto;
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to anon,authenticated; -- Functions remain outside exposed API schemas.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  role text not null default 'customer' check (role in ('customer','admin')),
  created_at timestamptz not null default now()
);
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique check (char_length(sku) between 2 and 64),
  name text not null check (char_length(name) between 2 and 160),
  description text not null default '',
  category text not null default 'General' check (char_length(category) between 2 and 80),
  price numeric(12,2) not null check (price >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.inventory (
  product_id uuid primary key references public.products(id) on delete restrict,
  on_hand integer not null default 0 check (on_hand >= 0),
  reserved integer not null default 0 check (reserved >= 0 and reserved <= on_hand),
  updated_at timestamptz not null default now()
);
create table if not exists public.cart_items (
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  quantity integer not null check (quantity between 1 and 10),
  updated_at timestamptz not null default now(),
  primary key (user_id, product_id)
);
create table if not exists public.reservations (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default upper(substr(replace(gen_random_uuid()::text,'-',''),1,12)),
  user_id uuid not null references auth.users(id) on delete restrict,
  status text not null default 'pending_contact'
    check (status in ('pending_contact','confirmed','cancelled','expired','fulfilled')),
  total numeric(12,2) not null default 0 check (total >= 0),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.reservation_items (
  id bigint generated always as identity primary key,
  reservation_id uuid not null references public.reservations(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  product_name text not null,
  unit_price numeric(12,2) not null check (unit_price >= 0),
  quantity integer not null check (quantity between 1 and 10),
  unique (reservation_id,product_id)
);
create index if not exists idx_reservations_user on public.reservations(user_id,created_at desc);
create index if not exists idx_reservations_status on public.reservations(status,expires_at);
create index if not exists idx_reservation_items_reservation on public.reservation_items(reservation_id);
create index if not exists idx_cart_items_product on public.cart_items(product_id);

-- Perfiles aprovisionados en el servidor; NUNCA desde el frontend.
create or replace function private.create_customer_profile()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles(id,email,display_name,role)
  values (
    new.id,
    new.email,
    left(coalesce(new.raw_user_meta_data->>'full_name',
                  new.raw_user_meta_data->>'name', 'Cliente'),120),
    'customer'
  ) on conflict (id) do nothing;
  return new;
end;
$$;
drop trigger if exists on_redcastle_user_created on auth.users;
create trigger on_redcastle_user_created
after insert on auth.users for each row execute function private.create_customer_profile();

-- Inserta inventario 0 al crear producto.
create or replace function private.create_product_inventory()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.inventory(product_id) values(new.id);
  return new;
end;
$$;
drop trigger if exists on_redcastle_product_created on public.products;
create trigger on_redcastle_product_created
after insert on public.products for each row execute function private.create_product_inventory();

-- Privilegios admin almacenados en Postgres, nunca en metadatos editables por usuarios.
create or replace function private.is_admin()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists(select 1 from public.profiles p
                where p.id=(select auth.uid()) and p.role='admin');
$$;
revoke all on function private.is_admin() from public,anon;
grant execute on function private.is_admin() to authenticated;

alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.inventory enable row level security;
alter table public.cart_items enable row level security;
alter table public.reservations enable row level security;
alter table public.reservation_items enable row level security;

create policy "Own profile or admin" on public.profiles
for select to authenticated using (id=(select auth.uid()) or (select private.is_admin()));
-- No hay políticas de INSERT/UPDATE/DELETE sobre profiles para usuarios.

create policy "Visible active products" on public.products
for select to anon,authenticated using (active);
create policy "Admins see all products" on public.products
for select to authenticated using ((select private.is_admin()));
create policy "Admins create products" on public.products
for insert to authenticated with check ((select private.is_admin()));
create policy "Admins edit products" on public.products
for update to authenticated using ((select private.is_admin()))
with check ((select private.is_admin()));
-- Sin DELETE: conservar referencias históricas; desactivar en lugar de borrar.

create policy "Admins see inventory" on public.inventory
for select to authenticated using ((select private.is_admin()));
create policy "Admins edit inventory" on public.inventory
for update to authenticated using ((select private.is_admin()))
with check ((select private.is_admin()));
-- Sin INSERT/DELETE: gestionado por trigger.

create policy "Own cart read" on public.cart_items
for select to authenticated using (user_id=(select auth.uid()));
create policy "Own cart insert" on public.cart_items
for insert to authenticated with check (user_id=(select auth.uid()));
create policy "Own cart edit" on public.cart_items
for update to authenticated using (user_id=(select auth.uid()))
with check (user_id=(select auth.uid()));
create policy "Own cart delete" on public.cart_items
for delete to authenticated using (user_id=(select auth.uid()));

create policy "Own reservations or admin" on public.reservations
for select to authenticated using (user_id=(select auth.uid()) or (select private.is_admin()));
create policy "Own reservation items or admin" on public.reservation_items
for select to authenticated using (
  exists (select 1 from public.reservations r where r.id=reservation_id
          and (r.user_id=(select auth.uid()) or (select private.is_admin())))
);
-- Ninguna escritura directa en reservas; usar RPCs transaccionales.

-- Catálogo público: muestra solo stock disponible, nunca tablas privadas completas.
create or replace function private.get_catalog()
returns table(id uuid,sku text,name text,description text,category text,
              price numeric,available integer)
language sql stable security definer set search_path = ''
as $$
  select p.id,p.sku,p.name,p.description,p.category,p.price,
         greatest(i.on_hand-i.reserved,0)::integer
  from public.products p join public.inventory i on i.product_id=p.id
  where p.active=true order by p.name;
$$;
revoke all on function private.get_catalog() from public, anon, authenticated;
grant execute on function private.get_catalog() to anon,authenticated;
create or replace function public.get_catalog()
returns table(id uuid,sku text,name text,description text,category text,price numeric,available integer)
language sql stable security invoker set search_path = ''
as $
  select * from private.get_catalog();
$;
revoke all on function public.get_catalog() from public;
grant execute on function public.get_catalog() to anon,authenticated;

-- Limpieza transaccional de reservas vencidas, antes de nuevas solicitudes.
create or replace function private.release_expired()
returns void language plpgsql security definer set search_path = ''
as $$
declare old_res record; item record;
begin
  for old_res in
    select id from public.reservations
    where status='pending_contact' and expires_at <= now()
    order by created_at
    limit 100 for update skip locked
  loop
    for item in
      select product_id,quantity from public.reservation_items
      where reservation_id=old_res.id order by product_id
    loop
      update public.inventory set reserved=reserved-item.quantity,updated_at=now()
      where product_id=item.product_id;
    end loop;
    update public.reservations set status='expired',updated_at=now()
    where id=old_res.id;
  end loop;
end;
$$;

-- Una llamada reserva el carrito completo; si un producto no tiene stock, rollback total.
create or replace function private.reserve_cart()
returns table(reservation_id uuid,reservation_code text,reservation_total numeric,expires_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  record_item record;
  new_id uuid;
  new_code text;
  new_expiry timestamptz := now()+interval '24 hours';
  running_total numeric(12,2) := 0;
  available_now integer;
begin
  if caller is null then raise exception 'AUTH_REQUIRED'; end if;
  -- Serializa solicitudes simultáneas del mismo usuario y evita duplicados.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(caller::text,0));
  perform private.release_expired();
  if (select count(*) from public.reservations
      where user_id=caller and status in ('pending_contact','confirmed')) >= 3
  then raise exception 'ACTIVE_RESERVATION_LIMIT'; end if;
  if not exists(select 1 from public.cart_items where user_id=caller)
  then raise exception 'EMPTY_CART'; end if;

  insert into public.reservations(user_id,status,expires_at)
  values(caller,'pending_contact',new_expiry)
  returning id,code into new_id,new_code;

  for record_item in
    select c.product_id,c.quantity,p.name,p.price,p.active
    from public.cart_items c join public.products p on p.id=c.product_id
    where c.user_id=caller
    order by c.product_id
  loop
    if record_item.active is not true then raise exception 'PRODUCT_UNAVAILABLE'; end if;
    update public.inventory
      set reserved=reserved+record_item.quantity,updated_at=now()
      where product_id=record_item.product_id
        and on_hand-reserved >= record_item.quantity
      returning on_hand-reserved into available_now;
    if not found then raise exception 'INSUFFICIENT_STOCK'; end if;

    insert into public.reservation_items(reservation_id,product_id,product_name,unit_price,quantity)
    values(new_id,record_item.product_id,record_item.name,record_item.price,record_item.quantity);
    running_total := running_total + record_item.price*record_item.quantity;
  end loop;

  update public.reservations set total=running_total where id=new_id;
  delete from public.cart_items where user_id=caller;
  return query select new_id,new_code,running_total,new_expiry;
end;
$$;

-- El administrador modifica estados; el inventario se libera o consume de forma atómica.
create or replace function private.set_reservation_status(target_id uuid,new_status text)
returns void language plpgsql security definer set search_path = ''
as $$
declare r record; item record;
begin
  if not private.is_admin() then raise exception 'FORBIDDEN'; end if;
  if new_status not in ('confirmed','cancelled','fulfilled')
  then raise exception 'INVALID_STATUS'; end if;

  select id,status,expires_at into r
  from public.reservations where id=target_id for update;
  if not found then raise exception 'RESERVATION_NOT_FOUND'; end if;
  if r.status in ('cancelled','expired','fulfilled') then raise exception 'RESERVATION_CLOSED'; end if;
  if new_status='confirmed' and
    (r.status <> 'pending_contact' or r.expires_at <= now())
  then raise exception 'INVALID_TRANSITION'; end if;
  if new_status='fulfilled' and r.status <> 'confirmed'
  then raise exception 'INVALID_TRANSITION'; end if;

  if new_status in ('cancelled','fulfilled') then
    for item in select product_id,quantity from public.reservation_items
                where reservation_id=target_id order by product_id
    loop
      if new_status='cancelled' then
        update public.inventory set reserved=reserved-item.quantity,updated_at=now()
        where product_id=item.product_id;
      else
        update public.inventory
        set reserved=reserved-item.quantity,on_hand=on_hand-item.quantity,updated_at=now()
        where product_id=item.product_id;
      end if;
    end loop;
  end if;
  update public.reservations set status=new_status,
    expires_at=case when new_status='confirmed' then null else expires_at end,
    updated_at=now() where id=target_id;
end;
$$;

-- SQL privileges: allow read only according to RLS.
revoke all on public.profiles,public.products,public.inventory,public.cart_items,
 public.reservations,public.reservation_items from anon,authenticated;
grant select on public.products to anon,authenticated;
grant select on public.profiles,public.inventory,public.cart_items,
 public.reservations,public.reservation_items to authenticated;
grant insert,update,delete on public.cart_items to authenticated;
grant insert,update on public.products to authenticated;
grant update on public.inventory to authenticated;

-- Private elevated functions stay outside PostgREST exposed schemas.
revoke all on function private.reserve_cart() from public,anon,authenticated;
revoke all on function private.set_reservation_status(uuid,text) from public,anon,authenticated;
grant execute on function private.reserve_cart() to authenticated;
grant execute on function private.set_reservation_status(uuid,text) to authenticated;
-- Public interfaces are SECURITY INVOKER; all checks execute server-side.
create or replace function public.reserve_cart()
returns table(reservation_id uuid,reservation_code text,reservation_total numeric,expires_at timestamptz)
language sql volatile security invoker set search_path = ''
as $
  select * from private.reserve_cart();
$;
create or replace function public.set_reservation_status(target_id uuid,new_status text)
returns void language sql volatile security invoker set search_path = ''
as $
  select private.set_reservation_status(target_id,new_status);
$;
revoke all on function public.reserve_cart() from public,anon;
revoke all on function public.set_reservation_status(uuid,text) from public,anon;
grant execute on function public.reserve_cart() to authenticated;
grant execute on function public.set_reservation_status(uuid,text) to authenticated;

-- IMPORTANTE: asignar primer administrador manualmente desde SQL Editor,
-- usando el UUID de Authentication > Users (nunca un botón público).
-- update public.profiles set role='admin' where id='<UUID_REAL_DEL_ADMIN>';

-- Los helpers de esquema privado no deben invocarse desde el cliente.
revoke all on function private.create_customer_profile() from public, anon, authenticated;
revoke all on function private.create_product_inventory() from public, anon, authenticated;
revoke all on function private.release_expired() from public, anon, authenticated;

-- Esta migración NO configura por sí sola un job programado para expirar
-- reservas sin tráfico. Activar pg_cron o un cron seguro antes de producción.
