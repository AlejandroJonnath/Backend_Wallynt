import { Injectable, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';
import { AnalysisDashboardService } from './analysis-dashboard.service';

@Injectable()
export class AnalysisAlertsService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly analysisDashboardService: AnalysisDashboardService,
  ) {}

  async generateAlerts(userId: string) {
    const supabase = this.supabaseService.getClient();
    const hoy = new Date();
    const startOfMonth = new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().split('T')[0];
    const hace7 = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
    const hace14 = new Date(Date.now() - 14 * 86400000).toISOString().split('T')[0];

    const { data: presupuestos } = await supabase
      .from('presupuestos').select('*').eq('usuario_id', userId);

    const alertas: any[] = [];

    // Alerta de presupuesto
    for (const p of presupuestos || []) {
      const { data: gastos } = await supabase
        .from('movimientos').select('monto')
        .eq('usuario_id', userId).eq('categoria_id', p.categoria_id)
        .eq('tipo', 'GASTO').gte('fecha', startOfMonth);

      const total = (gastos || []).reduce((s, m) => s + Number(m.monto), 0);
      const pct = (total / Number(p.limite_monto)) * 100;

      if (pct >= 100) {
        alertas.push({ usuario_id: userId, titulo: '⚠️ Presupuesto excedido', mensaje: `Has superado el 100% de tu presupuesto de ${p.categorias?.nombre || 'esta categoría'}`, tipo: 'PRESUPUESTO' });
      } else if (pct >= 80) {
        alertas.push({ usuario_id: userId, titulo: '🔔 Presupuesto al límite', mensaje: `Has utilizado el ${Math.round(pct)}% de tu presupuesto de ${p.categorias?.nombre || 'esta categoría'}`, tipo: 'PRESUPUESTO' });
      }
    }

    // Alerta de gasto inusual (semana actual vs anterior)
    const semActual = await supabase.from('movimientos').select('monto')
      .eq('usuario_id', userId).eq('tipo', 'GASTO').gte('fecha', hace7);
    const semAnterior = await supabase.from('movimientos').select('monto')
      .eq('usuario_id', userId).eq('tipo', 'GASTO').gte('fecha', hace14).lt('fecha', hace7);

    const totalActual = (semActual.data || []).reduce((s, m) => s + Number(m.monto), 0);
    const totalAnterior = (semAnterior.data || []).reduce((s, m) => s + Number(m.monto), 0);

    if (totalAnterior > 0 && totalActual > totalAnterior * 1.4) {
      const pct = Math.round(((totalActual - totalAnterior) / totalAnterior) * 100);
      alertas.push({ usuario_id: userId, titulo: '📈 Aumento de gastos', mensaje: `Esta semana gastaste ${pct}% más que la semana anterior`, tipo: 'INUSUAL' });
    }

    // Alerta de riesgo financiero (límite diario < $2)
    const { limite_diario } = await this.analysisDashboardService.getDailyLimit(userId);
    if (limite_diario < 2 && limite_diario >= 0) {
      alertas.push({ usuario_id: userId, titulo: '🔴 Riesgo financiero', mensaje: `Tu límite de gasto diario es de $${limite_diario}. Considera reducir gastos.`, tipo: 'RIESGO' });
    }

    if (alertas.length > 0) {
      await supabase.from('alertas').insert(alertas);
    }
  }

  async getAlerts(userId: string) {
    const supabase = this.supabaseService.getClient();
    const { data, error } = await supabase
      .from('alertas')
      .select('*')
      .eq('usuario_id', userId)
      .eq('leida', false)
      .order('fecha_creacion', { ascending: false });

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async markAlertRead(userId: string, alertId: string) {
    const supabase = this.supabaseService.getClient();
    const { data, error } = await supabase
      .from('alertas')
      .update({ leida: true })
      .eq('id', alertId)
      .eq('usuario_id', userId)
      .select()
      .single();

    if (error) throw new BadRequestException(error.message);
    return data;
  }
}
