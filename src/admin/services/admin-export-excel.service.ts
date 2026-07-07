import { Injectable, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';
import { AdminCoreService } from './admin-core.service';
import { AdminKpisService } from './admin-kpis.service';
import * as xlsx from 'xlsx';

@Injectable()
export class AdminExportExcelService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly adminCoreService: AdminCoreService,
    private readonly adminKpisService: AdminKpisService,
  ) {}

  async exportExcel(adminId: string): Promise<string> {
    await this.adminCoreService.verifyRole(adminId);
    const supabase = this.supabaseService.getClient();

    const [usuarios, movs, presupuestos, metas, analisis, grupos, alertasData] = await Promise.all([
      supabase.from('usuarios').select('id, nombre, correo, trabaja, ingreso_mensual, gasto_estimado, fecha_registro').eq('rol', 'ESTUDIANTE'),
      supabase.from('movimientos').select('usuario_id, monto, tipo, fecha, categorias(nombre), usuarios(nombre)'),
      supabase.from('presupuestos').select('usuario_id, limite_monto, categorias(nombre), usuarios(nombre)'),
      supabase.from('metas_ahorro').select('usuario_id, nombre, monto_objetivo, monto_actual, fecha_objetivo, usuarios(nombre)'),
      supabase.from('analisis_financiero').select('usuario_id, puntaje_financiero, nivel_riesgo, fecha_creacion, usuarios(nombre)').order('fecha_creacion', { ascending: false }),
      supabase.from('grupos_gastos').select('id', { count: 'exact', head: true }),
      supabase.from('alertas').select('id', { count: 'exact', head: true }),
    ]);

    if (!usuarios.data || usuarios.data.length === 0) {
      throw new BadRequestException('No hay estudiantes registrados para generar el reporte.');
    }

    // ── Precálculos ──────────────────────────────────────────────────────────
    const gastoPorUsuario: Record<string, number> = {};
    const gastoPorCategoria: Record<string, number> = {};
    const ingresoTotal: Record<string, number> = {};

    for (const m of movs.data || []) {
      const amt = Number(m.monto);
      const cat = (m.categorias as any)?.nombre || 'Otros';
      if (m.tipo === 'GASTO') {
        gastoPorUsuario[m.usuario_id] = (gastoPorUsuario[m.usuario_id] || 0) + amt;
        gastoPorCategoria[cat] = (gastoPorCategoria[cat] || 0) + amt;
      } else {
        ingresoTotal[m.usuario_id] = (ingresoTotal[m.usuario_id] || 0) + amt;
      }
    }

    const hoy = new Date();
    const start30d = new Date(hoy.getTime() - 30 * 86400000).getTime();
    const gasto30dPorUsuario: Record<string, number> = {};

    for (const m of movs.data || []) {
      const amt = Number(m.monto);
      const mDate = new Date(m.fecha).getTime();
      if (m.tipo === 'GASTO' && mDate >= start30d) {
        gasto30dPorUsuario[m.usuario_id] = (gasto30dPorUsuario[m.usuario_id] || 0) + amt;
      }
    }

    // Último análisis por usuario
    const lastAnalisis: Record<string, any> = {};
    for (const a of analisis.data || []) {
      if (!lastAnalisis[a.usuario_id]) lastAnalisis[a.usuario_id] = a;
    }

    // Funcionalidades con métricas + motivo
    const totalMov = (movs.data || []).length;
    const totalPres = (presupuestos.data || []).length;
    const totalMetas = (metas.data || []).length;
    const totalGrupos = grupos.count || 0;
    const totalAlertas = alertasData.count || 0;

    const funcionalidades = [
      { Funcionalidad: 'Registro de Movimientos', Uso_Total: totalMov, Motivo_Popularidad: 'Necesidad diaria de controlar ingresos y gastos. Es la acción financiera más frecuente.' },
      { Funcionalidad: 'Presupuestos por Categoría', Uso_Total: totalPres, Motivo_Popularidad: 'Permite planificar el gasto mensual de forma estructurada.' },
      { Funcionalidad: 'Metas de Ahorro', Uso_Total: totalMetas, Motivo_Popularidad: 'Asociada a objetivos concretos como viajes, emergencias o bienes.' },
      { Funcionalidad: 'Grupos de Gastos Compartidos', Uso_Total: totalGrupos, Motivo_Popularidad: 'Uso colaborativo entre estudiantes para dividir gastos comunes.' },
      { Funcionalidad: 'Alertas Financieras', Uso_Total: totalAlertas, Motivo_Popularidad: 'Generadas automáticamente por el sistema al detectar comportamientos de riesgo.' },
    ].sort((a, b) => b.Uso_Total - a.Uso_Total);

    // Gasto estimado vs real por usuario
    const diffSheet = (usuarios.data || []).map(u => {
      const est = Number(u.gasto_estimado) || 0;
      const real = gastoPorUsuario[u.id] || 0;
      const dif = real - est;
      const difPct = est > 0 ? parseFloat(((dif / est) * 100).toFixed(1)) : null;
      return {
        Nombre: u.nombre,
        Correo: u.correo,
        Gasto_Estimado_USD: est,
        Gasto_Real_USD: parseFloat(real.toFixed(2)),
        Diferencia_USD: parseFloat(dif.toFixed(2)),
        Diferencia_Pct: difPct !== null ? `${difPct}%` : 'Sin estimado',
        Estado: dif > 0 ? 'Gasta MÁS de lo estimado ⚠' : dif < 0 ? 'Gasta MENOS de lo estimado ✔' : 'Gasto en línea con estimado',
      };
    });

    // Usuarios en riesgo financiero con predicciones
    const riesgoSheet = (usuarios.data || [])
      .map(u => {
        const a = lastAnalisis[u.id];
        const gastoTotal = gastoPorUsuario[u.id] || 0;
        const ingresoHist = ingresoTotal[u.id] || 0;
        
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
          Nombre: u.nombre,
          Correo: u.correo,
          Wally_Score: a?.puntaje_financiero ?? 'Sin datos',
          Nivel_Riesgo: a?.nivel_riesgo ?? 'Sin análisis',
          Gasto_Real_USD: parseFloat(gastoTotal.toFixed(2)),
          Gasto_Estimado_USD: Number(u.gasto_estimado) || 0,
          Saldo_Disponible_USD: parseFloat(saldoDisponible.toFixed(2)),
          Promedio_Gasto_Diario_USD: parseFloat(promedioGastoDiario.toFixed(2)),
          Dias_Hasta_Sin_Dinero: diasHastaSinDinero,
          En_Riesgo: a?.nivel_riesgo === 'RIESGO_FINANCIERO' ? 'SÍ 🔴' : 'NO 🟢',
        };
      })
      .sort((a, b) => {
        const orden = { 'SÍ 🔴': 0, 'NO 🟢': 1 } as any;
        return (orden[a.En_Riesgo] ?? 1) - (orden[b.En_Riesgo] ?? 1);
      });

    // Categorías ordenadas por gasto
    const categoriasSheet = Object.entries(gastoPorCategoria)
      .map(([cat, total]) => ({
        Categoria: cat,
        Gasto_Total_USD: parseFloat(total.toFixed(2)),
        Proporcion_Pct: `${parseFloat(((total / Object.values(gastoPorCategoria).reduce((a, b) => a + b, 0)) * 100).toFixed(1))}%`,
        Recomendacion: total === Math.max(...Object.values(gastoPorCategoria))
          ? 'Categoría líder: crear alertas específicas y herramientas de control.'
          : 'Monitorear tendencia mensual.',
      }))
      .sort((a, b) => b.Gasto_Total_USD - a.Gasto_Total_USD);

    // Efectividad de metas
    const metasSheet = (metas.data || []).map(m => {
      const pct = Number(m.monto_objetivo) > 0
        ? parseFloat(((Number(m.monto_actual) / Number(m.monto_objetivo)) * 100).toFixed(1))
        : 0;
      const completada = Number(m.monto_actual) >= Number(m.monto_objetivo);
      return {
        Usuario: (m.usuarios as any)?.nombre || '',
        Meta: m.nombre,
        Objetivo_USD: Number(m.monto_objetivo),
        Acumulado_USD: Number(m.monto_actual),
        Progreso_Pct: `${pct}%`,
        Estado: completada ? 'Completada ✅' : pct >= 50 ? 'En progreso 🔄' : 'En inicio 🔵',
        Fecha_Limite: m.fecha_objetivo,
      };
    });

    // Scores por usuario
    const scoresSheet = (usuarios.data || []).map(u => {
      const a = lastAnalisis[u.id];
      const score = a?.puntaje_financiero ?? null;
      return {
        Nombre: u.nombre,
        Correo: u.correo,
        Wally_Score: score ?? 'Sin datos',
        Nivel_Riesgo: a?.nivel_riesgo ?? 'Sin análisis',
        Calificacion: score === null ? 'Sin datos'
          : score >= 90 ? 'Excelente 🏆'
          : score >= 70 ? 'Bueno ✔'
          : score >= 50 ? 'Regular ⚠'
          : 'Crítico 🔴',
      };
    }).sort((a, b) => {
      const av = typeof a.Wally_Score === 'number' ? a.Wally_Score : -1;
      const bv = typeof b.Wally_Score === 'number' ? b.Wally_Score : -1;
      return bv - av;
    });

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

    const retencionSheet = [
      { Metrica: 'Usuarios activos últimos 30 días (MAU)', Valor: mauCur },
      { Metrica: 'Usuarios activos período anterior (MAU prev)', Valor: mauPrev },
      { Metrica: 'Tasa de Retención (%)', Valor: `${retPct}%` },
      { Metrica: 'Tasa de Abandono (%)', Valor: `${Math.max(0, 100 - retPct)}%` },
      { Metrica: 'Interpretación', Valor: retPct >= 60 ? 'Retención saludable. Los usuarios vuelven consistentemente.' : 'Retención baja. Revisar onboarding y flujos clave de la app.' },
    ];

    // ── Construir workbook ────────────────────────────────────────────────────
    const wb = xlsx.utils.book_new();

    xlsx.utils.book_append_sheet(wb, xlsx.utils.json_to_sheet(funcionalidades.map((f, i) => ({
      Posicion: i + 1,
      Funcionalidad: f.Funcionalidad,
      Uso_Total: f.Uso_Total,
      Estado: i === 0 ? '⭐ Más utilizada' : i === funcionalidades.length - 1 ? '⚠ Menos utilizada' : 'Intermedia',
      Motivo: f.Motivo_Popularidad,
    }))), 'Funciones_Uso');

    xlsx.utils.book_append_sheet(wb, xlsx.utils.json_to_sheet(diffSheet), 'Gasto_Estimado_vs_Real');
    xlsx.utils.book_append_sheet(wb, xlsx.utils.json_to_sheet(riesgoSheet), 'Usuarios_en_Riesgo');
    xlsx.utils.book_append_sheet(wb, xlsx.utils.json_to_sheet(categoriasSheet), 'Categorias_Mayor_Gasto');
    xlsx.utils.book_append_sheet(wb, xlsx.utils.json_to_sheet(metasSheet), 'Efectividad_Metas');
    xlsx.utils.book_append_sheet(wb, xlsx.utils.json_to_sheet(scoresSheet), 'Puntaje_Financiero');
    xlsx.utils.book_append_sheet(wb, xlsx.utils.json_to_sheet(retencionSheet), 'Tasa_Retencion');

    // Hoja de resumen ejecutivo
    const [biz, fin] = await Promise.all([
      this.adminKpisService.getBusinessKPIs(adminId), 
      this.adminKpisService.getFinancialKPIs(adminId)
    ]);
    xlsx.utils.book_append_sheet(wb, xlsx.utils.json_to_sheet([
      { Indicador: 'Total Estudiantes Registrados', Valor: biz.usuarios_registrados, Significado: 'Usuarios con rol ESTUDIANTE en la plataforma' },
      { Indicador: 'Usuarios Activos (MAU)', Valor: biz.usuarios_activos_mensuales, Significado: 'Registraron al menos un movimiento en los últimos 30 días' },
      { Indicador: 'Tasa de Retención', Valor: `${biz.tasa_retencion}%`, Significado: 'Porcentaje de usuarios que repitieron actividad vs mes anterior' },
      { Indicador: 'Tasa de Abandono', Valor: `${biz.tasa_abandono}%`, Significado: 'Usuarios que no repitieron actividad comparado con período anterior' },
      { Indicador: 'Gasto Promedio por Usuario', Valor: `$${fin.gasto_promedio}`, Significado: 'Suma de gastos reales dividida entre todos los estudiantes' },
      { Indicador: 'Ingreso Promedio por Usuario', Valor: `$${fin.ingreso_promedio}`, Significado: 'Ingresos registrados divididos entre el total de estudiantes' },
      { Indicador: 'Usuarios en Riesgo Financiero', Valor: fin.usuarios_en_riesgo, Significado: 'Usuarios con nivel RIESGO_FINANCIERO en su último análisis' },
      { Indicador: 'Diferencia Gasto Estimado vs Real', Valor: `${fin.diferencia_estimado_real_pct > 0 ? '+' : ''}${fin.diferencia_estimado_real_pct}%`, Significado: 'Promedio de desviación entre lo estimado al registro y el gasto real' },
      { Indicador: 'Metas Completadas', Valor: `${fin.metas_completadas} / ${fin.total_metas}`, Significado: 'Metas donde el monto_actual alcanzó el monto_objetivo' },
      { Indicador: 'Wally Score Promedio', Valor: `${fin.wally_score_promedio}/100`, Significado: 'Promedio del puntaje financiero de todos los usuarios analizados' },
      { Indicador: 'Categoría con Mayor Gasto', Valor: fin.top_categorias[0]?.nombre || 'N/A', Significado: `Total acumulado: $${fin.top_categorias[0]?.total || 0}` },
    ]), 'Resumen_Ejecutivo');

    // Datos crudos para referencia
    xlsx.utils.book_append_sheet(wb, xlsx.utils.json_to_sheet(
      (movs.data || []).map(m => ({
        Usuario: (m.usuarios as any)?.nombre || '',
        Monto: m.monto, Tipo: m.tipo, Fecha: m.fecha,
        Categoria: (m.categorias as any)?.nombre || '',
      }))
    ), 'Movimientos_Detalle');

    xlsx.utils.book_append_sheet(wb, xlsx.utils.json_to_sheet(
      (usuarios.data || []).map(u => ({
        Id: u.id, Nombre: u.nombre, Correo: u.correo,
        Trabaja: u.trabaja ? 'Sí' : 'No',
        Ingreso_Mensual: u.ingreso_mensual,
        Gasto_Estimado: u.gasto_estimado,
        Fecha_Registro: u.fecha_registro,
      }))
    ), 'Dim_Usuarios');

    xlsx.utils.book_append_sheet(wb, xlsx.utils.json_to_sheet(
      (presupuestos.data || []).map(p => ({
        Usuario: (p.usuarios as any)?.nombre || '',
        Limite_Monto: p.limite_monto,
        Categoria: (p.categorias as any)?.nombre || '',
      }))
    ), 'Fact_Presupuestos');

    xlsx.utils.book_append_sheet(wb, xlsx.utils.json_to_sheet(
      (analisis.data || []).map(a => ({
        Usuario: (a.usuarios as any)?.nombre || '',
        Puntaje_Financiero: a.puntaje_financiero,
        Nivel_Riesgo: a.nivel_riesgo,
        Fecha: a.fecha_creacion,
      }))
    ), 'Fact_Analisis');

    const buffer: Buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
    return buffer.toString('base64');
  }
}
