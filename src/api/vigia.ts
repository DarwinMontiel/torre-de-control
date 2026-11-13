/**
 * El vigía: el ciclo que mantiene viva a la torre.
 *
 * Cada `intervaloMs`:
 *   1. Toma (o renueva) el liderazgo. Si otra réplica lo tiene, no hace nada.
 *   2. Lee las métricas de colas y las agrega al historial de tendencia.
 *   3. Evalúa las reglas con el catálogo y los últimos latidos.
 *   4. Concilia los hallazgos con las alertas vigentes y persiste los cambios.
 *   5. Envía avisos (abierta, escalada, resuelta) por todos los canales.
 *   6. Construye la instantánea, la guarda y la difunde por pub/sub.
 *
 * Toda la lógica de decisión vive en `src/dominio`; aquí solo se orquesta E/S.
 */
import { randomUUID } from 'node:crypto';
import { conciliarAlertas, type ResultadoConciliacion } from '../dominio/alertas.ts';
import { redactarAviso, type MotivoAviso } from '../dominio/avisos.ts';
import { construirInstantanea, type Instantanea } from '../dominio/instantanea.ts';
import { evaluarReglas } from '../dominio/reglas.ts';
import { HistorialColas } from '../dominio/tendencia.ts';
import type { Alerta, CodigoRegla, MetricaCola } from '../dominio/tipos.ts';
import type {
  EstadoVivo,
  FuenteColas,
  Notificador,
  Reloj,
  RepositorioCatalogo,
  RepositorioEventos,
  RepositorioIncidentes,
} from './puertos.ts';

export interface Bitacora {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

export interface ConfigVigia {
  nodo: string;
  intervaloMs: number;
  ttlLatidoSeg: number;
  ventanaTendenciaMin: number;
  coberturaMinimaMin: number;
  reglasDesactivadas: readonly CodigoRegla[];
}

export interface DependenciasVigia {
  catalogo: RepositorioCatalogo;
  incidentes: RepositorioIncidentes;
  eventos: RepositorioEventos;
  estado: EstadoVivo;
  fuente: FuenteColas;
  notificadores: readonly Notificador[];
  reloj: Reloj;
  log: Bitacora;
  nuevoId?: () => string;
}

export interface ResultadoCiclo {
  instantanea: Instantanea;
  cambios: ResultadoConciliacion;
}

export interface EstadoFuente {
  descripcion: string;
  ok: boolean;
  error: string | null;
  ultimaLecturaOk: string | null;
}

export class Vigia {
  readonly historial: HistorialColas;
  readonly #d: DependenciasVigia;
  readonly #cfg: ConfigVigia;
  readonly #nuevoId: () => string;
  #metricas: MetricaCola[] = [];
  #fuente: EstadoFuente;
  #temporizador: NodeJS.Timeout | null = null;
  #enCurso: Promise<unknown> | null = null;

  constructor(d: DependenciasVigia, cfg: ConfigVigia) {
    this.#d = d;
    this.#cfg = cfg;
    this.#nuevoId = d.nuevoId ?? randomUUID;
    this.historial = new HistorialColas(cfg.ventanaTendenciaMin);
    this.#fuente = { descripcion: d.fuente.descripcion, ok: false, error: null, ultimaLecturaOk: null };
  }

