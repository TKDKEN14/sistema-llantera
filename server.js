// Servidor del sistema de la llantera: sirve la página y guarda todo en PostgreSQL.
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const { Pool, types } = require('pg');

// numeric -> número, date -> 'YYYY-MM-DD', bigint -> número
types.setTypeParser(1700, v => (v === null ? null : parseFloat(v)));
types.setTypeParser(1082, v => v);
types.setTypeParser(20, v => parseInt(v, 10));

if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL. Copiá .env.ejemplo a .env y poné los datos de tu PostgreSQL.');
  process.exit(1);
}
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : undefined
});

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const nid = () => crypto.randomUUID();

// ---------- contraseña opcional (APP_PASSWORD en .env) ----------
if (process.env.APP_PASSWORD) {
  app.use((req, res, next) => {
    if (req.path === '/api/salud') return next(); // Render revisa esta ruta sin contraseña
    const [, b64] = (req.headers.authorization || '').split(' ');
    const pass = b64 ? Buffer.from(b64, 'base64').toString().split(':').slice(1).join(':') : '';
    const a = Buffer.from(pass), b = Buffer.from(process.env.APP_PASSWORD);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return next();
    res.set('WWW-Authenticate', 'Basic realm="Llantera", charset="UTF-8"').status(401).send('Contraseña requerida');
  });
}

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

// ---------- utilidades ----------
const fail = (status, message) => Object.assign(new Error(message), { status, expose: true });
const wrap = fn => (req, res) => fn(req, res).catch(err => {
  if (!err.expose) console.error(err);
  const msg = err.expose ? err.message : err.code === '23514' ? 'Hay un dato fuera de rango.' : 'Error del servidor. Intentá otra vez.';
  res.status(err.status || 500).json({ error: msg });
});
async function tx(fn) {
  const c = await pool.connect();
  try { await c.query('BEGIN'); const r = await fn(c); await c.query('COMMIT'); return r; }
  catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; }
  finally { c.release(); }
}
const str = (v, max = 300) => String(v ?? '').trim().slice(0, max);
const int = (v, def = 0) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? n : def; };
const dinero = v => { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0; };
const dia = v => (/^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? String(v) : new Date().toISOString().slice(0, 10));
const rango = q => [dia(q.desde), dia(q.hasta)];
const TIPOS = ['llanta', 'friccion', 'rin', 'tubo', 'aceite', 'bateria', 'otro'];

const SEL_PRODUCTO = `SELECT id, tipo, estado, medida, marca, modelo, vida, aplicacion, cantidad, minimo, costo, precio,
  ubicacion, notas, foto_id AS "fotoId", creado, actualizado FROM productos`;
const SEL_VENTA = `SELECT v.id, v.numero, v.fecha, v.dia, v.cliente, v.metodo, v.nota, v.total, v.costo_total AS "costoTotal", v.anulada,
  COALESCE(json_agg(json_build_object('pid', i.producto_id, 'nombre', i.nombre, 'tipo', i.tipo, 'cantidad', i.cantidad,
    'precio', i.precio, 'costo', i.costo) ORDER BY i.id) FILTER (WHERE i.id IS NOT NULL), '[]') AS items
  FROM ventas v LEFT JOIN venta_items i ON i.venta_id = v.id`;
const nombreProd = p => [({ llanta: 'Llanta', friccion: 'Fricción', rin: 'Rin', tubo: 'Tubo', aceite: 'Aceite', bateria: 'Batería' })[p.tipo] || 'Producto', p.medida, p.marca, p.modelo].filter(Boolean).join(' ');

function leerProducto(b) {
  const estado = b.estado === 'usada' ? 'usada' : 'nueva';
  const p = {
    tipo: TIPOS.includes(b.tipo) ? b.tipo : 'otro', estado,
    medida: str(b.medida, 80).toUpperCase(), marca: str(b.marca, 80), modelo: str(b.modelo, 80),
    vida: estado === 'usada' && b.vida !== '' && b.vida != null ? Math.min(100, Math.max(0, int(b.vida))) : null,
    aplicacion: str(b.aplicacion, 200), cantidad: Math.max(0, int(b.cantidad)),
    minimo: b.minimo === '' || b.minimo == null ? null : Math.max(0, int(b.minimo)),
    costo: Math.max(0, dinero(b.costo)), precio: Math.max(0, dinero(b.precio)),
    ubicacion: str(b.ubicacion, 80), notas: str(b.notas, 1000), fotoId: b.fotoId ? str(b.fotoId, 60) : null
  };
  if (!p.medida) throw fail(400, 'Escribí la numeración o código del producto.');
  return p;
}

