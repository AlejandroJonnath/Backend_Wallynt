import { Injectable } from '@nestjs/common';
import { AdminCoreService } from './admin-core.service';
import { AdminKpisService } from './admin-kpis.service';

@Injectable()
export class AdminInsightsService {
  constructor(
    private readonly adminCoreService: AdminCoreService,
    private readonly adminKpisService: AdminKpisService,
  ) {}

  async getStrategicInsights(adminId: string) {
    await this.adminCoreService.verifyRole(adminId);
    
    // Reutilizamos las funciones anteriores para calcular datos reales
    const [biz, fin] = await Promise.all([
      this.adminKpisService.getBusinessKPIs(adminId),
      this.adminKpisService.getFinancialKPIs(adminId),
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
}