  get estadoFuente(): EstadoFuente {
    return { ...this.#fuente };
  }

  /** Ejecuta un ciclo completo. Devuelve `null` si esta réplica no es la líder. */
  async ciclo(): Promise<ResultadoCiclo | null> {
    const { estado, catalogo, incidentes, eventos, reloj, log } = this.#d;
    // El candado dura tres ciclos: si el líder muere, otro toma el relevo pronto.
    if (!(await estado.tomarLiderazgo(this.#cfg.nodo, this.#cfg.intervaloMs * 3))) return null;

    const ahora = reloj.ahora();
    await this.#leerColas(ahora);

    const [cat, latidos, vigentes] = await Promise.all([catalogo.catalogo(), estado.ultimosLatidos(), incidentes.vigentes()]);
    const hallazgos = evaluarReglas(
      { ahora, catalogo: cat, latidos, metricas: this.#metricas, historial: this.historial },
      {
        ttlLatidoSeg: this.#cfg.ttlLatidoSeg,
        coberturaMinimaMin: this.#cfg.coberturaMinimaMin,
        desactivadas: this.#cfg.reglasDesactivadas,
      },
    );
    const cambios = conciliarAlertas(vigentes, hallazgos, ahora, this.#nuevoId);
    await incidentes.guardar([...cambios.resueltas, ...cambios.abiertas, ...cambios.escaladas, ...cambios.actualizadas]);

    for (const a of cambios.abiertas) log.warn({ alerta: a.clave, severidad: a.severidad }, `Alerta abierta: ${a.titulo}`);
    for (const a of cambios.escaladas) log.warn({ alerta: a.clave, severidad: a.severidad }, `Alerta escalada: ${a.titulo}`);
    for (const a of cambios.resueltas) log.info({ alerta: a.clave }, `Alerta resuelta: ${a.titulo}`);

    await this.#avisar(cambios.abiertas, 'abierta', ahora);
    await this.#avisar(cambios.escaladas, 'escalada', ahora);
    await this.#avisar(cambios.resueltas, 'resuelta', ahora);

    const [recientes, ultimosEventos] = await Promise.all([incidentes.listar({ limite: 60 }), eventos.recientes({ limite: 50 })]);
    const instantanea = construirInstantanea({
      ahora,
      catalogo: cat,
      latidos,
      metricas: this.#metricas,
      historial: this.historial,
      alertas: unirPorId(cambios.vigentes, recientes),
      eventos: ultimosEventos,
      ttlLatidoSeg: this.#cfg.ttlLatidoSeg,
    });
    await estado.guardarInstantanea(instantanea);
    for (const [motivo, lista] of [
      ['abierta', cambios.abiertas],
      ['escalada', cambios.escaladas],
      ['resuelta', cambios.resueltas],
    ] as const) {
      for (const a of lista) await estado.publicar({ tipo: 'alerta', motivo, datos: a });
    }
    await estado.publicar({ tipo: 'instantanea', datos: instantanea });
    return { instantanea, cambios };
  }

  iniciar(): void {
    if (this.#temporizador) return;
    const tic = () => {
      this.#enCurso = this.ciclo()
        .catch((e: unknown) => this.#d.log.error({ err: e }, 'El ciclo del vigía falló; se reintenta en el próximo intervalo.'))
        .finally(() => {
          this.#enCurso = null;
        });
    };
    tic();
    this.#temporizador = setInterval(() => {
      if (!this.#enCurso) tic();
    }, this.#cfg.intervaloMs);
  }

  async detener(): Promise<void> {
    if (this.#temporizador) clearInterval(this.#temporizador);
    this.#temporizador = null;
    await this.#enCurso;
  }

  async #leerColas(ahora: string): Promise<void> {
    try {
      this.#metricas = await this.#d.fuente.leer();
      this.historial.registrar(Date.parse(ahora), this.#metricas);
      this.#fuente = { ...this.#fuente, ok: true, error: null, ultimaLecturaOk: ahora };
    } catch (e) {
      // Se conservan las últimas métricas: mejor un dato viejo marcado que un tablero en blanco.
      const error = (e as Error).message;
      if (this.#fuente.error !== error) this.#d.log.error({ fuente: this.#d.fuente.descripcion }, error);
      this.#fuente = { ...this.#fuente, ok: false, error };
    }
  }

  async #avisar(alertas: readonly Alerta[], motivo: MotivoAviso, ahora: string): Promise<void> {
    for (const alerta of alertas) {
      const { asunto, cuerpo } = redactarAviso(alerta, motivo, ahora);
      const resultados = await Promise.allSettled(
        this.#d.notificadores.map((n) => n.enviar({ canal: n.canal, asunto, cuerpo, alertaId: alerta.id, enviadoEn: ahora })),
      );
      for (const r of resultados) {
        if (r.status === 'rejected') this.#d.log.warn({ alerta: alerta.clave }, (r.reason as Error).message);
      }
    }
  }
}

function unirPorId(primero: readonly Alerta[], despues: readonly Alerta[]): Alerta[] {
  const vistos = new Set(primero.map((a) => a.id));
  return [...primero, ...despues.filter((a) => !vistos.has(a.id))];
}
