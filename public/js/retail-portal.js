import {isConfigured,supabase,formatMoney,safeError,notify,node} from "./backend.js";

const $=id=>document.getElementById(id);
const LEGACY_ART={
  "DEMO-AURORA-HEADPHONES":"headphones","DEMO-NOMAD-BACKPACK":"backpack",
  "DEMO-HALO-LAMP":"lamp","DEMO-PULSE-WATCH":"watch",
  "DEMO-TERRA-BOTTLE":"bottle","DEMO-SONIC-SPEAKER":"speaker",
  "DEMO-CLOUD-CHAIR":"chair","DEMO-ATELIER-MUG":"mug"
};
const FALLBACK_COLORS=["#e9eff3","#f0eae6","#f0eee7","#e7edf3","#e8eee9","#ebe9f1","#f0e9e4","#f0ece4"];
const RETURN_KEY="redcastle-return-section-v1";
const HANDOFF_KEY="redcastle-legacy-handoff-v1";
const VALID_SECTIONS=new Set(["inicio","productos","categorias","reservas","carrito"]);
const STATUS={pending_contact:"Pendiente de contacto",confirmed:"Confirmada",cancelled:"Cancelada",expired:"Expirada",fulfilled:"Atendida"};
let api, user=null,profile=null,products=[],cart=[],reservations=[],images=[],contact="",category="Todos",search="",sort="default",selectedProduct=null;
let busy=false,initialised=false;
const safeGet=(k,local=false)=>{try{return(local?localStorage:sessionStorage).getItem(k);}catch{return null;}};
const safeSet=(k,v)=>{try{sessionStorage.setItem(k,v);}catch{}};
const safeRemove=(k,local=false)=>{try{(local?localStorage:sessionStorage).removeItem(k);}catch{}};

