import {isConfigured,supabase,formatMoney,safeError,notify,node} from "./backend.js";
const $=id=>document.getElementById(id);
let api,products=[],inventories=[],reservations=[],users=[];
function message(text,kind=""){$("accessNotice").textContent=text;$("accessNotice").className="notice "+kind;}
function action(text,fn){const b=node("button",text,"button secondary");b.type="button";b.addEventListener("click",fn);return b;}
function cell(tr,text){tr.append(node("td",text??""));}
function setTab(name){
  document.querySelectorAll(".admin-tabs button").forEach(b=>b.classList.toggle("active",b.dataset.tab===name));
  for(const n of ["products","reservations","users"])$(n+"Panel").hidden=n!==name;
}
async function loadProducts(){
  const {data,error}=await api.from("products").select("id,sku,name,category,price,active,inventory(on_hand,reserved)").order("name");
  if(error)throw error;products=data||[];
  const tbody=$("productsTable");tbody.replaceChildren();
  for(const p of products){
    const i=Array.isArray(p.inventory)?p.inventory[0]:(p.inventory||{});
    const tr=node("tr");
    const name=node("td");name.append(node("strong",p.name),node("small",p.sku));tr.append(name);
    cell(tr,formatMoney(p.price));
    const stock=node("td");const stockInput=node("input",undefined,"edit-input");
    stockInput.type="number";stockInput.min=String(Number(i.reserved)||0);stockInput.step="1";stockInput.max="1000000";stockInput.value=String(Number(i.on_hand)||0);
    stockInput.setAttribute("aria-label","Stock físico de "+p.name);stock.append(stockInput);tr.append(stock);
    cell(tr,i.reserved??0);cell(tr,Math.max(0,(Number(i.on_hand)||0)-(Number(i.reserved)||0)));
    const active=node("td");const checkbox=node("input");checkbox.type="checkbox";checkbox.checked=Boolean(p.active);
    checkbox.setAttribute("aria-label","Producto activo "+p.name);active.append(checkbox);tr.append(active);
    const controls=node("td");
    const save=action("Guardar",async()=>{
      const on_hand=Number(stockInput.value);
      if(!Number.isSafeInteger(on_hand)||on_hand<Number(i.reserved)||on_hand>1000000){notify("Stock inválido; no puede ser menor a lo reservado.",true);return;}
      save.disabled=true;
      try{
        const {error:stockError}=await api.from("inventory").update({on_hand,updated_at:new Date().toISOString()}).eq("product_id",p.id);
        if(stockError)throw stockError;
        const {error:productError}=await api.from("products").update({active:checkbox.checked,updated_at:new Date().toISOString()}).eq("id",p.id);
        if(productError)throw productError;
        notify("Producto actualizado.");await loadProducts();
      }catch(e){notify(safeError(e),true);}
      finally{save.disabled=false;}
    });
    controls.append(save);tr.append(controls);tbody.append(tr);
  }
  if(!products.length){const tr=node("tr");const td=node("td","Todavía no hay productos registrados.");td.colSpan=7;tr.append(td);tbody.append(tr);}
}
async function createProduct(event){
  event.preventDefault();
  const form=event.currentTarget;const data=new FormData(form);
  const sku=String(data.get("sku")||"").trim().toUpperCase();
  const name=String(data.get("name")||"").trim();
  const category=String(data.get("category")||"").trim();
  const description=String(data.get("description")||"").trim();
  const price=Number(data.get("price"));
  if(sku.length<2||name.length<2||category.length<2||!Number.isFinite(price)||price<0||!/^\d+(\.\d{1,2})?$/.test(String(data.get("price")))){notify("Revisa SKU, nombre, categoría y precio.",true);return;}
  const submit=form.querySelector("[type=submit]");submit.disabled=true;
  try{
    const {error}=await api.from("products").insert({sku,name,category,description,price,active:true});
    if(error)throw error;
    form.reset();notify("Producto creado. Ajusta su stock físico para publicarlo con disponibilidad.");
    await loadProducts();
  }catch(e){notify(safeError(e),true);}
  finally{submit.disabled=false;}
}
const STATUS={pending_contact:"Pendiente de contacto",confirmed:"Confirmada",cancelled:"Cancelada",expired:"Expirada",fulfilled:"Atendida"};
async function loadReservations(){
  const {data,error}=await api.from("reservations")
    .select("id,code,user_id,status,total,created_at,expires_at,reservation_items(product_name,quantity,unit_price)")
    .order("created_at",{ascending:false}).limit(100);
  if(error)throw error;
  reservations=data||[];
  const tbody=$("reservationsTable");tbody.replaceChildren();
  const usersById=new Map(users.map(u=>[u.id,u]));
  for(const r of reservations){
    const tr=node("tr");cell(tr,r.code);
    cell(tr,usersById.get(r.user_id)?.email||"Usuario "+r.user_id.slice(0,8));
    cell(tr,new Date(r.created_at).toLocaleString("es-PE"));cell(tr,STATUS[r.status]||r.status);
    const detail=node("td");
    for(const x of r.reservation_items||[])detail.append(node("div",x.quantity+" × "+x.product_name));
    tr.append(detail);cell(tr,formatMoney(r.total));
    const ops=node("td");
    const choices=r.status==="pending_contact"?["confirmed","cancelled"]
      :r.status==="confirmed"?["fulfilled","cancelled"]:[];
    if(choices.length){
      const select=node("select",undefined,"status-select");
      select.setAttribute("aria-label","Nuevo estado para "+r.code);
      select.append(new Option("Cambiar estado",""));
      for(const s of choices)select.append(new Option(STATUS[s],s));
      select.addEventListener("change",async()=>{
        if(!select.value)return;
        const value=select.value;select.disabled=true;
        try{
          const {error:changeError}=await api.rpc("set_reservation_status",{target_id:r.id,new_status:value});
          if(changeError)throw changeError;
          notify("Reserva actualizada.");await Promise.all([loadProducts(),loadReservations()]);
        }catch(e){notify(safeError(e),true);select.disabled=false;}
      });
      ops.append(select);
    }else ops.textContent="Cerrada";
    tr.append(ops);tbody.append(tr);
  }
  if(!reservations.length){const tr=node("tr");const td=node("td","Sin reservas registradas.");td.colSpan=7;tr.append(td);tbody.append(tr);}
}
async function loadUsers(){
  const {data,error}=await api.from("profiles").select("id,email,display_name,role,created_at").order("created_at",{ascending:false}).limit(200);
  if(error)throw error;users=data||[];
  const tbody=$("usersTable");tbody.replaceChildren();
  for(const u of users){const tr=node("tr");cell(tr,u.display_name||"—");cell(tr,u.email||"—");cell(tr,u.role);cell(tr,new Date(u.created_at).toLocaleDateString("es-PE"));tbody.append(tr);}
  if(!users.length){const tr=node("tr");const td=node("td","No hay usuarios.");td.colSpan=4;tr.append(td);tbody.append(tr);}
}
async function main(){
  document.querySelectorAll(".admin-tabs button").forEach(b=>b.addEventListener("click",()=>setTab(b.dataset.tab)));
  $("createProduct").addEventListener("submit",createProduct);
  $("reloadReservations").addEventListener("click",async()=>{try{await loadReservations();notify("Reservas actualizadas.");}catch(e){notify(safeError(e),true);}});
  $("signOut").addEventListener("click",async()=>{if(api)await api.auth.signOut();location.replace("/portal.html");});
  if(!isConfigured()){message("Portal administrativo inactivo: conecta Supabase y configura autenticación antes de habilitarlo.","error");return;}
  try{
    api=await supabase();
    const {data:{user},error:authError}=await api.auth.getUser();
    if(authError||!user){message("Debes iniciar sesión en el portal antes de acceder a administración.","error");return;}
    const {data:profile,error:roleError}=await api.from("profiles").select("role").eq("id",user.id).single();
    if(roleError||profile?.role!=="admin"){message("Acceso denegado. Tu usuario no tiene el rol administrador.","error");return;}
    message("Administrador autenticado. Las operaciones están restringidas por las reglas de PostgreSQL.","ok");
    $("adminContent").hidden=false;
    await Promise.all([loadProducts(),loadUsers()]);
    await loadReservations();
  }catch(e){message("Error al validar el acceso administrativo. Revisa la sesión y la configuración.","error");notify(safeError(e),true);}
}
main();
