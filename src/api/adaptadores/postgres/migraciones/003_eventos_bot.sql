-- Bitácora de eventos que reportan los bots a través del SDK.
CREATE TABLE eventos_bot (
  id          text PRIMARY KEY,
  bot_id      text NOT NULL,
  tipo        text NOT NULL,
  mensaje     text NOT NULL,
  tarea_id    text,
  ocurrido_en timestamptz NOT NULL
);
CREATE INDEX eventos_bot_ocurrido_idx ON eventos_bot (ocurrido_en DESC);
CREATE INDEX eventos_bot_bot_idx ON eventos_bot (bot_id, ocurrido_en DESC);
