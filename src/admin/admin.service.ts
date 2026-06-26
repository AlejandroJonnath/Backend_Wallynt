import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
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

    // Fetch all raw data in parallel
    const [usuarios, movs, presupuestos, metas, analisis] = await Promise.all([
      supabase.from('usuarios').select('nombre, correo, rol, trabaja, ingreso_mensual, gasto_estimado').eq('rol', 'ESTUDIANTE'),
      supabase.from('movimientos').select('monto, tipo, descripcion, fecha, categorias(nombre), usuarios(nombre)'),
      supabase.from('presupuestos').select('limite_monto, categorias(nombre), usuarios(nombre)'),
      supabase.from('metas_ahorro').select('nombre, monto_objetivo, monto_actual, fecha_objetivo, usuarios(nombre)'),
      supabase.from('analisis_financiero').select('puntaje_financiero, nivel_riesgo, usuarios(nombre)').order('fecha_creacion', { ascending: false }),
    ]);

    if (usuarios.error) throw new BadRequestException(`Error en tabla usuarios: ${usuarios.error.message}`);
    if (movs.error) throw new BadRequestException(`Error en tabla movimientos: ${movs.error.message}`);
    if (presupuestos.error) throw new BadRequestException(`Error en tabla presupuestos: ${presupuestos.error.message}`);
    if (metas.error) throw new BadRequestException(`Error en tabla metas: ${metas.error.message}`);

    if (!usuarios.data || usuarios.data.length === 0) {
      throw new BadRequestException('No hay estudiantes registrados. No se puede generar el reporte Excel sin datos.');
    }

    // Calculate KPIs for insight sheets
    const [biz, fin] = await Promise.all([
      this.getBusinessKPIs(adminId),
      this.getFinancialKPIs(adminId),
    ]);

    const wb = xlsx.utils.book_new();

    // --- Hoja 1: Usuarios ---
    xlsx.utils.book_append_sheet(wb, xlsx.utils.json_to_sheet(
      (usuarios.data || []).map(u => ({
        Nombre: u.nombre, Correo: u.correo, Rol: u.rol,
        Trabaja: u.trabaja ? 'Sí' : 'No',
        Ingreso_Mensual: u.ingreso_mensual, Gasto_Estimado: u.gasto_estimado,
      }))
    ), 'Usuarios');

    // --- Hoja 2: Movimientos ---
    xlsx.utils.book_append_sheet(wb, xlsx.utils.json_to_sheet(
      (movs.data || []).map(m => ({
        Usuario: (m.usuarios as any)?.nombre || '',
        Monto: m.monto, Tipo: m.tipo, Descripcion: m.descripcion,
        Fecha: m.fecha, Categoria: (m.categorias as any)?.nombre || '',
      }))
    ), 'Movimientos');

    // --- Hoja 3: Presupuestos ---
    xlsx.utils.book_append_sheet(wb, xlsx.utils.json_to_sheet(
      (presupuestos.data || []).map(p => ({
        Usuario: (p.usuarios as any)?.nombre || '',
        Categoria: (p.categorias as any)?.nombre || '',
        Limite_Monto: p.limite_monto,
      }))
    ), 'Presupuestos');

    // --- Hoja 4: Metas de Ahorro ---
    xlsx.utils.book_append_sheet(wb, xlsx.utils.json_to_sheet(
      (metas.data || []).map(m => ({
        Usuario: (m.usuarios as any)?.nombre || '',
        Meta: m.nombre, Objetivo: m.monto_objetivo,
        Acumulado: m.monto_actual, Fecha_Limite: m.fecha_objetivo,
      }))
    ), 'Metas_Ahorro');

    // --- Hoja 5: KPIs de Negocio ---
    xlsx.utils.book_append_sheet(wb, xlsx.utils.json_to_sheet([
      { Metrica: 'Usuarios Registrados (Estudiantes)', Valor: biz.usuarios_registrados },
      { Metrica: 'Usuarios Activos Mensuales (MAU)', Valor: biz.usuarios_activos_mensuales },
      { Metrica: 'Tasa de Retención (%)', Valor: biz.tasa_retencion },
      { Metrica: 'Tasa de Abandono (%)', Valor: biz.tasa_abandono },
      ...biz.funcionalidades.map(f => ({ Metrica: `Uso de "${f.name}"`, Valor: f.count })),
    ]), 'KPIs_Negocio');

    // --- Hoja 6: KPIs Financieros ---
    xlsx.utils.book_append_sheet(wb, xlsx.utils.json_to_sheet([
      { Metrica: 'Gasto Promedio por Usuario ($)', Valor: fin.gasto_promedio },
      { Metrica: 'Ingreso Promedio por Usuario ($)', Valor: fin.ingreso_promedio },
      { Metrica: 'Usuarios en Riesgo Financiero', Valor: fin.usuarios_en_riesgo },
      { Metrica: 'Diferencia Estimado vs Real (%)', Valor: fin.diferencia_estimado_real_pct },
      { Metrica: 'Metas Completadas', Valor: fin.metas_completadas },
      { Metrica: 'Total de Metas', Valor: fin.total_metas },
      { Metrica: 'Wally Score Promedio (0-100)', Valor: fin.wally_score_promedio },
      ...fin.top_categorias.map(c => ({ Metrica: `Gasto en categoría "${c.nombre}"`, Valor: c.total })),
    ]), 'KPIs_Financieros');

    // --- Hoja 7: Wally Scores por Usuario ---
    xlsx.utils.book_append_sheet(wb, xlsx.utils.json_to_sheet(
      (analisis.data || []).map(a => ({
        Usuario: (a.usuarios as any)?.nombre || '',
        Puntaje: a.puntaje_financiero, Nivel_Riesgo: a.nivel_riesgo,
      }))
    ), 'Wally_Scores');

    // --- Hoja 8: Insights Estratégicos ---
    const insights = await this.getStrategicInsights(adminId);
    xlsx.utils.book_append_sheet(wb, xlsx.utils.json_to_sheet(
      insights.map(ins => ({
        Insight: ins.titulo,
        Dato: ins.dato_texto,
        Accion_Recomendada: ins.decision,
      }))
    ), 'Insights_Estrategicos');

    const buffer: Buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
    return buffer.toString('base64');
  }

  async exportPowerBI(adminId: string) {
    await this.verifyRole(adminId);
    const supabase = this.supabaseService.getClient();

    const [usuarios, movimientos, presupuestos, metas, analisis] = await Promise.all([
      supabase.from('usuarios').select('id, nombre, trabaja, ingreso_mensual, gasto_estimado').eq('rol', 'ESTUDIANTE'),
      supabase.from('movimientos').select('id, usuario_id, monto, tipo, fecha, categorias(nombre), usuarios(nombre)'),
      supabase.from('presupuestos').select('id, usuario_id, limite_monto, categorias(nombre)'),
      supabase.from('metas_ahorro').select('id, usuario_id, nombre, monto_objetivo, monto_actual'),
      supabase.from('analisis_financiero').select('usuario_id, puntaje_financiero, nivel_riesgo, fecha_creacion').order('fecha_creacion', { ascending: false }),
    ]);

    if (usuarios.error) throw new BadRequestException(`Error en tabla usuarios: ${usuarios.error.message}`);
    if (movimientos.error) throw new BadRequestException(`Error en movimientos: ${movimientos.error.message}`);
    if (presupuestos.error) throw new BadRequestException(`Error en presupuestos: ${presupuestos.error.message}`);
    if (metas.error) throw new BadRequestException(`Error en metas: ${metas.error.message}`);

    if (!usuarios.data || usuarios.data.length === 0) {
      throw new BadRequestException('No hay estudiantes registrados. No se puede exportar datos para Power BI sin registros.');
    }

    const [biz, fin, insights] = await Promise.all([
      this.getBusinessKPIs(adminId),
      this.getFinancialKPIs(adminId),
      this.getStrategicInsights(adminId),
    ]);

    return {
      // Dimensiones base
      dim_usuarios: usuarios.data,
      fact_movimientos: (movimientos.data || []).map(m => ({
        id: m.id, usuario_id: m.usuario_id, nombre_usuario: (m.usuarios as any)?.nombre || '',
        monto: Number(m.monto), tipo: m.tipo, fecha: m.fecha,
        categoria: (m.categorias as any)?.nombre || 'Sin Categoría',
      })),
      dim_presupuestos: (presupuestos.data || []).map(p => ({
        id: p.id, usuario_id: p.usuario_id, limite_monto: p.limite_monto,
        categoria: (p.categorias as any)?.nombre || 'Sin Categoria',
      })),
      fact_metas: metas.data || [],
      fact_scores: (analisis.data || []).map(a => ({
        usuario_id: a.usuario_id, puntaje_financiero: a.puntaje_financiero,
        nivel_riesgo: a.nivel_riesgo, fecha: a.fecha_creacion,
      })),
      // KPIs listos para tarjetas de Power BI
      kpis_negocio: {
        usuarios_registrados: biz.usuarios_registrados,
        usuarios_activos_mensuales: biz.usuarios_activos_mensuales,
        tasa_retencion_pct: biz.tasa_retencion,
        tasa_abandono_pct: biz.tasa_abandono,
        uso_funcionalidades: biz.funcionalidades,
      },
      kpis_financieros: {
        gasto_promedio_usd: fin.gasto_promedio,
        ingreso_promedio_usd: fin.ingreso_promedio,
        usuarios_en_riesgo: fin.usuarios_en_riesgo,
        diferencia_estimado_real_pct: fin.diferencia_estimado_real_pct,
        metas_completadas: fin.metas_completadas,
        total_metas: fin.total_metas,
        wally_score_promedio: fin.wally_score_promedio,
        top_categorias_gasto: fin.top_categorias,
      },
      // Insights estratégicos con fundamento
      insights_estrategicos: insights.map(ins => ({
        titulo: ins.titulo,
        dato_clave: ins.dato_texto,
        accion_recomendada: ins.decision,
      })),
      metadata: {
        generado_en: new Date().toISOString(),
        total_estudiantes: (usuarios.data || []).length,
        total_movimientos: (movimientos.data || []).length,
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
