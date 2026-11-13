-- Catálogo: servidores, bots y colas que vigila la torre.
CREATE TABLE servidores (
  id             text PRIMARY KEY,
  nombre         text NOT NULL,
  sistema        text NOT NULL CHECK (sistema IN ('windows', 'linux')),
  ip             text NOT NULL,
  ubicacion      text NOT NULL DEFAULT '',
  descripcion    text NOT NULL DEFAULT '',
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE bots (
  id             text PRIMARY KEY,
  alias          text NOT NULL,
  proceso        text NOT NULL,
  servidor_id    text NOT NULL REFERENCES servidores (id) ON DELETE RESTRICT,
  descripcion    text NOT NULL DEFAULT '',
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bots_servidor_idx ON bots (servidor_id);

CREATE TABLE colas (
  nombre                     text PRIMARY KEY,
  proceso                    text NOT NULL,
  tipo                       text NOT NULL CHECK (tipo IN ('principal', 'reintento', 'dlq')),
  umbral_mensajes            integer NOT NULL CHECK (umbral_mensajes >= 0),
  umbral_crecimiento_por_min double precision NOT NULL CHECK (umbral_crecimiento_por_min >= 0),
  creado_en                  timestamptz NOT NULL DEFAULT now(),
  actualizado_en             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX colas_proceso_idx ON colas (proceso);
