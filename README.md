# Redcastle Marketplace — demo retail v1

Tienda **estática de demostración** desplegada con GitHub y Cloudflare Pages.

🌐 https://redcastle-marketplace.pages.dev/

## Funcionalidades

- Diseño retail responsive (desktop, tablet y móvil).
- Catálogo de ocho productos *ficticios* con precios en soles peruanos (PEN).
- Filtros por categoría, búsqueda de texto y ordenamiento.
- Carrito de compras con botones de cantidad (máximo 10 por producto), eliminación de productos, subtotal y botón para vaciar.
- Persistencia local del carrito en `localStorage` (sin servidor ni cuentas).
- Página con cabeceras de seguridad y recursos locales, sin dependencias externas.

> **Demo:** no existe pasarela de pago, inventario real, autenticación, API, backend, envío ni registro de pedidos. El botón «Finalizar compra» permanece deshabilitado intencionadamente. Los productos, imágenes y precios son ilustrativos.

## Estructura

- `public/index.html`: portada y estructura del catálogo.
- `public/css/retail.css`: estilos de la tienda.
- `public/js/store.js`: datos ficticios del catálogo y carrito.
- `public/assets/products.svg`: ilustraciones vectoriales locales.
- `public/assets/favicon.svg`: ícono del sitio.
- `public/_headers`: cabeceras CSP, antiframe, permisos y otras protecciones.

## Publicación en Cloudflare Pages

| Ajuste | Valor |
| --- | --- |
| Production branch | `main` |
| Framework preset | `None` |
| Build command | vacío |
| Build output directory | `public` |

Cloudflare Pages está conectado a GitHub y detecta los cambios enviados a `main`.

## Pruebas manuales sugeridas

1. Abrir la tienda en Chrome/Edge y móvil; comprobar navegación responsive.
2. Buscar «audífonos» y confirmar que aparece un producto; borrar la búsqueda.
3. Seleccionar «Hogar» y ordenar por menor precio.
4. Agregar dos productos al carrito, incrementar cantidades, borrar uno y comprobar el subtotal.
5. Recargar la página y comprobar que el carrito se mantiene en el mismo navegador.
6. Vaciar el carrito; comprobar estado vacío.
7. Abrir una ventana privada y comprobar que el carrito comienza vacío.
8. Verificar el nuevo despliegue en **Cloudflare → Pages → redcastle-marketplace → Deployments**.

## Seguridad

Se utilizan `textContent` y nodos DOM para representar la información del catálogo, sin interpolar entradas del usuario como HTML. La cabecera Content-Security-Policy limita los recursos a los propios del sitio y no permite formularios ni inserción en frames. El carrito se guarda exclusivamente en el navegador. Si se añaden scripts externos, APIs, pasarelas de pago u otros componentes, deberán revisarse estas cabeceras.

Las cabeceras existentes no equivalen a una auditoría de seguridad completa. Un ecommerce real necesitará backend, control de stock, validación de precios en servidor, gestión de pedidos, pagos mediante un proveedor especializado y requisitos legales aplicables.