const api = express.Router();
api.use(express.json({ limit: '2mb' }));

api.get('/salud', wrap(async (req, res) => { await pool.query('SELECT 1'); res.json({ ok: true }); }));

// ---------- configuración ----------
api.get('/config', wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT negocio, moneda, minimo, servicios FROM config WHERE id = 1');
  res.json(rows[0]);
}));
api.put('/config', wrap(async (req, res) => {
  const b = req.body || {};
  const { rows } = await pool.query(
    'UPDATE config SET negocio = $1, moneda = $2, minimo = $3, servicios = $4 WHERE id = 1 RETURNING negocio, moneda, minimo, servicios',
    [str(b.negocio, 80) || 'Mi Llantera', str(b.moneda, 6) || 'L', Math.max(0, int(b.minimo, 2)), str(b.servicios, 4000)]);
  res.json(rows[0]);
}));

// ---------- fotos ----------
api.post('/fotos', express.raw({ type: 'image/*', limit: '8mb' }), wrap(async (req, res) => {
  if (!Buffer.isBuffer(req.body) || !req.body.length) throw fail(400, 'No llegó ninguna foto.');
  const tipo = String(req.headers['content-type'] || 'image/jpeg').split(';')[0];
  if (!/^image\/(jpeg|png|webp|gif)$/.test(tipo)) throw fail(400, 'Formato de foto no permitido.');
  const id = nid();
  await pool.query('INSERT INTO fotos (id, tipo, datos) VALUES ($1, $2, $3)', [id, tipo, req.body]);
  res.json({ id });
}));
api.get('/fotos/:id', wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT tipo, datos FROM fotos WHERE id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).end();
  res.set('Content-Type', rows[0].tipo).set('Cache-Control', 'private, max-age=31536000, immutable').send(rows[0].datos);
}));

