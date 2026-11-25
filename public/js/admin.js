import {isConfigured,supabase,formatMoney,safeError,notify,node} from "./backend.js";
const $=id=>document.getElementById(id);
let api,products=[],inventories=[],reservations=[],users=[],selectedProduct=null,editingProduct=null,stockProduct=null,imagesBusy=false, galleryIds=[],draggingImageId=null;
function message(text,kind=""){$("accessNotice").textContent=text;$("accessNotice").className="notice "+kind;}
function action(text,fn){const b=node("button",text,"button secondary");b.type="button";b.addEventListener("click",fn);return b;}
function cell(tr,text){tr.append(node("td",text??""));}
function setTab(name){
  document.querySelectorAll(".admin-tabs button").forEach(b=>b.classList.toggle("active",b.dataset.tab===name));
  for(const n of ["products","reservations","users","settings","history","movements"])$(n+"Panel").hidden=n!==name;
}
async function loadProducts(){
  const {data,error}=await api.from("products").select("id,sku,name,description,category,price,active,updated_at,inventory(on_hand,reserved,updated_at)").order("name");
  if(error)throw error;products=data||[];
  const tbody=$("productsTable");tbody.replaceChildren();
  for(const p of products){
    const i=Array.isArray(p.inventory)?p.inventory[0]:(p.inventory||{});
    const tr=node("tr");
    const name=node("td");name.append(node("strong",p.name),node("small",p.sku));tr.append(name);
    cell(tr,formatMoney(p.price));
    const stock=node("td");
    stock.append(node("strong",String(Number(i.on_hand)||0)));
    tr.append(stock);
    cell(tr,i.reserved??0);
    cell(tr,Math.max(0,(Number(i.on_hand)||0)-(Number(i.reserved)||0)));
    cell(tr,!p.active?"Oculto":Number(i.on_hand)-Number(i.reserved)<=0?"Agotado · revisar catálogo":"Publicado");
    const imageCell=node("td");
    imageCell.append(action("Imágenes",()=>openImageManager(p)));tr.append(imageCell);
    const controls=node("td");
    const edit=action("Editar",()=>openProductEditor(p));
    controls.append(edit,action("Ajustar stock",()=>openStockEditor(p)));tr.append(controls);tbody.append(tr);
  }
  if(!products.length){const tr=node("tr");const td=node("td","Todavía no hay productos registrados.");td.colSpan=8;tr.append(td);tbody.append(tr);}
}
function openProductEditor(product){
  editingProduct=product;
  $("editProductTitle").textContent="Editar producto · "+product.name;
  $("editProductId").value=product.id;
  $("editProductSku").value=product.sku;
  $("editProductName").value=product.name;
  $("editProductCategory").value=product.category;
  $("editProductPrice").value=String(product.price);
  const inventory=Array.isArray(product.inventory)?product.inventory[0]:(product.inventory||{});
  $("editProductStock").value=String(Number(inventory.on_hand)||0);
  $("editProductStock").min=String(Number(inventory.reserved)||0);
  $("editProductActive").checked=Boolean(product.active);
  $("editReservedHint").textContent="Unidades reservadas: "+(Number(inventory.reserved)||0)+". Para ventas presenciales o reposiciones usa «Ajustar stock», que registra el motivo.";
  $("editProductDescription").value=product.description||"";
  if(!$("editProductDialog").open)$("editProductDialog").showModal();
}
async function updateProduct(event){
  event.preventDefault();
  if(!editingProduct)return;
  const form=event.currentTarget;
  const data=new FormData(form);
  const sku=String(data.get("sku")||"").trim().toUpperCase();
  const name=String(data.get("name")||"").trim();
  const category=String(data.get("category")||"").trim();
  const description=String(data.get("description")||"").trim();
  const priceText=String(data.get("price")||"").trim();
  const price=Number(priceText);
  if(sku.length<2||sku.length>64||name.length<2||name.length>160||
     category.length<2||category.length>80||description.length>1000||
     !/^\d+(?:\.\d{1,2})?$/.test(priceText)||!Number.isFinite(price)||
     price<0||price>100000000){
    notify("Revisa SKU, nombre, categoría, precio y descripción.",true);return;
  }
  const onHandText=String(data.get("on_hand")||"").trim();
  const onHand=Number(onHandText);
  const active=$("editProductActive").checked;
  const inventory=Array.isArray(editingProduct.inventory)?editingProduct.inventory[0]:(editingProduct.inventory||{});
  if(!/^\d+$/.test(onHandText)||!Number.isSafeInteger(onHand)||onHand<Number(inventory.reserved||0)||onHand>1000000){
    notify("El stock físico debe ser un entero igual o superior a lo reservado.",true);return;
  }
  const submit=form.querySelector('[type="submit"]');
  submit.disabled=true;
  const snapshot=editingProduct;
  try{
    const {error}=await api.rpc("admin_update_product",{
      p_product_id:snapshot.id,p_sku:sku,p_name:name,p_category:category,
      p_description:description,p_price:price,p_on_hand:onHand,p_active:active,
      p_expected_product_updated_at:snapshot.updated_at,
      p_expected_inventory_updated_at:inventory.updated_at
    });
    if(error)throw error;
    $("editProductDialog").close();
    editingProduct=null;
    await loadProducts();
    notify("Producto, inventario e historial actualizados correctamente.");
  }catch(e){
    if(e.code==="23505")notify("Ese SKU ya pertenece a otro producto.",true);
    else if(e.message?.includes("PRODUCT_EDIT_CONFLICT")){
      notify("El producto fue modificado desde otra sesión. Cierra el editor, actualiza la tabla y vuelve a editar.",true);
    } else notify(safeError(e),true);
  }finally{submit.disabled=false;}
}
function inventoryOf(product){return Array.isArray(product.inventory)?product.inventory[0]:(product.inventory||{});}
function openStockEditor(product){
 stockProduct=product;
 const inv=inventoryOf(product);
 $("stockDialogTitle").textContent="Ajustar stock · "+product.name;
 $("stockCurrent").textContent="Stock físico: "+inv.on_hand+" · Reservado: "+inv.reserved+" · Disponible: "+Math.max(0,inv.on_hand-inv.reserved);
 $("stockNewQuantity").value=String(inv.on_hand??0);
 $("stockNewQuantity").min=String(inv.reserved||0);
 $("stockReason").value="";
 $("stockNotes").value="";
 $("stockDialog").showModal();
}
async function adjustStock(event){
 event.preventDefault();
 if(!stockProduct)return;
 const form=event.currentTarget;
 const newStock=Number($("stockNewQuantity").value);
 const kind=$("stockReason").value;
 const notes=$("stockNotes").value.trim();
 const reason=kind+(notes?" · "+notes:"");
 const inv=inventoryOf(stockProduct);
 if(!Number.isSafeInteger(newStock)||newStock<Number(inv.reserved)||newStock>1000000){
  notify("El conteo no puede ser inferior a lo reservado ni superior a un millón.",true);return;
 }
 if(!kind||reason.length<5||reason.length>250){notify("Selecciona un motivo válido.",true);return;}
 if(newStock===Number(inv.on_hand)){notify("No hay cambios en el conteo.",true);return;}
 const submit=form.querySelector('[type="submit"]');submit.disabled=true;
 try{
  const {error}=await api.rpc("admin_adjust_stock",{
    p_product_id:stockProduct.id,p_new_on_hand:newStock,p_reason:reason,
    p_expected_inventory_updated_at:inv.updated_at
  });
  if(error)throw error;
  $("stockDialog").close();stockProduct=null;
  await Promise.all([loadProducts(),loadMovements()]);
  notify("Stock actualizado y movimiento registrado.");
 }catch(error){
  notify(error?.message?.includes("PRODUCT_EDIT_CONFLICT")?"El inventario cambió desde otra sesión. Actualiza e intenta de nuevo.":safeError(error),true);
 }finally{submit.disabled=false;}
}
const MOVEMENT_TYPES={
 manual_physical_adjustment:"Ajuste presencial",
 admin_approved_hold:"Apartado confirmado",
 sale_paid:"Pago efectuado",
 sale_credit:"Entrega a crédito",
 released_hold:"Reserva liberada",
 paid_sale_reversed:"Pago anulado",
 system_adjustment:"Cambio de inventario"
};
async function loadMovements(){
 const {data,error}=await api.from("inventory_movements")
  .select("id,product_id,movement_type,reason,old_on_hand,new_on_hand,delta,created_at")
  .order("created_at",{ascending:false}).limit(100);
 if(error)throw error;
 const tbody=$("movementsTable");tbody.replaceChildren();
 if(!data?.length){
  const tr=node("tr"),td=node("td","Todavía no hay movimientos registrados.");
  td.colSpan=7;tr.append(td);tbody.append(tr);return;
 }
 const byId=new Map(products.map(p=>[p.id,p]));
 for(const m of data){
  const tr=node("tr");
  [
   new Date(m.created_at).toLocaleString("es-PE"),
   byId.get(m.product_id)?.name||m.product_id.slice(0,8),
   MOVEMENT_TYPES[m.movement_type]||m.movement_type,
   m.reason||"—",m.old_on_hand,m.new_on_hand,
   (m.delta>0?"+":"")+m.delta
  ].forEach(v=>cell(tr,String(v)));
  tbody.append(tr);
 }
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
const STATUS={
 pending_contact:"Solicitud recibida",confirmed:"Reserva aprobada · stock separado",
 ready_for_pickup:"Lista para recojo",paid:"Pago efectuado · pendiente de recojo",
 delivered_unpaid:"Entregado a crédito · pago pendiente",
 fulfilled:"Finalizada",legacy_sale:"Venta anterior · estado pendiente de revisión",
 cancelled:"Cancelada",expired:"Solicitud vencida",refunded:"Pago anulado · stock repuesto"
};
const RESERVATION_ACTIONS={
 pending_contact:[["confirmed","Aprobar reserva y separar stock"],["cancelled","Rechazar solicitud"]],
 confirmed:[["ready_for_pickup","Marcar lista para recojo"],["paid","Registrar pago efectuado"],["delivered_unpaid","Entregar a crédito"],["cancelled","Cancelar reserva y liberar stock"]],
 ready_for_pickup:[["paid","Registrar pago efectuado"],["delivered_unpaid","Entregar a crédito"],["cancelled","Cancelar reserva y liberar stock"]],
 paid:[["fulfilled","Confirmar recojo en tienda"],["refunded","Anular pago y reponer stock (sin recojo)"]],
 delivered_unpaid:[["fulfilled","Crédito pagado · finalizar"]],
 legacy_sale:[["paid","Marcar pago registrado (venta anterior)"],["delivered_unpaid","Marcar crédito pendiente (venta anterior)"],["fulfilled","Cerrar venta anterior"]]
};
function reservationActionMessage(status,next){
 if(next==="refunded")return "¿Confirmas que el pago fue anulado y el producto NO se entregó? Se devolverá una unidad por artículo al inventario físico. Esta acción no ejecuta transferencias bancarias.";
 if(next==="confirmed")return "El administrador aprobará la solicitud y apartará las unidades disponibles. ¿Continuar?";
 if(next==="ready_for_pickup")return "El pedido está preparado y listo para ser recogido. El stock continúa apartado. ¿Continuar?";
 if(next==="paid")return status==="legacy_sale"?"Registrar el pago de una venta anterior sin descontar stock nuevamente. ¿Continuar?":"Registrar pago: se descontará el stock físico y se liberará el apartado. ¿Continuar?";
 if(next==="delivered_unpaid")return status==="legacy_sale"?"La venta anterior seguirá marcada como crédito pendiente. ¿Continuar?":"El cliente retiró el pedido a crédito; se descontará stock físico y quedará pago pendiente. ¿Continuar?";
 if(next==="fulfilled")return status==="delivered_unpaid"?"El cliente saldó el crédito. Se cerrará el pedido sin otro descuento de inventario. ¿Continuar?":"Cerrar pedido sin descontar nuevamente el stock. ¿Continuar?";
 if(next==="cancelled")return status==="pending_contact"?"Rechazar la solicitud sin modificar el inventario. ¿Continuar?":"Cancelar la reserva y liberar las unidades separadas. ¿Continuar?";
 return "¿Confirmar el cambio de estado?";
}
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
    const breakdown=node("table",undefined,"reservation-breakdown");
    const head=node("thead"),headRow=node("tr");
    for(const col of ["Producto","Cantidad","Precio histórico","Subtotal"])headRow.append(node("th",col));
    head.append(headRow);breakdown.append(head);
    const body=node("tbody");
    let computedCents=0;
    for(const x of r.reservation_items||[]){
      const trItem=node("tr");
      const unitCents=Math.round(Number(x.unit_price)*100);
      const subtotalCents=unitCents*Number(x.quantity);
      computedCents+=subtotalCents;
      trItem.append(
        node("td",x.product_name),
        node("td",String(x.quantity)),
        node("td",formatMoney(x.unit_price)),
        node("td",formatMoney(subtotalCents/100))
      );
      body.append(trItem);
    }
    breakdown.append(body);detail.append(breakdown);
    if(computedCents!==Math.round(Number(r.total)*100))
      detail.append(node("p","Aviso: el total registrado difiere de la suma de partidas.","reservation-total-warning"));
    tr.append(detail);cell(tr,formatMoney(r.total));
    const ops=node("td");
    const choices=RESERVATION_ACTIONS[r.status]||[];
    if(choices.length){
      const select=node("select",undefined,"status-select");
      select.setAttribute("aria-label","Acción para reserva "+r.code);
      select.append(new Option("Seleccionar siguiente acción",""));
      for(const [value,label] of choices)select.append(new Option(label,value));
      select.addEventListener("change",async()=>{
        const value=select.value;if(!value)return;
        if(!window.confirm(reservationActionMessage(r.status,value))){select.value="";return;}
        select.disabled=true;
        try{
          const {error}=await api.rpc("set_reservation_status",{target_id:r.id,new_status:value});
          if(error)throw error;
          notify("Estado actualizado. Inventario sincronizado.");
          await Promise.all([loadProducts(),loadReservations()]);
        }catch(error){
          notify(safeError(error),true);select.disabled=false;select.value="";
        }
      });
      ops.append(select);
    }else ops.textContent="Cerrada";
    tr.append(ops);tbody.append(tr);
  }
  if(!reservations.length){const tr=node("tr");const td=node("td","Sin reservas registradas.");td.colSpan=7;tr.append(td);tbody.append(tr);}
}
const HISTORY_AVAILABILITY={
  available:"Disponible",out_of_stock:"Sin stock",unlisted:"Retirado del catálogo"
};
const HISTORY_CHANGE={
  baseline:"Estado inicial",product_change:"Cambio de ficha o precio",
  availability_change:"Cambio de disponibilidad"
};
async function loadHistory(){
  const selector=$("historyProductSelect");
  const selected=selector.value;
  selector.replaceChildren(new Option("Selecciona un producto",""));
  for(const p of products)selector.append(new Option(p.sku+" · "+p.name,p.id));
  if(products.some(p=>p.id===selected))selector.value=selected;
  const body=$("historyTable");body.replaceChildren();
  const id=selector.value;
  if(!id){$("historySummary").textContent="Selecciona un producto para ver sus versiones históricas.";return;}
  const {data,error}=await api.from("product_history")
    .select("version_no,sku,name,price,active,availability,valid_from,valid_to,change_kind")
    .eq("product_id",id).order("version_no",{ascending:false}).limit(250);
  if(error)throw error;
  $("historySummary").textContent=(data||[]).length+" versiones registradas. Los períodos anteriores al inicio del historial no pueden reconstruirse.";
  for(const v of data||[]){
    const row=node("tr");
    const formatDate=x=>x?new Date(x).toLocaleString("es-PE"):"Actual";
    row.append(
      node("td","v"+v.version_no),
      node("td",formatDate(v.valid_from)),
      node("td",formatDate(v.valid_to)),
      node("td",v.sku+" · "+v.name),
      node("td",formatMoney(v.price)),
      node("td",v.active?"Publicado":"Oculto"),
      node("td",HISTORY_AVAILABILITY[v.availability]||v.availability),
      node("td",HISTORY_CHANGE[v.change_kind]||v.change_kind)
    );
    body.append(row);
  }
}
async function loadUsers(){
  const {data,error}=await api.from("profiles").select("id,email,display_name,role,created_at").order("created_at",{ascending:false}).limit(200);
  if(error)throw error;users=data||[];
  const tbody=$("usersTable");tbody.replaceChildren();
  for(const u of users){const tr=node("tr");cell(tr,u.display_name||"—");cell(tr,u.email||"—");cell(tr,u.role);cell(tr,new Date(u.created_at).toLocaleDateString("es-PE"));tbody.append(tr);}
  if(!users.length){const tr=node("tr");const td=node("td","No hay usuarios.");td.colSpan=4;tr.append(td);tbody.append(tr);}
}

