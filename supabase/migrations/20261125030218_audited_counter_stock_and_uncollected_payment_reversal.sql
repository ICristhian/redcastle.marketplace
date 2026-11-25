-- DEV: record all physical stock mutations, including counter sales outside the web.
create table public.inventory_movements(
 id bigint generated always as identity primary key,
 product_id uuid not null references public.products(id) on delete restrict,
 actor_id uuid,
 movement_type text not null,
 reason text not null default '',
 old_on_hand integer not null,
 new_on_hand integer not null,
 delta integer not null,
 old_reserved integer not null,
 new_reserved integer not null,
 created_at timestamptz not null default pg_catalog.clock_timestamp(),
 constraint movement_delta_matches check(new_on_hand-old_on_hand=delta)
);
create index inventory_movements_product_time on public.inventory_movements(product_id,created_at desc);
alter table public.inventory_movements enable row level security;
revoke all on public.inventory_movements from public,anon,authenticated;
grant select on public.inventory_movements to authenticated;
create policy "Admin reads movement audit" on public.inventory_movements
for select to authenticated using ((select private.is_admin()));

create or replace function private.capture_inventory_movement()
returns trigger language plpgsql security definer set search_path=''
as $$
declare detail text; kind text;
begin
 if new.on_hand is distinct from old.on_hand or new.reserved is distinct from old.reserved then
   detail:=coalesce(pg_catalog.current_setting('redcastle.inventory_reason',true),'');
   kind:=coalesce(nullif(pg_catalog.current_setting('redcastle.inventory_action',true),''),'system_adjustment');
   insert into public.inventory_movements(
     product_id,actor_id,movement_type,reason,old_on_hand,new_on_hand,
     delta,old_reserved,new_reserved)
   values(new.product_id,(select auth.uid()),kind,detail,old.on_hand,new.on_hand,
     new.on_hand-old.on_hand,old.reserved,new.reserved);
 end if;
 return new;
end;
$$;
revoke all on function private.capture_inventory_movement() from public,anon,authenticated;
create trigger zz_redcastle_inventory_movement
after update of on_hand,reserved on public.inventory
for each row execute function private.capture_inventory_movement();

-- Atomic physical count reconciliation; never alter reserved quantities.
create or replace function private.admin_adjust_stock(
 p_product_id uuid,p_new_on_hand integer,p_reason text,
 p_expected_inventory_updated_at timestamptz
) returns void language plpgsql security definer set search_path=''
as $$
declare rec public.inventory%rowtype;
begin
 if (select auth.uid()) is null or not private.is_admin() then
    raise exception 'FORBIDDEN';
 end if;
 if p_reason is null or char_length(btrim(p_reason))<5 or char_length(p_reason)>250
 then raise exception 'STOCK_REASON_REQUIRED';end if;
 select * into rec from public.inventory where product_id=p_product_id for update;
 if not found then raise exception 'INVENTORY_NOT_FOUND';end if;
 if rec.updated_at is distinct from p_expected_inventory_updated_at
 then raise exception 'PRODUCT_EDIT_CONFLICT';end if;
 if p_new_on_hand is null or p_new_on_hand<rec.reserved or p_new_on_hand>1000000
 then raise exception 'STOCK_BELOW_RESERVED';end if;
 if rec.on_hand=p_new_on_hand then raise exception 'STOCK_NO_CHANGE';end if;
 perform pg_catalog.set_config('redcastle.inventory_action','manual_physical_adjustment',true);
 perform pg_catalog.set_config('redcastle.inventory_reason',btrim(p_reason),true);
 update public.inventory
 set on_hand=p_new_on_hand,updated_at=pg_catalog.clock_timestamp()
 where product_id=p_product_id;
 perform pg_catalog.set_config('redcastle.inventory_action','',true);
 perform pg_catalog.set_config('redcastle.inventory_reason','',true);
