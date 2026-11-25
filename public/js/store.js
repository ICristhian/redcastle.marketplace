"use strict";
(() => {
  const PRODUCTS = [
    {id:"aurora-headphones",name:"Audífonos Aurora Wireless",category:"Tecnología",desc:"Sonido envolvente · Bluetooth",price:249,old:329,tag:"OFERTA",art:"headphones",color:"#e9eff3"},
    {id:"nomad-backpack",name:"Mochila Nómada Urban",category:"Accesorios",desc:"Diseño versátil · 18 litros",price:139,old:null,tag:"NUEVO",art:"backpack",color:"#f0eae6"},
    {id:"halo-lamp",name:"Lámpara Halo de escritorio",category:"Hogar",desc:"Luz cálida · Estilo minimalista",price:179,old:219,tag:"OFERTA",art:"lamp",color:"#f0eee7"},
    {id:"pulse-watch",name:"Smartwatch Pulse Fit",category:"Tecnología",desc:"Pantalla digital · Diseño deportivo",price:319,old:null,tag:"POPULAR",art:"watch",color:"#e7edf3"},
    {id:"terra-bottle",name:"Botella térmica Terra",category:"Accesorios",desc:"Acero inoxidable · 750 ml",price:79,old:99,tag:"OFERTA",art:"bottle",color:"#e8eee9"},
    {id:"sonic-speaker",name:"Parlante Sonic Mini",category:"Tecnología",desc:"Portátil · Conexión inalámbrica",price:189,old:null,tag:"",art:"speaker",color:"#ebe9f1"},
    {id:"cloud-chair",name:"Silla Lounge Cloud",category:"Hogar",desc:"Confort y estilo · Hogar",price:459,old:549,tag:"OFERTA",art:"chair",color:"#f0e9e4"},
    {id:"atelier-mug",name:"Taza Atelier Cerámica",category:"Hogar",desc:"Diseño artesanal · 350 ml",price:49,old:null,tag:"",art:"mug",color:"#f0ece4"}
  ];
  const STORAGE_KEY = "redcastle-demo-cart-v1";
  const MAX_QTY = 10;
  const $ = (id) => document.getElementById(id);
  const money = (n) => "S/ " + n.toFixed(2);
  let activeCategory = "Todos";
  let searchText = "";
  let sortOrder = "default";
  let cart = {};
  let toastTimer;

  function safeLoadCart() {
    try {
      const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      if (!data || Array.isArray(data) || typeof data !== "object") return {};
      const valid = {};
      for (const p of PRODUCTS) {
        const q = data[p.id];
        if (Number.isInteger(q) && q > 0) valid[p.id] = Math.min(q, MAX_QTY);
      }
      return valid;
    } catch { return {}; }
  }
  function saveCart() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cart)); }
    catch { showToast("No fue posible guardar el carrito en este navegador."); }
  }
  function iconSvg(name, label) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg","svg");
    svg.setAttribute("viewBox","0 0 320 260");
    svg.setAttribute("aria-hidden","true");
    const use = document.createElementNS("http://www.w3.org/2000/svg","use");
    use.setAttribute("href","/assets/products.svg#" + name);
    svg.append(use);
    return svg;
  }
  function showToast(message) {
    const el = $("toast");
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2700);
  }
  function itemCount() { return Object.values(cart).reduce((n,q) => n + q,0); }
  function sum() { return PRODUCTS.reduce((n,p) => n + (cart[p.id] || 0) * p.price, 0); }
  function renderProducts() {
    const grid = $("productGrid");
    grid.replaceChildren();
    const filtered = PRODUCTS.filter((p) => {
      const categoryMatches = activeCategory === "Todos" || p.category === activeCategory;
      const textMatches = (p.name + " " + p.category + " " + p.desc).toLocaleLowerCase("es").includes(searchText);
      return categoryMatches && textMatches;
    });
    if (sortOrder === "price-asc") filtered.sort((a,b) => a.price-b.price);
    else if (sortOrder === "price-desc") filtered.sort((a,b) => b.price-a.price);
    else if (sortOrder === "name") filtered.sort((a,b) => a.name.localeCompare(b.name,"es"));
    $("resultCount").textContent = filtered.length + (filtered.length === 1 ? " producto" : " productos");
    $("noResults").hidden = filtered.length !== 0;
    for (const p of filtered) {
      const article = document.createElement("article");
      article.className = "product-card";
      const art = document.createElement("div");
      art.className = "product-art";
      art.style.backgroundColor = p.color;
      art.append(iconSvg(p.art));
      if (p.tag) {
        const tag = document.createElement("span");
        tag.className = "product-tag" + (p.tag === "OFERTA" ? " sale" : "");
        tag.textContent = p.tag; art.append(tag);
      }
      const content = document.createElement("div");
      content.className = "product-content";
      const category = document.createElement("span");
      category.className = "product-category"; category.textContent = p.category;
      const name = document.createElement("h3");
      name.className = "product-name"; name.textContent = p.name;
      const desc = document.createElement("p");
      desc.className = "product-description"; desc.textContent = p.desc;
      const prices = document.createElement("div");
      prices.className = "product-price-row";
      const price = document.createElement("strong");
      price.className = "product-price"; price.textContent = money(p.price);
      prices.append(price);
      if (p.old) {
        const old = document.createElement("span");
        old.className = "old-price"; old.textContent = money(p.old); prices.append(old);
      }
      const button = document.createElement("button");
      button.className = "add-button";
      button.type = "button";
      button.setAttribute("aria-label","Agregar " + p.name + " al carrito");
      const btnText = document.createElement("span");
      btnText.textContent = "Agregar al carrito";
      const plus = document.createElement("span"); plus.textContent = "+";
      button.append(btnText,plus);
      button.addEventListener("click",() => updateQuantity(p.id,(cart[p.id] || 0) + 1,true));
      content.append(category,name,desc,prices,button);
      article.append(art,content); grid.append(article);
    }
  }
  function updateQuantity(id,qty,announce=false) {
    const p = PRODUCTS.find(x=>x.id===id);
    if (!p) return;
    if (!Number.isInteger(qty) || qty < 0) return;
    if (qty > MAX_QTY) {
      showToast("Máximo de " + MAX_QTY + " unidades por producto.");
      return;
    }
    if (qty === 0) delete cart[id];
    else cart[id] = qty;
    saveCart();
    renderCart();
    if (announce) showToast(p.name + " agregado al carrito.");
  }
  function qtyButton(text,label,handler) {
    const button = document.createElement("button");
    button.type = "button"; button.textContent = text;
    button.setAttribute("aria-label",label);
    button.addEventListener("click",handler);
    return button;
  }
  function renderCart() {
    const count = itemCount();
    $("cartCount").textContent = count;
    $("cartTitleCount").textContent = "(" + count + ")";
    $("openCart").setAttribute("aria-label","Abrir carrito de compras, " + count + (count === 1 ? " artículo" : " artículos"));
    $("cartSubtotal").textContent = money(sum());
    $("clearCart").disabled = !count;
    $("transferToPortal").disabled = !count;
    const items = $("cartItems"); items.replaceChildren();
    if (!count) {
      const empty = document.createElement("div");
      empty.className = "cart-empty";
      const emoji = document.createElement("span"); emoji.className = "cart-empty-icon";
      emoji.setAttribute("aria-hidden","true"); emoji.textContent = "🛒";
      const heading = document.createElement("h3"); heading.textContent = "Tu carrito está vacío";
      const text = document.createElement("p"); text.textContent = "Explora nuestros productos y agrega lo que más te guste.";
      const explore = document.createElement("button");
      explore.type = "button"; explore.className = "btn btn-primary"; explore.textContent = "Ver productos";
      explore.addEventListener("click",() => { $("cartDialog").close(); $("productos").scrollIntoView({behavior:"smooth"}); });
      empty.append(emoji,heading,text,explore);
      items.append(empty); return;
    }
    for (const p of PRODUCTS) {
      const qty = cart[p.id] || 0;
      if (!qty) continue;
      const item = document.createElement("div"); item.className = "cart-item";
      const art = document.createElement("div"); art.className = "cart-item-art"; art.style.backgroundColor = p.color;
      art.append(iconSvg(p.art));
      const body = document.createElement("div"); body.className = "cart-item-body";
      const name = document.createElement("div"); name.className = "cart-item-name"; name.textContent = p.name;
      const price = document.createElement("div"); price.className = "cart-item-price"; price.textContent = money(p.price * qty);
      const actions = document.createElement("div"); actions.className = "cart-item-actions";
      const stepper = document.createElement("div"); stepper.className = "qty-control";
      const minus = qtyButton("−","Quitar una unidad de " + p.name,() => updateQuantity(p.id,qty-1));
      const value = document.createElement("span"); value.textContent = qty;
      const plus = qtyButton("+","Agregar una unidad de " + p.name,() => updateQuantity(p.id,qty+1));
      minus.disabled = qty <= 0; plus.disabled = qty >= MAX_QTY;
      stepper.append(minus,value,plus);
      const remove = document.createElement("button");
      remove.type = "button"; remove.className = "remove-button"; remove.textContent = "Eliminar";
      remove.setAttribute("aria-label","Eliminar " + p.name + " del carrito");
      remove.addEventListener("click",() => updateQuantity(p.id,0));
      actions.append(stepper,remove); body.append(name,price,actions); item.append(art,body); items.append(item);
    }
  }
  function setCategory(category,scroll=true) {
    activeCategory = category;
    document.querySelectorAll(".filter-chip").forEach(chip => {
      const active = chip.dataset.category === category;
      chip.classList.toggle("active",active);
      chip.setAttribute("aria-pressed",String(active));
    });
    renderProducts();
    if (scroll) $("productos").scrollIntoView({behavior:"smooth"});
  }
  cart = safeLoadCart();
  $("year").textContent = new Date().getFullYear();
  $("openCart").addEventListener("click",() => $("cartDialog").showModal());
  $("closeCart").addEventListener("click",() => $("cartDialog").close());
  $("cartDialog").addEventListener("click",(e) => {
    if (e.target === $("cartDialog")) $("cartDialog").close();
  });
  $("clearCart").addEventListener("click",() => { cart = {}; saveCart(); renderCart(); showToast("Carrito vaciado."); });
  $("transferToPortal").addEventListener("click",() => {
    if (!itemCount()) return;
    // Solo IDs de producto conocidos y cantidades enteras, sin precios editables.
    const selection = {};
    for (const p of PRODUCTS) {
      const quantity = cart[p.id];
      if (Number.isInteger(quantity) && quantity>=1 && quantity<=MAX_QTY) selection[p.id]=quantity;
    }
    try {
      sessionStorage.setItem("redcastle-legacy-handoff-v1",JSON.stringify(selection));
      sessionStorage.setItem("redcastle-return-section-v1","carrito");
      location.assign("/portal.html#carrito");
    } catch {
      showToast("No se pudo transferir la selección. Revisa el almacenamiento de Opera.");
    }
  });
  $("siteSearch").addEventListener("input",(e) => { searchText = e.target.value.trim().toLocaleLowerCase("es"); renderProducts(); });
  $("sortSelect").addEventListener("change",(e) => { sortOrder = e.target.value; renderProducts(); });
  $("resetFilters").addEventListener("click",() => { $("siteSearch").value = ""; searchText = ""; setCategory("Todos",false); });
  document.querySelectorAll(".filter-chip,.category-card").forEach(button => {
    button.addEventListener("click",() => setCategory(button.dataset.category));
  });
  renderProducts();
  renderCart();
})();
