/** Carga el catálogo ficticio de Cobranzas Macondo en un catálogo vacío. */
import { catalogoMacondo } from '../dominio/macondo.ts';
import type { Catalogo } from '../dominio/tipos.ts';
import type { RepositorioCatalogo } from './puertos.ts';

/** Devuelve el catálogo sembrado, o `null` si ya había servidores y no se tocó nada. */
export async function sembrarMacondo(catalogo: RepositorioCatalogo): Promise<Catalogo | null> {
  if ((await catalogo.listarServidores()).length > 0) return null;
  const c = catalogoMacondo();
  for (const s of c.servidores) await catalogo.crearServidor(s);
  for (const b of c.bots) await catalogo.crearBot(b);
  for (const q of c.colas) await catalogo.crearCola(q);
  return c;
}
