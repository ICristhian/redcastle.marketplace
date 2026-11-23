import {APP_CONFIG} from "./config.js";
import {APP_CONFIG} from "./config.js";
import {isConfigured,supabase,formatMoney,safeError,notify,whatsappLink,node} from "./backend.js";

const $=id=>document.getElementById(id);
let api,user,profile,products=[],cart=[],reservations=[];
let category="",search="",sort="name";

function setNotice(text,kind="") {const el=$("setupNotice");el.textContent=text;el.className="notice "+kind;}
function button(label,handler,cls="button secondary") {const b=node("button",label,cls);b.type="button";b.addEventListener("click",handler);return b;}
async function refreshSession() {
  const {data:{user:current},error}=await api.auth.getUser();
  if(error && !/Auth session missing/i.test(error.message))console.warn("Unable to refresh user session.");
  user=current||null;
  profile=null;
  if(user){
    const {data,error:roleError}=await api.from("profiles").select("id,role,display_name").eq("id",user.id).maybeSingle();
    if(roleError)throw roleError;
    profile=data;
  }
  $("userLabel").textContent=profile?.display_name||user?.email||"Invitado";
  $("signIn").hidden=Boolean(user);
  $("signOut").hidden=!user;
  $("authSection").hidden=Boolean(user);
  $("adminLink").hidden=profile?.role!=="admin";
  $("reserve").disabled=!user;
}
async function loadCatalog(){
  const {data,error}=await api.rpc("get_catalog");
  if(error)throw error;
  products=data||[];
  renderCatalog();
}
function renderCatalog(){
  const grid=$("catalogGrid");grid.replaceChildren();
  const categories=[...new Set(products.map(p=>p.category))].sort();
  const selected=$("categoryFilter").value;
  const filter=$("categoryFilter");filter.replaceChildren(new Option("Todas las categorías",""));
  for(const c of categories)filter.append(new Option(c,c));
  filter.value=categories.includes(selected)?selected:"";
  category=filter.value;
  let rows=products.filter(p=>(!category||p.category===category)
    &&[p.name,p.category,p.description,p.sku].join(" ").toLocaleLowerCase("es").includes(search));
  rows=[...rows];
  if(sort==="price-low")rows.sort((a,b)=>Number(a.price)-Number(b.price));
  else if(sort==="price-high")rows.sort((a,b)=>Number(b.price)-Number(a.price));
  else rows.sort((a,b)=>a.name.localeCompare(b.name,"es"));
  $("catalogCount").textContent=rows.length+" productos";
  if(!rows.length){grid.append(node("div","No hay productos con esos filtros.","empty"));return;}
  for(const p of rows){
    const card=node("article",undefined,"product-card");
    const thumb=node("div","◈","product-thumb");
    thumb.setAttribute("aria-hidden","true");
    const meta=node("div",undefined,"product-meta");
    meta.append(node("span",p.category,"eyebrow"),node("h3",p.name),node("p",p.description||p.sku),node("div",formatMoney(p.price),"price"));
    const available=Number(p.available)||0;
    meta.append(node("span",available>0?`${available} disponibles`:"Sin stock",available>0?"stock":"stock out"));
    const add=button(user?"Agregar al carrito":"Inicia sesión para reservar",()=>addToCart(p));
    add.disabled=!user||available<=0;
    meta.append(add);card.append(thumb,meta);grid.append(card);
  }
}
async function loadCart(){
  cart=[];
  if(user){
    const {data,error}=await api.from("cart_items").select("product_id,quantity").eq("user_id",user.id);
    if(error)throw error;
    cart=data||[];
  }
  renderCart();
}
function renderCart(){
  const box=$("cartItems");box.replaceChildren();
  $("cartCount").textContent=cart.reduce((sum,i)=>sum+i.quantity,0);
  let total=0;
  for(const item of cart){
    const p=products.find(x=>x.id===item.product_id);
    if(!p)continue;
    total+=Number(p.price)*item.quantity;
    const row=node("div",undefined,"stack-item");
    const detail=node("div");
    detail.append(node("strong",p.name),node("small",formatMoney(p.price)+" · "+item.quantity+" unidades"));
    const qty=node("div",undefined,"qty");
    const less=button("−",()=>changeQty(p,item.quantity-1));
    less.setAttribute("aria-label","Quitar una unidad de "+p.name);
    const more=button("+",()=>changeQty(p,item.quantity+1));
    more.setAttribute("aria-label","Agregar una unidad de "+p.name);
    more.disabled=item.quantity>=10 || item.quantity>=Number(p.available);
    qty.append(less,node("span",item.quantity),more);
    row.append(detail,qty);box.append(row);
  }
  if(!cart.length)box.append(node("p",user?"Todavía no agregaste productos.":"Inicia sesión para tener un carrito personal.","dim"));
  $("cartTotal").textContent=formatMoney(total);
  $("reserve").disabled=!user||!cart.length||!/^\d{8,15}$/.test(APP_CONFIG.whatsappNumber);
}
async function addToCart(product){
  if(!user)return notify("Inicia sesión para utilizar tu carrito.",true);
  const old=cart.find(i=>i.product_id===product.id);
  const quantity=(old?.quantity||0)+1;
  if(quantity>10||quantity>Number(product.available))return notify("Cantidad máxima o stock insuficiente.",true);
  await saveQty(product.id,quantity);
}
async function changeQty(product,quantity) {
  if(quantity>10 || quantity>Number(product.available))return notify("Cantidad superior al stock disponible.",true);
  await saveQty(product.id,quantity);
}
async function saveQty(productId,quantity){
  try{
    const query=quantity===0
      ?api.from("cart_items").delete().eq("user_id",user.id).eq("product_id",productId)
      :api.from("cart_items").upsert({user_id:user.id,product_id:productId,quantity},{onConflict:"user_id,product_id"});
    const {error}=await query;if(error)throw error;
    await loadCart();notify("Carrito actualizado.");
  }catch(error){notify(safeError(error),true);}
}
async function loadReservations(){
  reservations=[];
  if(user){
    const {data,error}=await api.from("reservations")
      .select("id,code,status,total,created_at,expires_at,reservation_items(product_name,quantity)")
      .eq("user_id",user.id).order("created_at",{ascending:false}).limit(50);
    if(error)throw error;
    reservations=data||[];
  }
  renderReservations();
}
const STATUS={pending_contact:"Pendiente de contacto",confirmed:"Confirmada",cancelled:"Cancelada",expired:"Expirada",fulfilled:"Atendida"};
function renderReservations(){
  const box=$("reservationList");box.replaceChildren();
  if(!reservations.length){box.append(node("p",user?"Aún no tienes reservas.":"Inicia sesión para ver tus reservas.","dim"));return;}
  for(const r of reservations){
    const entry=node("div",undefined,"reservation-entry");
    entry.append(node("strong",r.code+" · "+(STATUS[r.status]||r.status)));
    entry.append(node("p",new Date(r.created_at).toLocaleString("es-PE")+" · "+formatMoney(r.total)));
    entry.append(node("p",(r.reservation_items||[]).map(x=>x.quantity+" × "+x.product_name).join(", ")));
    if(r.status==="pending_contact"||r.status==="confirmed"){
      const url=whatsappLink(r.code,r.reservation_items||[]);
      if(url){const link=node("a","Continuar por WhatsApp ↗","button secondary");link.href=url;link.target="_blank";link.rel="noopener noreferrer";entry.append(link);}
    }
    box.append(entry);
  }
}
async function reserve(){
  if(!/^\d{8,15}$/.test(APP_CONFIG.whatsappNumber)){
    notify("Las reservas aún están deshabilitadas hasta configurar WhatsApp.",true);
    return;
  }
  const b=$("reserve");b.disabled=true;b.textContent="Validando disponibilidad…";
  try{
    const {data,error}=await api.rpc("reserve_cart");
    if(error)throw error;
    const reservation=Array.isArray(data)?data[0]:data;
    if(!reservation?.reservation_code)throw new Error("Respuesta inválida");
    await Promise.all([loadCatalog(),loadCart(),loadReservations()]);
    const items=reservations.find(x=>x.code===reservation.reservation_code)?.reservation_items||[];
    notify("Reserva "+reservation.reservation_code+" registrada.");
    const url=whatsappLink(reservation.reservation_code,items);
    if(url){window.location.assign(url);}
    else {setNotice("Reserva "+reservation.reservation_code+" registrada. Falta configurar WhatsApp para continuar.", "ok");$("reservas").scrollIntoView({behavior:"smooth"});}
  }catch(error){notify(safeError(error),true);}
  finally{b.textContent="Solicitar reserva ↗";b.disabled=!cart.length||!user||!/^\d{8,15}$/.test(APP_CONFIG.whatsappNumber);}
}
async function oauth(provider){
  if(!api)return;
  try{
    const {error}=await api.auth.signInWithOAuth({provider,options:{
      redirectTo:location.origin+"/portal.html",
      ...(provider==="azure"?{scopes:"email"}:{})
    }});
    if(error)throw error;
  }catch(error){notify(safeError(error),true);}
}
async function main(){
  $("search").addEventListener("input",e=>{search=e.target.value.trim().toLocaleLowerCase("es");renderCatalog();});
  $("categoryFilter").addEventListener("change",e=>{category=e.target.value;renderCatalog();});
  $("sort").addEventListener("change",e=>{sort=e.target.value;renderCatalog();});
  $("googleLogin").addEventListener("click",()=>oauth("google"));
  $("microsoftLogin").addEventListener("click",()=>oauth("azure"));
  $("signIn").addEventListener("click",()=>$("authSection").scrollIntoView({behavior:"smooth"}));
  $("signOut").addEventListener("click",async()=>{if(api){await api.auth.signOut();await refreshSession();await loadCart();await loadReservations();renderCatalog();notify("Sesión cerrada.");}});
  $("reserve").addEventListener("click",reserve);
  if(!isConfigured()){
    setNotice("Portal preparado, pero aún no conectado. Configura Supabase y los proveedores de acceso antes de habilitar reservas.","error");
    $("googleLogin").disabled=true;$("microsoftLogin").disabled=true;$("signIn").disabled=true;return;
  }
  try{
    api=await supabase();await refreshSession();
    await loadCatalog();await loadCart();await loadReservations();
    setNotice(/^\d{8,15}$/.test(APP_CONFIG.whatsappNumber)?"Sistema conectado. Las reservas se registran y validan contra inventario.":"Supabase conectado. Puedes probar el acceso con Google y el carrito; las reservas están deshabilitadas hasta configurar WhatsApp.","ok");
    api.auth.onAuthStateChange(()=>{setTimeout(async()=>{try{await refreshSession();await loadCatalog();await loadCart();await loadReservations();}catch{notify("Error al actualizar la sesión.",true);}},0);});
  }catch(error){setNotice("Error al conectar con la plataforma. Comprueba la configuración y permisos.","error");notify(safeError(error),true);}
}
main();
