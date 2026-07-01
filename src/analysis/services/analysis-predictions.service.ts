import { Injectable, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';
import { AnalysisDashboardService } from './analysis-dashboard.service';

@Injectable()
export class AnalysisPredictionsService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly analysisDashboardService: AnalysisDashboardService,
  ) {}

  async getFinancialPrediction(userId: string) {
    const supabase = this.supabaseService.getClient();

    const saldoDisponible = await this.analysisDashboardService.calcularSaldoHistorico(userId);

    // Promedio diario basado en últimos 30 días
    const hace30Dias = new Date();
    hace30Dias.setDate(hace30Dias.getDate() - 30);
    const start30d = hace30Dias.toISOString().split('T')[0];

    const { data: gastos30d } = await supabase
      .from('movimientos')
      .select('monto')
      .eq('usuario_id', userId)
      .eq('tipo', 'GASTO')
      .gte('fecha', start30d);

    const totalGastos30d = (gastos30d || []).reduce((sum, m) => sum + Number(m.monto), 0);
    const promedioGastoDiario = totalGastos30d > 0 ? totalGastos30d / 30 : 0;

    const diasHastaSinDinero = promedioGastoDiario > 0
      ? Math.max(0, Math.floor(saldoDisponible / promedioGastoDiario))
      : 999;

    const hoy = new Date();
    const fechaEstimada = new Date(hoy);
    fechaEstimada.setDate(hoy.getDate() + diasHastaSinDinero);

    const diasHastaFinMes = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).getDate() - hoy.getDate();

    const enRiesgo = saldoDisponible <= 0 || (promedioGastoDiario > 0 && diasHastaSinDinero < diasHastaFinMes);

    let mensaje: string;
    if (saldoDisponible <= 0) {
      mensaje = 'Tu saldo ya es negativo. Revisa tus gastos urgentemente.';
    } else if (promedioGastoDiario === 0) {
      mensaje = 'Sin gastos registrados. Registra movimientos para obtener una predicción.';
    } else if (enRiesgo) {
      mensaje = `Si mantienes este ritmo, tu dinero terminará ${diasHastaFinMes - diasHastaSinDinero} días antes de fin de mes`;
    } else {
      mensaje = 'Tu ritmo de gasto es sostenible hasta fin de mes';
    }

    return {
      promedio_gasto_diario: parseFloat(promedioGastoDiario.toFixed(2)),
      dias_hasta_sin_dinero: diasHastaSinDinero,
      fecha_estimada_sin_dinero: fechaEstimada.toISOString().split('T')[0],
      en_riesgo: enRiesgo,
      saldo_disponible: parseFloat(saldoDisponible.toFixed(2)),
      mensaje,
    };
  }

  async calculateAndSaveWallyScore(userId: string) {
    const supabase = this.supabaseService.getClient();

    // Obtener perfil del usuario
    const { data: usuario } = await supabase
      .from('usuarios')
      .select('gasto_estimado')
      .eq('id', userId)
      .single();

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    const startDate = startOfMonth.toISOString().split('T')[0];

    const { data: movimientos } = await supabase
      .from('movimientos')
      .select('monto, tipo, fecha')
      .eq('usuario_id', userId)
      .gte('fecha', startDate);

    const { data: presupuestos } = await supabase
      .from('presupuestos')
      .select('*')
      .eq('usuario_id', userId);

    const { data: metas } = await supabase
      .from('metas_ahorro')
      .select('*')
      .eq('usuario_id', userId);

    let totalGastos = 0;
    let totalIngresos = 0;
    (movimientos || []).forEach(m => {
      if (m.tipo === 'GASTO') totalGastos += Number(m.monto);
      else totalIngresos += Number(m.monto);
    });

    // Pilar 1: Control de gastos vs estimado (25pts)
    let pilar1 = 25;
    if (usuario?.gasto_estimado) {
      const ratio = totalGastos / Number(usuario.gasto_estimado);
      pilar1 = ratio <= 1 ? 25 : ratio <= 1.2 ? 15 : ratio <= 1.5 ? 5 : 0;
    }

    // Pilar 2: Cumplimiento de presupuestos (25pts)
    let pilar2 = 25;
    if (presupuestos && presupuestos.length > 0) {
      const { data: gastosCat } = await supabase
        .from('movimientos')
        .select('categoria_id, monto')
        .eq('usuario_id', userId)
        .eq('tipo', 'GASTO')
        .gte('fecha', startDate);

      let cumplidos = 0;
      for (const p of presupuestos) {
        const gastoCat = (gastosCat || [])
          .filter(m => m.categoria_id === p.categoria_id)
          .reduce((s, m) => s + Number(m.monto), 0);
        if (gastoCat <= Number(p.limite_monto)) cumplidos++;
      }
      pilar2 = Math.round((cumplidos / presupuestos.length) * 25);
    }

    // Pilar 3: Hábito de ahorro — tiene metas activas con progreso (25pts)
    let pilar3 = 0;
    if (metas && metas.length > 0) {
      const metasConProgreso = metas.filter(m => Number(m.monto_actual) > 0);
      pilar3 = metasConProgreso.length > 0 ? 25 : 10;
    }

    // Pilar 4: Comportamiento — variación de gasto (25pts)
    const semanaActual = (movimientos || [])
      .filter(m => m.tipo === 'GASTO' && new Date(m.fecha) >= new Date(Date.now() - 7 * 86400000))
      .reduce((s, m) => s + Number(m.monto), 0);
    const semanaAnterior = (movimientos || [])
      .filter(m => {
        const d = new Date(m.fecha);
        const hace14 = new Date(Date.now() - 14 * 86400000);
        const hace7 = new Date(Date.now() - 7 * 86400000);
        return m.tipo === 'GASTO' && d >= hace14 && d < hace7;
      })
      .reduce((s, m) => s + Number(m.monto), 0);

    let pilar4 = 25;
    if (semanaAnterior > 0) {
      const variacion = (semanaActual - semanaAnterior) / semanaAnterior;
      pilar4 = variacion <= 0 ? 25 : variacion <= 0.2 ? 20 : variacion <= 0.4 ? 10 : 0;
    }

    const puntaje = pilar1 + pilar2 + pilar3 + pilar4;
    const nivel_riesgo = puntaje >= 90 ? 'EXCELENTE' : puntaje >= 50 ? 'ESTABLE' : 'RIESGO_FINANCIERO';

    // Persistir en analisis_financiero
    await supabase.from('analisis_financiero').insert([{
      usuario_id: userId,
      puntaje_financiero: puntaje,
      nivel_riesgo,
    }]);

    return { puntaje_financiero: puntaje, nivel_riesgo };
  }

  async getFinancialAnalysis(userId: string) {
    const supabase = this.supabaseService.getClient();
    const { data, error } = await supabase
      .from('analisis_financiero')
      .select('*')
      .eq('usuario_id', userId)
      .order('fecha_creacion', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw new BadRequestException(error.message);
    return data || null;
  }
}
