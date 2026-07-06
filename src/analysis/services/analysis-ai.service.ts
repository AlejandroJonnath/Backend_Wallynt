import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Groq from 'groq-sdk';
import { AnalysisPredictionsService } from './analysis-predictions.service';
import { AnalysisDashboardService } from './analysis-dashboard.service';

@Injectable()
export class AnalysisAiService {
  private groq: Groq;

  constructor(
    private readonly configService: ConfigService,
    private readonly analysisPredictionsService: AnalysisPredictionsService,
    private readonly analysisDashboardService: AnalysisDashboardService,
  ) {
    this.groq = new Groq({
      apiKey: this.configService.get<string>('GROQ_API_KEY'),
    });
  }

  async getPersonalizedRecommendations(userId: string): Promise<{
    greeting: string;
    tips: { icon: string; title: string; description: string }[];
    score: number;
    nivel_riesgo: string;
  }> {
    // Obtener datos financieros del estudiante
    const [scoreData, dashboardData, predictionData] = await Promise.all([
      this.analysisPredictionsService.calculateAndSaveWallyScore(userId),
      this.analysisDashboardService.getDashboard(userId),
      this.analysisPredictionsService.getFinancialPrediction(userId),
    ]);

    const { puntaje_financiero, nivel_riesgo } = scoreData;

    // Construir prompt con contexto financiero real
    const prompt = `Eres WallyBot, un asistente financiero amigable para estudiantes universitarios. 
Tu misión: dar 5 consejos prácticos, breves y personalizados para mejorar su situación financiera.

DATOS FINANCIEROS DEL ESTUDIANTE:
- Wally Score: ${puntaje_financiero}/100 (${nivel_riesgo})
- Saldo disponible: $${dashboardData.saldoDisponible.toFixed(2)}
- Ingreso mensual fijo: $${dashboardData.ingreso_mensual_fijo.toFixed(2)}
- Total gastos este mes: $${dashboardData.totalGastos.toFixed(2)}
- Promedio gasto diario (30 días): $${predictionData.promedio_gasto_diario}
- Días hasta quedarse sin dinero: ${predictionData.dias_hasta_sin_dinero}
- En riesgo financiero: ${predictionData.en_riesgo ? 'SÍ' : 'NO'}
- Mensaje predicción: ${predictionData.mensaje}

INSTRUCCIONES:
- Responde ÚNICAMENTE con JSON válido (sin markdown, sin texto extra).
- El JSON debe tener exactamente este formato:
{
  "tips": [
    {
      "icon": "<un emoji relevante>",
      "title": "<título corto del consejo, máx 6 palabras>",
      "description": "<descripción práctica y amigable, máx 2 oraciones>"
    }
  ]
}
- Los 5 consejos deben ser específicos a los datos del estudiante.
- Usa un tono amigable, motivador y sin tecnicismos.
- Idioma: Español.`;

    const completion = await this.groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.7,
      max_tokens: 800,
    });

    const content = completion.choices[0]?.message?.content || '{}';

    let tips: { icon: string; title: string; description: string }[] = [];
    try {
      // Extraer JSON limpio aunque la respuesta tenga texto extra
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        tips = parsed.tips || [];
      }
    } catch {
      // Fallback con consejos genéricos si el parsing falla
      tips = [
        {
          icon: '💸',
          title: 'Registra todos tus gastos',
          description: 'Anota cada gasto, por pequeño que sea. Lo que no se mide, no se mejora.',
        },
        {
          icon: '🎯',
          title: 'Crea un presupuesto mensual',
          description: 'Divide tu ingreso en necesidades (50%), deseos (30%) y ahorro (20%).',
        },
        {
          icon: '🚫',
          title: 'Evita gastos impulsivos',
          description: 'Espera 24h antes de comprar algo que no tenías planeado.',
        },
        {
          icon: '🐷',
          title: 'Ahorra aunque sea poco',
          description: 'Guarda al menos el 5% de tu ingreso. Los hábitos pequeños generan grandes cambios.',
        },
        {
          icon: '📊',
          title: 'Revisa tu progreso semanal',
          description: 'Cada semana evalúa cómo vas con tus metas. Ajusta si es necesario.',
        },
      ];
    }

    const greeting =
      puntaje_financiero < 30
        ? '¡Hey! Tu situación necesita atención urgente. ¡Pero juntos lo resolvemos!'
        : '¡Hey! Veo que tienes margen para mejorar tu salud financiera. ¡Yo te guío!';

    return {
      greeting,
      tips,
      score: puntaje_financiero,
      nivel_riesgo,
    };
  }
}
