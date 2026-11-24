import {isConfigured,supabase,formatMoney,safeError,notify,node} from "./backend.js";
const $=id=>document.getElementById(id);
let api,products=[],inventories=[],reservations=[],users=[],selectedProduct=null,editingProduct=null,imagesBusy=false, galleryIds=[],draggingImageId=null;
function message(text,kind=""){$("accessNotice").textContent=text;$("accessNotice").className="notice "+kind;}
function action(text,fn){const b=node("button",text,"button secondary");b.type="button";b.addEventListener("click",fn);return b;}
function cell(tr,text){tr.append(node("td",text??""));}
function setTab(name){
  document.querySelectorAll(".admin-tabs button").forEach(b=>b.classList.toggle("active",b.dataset.tab===name));
  for(const n of ["products","reservations","users","settings"])$(n+"Panel").hidden=n!==name;
}
async function loadProducts(){
  const {data,error}=await api.from("products").select("id,sku,name,description,category,price,active,inventory(on_hand,reserved)").order("name");
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
    const imageCell=node("td");
    const imagesButton=action("Imágenes",()=>openImageManager(p));
    imageCell.append(imagesButton);tr.append(imageCell);
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
    controls.append(save,action("Editar ficha",()=>openProductEditor(p)));tr.append(controls);tbody.append(tr);
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
  const submit=form.querySelector('[type="submit"]');
  submit.disabled=true;
  const id=editingProduct.id;
  try{
    const {data:updated,error}=await api.from("products")
      .update({sku,name,category,description,price,updated_at:new Date().toISOString()})
      .eq("id",id)
      .select("id,sku,name,category,price").single();
    if(error)throw error;
    if(updated.id!==id)throw new Error("PRODUCT_UPDATE_FAILED");
    $("editProductDialog").close();
    editingProduct=null;
    await loadProducts();
    notify("Ficha del producto actualizada. El catálogo mostrará los cambios al recargar.");
  }catch(e){
    if(e.code==="23505")notify("El SKU ya pertenece a otro producto.",true);
    else notify(safeError(e),true);
  }finally{submit.disabled=false;}
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
  $("editProductForm").addEventListener("submit",updateProduct);
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
    await loadReservations();
  }catch(e){message("Error al validar el acceso administrativo. Revisa la sesión y la configuración.","error");notify(safeError(e),true);}
}
main();