const IMAGE_TYPES={"image/jpeg":new Set(["jpg","jpeg"]),"image/png":new Set(["png"]),"image/webp":new Set(["webp"])};
const IMAGE_BUCKET="product-images";
function validateImage(file){
  const ext=(file.name.split(".").pop()||"").toLowerCase();
  if(!IMAGE_TYPES[file.type]?.has(ext) || file.size>3145728 || file.size<=0){
    throw new Error("IMAGE_INVALID_FORMAT_OR_SIZE");
  }
  return ext;
}
async function uploadObject(product,file){
  const ext=validateImage(file);
  const path=product.id+"/"+crypto.randomUUID()+"."+ext;
  const {error}=await api.storage.from(IMAGE_BUCKET).upload(path,file,{cacheControl:"3600",contentType:file.type,upsert:false});
  if(error)throw error;
  return path;
}
function setImageNotice(text,kind=""){
  const el=$("imageNotice");
  el.textContent=text;
  el.className="fine image-notice "+kind;
}
function imagePublicUrl(img){
  return api.storage.from(IMAGE_BUCKET).getPublicUrl(img.storage_path).data.publicUrl;
}
function friendlyImageError(error){
  if(error?.message==="IMAGE_LIMIT_REACHED")return "Este producto ya tiene ocho imágenes. Elimina o reemplaza una para continuar.";
  if(error?.message?.includes("INVALID_IMAGE_ORDER"))return "La galería cambió mientras la ordenabas. Actualiza y vuelve a intentarlo.";
  if(error?.message==="IMAGE_INVALID_FORMAT_OR_SIZE")return "Usa archivos JPG, PNG o WEBP, de hasta 3 MB cada uno.";
  return safeError(error);
}

