import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';
import { AdminCoreService } from './admin-core.service';

@Injectable()
export class AdminKpisService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly adminCoreService: AdminCoreService,
  ) {}

  async getBusinessKPIs(adminId: string) {
    await this.adminCoreService.verifyRole(adminId);
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
    await this.adminCoreService.verifyRole(adminId);
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
}
