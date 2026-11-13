/** Redacción de los avisos que salen por webhook o correo. Texto plano y en español. */
import { duracionMin } from './alertas.ts';
import type { Alerta } from './tipos.ts';

export type MotivoAviso = 'abierta' | 'escalada' | 'resuelta';

const ETIQUETA = { critica: 'CRÍTICA', advertencia: 'ADVERTENCIA', informativa: 'INFO' } as const;

export function redactarAviso(alerta: Alerta, motivo: MotivoAviso, ahora: string): { asunto: string; cuerpo: string } {
  const prefijo =
    motivo === 'resuelta' ? '[RESUELTA]' : `[${ETIQUETA[alerta.severidad]}]${motivo === 'escalada' ? '[ESCALÓ]' : ''}`;
  const asunto = `${prefijo} ${alerta.titulo} · ${alerta.objetivo}`;
  const lineas = [alerta.detalle, '', `Regla: ${alerta.regla}`, `Objetivo: ${alerta.objetivo}`, `Abierta: ${alerta.abiertaEn}`];
  if (motivo === 'resuelta') lineas.push(`Duración: ${duracionMin(alerta, ahora)} min`);
  if (alerta.reconocidaPor) lineas.push(`Reconocida por: ${alerta.reconocidaPor}`);
  lineas.push('', '— Torre de Control');
  return { asunto, cuerpo: lineas.join('\n') };
}
