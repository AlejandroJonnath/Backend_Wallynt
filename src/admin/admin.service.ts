import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { CreateAlertDto } from './dto/create-alert.dto';
import * as xlsx from 'xlsx';

@Injectable()
export class AdminService {
  constructor(private readonly supabaseService: SupabaseService) { }

  private async verifyRole(userId: string) {
    const supabase = this.supabaseService.getClient();
    const { data } = await supabase
      .from('usuarios').select('rol').eq('id', userId).single();
    if (!data || (data.rol !== 'ADMIN' && data.rol !== 'SUPERADMIN')) {
      throw new ForbiddenException('Acceso restringido a administradores');
    }
    return data.rol;
  }

  async getBusinessKPIs(adminId: string) {
    await this.verifyRole(adminId);
    const supabase = this.supabaseService.getClient();

    const hace30 = new Date(Date.now() - 30 * 86400000).toISOString();
    const hace60 = new Date(Date.now() - 60 * 86400000).toISOString();

    const [totalUsers, currentActive, pastActive, movimientos, metas, presupuestos] = await Promise.all([
      supabase.from('usuarios').select('id', { count: 'exact', head: true }).eq('rol', 'ESTUDIANTE'),
      supabase.from('movimientos').select('usuario_id').gte('fecha_creacion', hace30),
      supabase.from('movimientos').select('usuario_id').gte('fecha_creacion', hace60).lt('fecha_creacion', hace30),
      supabase.from('movimientos').select('id', { count: 'exact', head: true }),
      supabase.from('metas_ahorro').select('id', { count: 'exact', head: true }),
      supabase.from('presupuestos').select('id', { count: 'exact', head: true }),
    ]);

    const currentMAU = new Set((currentActive.data || []).map(m => m.usuario_id)).size;
    const pastMAU = new Set((pastActive.data || []).map(m => m.usuario_id)).size;

    const retentionRate = pastMAU === 0 ? 0 : Math.min(100, Math.round((currentMAU / pastMAU) * 100));
    const churnRate = pastMAU === 0 ? 0 : Math.max(0, 100 - retentionRate);

    const features = [
      { name: 'Gestión de Gastos (Movimientos)', count: movimientos.count || 0, icon: 'list' },
      { name: 'Planificación (Presupuestos)', count: presupuestos.count || 0, icon: 'pie-chart' },
      { name: 'Ahorro (Metas)', count: metas.count || 0, icon: 'flag' },
    ].sort((a, b) => b.count - a.count);

    return {
      usuarios_registrados: totalUsers.count || 0,
      usuarios_activos_mensuales: currentMAU,
      tasa_retencion: retentionRate,
      tasa_abandono: churnRate,
      funcionalidades: features,
    };
  }

