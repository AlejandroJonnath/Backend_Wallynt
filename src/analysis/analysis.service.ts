import { Injectable, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

@Injectable()
export class AnalysisService {
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
    const supabase = this.supabaseService.getClient();
    const hoy = new Date();
    const startOfMonth = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
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

  async getFinancialPrediction(userId: string) {
    const supabase = this.supabaseService.getClient();

    const saldoDisponible = await this.calcularSaldoHistorico(userId);

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
    const { limite_diario } = await this.getDailyLimit(userId);
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
