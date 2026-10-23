-- Esquema de la base de datos (PostgreSQL 13 o más nuevo).
-- El servidor lo aplica solo al arrancar; se puede correr varias veces sin dañar datos.

CREATE TABLE IF NOT EXISTS config (
  id         smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  negocio    text    NOT NULL DEFAULT 'Mi Llantera',
  moneda     text    NOT NULL DEFAULT 'L',
  minimo     integer NOT NULL DEFAULT 2 CHECK (minimo >= 0),
  servicios  text    NOT NULL DEFAULT E'Montaje = 0\nBalanceo = 0\nReparación de pinchazo = 0\nAlineado = 0\nRotación = 0'
);
INSERT INTO config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Fotos de los productos (se guardan dentro de la base para que el respaldo sea uno solo)
CREATE TABLE IF NOT EXISTS fotos (
  id      text PRIMARY KEY,
  tipo    text  NOT NULL,
  datos   bytea NOT NULL,
  creado  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS productos (
  id          text PRIMARY KEY,
  tipo        text    NOT NULL DEFAULT 'llanta',
  estado      text    NOT NULL DEFAULT 'nueva' CHECK (estado IN ('nueva', 'usada')),
  medida      text    NOT NULL,
  marca       text    NOT NULL DEFAULT '',
  modelo      text    NOT NULL DEFAULT '',
  vida        integer CHECK (vida BETWEEN 0 AND 100),
  aplicacion  text    NOT NULL DEFAULT '',
  cantidad    integer NOT NULL DEFAULT 0 CHECK (cantidad >= 0),
  minimo      integer CHECK (minimo >= 0),
  costo       numeric(12,2) NOT NULL DEFAULT 0 CHECK (costo >= 0),
  precio      numeric(12,2) NOT NULL DEFAULT 0 CHECK (precio >= 0),
  ubicacion   text    NOT NULL DEFAULT '',
  notas       text    NOT NULL DEFAULT '',
  foto_id     text REFERENCES fotos(id) ON DELETE SET NULL,
  creado      timestamptz NOT NULL DEFAULT now(),
  actualizado timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS productos_medida_idx ON productos (medida);

CREATE TABLE IF NOT EXISTS ventas (
  id            text PRIMARY KEY,
  numero        bigserial UNIQUE,
  fecha         timestamptz NOT NULL DEFAULT now(),
  dia           date    NOT NULL,
  cliente       text    NOT NULL DEFAULT '',
  metodo        text    NOT NULL DEFAULT 'Efectivo',
  nota          text    NOT NULL DEFAULT '',
  total         numeric(12,2) NOT NULL,
  costo_total   numeric(12,2) NOT NULL DEFAULT 0,
  anulada       boolean NOT NULL DEFAULT false,
  anulada_fecha timestamptz
);
CREATE INDEX IF NOT EXISTS ventas_dia_idx ON ventas (dia);

CREATE TABLE IF NOT EXISTS venta_items (
  id           bigserial PRIMARY KEY,
  venta_id     text NOT NULL REFERENCES ventas(id) ON DELETE CASCADE,
  producto_id  text REFERENCES productos(id) ON DELETE SET NULL,
  nombre       text    NOT NULL,
  tipo         text    NOT NULL DEFAULT '',
  cantidad     integer NOT NULL CHECK (cantidad > 0),
  precio       numeric(12,2) NOT NULL CHECK (precio >= 0),
  costo        numeric(12,2) NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS venta_items_venta_idx ON venta_items (venta_id);

CREATE TABLE IF NOT EXISTS entradas (
  id           text PRIMARY KEY,
  fecha        timestamptz NOT NULL DEFAULT now(),
  dia          date    NOT NULL,
  producto_id  text REFERENCES productos(id) ON DELETE SET NULL,
  nombre       text    NOT NULL,
  cantidad     integer NOT NULL CHECK (cantidad > 0),
  costo_unit   numeric(12,2) NOT NULL DEFAULT 0,
  total        numeric(12,2) NOT NULL DEFAULT 0,
  proveedor    text    NOT NULL DEFAULT '',
  nota         text    NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS entradas_dia_idx ON entradas (dia);

CREATE TABLE IF NOT EXISTS gastos (
  id         text PRIMARY KEY,
  fecha      timestamptz NOT NULL DEFAULT now(),
  dia        date    NOT NULL,
  categoria  text    NOT NULL DEFAULT 'Otros',
  concepto   text    NOT NULL DEFAULT '',
  monto      numeric(12,2) NOT NULL CHECK (monto > 0)
);
CREATE INDEX IF NOT EXISTS gastos_dia_idx ON gastos (dia);
