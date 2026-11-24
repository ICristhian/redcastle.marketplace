import {isConfigured,supabase,formatMoney,safeError,notify,node} from "./backend.js";
const $=id=>document.getElementById(id);
let api,products=[],inventories=[],reservations=[],users=[],selectedProduct=null,imagesBusy=false;
function message(text,kind=""){$("accessNotice").textContent=text;$("accessNotice").className="notice "+kind;}
function action(text,fn){const b=node("button",text,"button secondary");b.type="button";b.addEventListener("click",fn);return b;}
function cell(tr,text){tr.append(node("td",text??""));}
function setTab(name){
  document.querySelectorAll(".admin-tabs button").forEach(b=>b.classList.toggle("active",b.dataset.tab===name));
  for(const n of ["products","reservations","users","settings"])$(n+"Panel").hidden=n!==name;
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
    controls.append(save);tr.append(controls);tbody.append(tr);
  }
  if(!products.length){const tr=node("tr");const td=node("td","Todavía no hay productos registrados.");td.colSpan=8;tr.append(td);tbody.append(tr);}
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
async function loadProductImages(){
  if(!selectedProduct)return;
  const {data,error}=await api.from("product_images").select("id,product_id,storage_path,alt_text,sort_order,is_primary,created_at")
    .eq("product_id",selectedProduct.id).order("sort_order",{ascending:true}).order("created_at");
  if(error)throw error;
  const imgs=data||[];
  const parent=$("imagesList");parent.replaceChildren();
  if(!imgs.length)parent.append(node("p","No hay imágenes. Añade la primera para el catálogo.","fine"));
  for(const im of imgs){
    const item=node("div",undefined,"admin-image-item");
    const url=api.storage.from(IMAGE_BUCKET).getPublicUrl(im.storage_path).data.publicUrl;
    const preview=node("img");preview.src=url;preview.alt=im.alt_text||selectedProduct.name;
    preview.loading="lazy";item.append(preview);
    if(im.is_primary)item.append(node("strong","Imagen principal","image-primary-label"));
    const tools=node("div",undefined,"admin-image-tools");
    if(!im.is_primary){
      const primary=action("Elegir principal",async()=>{
        if(imagesBusy)return;
        imagesBusy=true;
        try{
          const {error}=await api.rpc("set_primary_product_image",{p_product_id:selectedProduct.id,p_image_id:im.id});
          if(error)throw error;
          await loadProductImages();notify("Imagen principal actualizada.");
        }catch(e){notify(safeError(e),true);}finally{imagesBusy=false;}
      });
      tools.append(primary);
    }
    const labelInput=node("input");labelInput.type="text";labelInput.maxLength=180;labelInput.value=im.alt_text||"";
    labelInput.setAttribute("aria-label","Texto alternativo de "+selectedProduct.name);
    const position=node("input");position.type="number";position.min="0";position.max="9999";position.step="1";position.value=String(im.sort_order);
    position.setAttribute("aria-label","Orden de imagen");
    const save=action("Guardar texto y orden",async()=>{
      const order=Number(position.value);
      if(!Number.isInteger(order)||order<0||order>9999){notify("Orden inválido.",true);return;}
      save.disabled=true;
      try{
        const {error}=await api.from("product_images").update({alt_text:labelInput.value.trim(),sort_order:order}).eq("id",im.id);
        if(error)throw error;
        await loadProductImages();notify("Imagen actualizada.");
      }catch(e){notify(safeError(e),true);}finally{save.disabled=false;}
    });
    const replacement=node("input");replacement.type="file";replacement.accept="image/jpeg,image/png,image/webp";
    replacement.className="replace-image-input";replacement.setAttribute("aria-label","Reemplazar imagen");
    replacement.addEventListener("change",async()=>{
      const file=replacement.files?.[0];if(!file||imagesBusy)return;
      imagesBusy=true;
      let newPath;
      try{
        newPath=await uploadObject(selectedProduct,file);
        const {error}=await api.from("product_images").update({storage_path:newPath}).eq("id",im.id);
        if(error)throw error;
        const {error:cleanupError}=await api.storage.from(IMAGE_BUCKET).remove([im.storage_path]);
        if(cleanupError)console.warn("Redcastle: original image cleanup pending.",cleanupError.code||"StorageError");
        await loadProductImages();notify("Fotografía reemplazada.");
      }catch(e){
        if(newPath)await api.storage.from(IMAGE_BUCKET).remove([newPath]);
        notify(safeError(e),true);
      }finally{imagesBusy=false;}
    });
    const del=action("Eliminar",async()=>{
      if(imagesBusy)return;
      imagesBusy=true;
      try{
        const {error}=await api.from("product_images").delete().eq("id",im.id);
        if(error)throw error;
        const {error:removeError}=await api.storage.from(IMAGE_BUCKET).remove([im.storage_path]);
        if(removeError)console.warn("Redcastle: orphaned image requires cleanup.",removeError.code||"StorageError");
        await loadProductImages();notify("Imagen retirada del producto.");
      }catch(e){notify(safeError(e),true);}finally{imagesBusy=false;}
    });
    tools.append(labelInput,position,save,replacement,del);
    item.append(tools);parent.append(item);
  }
}
async function openImageManager(product){
  selectedProduct=product;
  $("imageDialogTitle").textContent="Imágenes · "+product.name;
  $("imageDialog").showModal();
  try{await loadProductImages();}catch(e){notify(safeError(e),true);}
}
async function uploadImages(event){
  event.preventDefault();
  if(!selectedProduct||imagesBusy)return;
  const files=[...$("imageFiles").files];
  if(!files.length)return;
  imagesBusy=true;
  const submit=event.currentTarget.querySelector("[type=submit]");submit.disabled=true;
  try{
    const {data:current,error:readError}=await api.from("product_images")
      .select("id,is_primary").eq("product_id",selectedProduct.id);
    if(readError)throw readError;
    if(files.length>8-(current?.length||0))throw new Error("IMAGE_LIMIT_REACHED");
    const alt=$("imageAlt").value.trim();
    for(const file of files){
      const path=await uploadObject(selectedProduct,file);
      const primary=!(current||[]).some(x=>x.is_primary);
      const {error:insertError}=await api.from("product_images").insert({
        product_id:selectedProduct.id,storage_path:path,alt_text:alt||selectedProduct.name,
        sort_order:(current?.length||0),is_primary:primary
      });
      if(insertError){await api.storage.from(IMAGE_BUCKET).remove([path]);throw insertError;}
      current.push({id:path,is_primary:primary});
    }
    event.currentTarget.reset();
    await loadProductImages();notify("Fotografías incorporadas al catálogo.");
  }catch(e){notify(safeError(e),true);}
  finally{imagesBusy=false;submit.disabled=false;}
}
async function loadContactSettings(){
  const {data,error}=await api.from("site_settings").select("whatsapp_number").eq("singleton",true).single();
  if(error)throw error;
  $("whatsappNumber").value=data.whatsapp_number;
}
async function saveContactSettings(event){
  event.preventDefault();
  const value=$("whatsappNumber").value.trim();
  if(!/^[0-9]{8,15}$/.test(value)){notify("Ingresa el número internacional con 8 a 15 dígitos.",true);return;}
  const submit=event.currentTarget.querySelector("[type=submit]");submit.disabled=true;
  try{
    const {error}=await api.from("site_settings").update({whatsapp_number:value,updated_at:new Date().toISOString()}).eq("singleton",true);
    if(error)throw error;
    notify("WhatsApp actualizado para las próximas solicitudes.");
  }catch(e){notify(safeError(e),true);}finally{submit.disabled=false;}
}

async function main(){
  document.querySelectorAll(".admin-tabs button").forEach(b=>b.addEventListener("click",()=>setTab(b.dataset.tab)));
  $("createProduct").addEventListener("submit",createProduct);
  $("uploadImages").addEventListener("submit",uploadImages);
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