function requestedOrder(sourceId,targetId){
  const ids=[...galleryIds];
  const from=ids.indexOf(sourceId),to=ids.indexOf(targetId);
  if(from<0||to<0||from===to)return null;
  ids.splice(from,1);
  ids.splice(to,0,sourceId);
  return ids;
}
async function persistImageOrder(ids){
  if(!selectedProduct||imagesBusy||!ids||ids.length!==galleryIds.length)return;
  const productId=selectedProduct.id;
  imagesBusy=true;
  setImageNotice("Guardando el nuevo orden visual…");
  try{
    const {error}=await api.rpc("reorder_product_images",{
      p_product_id:productId,p_image_ids:ids
    });
    if(error)throw error;
    await loadProductImages();
    setImageNotice("Orden guardado. La galería pública mostrará las fotos en esta secuencia.","ok");
    notify("Orden de las fotografías actualizado.");
  }catch(error){
    setImageNotice("No se pudo guardar el orden: "+friendlyImageError(error),"error");
    notify(friendlyImageError(error),true);
    try{await loadProductImages();}catch{console.warn("Redcastle: no se pudo recuperar el orden anterior.");}
    setImageNotice("No se pudo guardar el orden: "+friendlyImageError(error),"error");
  }finally{
    imagesBusy=false;draggingImageId=null;
  }
}
function moveGalleryImage(id,direction){
  const pos=galleryIds.indexOf(id),target=pos+direction;
  if(pos<0||target<0||target>=galleryIds.length)return;
  persistImageOrder(requestedOrder(id,galleryIds[target]));
}

