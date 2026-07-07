import { Injectable, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';
import { AdminCoreService } from './admin-core.service';

@Injectable()
export class AdminExportPowerBiService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly adminCoreService: AdminCoreService,
  ) {}

  async exportPowerBI(adminId: string) {
    await this.adminCoreService.verifyRole(adminId);
    const supabase = this.supabaseService.getClient();

    const [usuarios, movimientos, presupuestos, metas, analisis, grupos] = await Promise.all([
      supabase.from('usuarios').select('id, nombre, correo, trabaja, ingreso_mensual, gasto_estimado, fecha_registro').eq('rol', 'ESTUDIANTE'),
      supabase.from('movimientos').select('id, usuario_id, monto, tipo, fecha, fecha_creacion, categorias(nombre), usuarios(nombre)'),
      supabase.from('presupuestos').select('id, usuario_id, limite_monto, categorias(nombre), usuarios(nombre)'),
      supabase.from('metas_ahorro').select('id, usuario_id, nombre, monto_objetivo, monto_actual, fecha_objetivo, fecha_creacion, usuarios(nombre)'),
      supabase.from('analisis_financiero').select('usuario_id, puntaje_financiero, nivel_riesgo, fecha_creacion, usuarios(nombre)').order('fecha_creacion', { ascending: false }),
      supabase.from('grupos_gastos').select('id, nombre, creador_id, fecha_creacion'),
    ]);

    if (!usuarios.data || usuarios.data.length === 0) {
      throw new BadRequestException('No hay estudiantes registrados para exportar a Power BI.');
    }

    // Precálculos
    const gastoPorUsuario: Record<string, number> = {};
    const gastoPorCategoria: Record<string, number> = {};

    for (const m of movimientos.data || []) {
      const amt = Number(m.monto);
      const cat = (m.categorias as any)?.nombre || 'Otros';
      if (m.tipo === 'GASTO') {
        gastoPorUsuario[m.usuario_id] = (gastoPorUsuario[m.usuario_id] || 0) + amt;
        gastoPorCategoria[cat] = (gastoPorCategoria[cat] || 0) + amt;
      }
    }

    const hoy = new Date();
    const start30d = new Date(hoy.getTime() - 30 * 86400000).getTime();
    const gasto30dPorUsuario: Record<string, number> = {};
    const ingresoHistPorUsuario: Record<string, number> = {};

    for (const m of movimientos.data || []) {
      const amt = Number(m.monto);
      const mDate = new Date(m.fecha).getTime();
      if (m.tipo === 'GASTO') {
        if (mDate >= start30d) {
          gasto30dPorUsuario[m.usuario_id] = (gasto30dPorUsuario[m.usuario_id] || 0) + amt;
        }
      } else {
        ingresoHistPorUsuario[m.usuario_id] = (ingresoHistPorUsuario[m.usuario_id] || 0) + amt;
      }
    }

    const lastAnalisis: Record<string, any> = {};
    for (const a of analisis.data || []) {
      if (!lastAnalisis[a.usuario_id]) lastAnalisis[a.usuario_id] = a;
    }

    // Tasa de retención
    const hace30 = new Date(Date.now() - 30 * 86400000).toISOString();
    const hace60 = new Date(Date.now() - 60 * 86400000).toISOString();
    const [cur, prev] = await Promise.all([
      supabase.from('movimientos').select('usuario_id').gte('fecha_creacion', hace30),
      supabase.from('movimientos').select('usuario_id').gte('fecha_creacion', hace60).lt('fecha_creacion', hace30),
    ]);
    const mauCur = new Set((cur.data || []).map(m => m.usuario_id)).size;
    const mauPrev = new Set((prev.data || []).map(m => m.usuario_id)).size;
    const retPct = mauPrev === 0 ? 0 : Math.min(100, Math.round((mauCur / mauPrev) * 100));

    // Métricas de funciones
    const totalMov = (movimientos.data || []).length;
    const totalPres = (presupuestos.data || []).length;
    const totalMetas = (metas.data || []).length;
    const totalGrupos = (grupos.data || []).length;

    const funciones = [
      { funcionalidad: 'Registro de Movimientos', uso_total: totalMov, motivo: 'Necesidad diaria de control de ingresos y gastos' },
      { funcionalidad: 'Presupuestos por Categoría', uso_total: totalPres, motivo: 'Permite planificar el gasto mensual de forma estructurada' },
      { funcionalidad: 'Metas de Ahorro', uso_total: totalMetas, motivo: 'Objetivos concretos de ahorro a futuro' },
      { funcionalidad: 'Grupos de Gastos', uso_total: totalGrupos, motivo: 'Gasto colaborativo entre estudiantes' },
    ].sort((a, b) => b.uso_total - a.uso_total).map((f, i) => ({
      ...f,
      ranking: i + 1,
      estado: i === 0 ? 'Más utilizada' : i === 3 ? 'Menos utilizada' : 'Intermedia',
    }));

    // Gasto estimado vs real por usuario
    const gastoComparativo = (usuarios.data || []).map(u => {
      const est = Number(u.gasto_estimado) || 0;
      const real = parseFloat((gastoPorUsuario[u.id] || 0).toFixed(2));
      const dif = parseFloat((real - est).toFixed(2));
      const difPct = est > 0 ? parseFloat(((dif / est) * 100).toFixed(1)) : null;
      return {
        usuario_id: u.id,
        nombre: u.nombre,
        gasto_estimado: est,
        gasto_real: real,
        diferencia_usd: dif,
        diferencia_pct: difPct,
        estado: dif > est * 0.1 ? 'Sobreestimado' : dif < -est * 0.1 ? 'Subestimado' : 'Alineado',
      };
    });

    // Usuarios en riesgo financiero detallado con predicciones
    const usuariosRiesgo = (usuarios.data || []).map(u => {
      const a = lastAnalisis[u.id];
      const gastoTotal = gastoPorUsuario[u.id] || 0;
      const ingresoHist = ingresoHistPorUsuario[u.id] || 0;
      
      let mesesActivos = 1;
      if (u.fecha_registro) {
        const fechaReg = new Date(u.fecha_registro);
        mesesActivos = (hoy.getFullYear() - fechaReg.getFullYear()) * 12 + (hoy.getMonth() - fechaReg.getMonth()) + 1;
        if (mesesActivos < 1) mesesActivos = 1;
      }
      
      const ingresoFijo = Number(u.ingreso_mensual) || 0;
      const saldoDisponible = (ingresoFijo * mesesActivos) + ingresoHist - gastoTotal;
      const promedioGastoDiario = (gasto30dPorUsuario[u.id] || 0) / 30;
      const diasHastaSinDinero = promedioGastoDiario > 0 ? Math.max(0, Math.floor(saldoDisponible / promedioGastoDiario)) : 999;
      
      return {
        usuario_id: u.id,
        nombre: u.nombre,
        correo: u.correo,
        wally_score: a?.puntaje_financiero ?? null,
        nivel_riesgo: a?.nivel_riesgo ?? 'SIN_ANALISIS',
        en_riesgo: a?.nivel_riesgo === 'RIESGO_FINANCIERO',
        gasto_real: parseFloat(gastoTotal.toFixed(2)),
        gasto_estimado: Number(u.gasto_estimado) || 0,
        saldo_disponible: parseFloat(saldoDisponible.toFixed(2)),
        promedio_gasto_diario: parseFloat(promedioGastoDiario.toFixed(2)),
        dias_hasta_sin_dinero: diasHastaSinDinero,
      };
    });

    // Categorías por gasto
    const categoriasGasto = Object.entries(gastoPorCategoria)
      .map(([nombre, total]) => ({
        categoria: nombre,
        gasto_total: parseFloat(total.toFixed(2)),
        porcentaje_del_total: parseFloat(((total / Object.values(gastoPorCategoria).reduce((a, b) => a + b, 0)) * 100).toFixed(1)),
      }))
      .sort((a, b) => b.gasto_total - a.gasto_total);

    // Efectividad de metas
    const metasDetalle = (metas.data || []).map(m => {
      const pct = Number(m.monto_objetivo) > 0
        ? parseFloat(((Number(m.monto_actual) / Number(m.monto_objetivo)) * 100).toFixed(1))
        : 0;
      return {
        usuario_id: m.usuario_id,
        nombre_usuario: (m.usuarios as any)?.nombre || '',
        meta: m.nombre,
        monto_objetivo: Number(m.monto_objetivo),
        monto_actual: Number(m.monto_actual),
        progreso_pct: pct,
        completada: Number(m.monto_actual) >= Number(m.monto_objetivo),
        fecha_objetivo: m.fecha_objetivo,
        fecha_creacion: m.fecha_creacion,
      };
    });

    const metasCompletadas = metasDetalle.filter(m => m.completada).length;
    const efectividadPct = metasDetalle.length > 0
      ? parseFloat(((metasCompletadas / metasDetalle.length) * 100).toFixed(1))
      : 0;

    // Scores por usuario
    const scoresDetalle = (usuarios.data || []).map(u => {
      const a = lastAnalisis[u.id];
      return {
        usuario_id: u.id,
        nombre: u.nombre,
        wally_score: a?.puntaje_financiero ?? null,
        nivel_riesgo: a?.nivel_riesgo ?? 'SIN_ANALISIS',
        fecha_ultimo_analisis: a?.fecha_creacion ?? null,
      };
    });

    const totalScore = scoresDetalle.reduce((acc, s) => acc + (s.wally_score || 0), 0);
    const scoresConDatos = scoresDetalle.filter(s => s.wally_score !== null).length;
    const scorePromedio = scoresConDatos > 0 ? Math.round(totalScore / scoresConDatos) : 0;

    return {
      // ── Dimensiones ───────────────────────────────────────────────────────
      dim_usuarios: (usuarios.data || []).map(u => ({
        id: u.id, nombre: u.nombre, correo: u.correo,
        trabaja: u.trabaja, ingreso_mensual: u.ingreso_mensual,
        gasto_estimado: u.gasto_estimado, fecha_registro: u.fecha_registro,
      })),

      // ── Tablas de hechos ──────────────────────────────────────────────────
      fact_movimientos: (movimientos.data || []).map(m => ({
        id: m.id, usuario_id: m.usuario_id,
        nombre_usuario: (m.usuarios as any)?.nombre || '',
        monto: Number(m.monto), tipo: m.tipo,
        fecha: m.fecha, fecha_creacion: m.fecha_creacion,
        categoria: (m.categorias as any)?.nombre || 'Sin Categoría',
      })),
      fact_presupuestos: (presupuestos.data || []).map(p => ({
        id: p.id, usuario_id: p.usuario_id,
        nombre_usuario: (p.usuarios as any)?.nombre || '',
        limite_monto: Number(p.limite_monto),
        categoria: (p.categorias as any)?.nombre || 'Sin Categoría',
      })),
      fact_metas: metasDetalle,
      fact_analisis_historico: (analisis.data || []).map(a => ({
        usuario_id: a.usuario_id,
        nombre_usuario: (a.usuarios as any)?.nombre || '',
        puntaje_financiero: a.puntaje_financiero,
        nivel_riesgo: a.nivel_riesgo,
        fecha: a.fecha_creacion,
      })),

      // ── Métricas calculadas ───────────────────────────────────────────────
      funciones_uso: funciones,

      gasto_estimado_vs_real: {
        detalle_por_usuario: gastoComparativo,
        resumen: {
          usuarios_gastando_mas: gastoComparativo.filter(u => u.diferencia_usd > 0).length,
          usuarios_gastando_menos: gastoComparativo.filter(u => u.diferencia_usd < 0).length,
          usuarios_alineados: gastoComparativo.filter(u => u.estado === 'Alineado').length,
          diferencia_promedio_pct: gastoComparativo.filter(u => u.diferencia_pct !== null).length > 0
            ? parseFloat((gastoComparativo.filter(u => u.diferencia_pct !== null)
                .reduce((acc, u) => acc + (u.diferencia_pct || 0), 0) /
                gastoComparativo.filter(u => u.diferencia_pct !== null).length).toFixed(1))
            : 0,
        },
      },

      usuarios_riesgo_financiero: {
        detalle: usuariosRiesgo,
        resumen: {
          total_en_riesgo: usuariosRiesgo.filter(u => u.en_riesgo).length,
          total_estudiantes: usuarios.data?.length || 0,
          porcentaje_en_riesgo: usuarios.data && usuarios.data.length > 0
            ? parseFloat(((usuariosRiesgo.filter(u => u.en_riesgo).length / usuarios.data.length) * 100).toFixed(1))
            : 0,
        },
      },

      categorias_mayor_gasto: {
        ranking: categoriasGasto,
        categoria_lider: categoriasGasto[0] ?? null,
        categoria_menor_gasto: categoriasGasto[categoriasGasto.length - 1] ?? null,
      },

      efectividad_metas: {
        detalle: metasDetalle,
        resumen: {
          total_metas: metasDetalle.length,
          metas_completadas: metasCompletadas,
          efectividad_pct: efectividadPct,
          promedio_progreso_pct: metasDetalle.length > 0
            ? parseFloat((metasDetalle.reduce((acc, m) => acc + m.progreso_pct, 0) / metasDetalle.length).toFixed(1))
            : 0,
        },
      },

      puntaje_financiero: {
        detalle: scoresDetalle,
        resumen: {
          score_promedio: scorePromedio,
          usuarios_excelente: scoresDetalle.filter(s => (s.wally_score || 0) >= 90).length,
          usuarios_estable: scoresDetalle.filter(s => (s.wally_score || 0) >= 50 && (s.wally_score || 0) < 90).length,
          usuarios_en_riesgo: scoresDetalle.filter(s => s.wally_score !== null && (s.wally_score || 0) < 50).length,
          usuarios_sin_datos: scoresDetalle.filter(s => s.wally_score === null).length,
        },
      },

      tasa_retencion: {
        mau_periodo_actual: mauCur,
        mau_periodo_anterior: mauPrev,
        tasa_retencion_pct: retPct,
        tasa_abandono_pct: Math.max(0, 100 - retPct),
        interpretacion: retPct >= 60
          ? 'Retención saludable. Los usuarios vuelven consistentemente a la plataforma.'
          : 'Retención baja. Se recomienda revisar el onboarding y flujos clave.',
      },

      metadata: {
        generado_en: new Date().toISOString(),
        total_estudiantes: usuarios.data?.length || 0,
        total_movimientos: (movimientos.data || []).length,
        total_metas: metasDetalle.length,
        total_presupuestos: (presupuestos.data || []).length,
        total_grupos: (grupos.data || []).length,
      },
    };
  }
}
