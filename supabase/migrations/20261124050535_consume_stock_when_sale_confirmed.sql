-- Sales consume stock when the administrator confirms the sale, not when delivered.
-- One-time legacy reconciliation included for reservations already 'confirmed'.
-- All inventory/status modifications run within one PostgreSQL transaction.

lock table public.reservations, public.reservation_items, public.inventory
  in share row exclusive mode;

do $$
begin
  if exists (
    with held as (
      select ri.product_id, sum(ri.quantity) as qty
      from public.reservations r
      join public.reservation_items ri on ri.reservation_id=r.id
      where r.status in ('pending_contact','confirmed')
      group by ri.product_id
    )
    select 1 from public.inventory i
    left join held h on h.product_id=i.product_id
    where i.reserved <> coalesce(h.qty,0)
  ) then
    raise exception 'LEGACY_RESERVATION_STOCK_MISMATCH';
  end if;
end;
$$;

do $$
declare expected_rows integer; applied_rows integer;
begin
  with sold as (
    select ri.product_id,sum(ri.quantity)::integer as qty
    from public.reservations r
    join public.reservation_items ri on ri.reservation_id=r.id
    where r.status='confirmed'
    group by ri.product_id
  )
  select count(*) into expected_rows from sold;

  with sold as (
    select ri.product_id,sum(ri.quantity)::integer as qty
    from public.reservations r
    join public.reservation_items ri on ri.reservation_id=r.id
    where r.status='confirmed'
    group by ri.product_id
  )
  update public.inventory as i
  set on_hand=i.on_hand-s.qty, reserved=i.reserved-s.qty,
      updated_at=pg_catalog.clock_timestamp()
  from sold s where i.product_id=s.product_id
     and i.on_hand>=s.qty and i.reserved>=s.qty;
  get diagnostics applied_rows = row_count;
  if applied_rows<>expected_rows then
    raise exception 'LEGACY_CONFIRMED_RECONCILIATION_FAILED';
  end if;
end;
$$;

create or replace function private.set_reservation_status(target_id uuid,new_status text)
returns void
language plpgsql security definer set search_path=''
as $$
declare r record;item record;
begin
  if (select auth.uid()) is null or not private.is_admin() then
    raise exception 'FORBIDDEN';
  end if;
  if new_status not in ('confirmed','cancelled','fulfilled') then
    raise exception 'INVALID_STATUS';
  end if;
  select id,status,expires_at into r
  from public.reservations where id=target_id for update;
  if not found then raise exception 'RESERVATION_NOT_FOUND'; end if;
  if r.status in ('cancelled','expired','fulfilled') then
    raise exception 'RESERVATION_CLOSED';
  end if;
  if new_status='confirmed' and
     (r.status<>'pending_contact' or r.expires_at<=now()) then
    raise exception 'INVALID_TRANSITION';
  end if;
  if new_status='fulfilled' and r.status<>'confirmed' then
    raise exception 'INVALID_TRANSITION';
  end if;
  if new_status='cancelled' and r.status not in ('pending_contact','confirmed') then
    raise exception 'INVALID_TRANSITION';
  end if;

  -- Stable product lock ordering avoids deadlocks between multi-item sales.
  if new_status in ('confirmed','cancelled') then
    for item in
      select product_id,quantity
      from public.reservation_items
      where reservation_id=target_id order by product_id
    loop
      if new_status='confirmed' then
        -- The product leaves physical stock and ceases to be reserved.
        update public.inventory
        set reserved=reserved-item.quantity,
            on_hand=on_hand-item.quantity,
            updated_at=pg_catalog.clock_timestamp()
        where product_id=item.product_id
          and reserved>=item.quantity and on_hand>=item.quantity;
      elsif r.status='pending_contact' then
        -- A pending cancellation merely releases its hold.
        update public.inventory
        set reserved=reserved-item.quantity,
            updated_at=pg_catalog.clock_timestamp()
        where product_id=item.product_id and reserved>=item.quantity;
      else
        -- Cancelling a confirmed sale reverses it and returns items to stock.
        update public.inventory
        set on_hand=on_hand+item.quantity,
            updated_at=pg_catalog.clock_timestamp()
        where product_id=item.product_id;
      end if;
      if not found then raise exception 'RESERVATION_INVENTORY_INCONSISTENT'; end if;
    end loop;
  end if;

  -- 'fulfilled' marks delivery/service only: sale was already deducted.
  update public.reservations
  set status=new_status,
      expires_at=case when new_status='confirmed' then null else expires_at end,
      updated_at=pg_catalog.clock_timestamp()
  where id=target_id;
end;
$$;

-- A completed sale must not occupy one of a customer's 3 active reservation slots.
create or replace function private.reserve_cart()
returns table(reservation_id uuid,reservation_code text,reservation_total numeric,expires_at timestamptz)
language plpgsql security definer set search_path=''
as $$
declare
  caller uuid := auth.uid();
  record_item record; new_id uuid; new_code text;
  new_expiry timestamptz := now()+interval '24 hours';
  running_total numeric(12,2) := 0;
  available_now integer;
begin
  if caller is null then raise exception 'AUTH_REQUIRED'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(caller::text,0));
  perform private.release_expired();
  if (select count(*) from public.reservations
      where user_id=caller and status='pending_contact') >= 3 then
    raise exception 'ACTIVE_RESERVATION_LIMIT';
  end if;
  if not exists(select 1 from public.cart_items where user_id=caller) then
    raise exception 'EMPTY_CART';
  end if;

  insert into public.reservations(user_id,status,expires_at)
  values(caller,'pending_contact',new_expiry) returning id,code into new_id,new_code;

  for record_item in
    select c.product_id,c.quantity,p.name,p.price,p.active
    from public.cart_items c join public.products p on p.id=c.product_id
    where c.user_id=caller order by c.product_id
  loop
    if record_item.active is not true then raise exception 'PRODUCT_UNAVAILABLE'; end if;
    update public.inventory
    set reserved=reserved+record_item.quantity,updated_at=now()
    where product_id=record_item.product_id and on_hand-reserved>=record_item.quantity
    returning on_hand-reserved into available_now;
    if not found then raise exception 'INSUFFICIENT_STOCK'; end if;

    insert into public.reservation_items(reservation_id,product_id,product_name,unit_price,quantity)
    values(new_id,record_item.product_id,record_item.name,record_item.price,record_item.quantity);
    running_total:=running_total+record_item.price*record_item.quantity;
  end loop;
  update public.reservations set total=running_total where id=new_id;
  delete from public.cart_items where user_id=caller;
  return query select new_id,new_code,running_total,new_expiry;
end;
$$;