async function loadProductImages(){
  if(!selectedProduct)return;
  const product=selectedProduct;
  const {data,error}=await api.from("product_images")
    .select("id,product_id,storage_path,alt_text,sort_order,is_primary,created_at")
    .eq("product_id",product.id)
    .order("sort_order",{ascending:true}).order("created_at",{ascending:true});
  if(error)throw error;
  if(product.id!==selectedProduct?.id)return; // Ignore a stale answer from a different product.
  const imgs=data||[];
  galleryIds=imgs.map(im=>im.id);
  const count=imgs.length;
  const remaining=Math.max(0,8-count);
  $("imageCount").textContent=count+" de 8 imágenes · "+remaining+" espacios disponibles";
  $("imageFiles").disabled=remaining===0;
  $("submitImages").disabled=remaining===0; // Upload handler separately gates concurrent mutations.
  const parent=$("imagesList");parent.replaceChildren();
  if(!imgs.length)parent.append(node("p","No hay fotografías. Selecciona una o varias imágenes para empezar.","fine"));
  for(const im of imgs){
    const item=node("div",undefined,"admin-image-item");
    item.dataset.imageId=im.id;
    item.draggable=true;
    item.setAttribute("aria-label","Fotografía "+(galleryIds.indexOf(im.id)+1)+" de "+galleryIds.length+". Arrastra para cambiar su posición.");
    item.addEventListener("dragstart",e=>{
      if(imagesBusy){e.preventDefault();return;}
      draggingImageId=im.id;
      e.dataTransfer.effectAllowed="move";
      e.dataTransfer.setData("text/plain",im.id);
      item.classList.add("dragging");
    });
    item.addEventListener("dragover",e=>{
      if(imagesBusy||!draggingImageId||draggingImageId===im.id)return;
      e.preventDefault();e.dataTransfer.dropEffect="move";
      item.classList.add("drag-target");
    });
    item.addEventListener("dragleave",()=>item.classList.remove("drag-target"));
    item.addEventListener("drop",e=>{
      e.preventDefault();e.stopPropagation();
      item.classList.remove("drag-target");
      if(imagesBusy||!draggingImageId)return;
      const ids=requestedOrder(draggingImageId,im.id);
      if(ids)persistImageOrder(ids);
    });
    item.addEventListener("dragend",()=>{
      draggingImageId=null;
      parent.querySelectorAll(".dragging,.drag-target").forEach(el=>el.classList.remove("dragging","drag-target"));
    });
    const index=galleryIds.indexOf(im.id);
    const positionTools=node("div",undefined,"image-position-bar");
    positionTools.append(node("span","Posición "+(index+1)+" de "+imgs.length+" · Arrastra","image-position-label"));
    const left=action("←",()=>moveGalleryImage(im.id,-1));
    left.classList.add("move-image-button");left.disabled=index===0;
    left.title="Mover imagen a la posición anterior";left.setAttribute("aria-label","Mover imagen anterior");
    const right=action("→",()=>moveGalleryImage(im.id,1));
    right.classList.add("move-image-button");right.disabled=index===imgs.length-1;
    right.title="Mover imagen a la posición siguiente";right.setAttribute("aria-label","Mover imagen siguiente");
    positionTools.append(left,right);item.append(positionTools);
    const url=imagePublicUrl(im);
    const preview=node("img");
    preview.src=url;preview.alt=im.alt_text||product.name;
    preview.loading="eager";preview.decoding="async";
    preview.draggable=false;
    preview.addEventListener("error",()=>{
      preview.replaceWith(node("p","No se puede mostrar la miniatura en este navegador.","image-preview-error"));
      setImageNotice("Las imágenes están registradas, pero Opera no pudo cargar una miniatura. Usa «Abrir original» para comprobar el acceso.","warning");
    });
    item.append(preview);
    if(im.is_primary)item.append(node("strong","✓ Imagen principal del catálogo","image-primary-label"));
    const tools=node("div",undefined,"admin-image-tools");
    const open=node("a","Abrir original ↗","button secondary");
    open.href=url;open.target="_blank";open.rel="noopener noreferrer";tools.append(open);
    if(!im.is_primary){
      const primary=action("★ Usar como imagen principal",async()=>{
        if(imagesBusy)return;imagesBusy=true;
        primary.disabled=true;
        setImageNotice("Actualizando imagen principal…");
        try{
          const {error}=await api.rpc("set_primary_product_image",{
            p_product_id:product.id,p_image_id:im.id
          });
          if(error)throw error;
          await loadProductImages();
          setImageNotice("Imagen principal actualizada. Vuelve al catálogo y recarga la tienda para comprobarla.","ok");
          notify("Imagen principal actualizada.");
        }catch(e){
          setImageNotice("No se pudo cambiar la imagen principal: "+friendlyImageError(e),"error");
          notify(friendlyImageError(e),true);
        }finally{imagesBusy=false;primary.disabled=false;}
      });
      tools.append(primary);
    }
    const labelInput=node("input");labelInput.type="text";
    labelInput.maxLength=180;labelInput.value=im.alt_text||"";
    labelInput.setAttribute("aria-label","Descripción de imagen para "+product.name);
    const save=action("Guardar descripción",async()=>{
      save.disabled=true;
      try{
        const {error}=await api.from("product_images")
          .update({alt_text:labelInput.value.trim()})
          .eq("id",im.id);
        if(error)throw error;
        await loadProductImages();
        setImageNotice("Descripción de la imagen actualizada.","ok");
      }catch(e){setImageNotice(friendlyImageError(e),"error");notify(friendlyImageError(e),true);}
      finally{save.disabled=false;}
    });
    const replacement=node("input");replacement.type="file";
    replacement.accept="image/jpeg,image/png,image/webp";
    replacement.className="replace-image-input";
    replacement.setAttribute("aria-label","Reemplazar imagen existente");
    replacement.addEventListener("change",async()=>{
      const file=replacement.files?.[0];if(!file||imagesBusy)return;
      imagesBusy=true;let newPath;
      setImageNotice("Reemplazando imagen…");
      try{
        newPath=await uploadObject(product,file);
        const {error}=await api.from("product_images")
          .update({storage_path:newPath}).eq("id",im.id);
        if(error)throw error;
        const {error:cleanupError}=await api.storage.from(IMAGE_BUCKET).remove([im.storage_path]);
        if(cleanupError)console.warn("Redcastle: limpieza pendiente de imagen anterior.",cleanupError.code||"StorageError");
        await loadProductImages();
        setImageNotice("Imagen reemplazada. Puedes actualizar el catálogo para verla.","ok");
        notify("Imagen reemplazada.");
      }catch(e){
        if(newPath)await api.storage.from(IMAGE_BUCKET).remove([newPath]);
        setImageNotice(friendlyImageError(e),"error");notify(friendlyImageError(e),true);
      }finally{imagesBusy=false;}
    });
    const del=action("Eliminar imagen",async()=>{
      if(imagesBusy)return;
      imagesBusy=true;del.disabled=true;
      setImageNotice("Eliminando imagen…");
      try{
        const {error}=await api.from("product_images").delete().eq("id",im.id);
        if(error)throw error;
        const {error:removeError}=await api.storage.from(IMAGE_BUCKET).remove([im.storage_path]);
        if(removeError)console.warn("Redcastle: limpieza pendiente en Storage.",removeError.code||"StorageError");
        await loadProductImages();
        setImageNotice("Imagen eliminada; hay un espacio disponible para otra fotografía.","ok");
        notify("Imagen eliminada.");
      }catch(e){setImageNotice(friendlyImageError(e),"error");notify(friendlyImageError(e),true);}
      finally{imagesBusy=false;del.disabled=false;}
    });
    tools.append(labelInput,save,replacement,del);
    item.append(tools);parent.append(item);
  }
  if(remaining===0)setImageNotice("Límite de 8 imágenes alcanzado. Puedes elegir otra principal, reemplazar o eliminar una de las existentes.","warning");
}
async function openImageManager(product){
  selectedProduct=product;
  $("imageDialogTitle").textContent="Fotografías · "+product.name;
  $("imageCount").textContent="Consultando imágenes…";
  $("imagesList").replaceChildren();
  setImageNotice("Cargando galería del producto…");
  if(!$("imageDialog").open)$("imageDialog").showModal();
  try{await loadProductImages();}catch(e){
    setImageNotice("Error al leer la galería: "+friendlyImageError(e),"error");
    notify(friendlyImageError(e),true);
  }
}
async function uploadImages(event){
  event.preventDefault();
  if(!selectedProduct||imagesBusy)return;
  const product=selectedProduct;
  const files=[...$("imageFiles").files];
  if(!files.length)return;
  const submit=$("submitImages");
  imagesBusy=true;submit.disabled=true;
  let inserted=0;
  try{
    const {data,error:readError}=await api.from("product_images")
      .select("id,is_primary").eq("product_id",product.id);
    if(readError)throw readError;
    const existing=Array.isArray(data)?data:[];
    if(files.length>8-existing.length)throw new Error("IMAGE_LIMIT_REACHED");
    // Validate every file before starting a partial multi-file upload.
    for(const file of files)validateImage(file);
    const alt=$("imageAlt").value.trim();
    for(const file of files){
      setImageNotice("Subiendo imagen "+(inserted+1)+" de "+files.length+"…");
      const path=await uploadObject(product,file);
      const primary=!existing.some(x=>x.is_primary);
      const {error:insertError}=await api.from("product_images").insert({
        product_id:product.id,storage_path:path,alt_text:alt||product.name,
        sort_order:existing.length,is_primary:primary
      });
      if(insertError){
        await api.storage.from(IMAGE_BUCKET).remove([path]);
        throw insertError;
      }
      existing.push({id:path,is_primary:primary});
      inserted++;
      // Confirm each successful image visually even if another one fails later.
      await loadProductImages();
    }
    event.currentTarget.reset();
    setImageNotice(inserted+" imagen"+(inserted===1?"":"es")+" registrada"+(inserted===1?"":"s")+". Ahora puedes elegir la principal.","ok");
    notify(inserted+" fotografías añadidas.");
  }catch(e){
    const msg=friendlyImageError(e);
    const prefix=inserted?inserted+" imagen(es) guardadas correctamente. ":"";
    setImageNotice(prefix+"No se completó la carga: "+msg,"error");
    notify(prefix+msg,true);
    try{await loadProductImages();}catch{console.warn("Redcastle: no se pudo refrescar la galería.");}
    // Preserve a useful failure notice after refreshing the gallery.
    setImageNotice(prefix+"No se completó la carga: "+msg,"error");
  }finally{imagesBusy=false;submit.disabled=$("imageFiles").disabled;}
}
async function loadContactSettings(){
  const {data,error}=await api.from("site_settings").select("whatsapp_number").eq("singleton",true).maybeSingle();
  if(error)throw error;
  $("whatsappNumber").value=data?.whatsapp_number||"";
}
async function saveContactSettings(event){
  event.preventDefault();
  const value=$("whatsappNumber").value.trim();
  if(!/^[0-9]{8,15}$/.test(value)){notify("Ingresa el número internacional con 8 a 15 dígitos.",true);return;}
  const submit=event.currentTarget.querySelector("[type=submit]");submit.disabled=true;
  try{
    const {error}=await api.from("site_settings").upsert({singleton:true,whatsapp_number:value,updated_at:new Date().toISOString()},{onConflict:"singleton"});
    if(error)throw error;
    notify("WhatsApp actualizado para las próximas solicitudes.");
  }catch(e){notify(safeError(e),true);}finally{submit.disabled=false;}
}