function placeholder(p){
  const wrapper=node("div",undefined,"fallback-art");
  const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");
  svg.setAttribute("viewBox","0 0 320 260");svg.setAttribute("aria-hidden","true");
  const use=document.createElementNS("http://www.w3.org/2000/svg","use");
  use.setAttribute("href","/assets/products.svg#"+(LEGACY_ART[p.sku]||"headphones"));
  svg.append(use);wrapper.append(svg);
  return wrapper;
}
function productImages(p){
  return images.filter(i=>i.product_id===p.id).sort((a,b)=>Number(b.is_primary)-Number(a.is_primary)||a.sort_order-b.sort_order||a.created_at.localeCompare(b.created_at));
}
function imageUrl(i){return api.storage.from("product-images").getPublicUrl(i.storage_path).data.publicUrl;}
function imageNode(i,alt){
  const img=document.createElement("img");
  img.src=imageUrl(i);img.alt=i.alt_text||alt;img.loading="lazy";img.decoding="async";
  return img;
}
function productArt(p){
  const wrapper=node("div",undefined,"product-art");
  wrapper.style.backgroundColor=FALLBACK_COLORS[products.indexOf(p)%FALLBACK_COLORS.length]||"#f0f2f4";
  const main=productImages(p)[0];
  wrapper.append(main?imageNode(main,p.name):placeholder(p));
  return wrapper;
}
function setNotice(msg,kind=""){
  $("setupNotice").className="status-notice "+kind;$("setupNotice").textContent=msg;
}
function openCart(){
  if(!$("cartDialog").open)$("cartDialog").showModal();
}
function currentSection(){
  const h=location.hash.slice(1);
  return VALID_SECTIONS.has(h)?h:"inicio";
}
function rememberSection(section=currentSection()){safeSet(RETURN_KEY,VALID_SECTIONS.has(section)?section:"inicio");}
function restoreSection(){
  if(!user)return;
  const saved=safeGet(RETURN_KEY);
  if(!saved)return;
  safeRemove(RETURN_KEY);
  const section=VALID_SECTIONS.has(saved)?saved:"inicio";
  if(section==="carrito"){openCart();return;}
  if(location.hash!=="#"+section)location.hash=section;
}
function showAuth(section=currentSection()){
  rememberSection(section);
  $("authSection").hidden=false;
  $("authSection").scrollIntoView({behavior:"smooth",block:"center"});
  notify("Inicia sesión para guardar y reservar tus productos.");
}
async function auth(provider){
  if(!api)return;
  rememberSection();
  const {error}=await api.auth.signInWithOAuth({provider,options:{
    redirectTo:location.origin+"/portal.html",
    ...(provider==="azure"?{scopes:"email"}:{})
  }});
  if(error){notify(safeError(error),true);safeRemove(RETURN_KEY);}
}
async function refreshSession(){
  const {data:{user:current},error}=await api.auth.getUser();
  if(error && !/Auth session missing/i.test(error.message))throw error;
  user=current||null;profile=null;
  if(user){
    const {data,error:profileError}=await api.from("profiles").select("id,role,display_name").eq("id",user.id).maybeSingle();
    if(profileError)throw profileError;
    profile=data;
  }
  $("userLabel").textContent=profile?.display_name||user?.email||"Invitado";
  $("signIn").hidden=!!user;
  $("signOut").hidden=!user;
  $("authSection").hidden=!!user;
  $("adminLink").hidden=profile?.role!=="admin";
  renderProducts();
  renderCart();
}
async function loadCatalog(){
  const {data,error}=await api.rpc("get_catalog");
  if(error)throw error;
  products=data||[];
  const img=await api.from("product_images").select("id,product_id,storage_path,alt_text,sort_order,is_primary,created_at");
  if(img.error)throw img.error;
  images=img.data||[];
  renderProducts();
  renderCart();
}
async function loadContact(){
  const {data,error}=await api.from("site_settings").select("whatsapp_number").eq("singleton",true).maybeSingle();
  if(error)throw error;
  contact=/^[0-9]{8,15}$/.test(data?.whatsapp_number||"")?data.whatsapp_number:"";
  renderCart();
}
function makeButton(text,className,callback){
  const el=node("button",text,className);el.type="button";el.addEventListener("click",callback);return el;
}
function renderProducts(){
  if(!initialised)return;
  const list=products.filter(p=>
    (category==="Todos"||category===p.category)&&
    [p.name,p.category,p.description,p.sku].join(" ").toLocaleLowerCase("es").includes(search)
  );
  if(sort==="price-asc")list.sort((a,b)=>Number(a.price)-Number(b.price));
  else if(sort==="price-desc")list.sort((a,b)=>Number(b.price)-Number(a.price));
  else if(sort==="name")list.sort((a,b)=>a.name.localeCompare(b.name,"es"));
  $("resultCount").textContent=list.length+(list.length===1?" producto":" productos");
  $("noResults").hidden=list.length!==0;
  $("productGrid").replaceChildren();
  for(const p of list){
    const card=node("article",undefined,"product-card");
    const openImage=makeButton("","product-image-click",()=>showProduct(p));
    openImage.setAttribute("aria-label","Ver detalles e imágenes de "+p.name);
    openImage.append(productArt(p));
    const content=node("div",undefined,"product-content");
    content.append(node("span",p.category,"product-category"),node("h3",p.name,"product-name"),node("p",p.description||p.sku,"product-description"));
    const price=node("div",undefined,"product-price-row");price.append(node("strong",formatMoney(p.price),"product-price"));
    const stock=node("div",Number(p.available)>0?String(p.available)+" disponibles":"Sin stock",Number(p.available)>0?"product-stock":"product-stock out");
    const actions=node("div",undefined,"product-actions");
    const detail=makeButton("Ver detalles","product-detail-button",()=>showProduct(p));
    const add=makeButton("Agregar al carrito +","add-button",()=>addToCart(p));
    add.disabled=Number(p.available)<=0||busy;
    actions.append(detail,add);
    content.append(price,stock,actions);card.append(openImage,content);$("productGrid").append(card);
  }
}
function renderCart(){
  const box=$("cartItems");box.replaceChildren();
  const count=cart.reduce((n,i)=>n+i.quantity,0);
  $("cartCount").textContent=count;$("cartTitleCount").textContent="("+count+")";
  $("openCart").setAttribute("aria-label","Abrir carrito de reservas, "+count+" artículos");
  let total=0;
  if(!cart.length){
    const empty=node("div",undefined,"cart-empty");
    empty.append(node("span","🛒","cart-empty-icon"),node("h3",user?"Tu carrito está vacío":"Inicia sesión para guardar tu carrito"),node("p","Explora el catálogo y agrega tus productos favoritos."));
    const browse=makeButton("Ver productos","btn btn-primary",()=>{
      $("cartDialog").close();$("productos").scrollIntoView({behavior:"smooth"});
    });
    empty.append(browse);box.append(empty);
  }
  for(const item of cart){
    const p=products.find(x=>x.id===item.product_id);if(!p)continue;
    total+=Number(p.price)*item.quantity;
    const row=node("div",undefined,"cart-item");
    const art=node("div",undefined,"cart-item-art");
    const main=productImages(p)[0];
    art.append(main?imageNode(main,p.name):placeholder(p));
    const body=node("div",undefined,"cart-item-body");
    body.append(node("div",p.name,"cart-item-name"),node("div",formatMoney(Number(p.price)*item.quantity),"cart-item-price"));
    const actions=node("div",undefined,"cart-item-actions");
    const qty=node("div",undefined,"qty-control");
    const less=makeButton("−","",()=>changeQty(p,item.quantity-1));
    less.setAttribute("aria-label","Disminuir "+p.name);
    const more=makeButton("+","",()=>changeQty(p,item.quantity+1));
    more.setAttribute("aria-label","Aumentar "+p.name);
    less.disabled=busy;more.disabled=busy||item.quantity>=Math.min(10,Number(p.available));
    qty.append(less,node("span",item.quantity),more);
    const remove=makeButton("Eliminar","remove-button",()=>changeQty(p,0));
    remove.disabled=busy;
    actions.append(qty,remove);body.append(actions);row.append(art,body);box.append(row);
  }
  $("cartSubtotal").textContent=formatMoney(total);
  $("reserve").disabled=busy||!user||!cart.length||!contact;
  $("clearCart").disabled=busy||!user||!cart.length;
  const note=$("reserveHint");
  if(note)note.textContent=!contact?"Las reservas no están disponibles temporalmente: falta configurar WhatsApp.":"El inventario se verifica al reservar. Una reserva pendiente vence a las 24 horas si no se confirma. Pago fuera de esta web.";
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
async function saveQty(productId,quantity){
  if(!user)return showAuth("carrito");
  if(busy)return;
  busy=true;renderCart();
  try{
    const query=quantity===0
      ?api.from("cart_items").delete().eq("user_id",user.id).eq("product_id",productId)
      :api.from("cart_items").upsert({user_id:user.id,product_id:productId,quantity},{onConflict:"user_id,product_id"});
    const {error}=await query;if(error)throw error;
    await loadCart();
    notify("Carrito actualizado.");
  }catch(error){notify(safeError(error),true);}
  finally{busy=false;renderCart();renderProducts();}
}
async function addToCart(p){
  if(!user)return showAuth("carrito");
  const old=cart.find(x=>x.product_id===p.id)?.quantity||0;
  if(old>=10||old>=Number(p.available)){notify("Cantidad máxima o stock insuficiente.",true);return;}
  await saveQty(p.id,old+1);
  openCart();
}
async function changeQty(p,quantity){
  if(!Number.isInteger(quantity)||quantity<0||quantity>10||quantity>Number(p.available)){
    notify("La cantidad supera la disponibilidad.",true);return;
  }
  await saveQty(p.id,quantity);
}
async function clearCart(){
  if(!user||busy)return;
  busy=true;renderCart();
  try{
    const {error}=await api.from("cart_items").delete().eq("user_id",user.id);
    if(error)throw error;
    await loadCart();notify("Carrito vaciado.");
  }catch(error){notify(safeError(error),true);}
  finally{busy=false;renderCart();renderProducts();}
}
function showProduct(p){
  selectedProduct=p;$("detailTitle").textContent=p.name;
  $("detailCategory").textContent=p.category;
  $("detailDescription").textContent=p.description||"";
  $("detailPrice").textContent=formatMoney(p.price);
  $("detailStock").textContent=Number(p.available)>0?String(p.available)+" disponibles":"Sin stock";
  $("detailAdd").disabled=Number(p.available)<=0;
  const pictures=productImages(p);
  const primary=$("detailPrimary"), thumbs=$("detailThumbs");primary.replaceChildren();thumbs.replaceChildren();
  const showAt=index=>{
    primary.replaceChildren(pictures[index]?imageNode(pictures[index],p.name):placeholder(p));
    thumbs.querySelectorAll("button").forEach((button,i)=>button.classList.toggle("active",i===index));
  };
  if(!pictures.length)primary.append(placeholder(p));
  for(let i=0;i<pictures.length;i++){
    const b=makeButton("","detail-thumb",()=>showAt(i));
    b.append(imageNode(pictures[i],p.name));b.setAttribute("aria-label","Ver imagen "+(i+1)+" de "+p.name);
    thumbs.append(b);
  }
  if(pictures.length)showAt(0);
  $("productDialog").showModal();
}
async function loadReservations(){
  reservations=[];
  if(user){
    const {data,error}=await api.from("reservations")
      .select("id,code,status,total,created_at,expires_at,reservation_items(product_name,quantity,unit_price)")
      .eq("user_id",user.id).order("created_at",{ascending:false}).limit(50);
    if(error)throw error;
    reservations=data||[];
  }
  renderReservations();
}
function whatsappLink(r){
  if(!contact)return "";
  const lines=["Hola, deseo continuar con mi reserva Redcastle "+r.code+"."];
  for(const x of r.reservation_items||[])lines.push("• "+x.quantity+" × "+x.product_name);
  lines.push("Total referencial: "+formatMoney(r.total)+".");
  lines.push("Quisiera coordinar disponibilidad y pago fuera de la web.");
  return "https://wa.me/"+contact+"?text="+encodeURIComponent(lines.join("\n"));
}
function renderReservations(){
  const box=$("reservationList");box.replaceChildren();
  if(!user){box.append(node("p","Inicia sesión para ver tus reservas."));return;}
  if(!reservations.length){box.append(node("p","Aún no tienes reservas."));return;}
  for(const r of reservations){
    const entry=node("article",undefined,"reservation-entry");
    entry.append(node("div",STATUS[r.status]||r.status,"reservation-status"));
    entry.append(node("strong",r.code),node("p",new Date(r.created_at).toLocaleString("es-PE")+" · "+formatMoney(r.total)));
    const summary=(r.reservation_items||[]).map(x=>x.quantity+" × "+x.product_name).join(", ");
    entry.append(node("p",summary));
    if(r.status==="pending_contact"||r.status==="confirmed"){
      const url=whatsappLink(r);
      if(url){
        const a=node("a","Continuar por WhatsApp ↗","btn btn-outline");a.href=url;a.rel="noopener noreferrer";a.target="_blank";entry.append(a);
      }
    }
    box.append(entry);
  }
}
async function reserve(){
  if(!user)return showAuth("carrito");
  if(!contact||!cart.length||busy)return;
  busy=true;renderCart();
  try{
    const {data,error}=await api.rpc("reserve_cart");
    if(error)throw error;
    const newR=Array.isArray(data)?data[0]:data;
    if(!newR?.reservation_code)throw Error("RESERVATION_RESPONSE_INVALID");
    await Promise.all([loadCart(),loadCatalog(),loadReservations()]);
    const record=reservations.find(r=>r.code===newR.reservation_code);
    notify("Reserva "+newR.reservation_code+" registrada. Continuando con WhatsApp.");
    $("cartDialog").close();
    const url=record&&whatsappLink(record);
    if(url)location.assign(url);
    else{location.hash="reservas";notify("Reserva registrada. Puedes retomar WhatsApp desde Mis reservas.");}
  }catch(error){notify(safeError(error),true);}
  finally{busy=false;renderCart();renderProducts();}
}
async function importLegacyCart(){
  if(!user||!products.length)return;
  let raw=safeGet(HANDOFF_KEY);
  if(!raw){
    raw=safeGet("redcastle-demo-cart-v1",true);
    if(!raw)return;
  }
  let selection;
  try{selection=JSON.parse(raw);}catch{safeRemove(HANDOFF_KEY);return;}
  if(!selection||Array.isArray(selection)||typeof selection!=="object"){safeRemove(HANDOFF_KEY);return;}
  let imported=0;
  for(const [legacyId,q] of Object.entries(selection).slice(0,30)){
    if(!/^[a-z0-9-]{2,64}$/.test(legacyId)||!Number.isInteger(q)||q<1||q>10)continue;
    const p=products.find(x=>x.sku==="DEMO-"+legacyId.toUpperCase());if(!p||Number(p.available)<1)continue;
    const current=cart.find(x=>x.product_id===p.id)?.quantity||0;
    const quantity=Math.min(10,Number(p.available),Math.max(current,q));
    const {error}=await api.from("cart_items").upsert({user_id:user.id,product_id:p.id,quantity},{onConflict:"user_id,product_id"});
    if(error){console.warn("Redcastle: legacy cart migration failed.",error.code||"CartError");return;}
    imported++;
  }
  safeRemove(HANDOFF_KEY);
  safeRemove("redcastle-demo-cart-v1",true);
  if(imported){await loadCart();notify(imported+" artículos antiguos trasladados a tu carrito personal.");}
}
function setCategory(value,scroll=true){
  category=value;
  document.querySelectorAll(".filter-chip").forEach(b=>{
    const active=b.dataset.category===value;
    b.classList.toggle("active",active);b.setAttribute("aria-pressed",String(active));
  });
  renderProducts();
  if(scroll)$("productos").scrollIntoView({behavior:"smooth"});
}
async function loadAll(){
  await refreshSession();
  await loadCatalog();
  await loadContact();
  await loadCart();
  await importLegacyCart();
  await loadReservations();
  restoreSection();
}
async function start(){
  $("year").textContent=new Date().getFullYear();
  $("openCart").addEventListener("click",openCart);
  $("closeCart").addEventListener("click",()=>$("cartDialog").close());
  $("cartDialog").addEventListener("click",e=>{if(e.target===$("cartDialog"))$("cartDialog").close();});
  $("clearCart").addEventListener("click",clearCart);
  $("reserve").addEventListener("click",reserve);
  $("signIn").addEventListener("click",()=>showAuth(currentSection()));
  $("googleLogin").addEventListener("click",()=>auth("google"));
  $("microsoftLogin").addEventListener("click",()=>auth("azure"));
  $("signOut").addEventListener("click",async()=>{
    try{await api.auth.signOut();await refreshSession();await loadCart();await loadReservations();location.hash="inicio";notify("Sesión cerrada.");}
    catch(error){notify(safeError(error),true);}
  });
  $("siteSearch").addEventListener("input",e=>{search=e.target.value.toLocaleLowerCase("es").trim();renderProducts();});
  $("sortSelect").addEventListener("change",e=>{sort=e.target.value;renderProducts();});
  $("resetFilters").addEventListener("click",()=>{
    $("siteSearch").value="";search="";setCategory("Todos",false);
  });
  document.querySelectorAll(".filter-chip,.category-card").forEach(b=>b.addEventListener("click",()=>setCategory(b.dataset.category)));
  $("reloadReservations").addEventListener("click",async()=>{
    if(!api)return;
    try{await loadReservations();notify("Reservas actualizadas.");}catch(e){notify(safeError(e),true);}
  });
  $("closeProduct").addEventListener("click",()=>$("productDialog").close());
  $("detailAdd").addEventListener("click",async()=>{
    if(!selectedProduct)return;
    $("productDialog").close();await addToCart(selectedProduct);
  });
  $("productDialog").addEventListener("click",e=>{
    if(e.target===$("productDialog"))$("productDialog").close();
  });
  initialised=true;
  if(!isConfigured()){
    setNotice("Portal no configurado. Revisa la conexión con Supabase.","error");
    $("googleLogin").disabled=true;$("microsoftLogin").disabled=true;return;
  }
  try{api=await supabase();}
  catch(error){setNotice(safeError(error),"error");return;}
  try{
    await loadAll();
    setNotice("Catálogo conectado. Puedes reservar productos disponibles y coordinar la atención por WhatsApp.");
  }catch(error){
    setNotice("No fue posible cargar alguna información. Revisa el catálogo o intenta recargar.","error");
    console.warn("Redcastle: load error.",error?.code||error?.name||"ConnectionError");
  }
  api.auth.onAuthStateChange(()=>{setTimeout(async()=>{
    try{await loadAll();}catch(error){console.warn("Redcastle: session refresh failed.",error?.code||error?.name||"AuthError");}
  },0);});
}
start();
