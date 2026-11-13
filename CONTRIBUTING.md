# Cómo contribuir

1. Crea una rama desde `main`.
2. Instala dependencias con `npm ci` (Node 24 o superior).
3. Antes de abrir el PR, verifica que todo pase:

   ```bash
   npm run typecheck
   npm run lint
   npm run test:cobertura
   npm run build && npm run build:demo
   ```

4. Si cambias una regla de alertas, agrega o ajusta su prueba en `tests/dominio/` y revisa que
   `noche-del-cierre.test.ts` siga contando la misma historia.
5. Si cambias el SDK, corre `ruff`, `mypy` y `pytest` en `sdk/python`.

Los mensajes de commit van en español y siguen el estilo `tipo(alcance): descripción`
(`feat`, `fix`, `docs`, `test`, `refactor`, `ci`, `chore`).