async function main(){
  document.querySelectorAll(".admin-tabs button").forEach(b=>b.addEventListener("click",()=>setTab(b.dataset.tab)));
  $("createProduct").addEventListener("submit",createProduct);
  $("historyProductSelect").addEventListener("change",()=>loadHistory().catch(e=>notify(safeError(e),true)));
  $("reloadHistory").addEventListener("click",()=>loadHistory().catch(e=>notify(safeError(e),true)));
  $("editProductForm").addEventListener("submit",updateProduct);
  $("stockAdjustForm").addEventListener("submit",adjustStock);
  $("closeStockDialog").addEventListener("click",()=>$("stockDialog").close());
  $("stockDialog").addEventListener("close",()=>{stockProduct=null;});
  $("reloadMovements").addEventListener("click",()=>loadMovements().catch(e=>notify(safeError(e),true)));
  $("closeEditProduct").addEventListener("click",()=>$("editProductDialog").close());
  $("editProductDialog").addEventListener("close",()=>{editingProduct=null;});
  $("editProductDialog").addEventListener("click",e=>{if(e.target===$("editProductDialog"))$("editProductDialog").close();});
  $("uploadImages").addEventListener("submit",uploadImages);
  $("reloadImages").addEventListener("click",async()=>{
    if(!selectedProduct||imagesBusy)return;
    setImageNotice("Actualizando galería…");
    try{
      await loadProductImages();
      if(!$("imageFiles").disabled)setImageNotice("Galería actualizada.","ok");
    }catch(error){
      setImageNotice("No se pudo actualizar la galería: "+friendlyImageError(error),"error");
    }
  });
  $("contactSettings").addEventListener("submit",saveContactSettings);
  $("closeImageDialog").addEventListener("click",()=>$("imageDialog").close());
  $("imageDialog").addEventListener("click",e=>{if(e.target===$("imageDialog"))$("imageDialog").close();});
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
    await Promise.all([loadProducts(),loadUsers(),loadContactSettings()]);
    await loadHistory();
    await loadReservations();
    await loadMovements();
  }catch(e){message("Error al validar el acceso administrativo. Revisa la sesión y la configuración.","error");notify(safeError(e),true);}
}
main();
