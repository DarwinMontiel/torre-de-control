-- Historial de alertas (incidentes). Una alerta vigente por clave `<regla>:<objetivo>`.
CREATE TABLE incidentes (
  id             uuid PRIMARY KEY,
  clave          text NOT NULL,
  regla          text NOT NULL,
  severidad      text NOT NULL CHECK (severidad IN ('critica', 'advertencia', 'informativa')),
  objetivo       text NOT NULL,
  titulo         text NOT NULL,
  detalle        text NOT NULL,
  valor          double precision NOT NULL,
  estado         text NOT NULL CHECK (estado IN ('activa', 'reconocida', 'resuelta')),
  abierta_en     timestamptz NOT NULL,
  actualizada_en timestamptz NOT NULL,
  reconocida_en  timestamptz,
  reconocida_por text,
  resuelta_en    timestamptz
);

-- Garantiza en la base de datos lo que el motor ya cumple: no hay dos alertas
-- vigentes para el mismo problema, aunque dos vigías compitan por un instante.
CREATE UNIQUE INDEX incidentes_vigente_por_clave ON incidentes (clave) WHERE estado <> 'resuelta';
CREATE INDEX incidentes_abierta_idx ON incidentes (abierta_en DESC);