  async getFinancialKPIs(adminId: string) {
    await this.verifyRole(adminId);
    const supabase = this.supabaseService.getClient();

    const [movs, usuarios, analisis, metas, alertas] = await Promise.all([
      supabase.from('movimientos').select('monto, tipo, usuario_id, categorias(nombre)'),
      supabase.from('usuarios').select('id, gasto_estimado').eq('rol', 'ESTUDIANTE'),
      supabase.from('analisis_financiero').select('usuario_id, nivel_riesgo, puntaje_financiero').order('fecha_creacion', { ascending: false }),
      supabase.from('metas_ahorro').select('estado'),
      supabase.from('alertas').select('id', { count: 'exact', head: true }),
    ]);

    const totalUsuarios = (usuarios.data || []).length || 1;

    let totalGasto = 0, totalIngreso = 0;
    const gastoPorUsuario: Record<string, number> = {};
    const gastoPorCategoria: Record<string, number> = {};

    for (const m of movs.data || []) {
      const amt = Number(m.monto);
      const catName = (m.categorias as any)?.nombre || 'Otros';
      if (m.tipo === 'GASTO') {
        totalGasto += amt;
        gastoPorUsuario[m.usuario_id] = (gastoPorUsuario[m.usuario_id] || 0) + amt;
        gastoPorCategoria[catName] = (gastoPorCategoria[catName] || 0) + amt;
      } else {
        totalIngreso += amt;
      }
    }

    // Top categorías
    const topCategorias = Object.entries(gastoPorCategoria)
      .map(([nombre, total]) => ({ nombre, total: parseFloat(total.toFixed(2)) }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);

    // Riesgo financiero (último análisis por usuario)
    const byUser: Record<string, any> = {};
    for (const a of analisis.data || []) {
      if (!byUser[a.usuario_id]) byUser[a.usuario_id] = a;
    }
    let enRiesgo = 0, totalScore = 0, analisisCount = 0;
    for (const a of Object.values(byUser)) {
      if (a.nivel_riesgo === 'RIESGO_FINANCIERO') enRiesgo++;
      if (a.puntaje_financiero) { totalScore += a.puntaje_financiero; analisisCount++; }
    }

    // Diferencia estimado vs real
    let sumaDifs = 0, difCount = 0;
    for (const u of usuarios.data || []) {
      const est = Number(u.gasto_estimado) || 0;
      if (est > 0) {
        const real = gastoPorUsuario[u.id] || 0;
        sumaDifs += ((real - est) / est) * 100;
        difCount++;
      }
    }

    const metasCompletadas = (metas.data || []).filter(m => m.estado === 'COMPLETADA').length;
    const totalMetas = (metas.data || []).length;

    return {
      gasto_promedio: parseFloat((totalGasto / totalUsuarios).toFixed(2)),
      ingreso_promedio: parseFloat((totalIngreso / totalUsuarios).toFixed(2)),
      usuarios_en_riesgo: enRiesgo,
      diferencia_estimado_real_pct: difCount > 0 ? Math.round(sumaDifs / difCount) : 0,
      metas_completadas: metasCompletadas,
      total_metas: totalMetas,
      wally_score_promedio: analisisCount > 0 ? Math.round(totalScore / analisisCount) : 0,
      top_categorias: topCategorias,
    };
  }

  async getStrategicInsights(adminId: string) {
    await this.verifyRole(adminId);
    // Reutilizamos las funciones anteriores para calcular datos reales
    const [biz, fin] = await Promise.all([
      this.getBusinessKPIs(adminId),
      this.getFinancialKPIs(adminId),
    ]);

    const topFeat = biz.funcionalidades[0];
    const bottomFeat = biz.funcionalidades[biz.funcionalidades.length - 1];
    const topCat = fin.top_categorias[0];
    const difSign = fin.diferencia_estimado_real_pct >= 0 ? 'más de lo que estiman' : 'menos de lo que estiman';
    const difAbs = Math.abs(fin.diferencia_estimado_real_pct);

    const metasPct = fin.total_metas > 0
      ? Math.round((fin.metas_completadas / fin.total_metas) * 100)
      : 0;

    return [
      {
        titulo: 'Funcionalidades más utilizadas',
        dato_texto: topFeat ? `${topFeat.name}: ${topFeat.count} registros` : 'Sin datos suficientes aún',
        icono: 'star',
        color: '#4CAF50',
        decision: topFeat ? `Invertir más recursos en "${topFeat.name}".` : 'Aún no hay suficientes datos.',
      },
      {
        titulo: 'Funcionalidades menos utilizadas',
        dato_texto: bottomFeat ? `${bottomFeat.name}: ${bottomFeat.count} registros` : 'Sin datos suficientes aún',
        icono: 'alert-circle',
        color: '#FFC107',
        decision: bottomFeat ? `Rediseñar o simplificar "${bottomFeat.name}".` : 'Aún no hay suficientes datos.',
      },
      {
        titulo: 'Diferencia gasto estimado vs real',
        dato_texto: difAbs > 0 ? `Los usuarios gastan un ${difAbs}% ${difSign}` : 'Los usuarios gastan exactamente lo que estiman',
        icono: 'trending-up',
        color: fin.diferencia_estimado_real_pct > 0 ? '#F44336' : '#4CAF50',
        decision: fin.diferencia_estimado_real_pct > 10 ? 'Enfocar el producto en concientización del gasto real.' : 'La percepción financiera está alineada.',
      },
      {
        titulo: 'Usuarios en riesgo financiero',
        dato_texto: `${fin.usuarios_en_riesgo} de ${biz.usuarios_registrados} usuarios están en nivel de riesgo alto`,
        icono: 'warning',
        color: fin.usuarios_en_riesgo > 0 ? '#F44336' : '#4CAF50',
        decision: fin.usuarios_en_riesgo > 0 ? 'Crear alertas preventivas y recomendaciones personalizadas.' : 'La comunidad está financieramente saludable.',
      },
      {
        titulo: 'Categoría con mayor gasto',
        dato_texto: topCat ? `"${topCat.nombre}" concentra $${topCat.total} del gasto total` : 'Sin datos de gasto',
        icono: 'cart',
        color: '#2196F3',
        decision: topCat ? `Crear herramientas especializadas para la categoría "${topCat.nombre}".` : 'Aún no hay suficientes datos.',
      },
      {
        titulo: 'Efectividad de metas de ahorro',
        dato_texto: `${fin.metas_completadas} de ${fin.total_metas} metas completadas (${metasPct}%)`,
        icono: 'flag',
        color: metasPct >= 50 ? '#4CAF50' : '#FFC107',
        decision: metasPct < 50 ? 'Rediseñar el módulo de metas para facilitar el ahorro.' : 'El módulo de ahorro está funcionando bien.',
      },
      {
        titulo: 'Puntaje financiero promedio',
        dato_texto: `Wally Score promedio: ${fin.wally_score_promedio}/100`,
        icono: 'analytics',
        color: fin.wally_score_promedio >= 70 ? '#4CAF50' : fin.wally_score_promedio >= 40 ? '#FFC107' : '#F44336',
        decision: fin.wally_score_promedio < 60 ? 'Reforzar el módulo de educación financiera y alertas inteligentes.' : 'Los usuarios demuestran buena salud financiera general.',
      },
      {
        titulo: 'Tasa de retención mensual',
        dato_texto: `${biz.tasa_retencion}% de retención — ${biz.tasa_abandono}% de abandono`,
        icono: 'people',
        color: biz.tasa_retencion >= 60 ? '#4CAF50' : '#F44336',
        decision: biz.tasa_retencion < 60 ? 'Replantear el onboarding y los flujos clave de la aplicación.' : 'Los usuarios vuelven consistentemente.',
      },
    ];
  }

  async exportExcel(adminId: string): Promise<string> {
    await this.verifyRole(adminId);
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

    // Usuarios en riesgo financiero
    const riesgoSheet = (usuarios.data || [])
      .map(u => {
        const a = lastAnalisis[u.id];
        return {
          Nombre: u.nombre,
          Correo: u.correo,
          Wally_Score: a?.puntaje_financiero ?? 'Sin datos',
          Nivel_Riesgo: a?.nivel_riesgo ?? 'Sin análisis',
          Gasto_Real_USD: parseFloat((gastoPorUsuario[u.id] || 0).toFixed(2)),
          Gasto_Estimado_USD: Number(u.gasto_estimado) || 0,
          En_Riesgo: a?.nivel_riesgo === 'RIESGO_FINANCIERO' ? 'SÍ 🔴' : 'NO 🟢',
        };
      })
      .sort((a, b) => {
        const orden = { 'SÍ 🔴': 0, 'NO 🟢': 1 };
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
    const [biz, fin] = await Promise.all([this.getBusinessKPIs(adminId), this.getFinancialKPIs(adminId)]);
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
        Nombre: u.nombre, Correo: u.correo,
        Trabaja: u.trabaja ? 'Sí' : 'No',
        Ingreso_Mensual: u.ingreso_mensual,
        Gasto_Estimado: u.gasto_estimado,
        Fecha_Registro: u.fecha_registro,
      }))
    ), 'Usuarios_Detalle');

    const buffer: Buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
    return buffer.toString('base64');
  }

  async exportPowerBI(adminId: string) {
    await this.verifyRole(adminId);
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

    // Usuarios en riesgo financiero detallado
    const usuariosRiesgo = (usuarios.data || []).map(u => {
      const a = lastAnalisis[u.id];
      return {
        usuario_id: u.id,
        nombre: u.nombre,
        correo: u.correo,
        wally_score: a?.puntaje_financiero ?? null,
        nivel_riesgo: a?.nivel_riesgo ?? 'SIN_ANALISIS',
        en_riesgo: a?.nivel_riesgo === 'RIESGO_FINANCIERO',
        gasto_real: parseFloat((gastoPorUsuario[u.id] || 0).toFixed(2)),
        gasto_estimado: Number(u.gasto_estimado) || 0,
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

  // --- SUPER ADMIN CRUD ---

  async getUsers(adminId: string) {
    const rol = await this.verifyRole(adminId);
    if (rol !== 'SUPERADMIN') throw new ForbiddenException('Solo SuperAdmin puede gestionar usuarios');

    const supabase = this.supabaseService.getClient();
    const { data, error } = await supabase
      .from('usuarios').select('id, nombre, correo, rol, fecha_registro');

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async updateUserRole(adminId: string, userId: string, nuevoRol: string) {
    const rol = await this.verifyRole(adminId);
    if (rol !== 'SUPERADMIN') throw new ForbiddenException('Solo SuperAdmin puede cambiar roles');

    const supabase = this.supabaseService.getClient();
    const { data, error } = await supabase
      .from('usuarios').update({ rol: nuevoRol }).eq('id', userId).select().single();

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async deleteUser(adminId: string, userId: string) {
    const rol = await this.verifyRole(adminId);
    if (rol !== 'SUPERADMIN') throw new ForbiddenException('Solo SuperAdmin puede eliminar usuarios');

    const supabase = this.supabaseService.getClient();
    const { error } = await supabase.auth.admin.deleteUser(userId);
    if (error) throw new BadRequestException(error.message);
    return { message: 'Usuario eliminado' };
  }


}
