import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';

@Injectable()
export class AnalysisDashboardService {
  constructor(private readonly supabaseService: SupabaseService) {}

  async calcularSaldoHistorico(userId: string): Promise<number> {
    const supabase = this.supabaseService.getClient();
    const hoy = new Date();
    const { data: usuario } = await supabase
      .from('usuarios')
      .select('ingreso_mensual, fecha_registro')
      .eq('id', userId)
      .single();

    const ingreso_fijo = Number(usuario?.ingreso_mensual || 0);
    
    let mesesActivos = 1;
    if (usuario?.fecha_registro) {
      const fechaReg = new Date(usuario.fecha_registro);
      mesesActivos = (hoy.getFullYear() - fechaReg.getFullYear()) * 12 + (hoy.getMonth() - fechaReg.getMonth()) + 1;
      if (mesesActivos < 1) mesesActivos = 1;
    }

    const { data: movimientos } = await supabase
      .from('movimientos')
      .select('monto, tipo')
      .eq('usuario_id', userId);

    let totalIngresosHist = 0;
    let totalGastosHist = 0;
    (movimientos || []).forEach(m => {
      if (m.tipo === 'INGRESO') totalIngresosHist += Number(m.monto);
      else totalGastosHist += Number(m.monto);
    });

    return (ingreso_fijo * mesesActivos) + totalIngresosHist - totalGastosHist;
  }

  async getDashboard(userId: string) {
    const supabase = this.supabaseService.getClient();
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    const startDate = startOfMonth.toISOString().split('T')[0];

    const [userRes, presRes, movRes] = await Promise.all([
      supabase.from('usuarios').select('ingreso_mensual').eq('id', userId).single(),
      supabase.from('presupuestos').select('limite_monto').eq('usuario_id', userId),
      supabase.from('movimientos').select('monto, tipo').eq('usuario_id', userId).gte('fecha', startDate)
    ]);

    const ingreso_fijo = userRes.data?.ingreso_mensual || 0;
    let totalPresupuestos = 0;
    (presRes.data || []).forEach(p => totalPresupuestos += Number(p.limite_monto));

    let totalIngresosMes = 0;
    let totalGastosMes = 0;
    (movRes.data || []).forEach(m => {
      if (m.tipo === 'INGRESO') totalIngresosMes += Number(m.monto);
      else totalGastosMes += Number(m.monto);
    });

    const dinero_ahorro = Math.max(0, ingreso_fijo - totalPresupuestos);
    const saldoHistorico = await this.calcularSaldoHistorico(userId);

    return { 
      totalIngresos: totalIngresosMes + Number(ingreso_fijo), 
      totalGastos: totalGastosMes, 
      saldoDisponible: saldoHistorico,
      ingreso_mensual_fijo: Number(ingreso_fijo),
      dinero_para_ahorro: Number(dinero_ahorro)
    };
  }

  async getDailyLimit(userId: string) {
    const hoy = new Date();
    const saldo = await this.calcularSaldoHistorico(userId);
    const diasEnMes = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).getDate();
    const diasRestantes = Math.max(diasEnMes - hoy.getDate() + 1, 1);
    const limiteDiario = Math.max(saldo / diasRestantes, 0);

    return {
      saldo_disponible: parseFloat(saldo.toFixed(2)),
      dias_restantes: diasRestantes,
      limite_diario: parseFloat(limiteDiario.toFixed(2)),
    };
  }
}
