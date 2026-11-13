/** Mini gráficos en SVG generados a mano (sin librerías): sparklines de profundidad de colas. */
import { crudo, type Html } from './html.ts';

export interface OpcionesSparkline {
  ancho?: number;
  alto?: number;
  /** Etiqueta accesible. */
  titulo: string;
}

/**
 * Puntos de la polilínea escalados al recuadro. El eje Y va del mínimo al máximo de la
 * serie (lo que importa en una cola es la forma: sube, baja o se estanca); una serie
 * plana se dibuja en la base si es cero y a media altura si no.
 */
export function puntosSparkline(serie: readonly number[], ancho: number, alto: number): string {
  if (serie.length === 0) return '';
  const min = Math.min(...serie);
  const max = Math.max(...serie);
  const rango = max - min;
  const paso = serie.length > 1 ? ancho / (serie.length - 1) : 0;
  return serie
    .map((v, i) => {
      const x = serie.length > 1 ? i * paso : ancho / 2;
      const proporcion = rango === 0 ? (max === 0 ? 0 : 0.5) : (v - min) / rango;
      const y = alto - 1 - proporcion * (alto - 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

export function sparkline(serie: readonly number[], op: OpcionesSparkline): Html {
  const ancho = op.ancho ?? 120;
  const alto = op.alto ?? 28;
  const puntos = puntosSparkline(serie, ancho, alto);
  const titulo = op.titulo.replace(/[<&"]/g, '');
  if (!puntos)
    return crudo(`<svg class="spark" width="${ancho}" height="${alto}" role="img" aria-label="${titulo}: sin datos"></svg>`);
  const area = `0,${alto} ${puntos} ${ancho},${alto}`;
  return crudo(
    `<svg class="spark" width="${ancho}" height="${alto}" viewBox="0 0 ${ancho} ${alto}" role="img" aria-label="${titulo}">` +
      `<polygon class="spark-area" points="${area}"/><polyline class="spark-linea" points="${puntos}"/></svg>`,
  );
}
