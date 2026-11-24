create table public.product_history (
 id bigint generated always as identity primary key,
 product_id uuid not null references public.products(id) on delete restrict,
 version_no integer not null check(version_no>=1),
 sku text not null,name text not null,description text not null,category text not null,
 price numeric(14,2) not null check(price>=0),active boolean not null,
 availability text not null check(availability in ('available','out_of_stock','unlisted')),
 valid_from timestamptz not null,valid_to timestamptz,
 change_kind text not null check(change_kind in ('baseline','product_change','availability_change')),
 changed_by uuid,created_at timestamptz not null default now(),
 constraint product_history_time_check check(valid_to is null or valid_to>valid_from),
 constraint product_history_version_unique unique(product_id,version_no)
);
create unique index product_history_one_current on public.product_history(product_id) where valid_to is null;
create index product_history_timeline on public.product_history(product_id,valid_from desc);
alter table public.product_history enable row level security;
revoke all on public.product_history from public,anon,authenticated;
grant select on public.product_history to authenticated;
create policy "Only admins view product history" on public.product_history
for select to authenticated using ((select private.is_admin()));

create or replace function private.capture_product_version(p_id uuid)
returns void language plpgsql security definer set search_path=''
as $$
declare rec record; previous record; ts timestamptz; change_type text;
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_id::text,5731));
 select p.id,p.sku,p.name,p.description,p.category,p.price,p.active,
 case when not p.active then 'unlisted'
      when coalesce(i.on_hand-i.reserved,0)<=0 then 'out_of_stock'
      else 'available' end as availability
 into rec from public.products p left join public.inventory i on i.product_id=p.id where p.id=p_id;
 if not found then return; end if;
 select * into previous from public.product_history
 where product_id=p_id and valid_to is null for update;
 if found then
   if previous.sku is not distinct from rec.sku
     and previous.name is not distinct from rec.name
     and previous.description is not distinct from rec.description
     and previous.category is not distinct from rec.category
     and previous.price is not distinct from rec.price
     and previous.active is not distinct from rec.active
     and previous.availability is not distinct from rec.availability
   then return; end if;
   change_type:=case when previous.sku is distinct from rec.sku
       or previous.name is distinct from rec.name
       or previous.description is distinct from rec.description
       or previous.category is distinct from rec.category
       or previous.price is distinct from rec.price
       or previous.active is distinct from rec.active
     then 'product_change' else 'availability_change' end;
   ts:=greatest(pg_catalog.clock_timestamp(),previous.valid_from+interval '1 microsecond');
   update public.product_history set valid_to=ts where id=previous.id;
 else change_type:='baseline'; ts:=pg_catalog.clock_timestamp();
 end if;
 insert into public.product_history (
   product_id,version_no,sku,name,description,category,price,active,
   availability,valid_from,change_kind,changed_by
 ) values (
   p_id,coalesce(previous.version_no,0)+1,rec.sku,rec.name,rec.description,
   rec.category,rec.price,rec.active,rec.availability,
   ts,change_type,(select auth.uid())
 );
end;$$;
revoke all on function private.capture_product_version(uuid) from public,anon,authenticated;
create or replace function private.capture_product_from_trigger()
returns trigger language plpgsql security definer set search_path=''
as $$begin perform private.capture_product_version(new.id);return new;end;$$;
revoke all on function private.capture_product_from_trigger() from public,anon,authenticated;
create or replace function private.capture_inventory_from_trigger()
returns trigger language plpgsql security definer set search_path=''
as $$begin perform private.capture_product_version(new.product_id);return new;end;$$;
revoke all on function private.capture_inventory_from_trigger() from public,anon,authenticated;
create trigger zz_redcastle_product_history_insert after insert on public.products for each row
execute function private.capture_product_from_trigger();
create trigger zz_redcastle_product_history_update
after update of sku,name,description,category,price,active on public.products
for each row when (
 old.sku is distinct from new.sku or old.name is distinct from new.name
 or old.description is distinct from new.description or old.category is distinct from new.category
 or old.price is distinct from new.price or old.active is distinct from new.active)
execute function private.capture_product_from_trigger();
create trigger zz_redcastle_stock_history_insert after insert on public.inventory for each row
execute function private.capture_inventory_from_trigger();
create trigger zz_redcastle_stock_history_update after update of on_hand,reserved on public.inventory
for each row when ((old.on_hand>old.reserved) is distinct from (new.on_hand>new.reserved))
execute function private.capture_inventory_from_trigger();
select private.capture_product_version(id) from public.products;