// ---------- productos ----------
api.get('/productos', wrap(async (req, res) => {
  const { rows } = await pool.query(SEL_PRODUCTO + ' ORDER BY medida, marca');
  res.json(rows);
}));
api.post('/productos', wrap(async (req, res) => {
  const p = leerProducto(req.body || {});
  const id = nid();
  const out = await tx(async c => {
    const { rows } = await c.query(
      `INSERT INTO productos (id, tipo, estado, medida, marca, modelo, vida, aplicacion, cantidad, minimo, costo, precio, ubicacion, notas, foto_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
      [id, p.tipo, p.estado, p.medida, p.marca, p.modelo, p.vida, p.aplicacion, p.cantidad, p.minimo, p.costo, p.precio, p.ubicacion, p.notas, p.fotoId]);
    if (p.cantidad > 0) {
      await c.query(`INSERT INTO entradas (id, dia, producto_id, nombre, cantidad, costo_unit, total, nota)
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'Ingreso inicial')`,
        [nid(), dia(req.body.dia), id, nombreProd(p), p.cantidad, p.costo, dinero(p.cantidad * p.costo)]);
    }
    return rows[0];
  });
  res.status(201).json(out);
}));
api.put('/productos/:id', wrap(async (req, res) => {
  const p = leerProducto(req.body || {});
  await tx(async c => {
    const { rows } = await c.query('SELECT foto_id FROM productos WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!rows[0]) throw fail(404, 'Ese producto ya no existe.');
    await c.query(
      `UPDATE productos SET tipo=$2, estado=$3, medida=$4, marca=$5, modelo=$6, vida=$7, aplicacion=$8, cantidad=$9, minimo=$10,
         costo=$11, precio=$12, ubicacion=$13, notas=$14, foto_id=$15, actualizado=now() WHERE id=$1`,
      [req.params.id, p.tipo, p.estado, p.medida, p.marca, p.modelo, p.vida, p.aplicacion, p.cantidad, p.minimo, p.costo, p.precio, p.ubicacion, p.notas, p.fotoId]);
    if (rows[0].foto_id && rows[0].foto_id !== p.fotoId) await c.query('DELETE FROM fotos WHERE id = $1', [rows[0].foto_id]);
  });
  res.json({ ok: true });
}));
api.delete('/productos/:id', wrap(async (req, res) => {
  await tx(async c => {
    const { rows } = await c.query('DELETE FROM productos WHERE id = $1 RETURNING foto_id', [req.params.id]);
    if (rows[0]?.foto_id) await c.query('DELETE FROM fotos WHERE id = $1', [rows[0].foto_id]);
  });
  res.json({ ok: true });
}));

// ---------- entradas de mercadería ----------
api.get('/entradas', wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, fecha, dia, producto_id AS pid, nombre, cantidad, costo_unit AS "costoUnit", total, proveedor, nota
     FROM entradas WHERE dia BETWEEN $1 AND $2 ORDER BY fecha DESC`, rango(req.query));
  res.json(rows);
}));
api.post('/entradas', wrap(async (req, res) => {
  const b = req.body || {};
  const cant = int(b.cantidad);
  if (cant <= 0) throw fail(400, 'Escribí cuántas unidades llegaron.');
  const costoU = Math.max(0, dinero(b.costoUnit));
  const out = await tx(async c => {
    const { rows } = await c.query('SELECT * FROM productos WHERE id = $1 FOR UPDATE', [b.pid]);
    const p = rows[0];
    if (!p) throw fail(404, 'Ese producto ya no existe.');
    // costo promedio ponderado
    const costo = costoU > 0 ? (p.cantidad > 0 && p.costo > 0 ? dinero((p.cantidad * p.costo + cant * costoU) / (p.cantidad + cant)) : costoU) : p.costo;
    const precio = b.precio !== '' && b.precio != null ? Math.max(0, dinero(b.precio)) : p.precio;
    const d = dia(b.dia);
    const fecha = d === new Date().toISOString().slice(0, 10) ? new Date() : new Date(d + 'T12:00:00');
    await c.query('UPDATE productos SET cantidad = cantidad + $2, costo = $3, precio = $4, actualizado = now() WHERE id = $1', [p.id, cant, costo, precio]);
    await c.query(`INSERT INTO entradas (id, fecha, dia, producto_id, nombre, cantidad, costo_unit, total, proveedor)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [nid(), fecha, d, p.id, nombreProd(p), cant, costoU, dinero(cant * costoU), str(b.proveedor, 120)]);
    return { cantidad: p.cantidad + cant };
  });
  res.status(201).json(out);
}));

// ---------- ventas ----------
api.get('/ventas', wrap(async (req, res) => {
  const { rows } = await pool.query(SEL_VENTA + ' WHERE v.dia BETWEEN $1 AND $2 GROUP BY v.id ORDER BY v.fecha DESC', rango(req.query));
  res.json(rows);
}));
api.post('/ventas', wrap(async (req, res) => {
  const b = req.body || {};
  const items = (Array.isArray(b.items) ? b.items : []).map(i => ({
    pid: i.pid ? String(i.pid) : null, nombre: str(i.nombre, 200) || 'Cobro', tipo: str(i.tipo, 20),
    cantidad: int(i.cantidad), precio: dinero(i.precio)
  }));
  if (!items.length) throw fail(400, 'La venta no tiene productos.');
  if (items.some(i => i.cantidad <= 0)) throw fail(400, 'Hay una cantidad inválida.');
  if (items.some(i => !(i.precio > 0))) throw fail(400, 'Hay un producto o servicio sin precio.');
  const id = nid();
  const venta = await tx(async c => {
    const agotados = [];
    // se bloquean los productos en orden para evitar choques entre dos cajas
    for (const it of [...items].filter(i => i.pid).sort((a, b) => a.pid.localeCompare(b.pid))) {
      const { rows } = await c.query(
        'UPDATE productos SET cantidad = cantidad - $2, actualizado = now() WHERE id = $1 AND cantidad >= $2 RETURNING cantidad, costo, medida', [it.pid, it.cantidad]);
      if (!rows[0]) {
        const { rows: r } = await c.query('SELECT cantidad, medida FROM productos WHERE id = $1', [it.pid]);
        throw fail(409, r[0] ? `Solo quedan ${r[0].cantidad} de ${r[0].medida}. Actualizá la venta.` : `“${it.nombre}” ya no existe en el inventario.`);
      }
      it.costo = rows[0].costo;
      if (rows[0].cantidad === 0) agotados.push(rows[0].medida);
    }
    items.forEach(i => { if (i.costo == null) i.costo = 0; });
    const total = dinero(items.reduce((s, i) => s + i.cantidad * i.precio, 0));
    const costoTotal = dinero(items.reduce((s, i) => s + i.cantidad * i.costo, 0));
    await c.query(`INSERT INTO ventas (id, dia, cliente, metodo, nota, total, costo_total) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, dia(b.dia), str(b.cliente, 120), str(b.metodo, 30) || 'Efectivo', str(b.nota, 300), total, costoTotal]);
    for (const i of items) {
      await c.query('INSERT INTO venta_items (venta_id, producto_id, nombre, tipo, cantidad, precio, costo) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [id, i.pid, i.nombre, i.tipo, i.cantidad, i.precio, i.costo]);
    }
    const { rows } = await c.query(SEL_VENTA + ' WHERE v.id = $1 GROUP BY v.id', [id]);
    return { ...rows[0], agotados };
  });
  res.status(201).json(venta);
}));
api.post('/ventas/:id/anular', wrap(async (req, res) => {
  await tx(async c => {
    const { rows } = await c.query('UPDATE ventas SET anulada = true, anulada_fecha = now() WHERE id = $1 AND NOT anulada RETURNING id', [req.params.id]);
    if (!rows[0]) throw fail(409, 'Esa venta ya estaba anulada o no existe.');
    await c.query(`UPDATE productos p SET cantidad = p.cantidad + s.cant, actualizado = now()
      FROM (SELECT producto_id, SUM(cantidad) AS cant FROM venta_items WHERE venta_id = $1 AND producto_id IS NOT NULL GROUP BY producto_id) s
      WHERE p.id = s.producto_id`, [req.params.id]);
  });
  res.json({ ok: true });
}));

// ---------- gastos ----------
api.get('/gastos', wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT id, fecha, dia, categoria, concepto, monto FROM gastos WHERE dia BETWEEN $1 AND $2 ORDER BY dia DESC, fecha DESC', rango(req.query));
  res.json(rows);
}));
api.post('/gastos', wrap(async (req, res) => {
  const b = req.body || {};
  const monto = dinero(b.monto);
  if (!(monto > 0)) throw fail(400, 'Escribí el monto del gasto.');
  const d = dia(b.dia);
  await pool.query('INSERT INTO gastos (id, fecha, dia, categoria, concepto, monto) VALUES ($1,$2,$3,$4,$5,$6)',
    [nid(), new Date(d + 'T12:00:00'), d, str(b.categoria, 60) || 'Otros', str(b.concepto, 200), monto]);
  res.status(201).json({ ok: true });
}));
api.delete('/gastos/:id', wrap(async (req, res) => {
  await pool.query('DELETE FROM gastos WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));

// ---------- respaldo y restauración ----------
const TABLAS = ['config', 'fotos', 'productos', 'ventas', 'venta_items', 'entradas', 'gastos'];
api.get('/respaldo', wrap(async (req, res) => {
  const data = { app: 'llantera-pg', version: 1, exportado: new Date().toISOString() };
  for (const t of TABLAS) {
    const sql = t === 'fotos' ? "SELECT id, tipo, encode(datos, 'base64') AS datos, creado FROM fotos" : `SELECT * FROM ${t}`;
    data[t] = (await pool.query(sql)).rows;
  }
  res.set('Content-Disposition', `attachment; filename="respaldo_llantera_${new Date().toISOString().slice(0, 10)}.json"`);
  res.json(data);
}));
api.post('/respaldo', express.json({ limit: '500mb' }), wrap(async (req, res) => {
  const data = req.body || {};
  if (data.app !== 'llantera-pg') throw fail(400, 'Ese archivo no es un respaldo de este sistema.');
  let n = 0;
  await tx(async c => {
    for (const t of TABLAS) {
      for (const row of data[t] || []) {
        const cols = Object.keys(row).filter(k => /^[a-z_]+$/.test(k));
        if (!cols.length) continue;
        const vals = cols.map(k => row[k]);
        const ph = cols.map((k, i) => (t === 'fotos' && k === 'datos' ? `decode($${i + 1}, 'base64')` : `$${i + 1}`));
        const upd = cols.filter(k => k !== 'id').map(k => `${k} = EXCLUDED.${k}`).join(', ');
        await c.query(`INSERT INTO ${t} (${cols.join(', ')}) VALUES (${ph.join(', ')}) ON CONFLICT (id) DO ${upd ? 'UPDATE SET ' + upd : 'NOTHING'}`, vals);
        n++;
      }
    }
    await c.query("SELECT setval(pg_get_serial_sequence('ventas', 'numero'), GREATEST((SELECT MAX(numero) FROM ventas), 1))");
    await c.query("SELECT setval(pg_get_serial_sequence('venta_items', 'id'), GREATEST((SELECT MAX(id) FROM venta_items), 1))");
  });
  res.json({ ok: true, registros: n });
}));

app.use('/api', api);
app.use('/api', (req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));

(async () => {
  // la base de datos puede tardar en aceptar conexiones justo después de crearse
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  for (let intento = 1; ; intento++) {
    try { await pool.query(schema); break; }
    catch (e) {
      console.error(`Base de datos no disponible (intento ${intento}/20): ${e.message}`);
      if (intento >= 20) process.exit(1);
      await new Promise(r => setTimeout(r, 5000));
    }
  }
  app.listen(PORT, '0.0.0.0', () => console.log(`Sistema de la llantera listo en el puerto ${PORT}`));
})();