end;
$$;
revoke all on function private.admin_adjust_stock(uuid,integer,text,timestamptz) from public,anon,authenticated;
grant execute on function private.admin_adjust_stock(uuid,integer,text,timestamptz) to authenticated;
create or replace function public.admin_adjust_stock(
 p_product_id uuid,p_new_on_hand integer,p_reason text,
 p_expected_inventory_updated_at timestamptz
) returns void language sql security invoker set search_path=''
as $$
 select private.admin_adjust_stock(p_product_id,p_new_on_hand,p_reason,p_expected_inventory_updated_at);
$$;
revoke all on function public.admin_adjust_stock(uuid,integer,text,timestamptz) from public,anon,authenticated;
grant execute on function public.admin_adjust_stock(uuid,integer,text,timestamptz) to authenticated;

-- A payment cancellation restores physical stock only before the customer takes it.
alter table public.reservations drop constraint reservations_status_check;
alter table public.reservations add constraint reservations_status_check
check(status in ('pending_contact','confirmed','ready_for_pickup','paid',
'delivered_unpaid','fulfilled','legacy_sale','cancelled','expired','refunded'));

create or replace function private.set_reservation_status(target_id uuid,new_status text)
returns void language plpgsql security definer set search_path=''
as $$
declare r record;item record; kind text;
begin
 if (select auth.uid()) is null or not private.is_admin() then raise exception 'FORBIDDEN';end if;
 if new_status not in ('confirmed','ready_for_pickup','paid','delivered_unpaid','fulfilled','cancelled','refunded')
 then raise exception 'INVALID_STATUS';end if;
 select id,status,expires_at into r from public.reservations where id=target_id for update;
 if not found then raise exception 'RESERVATION_NOT_FOUND';end if;
 if r.status in ('cancelled','expired','fulfilled','refunded') then raise exception 'RESERVATION_CLOSED';end if;
 if not(
 (r.status='pending_contact' and new_status in ('confirmed','cancelled'))
 or (r.status='confirmed' and new_status in ('ready_for_pickup','paid','delivered_unpaid','cancelled'))
 or (r.status='ready_for_pickup' and new_status in ('paid','delivered_unpaid','cancelled'))
 or (r.status='paid' and new_status in ('fulfilled','refunded'))
 or (r.status='delivered_unpaid' and new_status='fulfilled')
 or (r.status='legacy_sale' and new_status in ('paid','delivered_unpaid','fulfilled'))
 ) then raise exception 'INVALID_TRANSITION';end if;
 if r.status='pending_contact' and new_status='confirmed' and r.expires_at<=now()
 then raise exception 'REQUEST_EXPIRED';end if;

 if new_status in ('confirmed','paid','delivered_unpaid','cancelled','refunded') then
  kind:=case new_status when 'confirmed' then 'admin_approved_hold'
        when 'paid' then 'sale_paid'
        when 'delivered_unpaid' then 'sale_credit'
        when 'cancelled' then 'released_hold'
        when 'refunded' then 'paid_sale_reversed' end;
  perform pg_catalog.set_config('redcastle.inventory_action',kind,true);
  perform pg_catalog.set_config('redcastle.inventory_reason','Reserva '||target_id::text,true);
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
   elsif new_status='refunded' and r.status='paid' then
    -- Paid but not picked up: cancel/reverse the payment manually and restock.
    update public.inventory set on_hand=on_hand+item.quantity,
      updated_at=pg_catalog.clock_timestamp()
    where product_id=item.product_id and on_hand<=1000000-item.quantity;
   else continue;end if;
   if not found then raise exception 'INSUFFICIENT_STOCK_OR_INCONSISTENT_HOLD';end if;
  end loop;
  perform pg_catalog.set_config('redcastle.inventory_action','',true);
  perform pg_catalog.set_config('redcastle.inventory_reason','',true);
 end if;
 update public.reservations set status=new_status,
 expires_at=case when new_status='confirmed' then null else expires_at end,
 updated_at=pg_catalog.clock_timestamp() where id=target_id;
end $$;
