lock table public.reservations,public.reservation_items,public.inventory in share row exclusive mode;
-- Migrate only pending holds, if any; existing confirmed sales had separate accounting.
do $$
begin
 if exists(
  with pending as (
   select ri.product_id,sum(ri.quantity)::integer qty from public.reservation_items ri
   join public.reservations r on r.id=ri.reservation_id
   where r.status='pending_contact' group by ri.product_id
  )
  select 1 from public.inventory i left join pending p on p.product_id=i.product_id
  where i.reserved<>coalesce(p.qty,0)
 ) then raise exception 'PENDING_HOLD_RECONCILIATION_REQUIRED';end if;
end $$;
alter table public.reservations drop constraint reservations_status_check;
alter table public.reservations add constraint reservations_status_check
check(status in ('pending_contact','confirmed','ready_for_pickup','paid','delivered_unpaid',
 'fulfilled','legacy_sale','cancelled','expired'));
-- Historical 'confirmed' did deduct stock in prior implementation; do not infer paid.
update public.reservations set status='legacy_sale',updated_at=pg_catalog.clock_timestamp()
where status='confirmed';
with held as(
 select ri.product_id,sum(ri.quantity)::integer qty from public.reservation_items ri
 join public.reservations r on r.id=ri.reservation_id
 where r.status='pending_contact' group by ri.product_id
)
update public.inventory i set reserved=i.reserved-h.qty,
 updated_at=pg_catalog.clock_timestamp() from held h
where i.product_id=h.product_id and i.reserved>=h.qty;
do $$begin
 if exists(select 1 from public.inventory where reserved<>0)
 then raise exception 'UNEXPECTED_EXISTING_HOLDS';end if;
end $$;

create or replace function private.release_expired()
returns void language plpgsql security definer set search_path=''
as $$
begin
 with expired as (
  select id from public.reservations where status='pending_contact' and expires_at<=now()
  order by created_at limit 100 for update skip locked
 )
 update public.reservations r set status='expired',updated_at=pg_catalog.clock_timestamp()
 from expired e where r.id=e.id;
end $$;

create or replace function private.reserve_cart()
returns table(reservation_id uuid,reservation_code text,reservation_total numeric,expires_at timestamptz)
language plpgsql security definer set search_path=''
as $$
declare caller uuid:=auth.uid(); item record;new_id uuid;new_code text;
 expiry timestamptz:=now()+interval '24 hours'; total_price numeric(12,2):=0;
begin
 if caller is null then raise exception 'AUTH_REQUIRED';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(caller::text,0));
 perform private.release_expired();
 if (select count(*) from public.reservations
 where user_id=caller and status='pending_contact')>=3
 then raise exception 'ACTIVE_RESERVATION_LIMIT';end if;
 if not exists(select 1 from public.cart_items where user_id=caller)
 then raise exception 'EMPTY_CART';end if;
 insert into public.reservations(user_id,status,expires_at)
 values(caller,'pending_contact',expiry) returning id,code into new_id,new_code;
 for item in
 select c.product_id,c.quantity,p.name,p.price,p.active from public.cart_items c
 join public.products p on p.id=c.product_id
 where c.user_id=caller order by c.product_id
 loop
  if item.active is not true then raise exception 'PRODUCT_UNAVAILABLE';end if;
  if not exists(select 1 from public.inventory i where i.product_id=item.product_id
    and i.on_hand-i.reserved>=item.quantity) then
    raise exception 'INSUFFICIENT_STOCK';end if;
  insert into public.reservation_items(reservation_id,product_id,product_name,unit_price,quantity)
  values(new_id,item.product_id,item.name,item.price,item.quantity);
  total_price:=total_price+item.price*item.quantity;
 end loop;
 update public.reservations set total=total_price where id=new_id;
 delete from public.cart_items where user_id=caller;
 return query select new_id,new_code,total_price,expiry;
end $$;

create or replace function private.set_reservation_status(target_id uuid,new_status text)
returns void language plpgsql security definer set search_path=''
as $$
declare r record;item record;
begin
 if (select auth.uid()) is null or not private.is_admin()
 then raise exception 'FORBIDDEN';end if;
 if new_status not in ('confirmed','ready_for_pickup','paid','delivered_unpaid','fulfilled','cancelled')
 then raise exception 'INVALID_STATUS';end if;
 select id,status,expires_at into r from public.reservations where id=target_id for update;
 if not found then raise exception 'RESERVATION_NOT_FOUND';end if;
 if r.status in ('cancelled','expired','fulfilled') then raise exception 'RESERVATION_CLOSED';end if;
 if not(
 (r.status='pending_contact' and new_status in ('confirmed','cancelled'))
 or (r.status='confirmed' and new_status in ('ready_for_pickup','paid','delivered_unpaid','cancelled'))
 or (r.status='ready_for_pickup' and new_status in ('paid','delivered_unpaid','cancelled'))
 or (r.status='paid' and new_status='fulfilled')
 or (r.status='delivered_unpaid' and new_status='fulfilled')
 or (r.status='legacy_sale' and new_status in ('paid','delivered_unpaid','fulfilled'))
 ) then raise exception 'INVALID_TRANSITION';end if;
 if r.status='pending_contact' and new_status='confirmed'
 and r.expires_at<=now() then raise exception 'REQUEST_EXPIRED';end if;
 if new_status in ('confirmed','paid','delivered_unpaid','cancelled') then
  for item in select product_id,quantity from public.reservation_items
    where reservation_id=target_id order by product_id
  loop
   if new_status='confirmed' then
    update public.inventory set reserved=reserved+item.quantity,
      updated_at=pg_catalog.clock_timestamp()
    where product_id=item.product_id and on_hand-reserved>=item.quantity;
   elsif new_status in ('paid','delivered_unpaid') and r.status in ('confirmed','ready_for_pickup') then
    update public.inventory set reserved=reserved-item.quantity,
      on_hand=on_hand-item.quantity,updated_at=pg_catalog.clock_timestamp()
    where product_id=item.product_id and reserved>=item.quantity and on_hand>=item.quantity;
   elsif new_status='cancelled' and r.status in ('confirmed','ready_for_pickup') then
    update public.inventory set reserved=reserved-item.quantity,
      updated_at=pg_catalog.clock_timestamp()
    where product_id=item.product_id and reserved>=item.quantity;
   else continue;end if;
   if not found then raise exception 'INSUFFICIENT_STOCK_OR_INCONSISTENT_HOLD';end if;
  end loop;
 end if;
 update public.reservations set status=new_status,
 expires_at=case when new_status='confirmed' then null else expires_at end,
 updated_at=pg_catalog.clock_timestamp() where id=target_id;
end $$;

