-- Edit product master data and physical inventory in one transaction.
-- Captures a single SCD2 version for the complete administrator action.
create or replace function private.capture_product_version(p_id uuid)
returns void language plpgsql security definer set search_path=''
as $$
declare rec record; previous record; ts timestamptz; change_type text;
begin
 if pg_catalog.current_setting('redcastle.history_suppressed',true)='on' then return; end if;
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
 else change_type:='baseline'; ts:=pg_catalog.clock_timestamp(); end if;
 insert into public.product_history(product_id,version_no,sku,name,description,category,
 price,active,availability,valid_from,change_kind,changed_by)
 values(p_id,coalesce(previous.version_no,0)+1,rec.sku,rec.name,rec.description,
 rec.category,rec.price,rec.active,rec.availability,ts,change_type,(select auth.uid()));
end;$$;

create or replace function private.admin_update_product(
 p_product_id uuid, p_sku text, p_name text, p_category text, p_description text,
 p_price numeric, p_on_hand integer, p_active boolean,
 p_expected_product_updated_at timestamptz,p_expected_inventory_updated_at timestamptz
) returns void language plpgsql security definer set search_path=''
as $$
declare old_product public.products%rowtype; old_inventory public.inventory%rowtype;
begin
 if (select auth.uid()) is null or not private.is_admin() then raise exception 'FORBIDDEN';end if;
 select * into old_product from public.products where id=p_product_id for update;
 if not found then raise exception 'PRODUCT_NOT_FOUND';end if;
 select * into old_inventory from public.inventory where product_id=p_product_id for update;
 if not found then raise exception 'INVENTORY_NOT_FOUND';end if;
 if old_product.updated_at is distinct from p_expected_product_updated_at or
    old_inventory.updated_at is distinct from p_expected_inventory_updated_at then
   raise exception 'PRODUCT_EDIT_CONFLICT';end if;
 if p_sku is null or length(btrim(p_sku))<2 or length(p_sku)>64
   or p_name is null or length(btrim(p_name))<2 or length(p_name)>160
   or p_category is null or length(btrim(p_category))<2 or length(p_category)>80
   or p_description is null or length(p_description)>1000
   or p_price is null or p_price<0 or p_price>100000000
   or p_price<>round(p_price,2)
   or p_on_hand is null or p_on_hand<old_inventory.reserved or p_on_hand>1000000
   or p_active is null then raise exception 'INVALID_PRODUCT_DATA'; end if;
 perform pg_catalog.set_config('redcastle.history_suppressed','on',true);
 if old_inventory.on_hand is distinct from p_on_hand then
   update public.inventory set on_hand=p_on_hand,updated_at=pg_catalog.clock_timestamp()
   where product_id=p_product_id;
 end if;
 if (old_product.sku,old_product.name,old_product.category,old_product.description,old_product.price,old_product.active)
    is distinct from (p_sku,p_name,p_category,p_description,p_price,p_active) then
   update public.products set
      sku=btrim(p_sku),name=btrim(p_name),category=btrim(p_category),
      description=p_description,price=p_price,active=p_active,
      updated_at=pg_catalog.clock_timestamp()
   where id=p_product_id;
 end if;
 perform pg_catalog.set_config('redcastle.history_suppressed','off',true);
 perform private.capture_product_version(p_product_id);
end;$$;

revoke all on function private.admin_update_product(uuid,text,text,text,text,numeric,integer,boolean,timestamptz,timestamptz)
from public,anon,authenticated;
grant execute on function private.admin_update_product(uuid,text,text,text,text,numeric,integer,boolean,timestamptz,timestamptz)
to authenticated;

create or replace function public.admin_update_product(
 p_product_id uuid, p_sku text, p_name text, p_category text, p_description text,
 p_price numeric, p_on_hand integer, p_active boolean,
 p_expected_product_updated_at timestamptz,p_expected_inventory_updated_at timestamptz
) returns void language sql security invoker set search_path=''
as $$
 select private.admin_update_product(p_product_id,p_sku,p_name,p_category,p_description,
   p_price,p_on_hand,p_active,p_expected_product_updated_at,p_expected_inventory_updated_at);
$$;

revoke all on function public.admin_update_product(uuid,text,text,text,text,numeric,integer,boolean,timestamptz,timestamptz)
from public,anon,authenticated;
grant execute on function public.admin_update_product(uuid,text,text,text,text,numeric,integer,boolean,timestamptz,timestamptz)
to authenticated;
