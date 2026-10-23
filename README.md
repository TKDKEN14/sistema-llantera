# Sistema de la llantera

Inventario de llantas, fricciones y repuestos con foto, registro de ventas que descuenta el inventario solo, entradas de mercadería y contabilidad (ingresos, costo de lo vendido, gastos y ganancia). Todo se guarda en **PostgreSQL**.

Funciona en el navegador de la computadora y del celular. Si varios equipos usan el mismo servidor, todos ven el mismo inventario.

[![Desplegar en Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/TKDKEN14/sistema-llantera)

## Qué hace

- **Inventario**: cada producto lleva tipo (llanta, fricción, rin, tubo, aceite, batería u otro), numeración o código, marca, modelo, estado (nueva o usada, con % de vida), vehículo al que aplica, cantidad, costo, precio, ubicación y foto.
- **Búsqueda rápida**: se escribe la medida como sea (`205/55R16`, `205 55 16`, `2055516`), la marca o el vehículo (`hilux`). Filtros por tipo, nueva/usada, rin (R13, R15, R16…) y existencia.
- **Agotado**: cuando una venta deja la cantidad en 0, el producto aparece como **AGOTADO** y no se puede vender hasta que entre más.
- **Ventas**: carrito con varios productos y servicios (montaje, balanceo, reparación…), forma de pago, cliente y comprobante para copiar y mandar por WhatsApp. El servidor revisa la existencia dentro de una transacción, así dos equipos no pueden vender la misma llanta dos veces.
- **Anular venta**: devuelve los productos al inventario y la saca de la contabilidad.
- **Entradas**: cuando llega mercadería suma al inventario y recalcula el costo promedio.
- **Contabilidad**: por día, semana, mes, año o fechas a elección. Ingresos, costo de lo vendido, ganancia bruta, gastos, ganancia neta, compras, gráfico, más vendidos, formas de pago, valor del inventario y lista de lo que se está agotando.
- **Exportar** ventas, reporte e inventario a CSV (abre en Excel) y **respaldo completo** en un archivo (incluye fotos).

## Cómo arrancarlo

### Opción A: con Docker (lo más fácil)

1. Instalá [Docker Desktop](https://www.docker.com/products/docker-desktop/).
2. Abrí `docker-compose.yml` y cambiá `cambia-esta-clave` (en los dos lugares) por una clave propia.
3. En una terminal, dentro de esta carpeta:
   ```
   docker compose up -d
   ```
4. Abrí http://localhost:3000

Los datos quedan en el volumen `datos` de Docker y no se pierden al apagar la computadora.

### Opción B: con Node.js y PostgreSQL instalados

1. Instalá [Node.js 18 o más nuevo](https://nodejs.org/) y [PostgreSQL](https://www.postgresql.org/download/).
2. Creá la base de datos (en `psql` o pgAdmin):
   ```sql
   CREATE USER llantera WITH PASSWORD 'tu-clave';
   CREATE DATABASE llantera OWNER llantera;
   ```
3. Copiá `.env.ejemplo` como `.env` y poné la conexión:
   ```
   DATABASE_URL=postgres://llantera:tu-clave@localhost:5432/llantera
   ```
4. En una terminal, dentro de esta carpeta:
   ```
   npm install
   npm start
   ```
5. Abrí http://localhost:3000

Las tablas se crean solas la primera vez (ver `schema.sql`).

### Usarlo desde el celular

- **En el mismo WiFi**: averiguá la IP de la computadora donde corre (ej. `192.168.1.20`) y en el celular abrí `http://192.168.1.20:3000`.
- **Desde cualquier lugar**: hay que subirlo a un servidor en internet (Render, Railway, un VPS…) con una base PostgreSQL. En ese caso poné `APP_PASSWORD` en el `.env` para que pida contraseña, y `PGSSL=true` si el proveedor lo exige.

## Respaldos

- Desde la página: **Ajustes → Descargar respaldo completo**. Se restaura con **Restaurar desde respaldo**.
- Desde PostgreSQL: `pg_dump -Fc llantera > llantera.dump` y se restaura con `pg_restore -d llantera llantera.dump`.

## Archivos

| Archivo | Para qué |
|---|---|
| `server.js` | Servidor (Express) con la API y la conexión a PostgreSQL |
| `schema.sql` | Tablas: `productos`, `fotos`, `ventas`, `venta_items`, `entradas`, `gastos`, `config` |
| `public/index.html` | La página completa (inventario, ventas, contabilidad) |
| `.env.ejemplo` | Configuración de ejemplo |
| `docker-compose.yml`, `Dockerfile` | Para arrancar todo con Docker |
