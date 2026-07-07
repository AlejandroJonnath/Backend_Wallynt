import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Groq from 'groq-sdk';
import { AnalysisPredictionsService } from './analysis-predictions.service';
import { AnalysisDashboardService } from './analysis-dashboard.service';
import { SupabaseService } from '../../supabase/supabase.service';

@Injectable()
export class AnalysisAiService {
  private groq: Groq;

  constructor(
    private readonly configService: ConfigService,
    private readonly analysisPredictionsService: AnalysisPredictionsService,
    private readonly analysisDashboardService: AnalysisDashboardService,
    private readonly supabaseService: SupabaseService,
  ) {
    this.groq = new Groq({
      apiKey: this.configService.get<string>('GROQ_API_KEY'),
    });
  }

  // Busca los últimos gastos problemáticos en categorías clave (Educación, Transporte, Comida)
  private async getRecentProblematicExpenses(userId: string) {
    const supabase = this.supabaseService.getClient();
    
    // Obtener los últimos 15 movimientos
    const { data: movimientos } = await supabase
      .from('movimientos')
      .select('monto, descripcion, categorias(nombre)')
      .eq('usuario_id', userId)
      .eq('tipo', 'GASTO')
      .order('fecha', { ascending: false })
      .limit(15);

    if (!movimientos) return [];

    return movimientos.filter(m => {
      const cat = (m.categorias as any)?.nombre?.toLowerCase() || '';
      // Filtrar si es Transporte, Educación o Comida y el monto es "relevante"
      return (
        cat.includes('transporte') ||
        cat.includes('educación') || cat.includes('educacion') ||
        cat.includes('comida') || cat.includes('alimentación') || cat.includes('alimentacion')
      );
    });
  }

  // Método para el mensaje proactivo inicial
  async getPersonalizedRecommendations(userId: string): Promise<{
    greeting: string;
    tips: { icon: string; title: string; description: string }[];
    score: number;
    nivel_riesgo: string;
    hasContextMsg?: boolean;
  }> {
    const [scoreData, dashboardData] = await Promise.all([
      this.analysisPredictionsService.calculateAndSaveWallyScore(userId),
      this.analysisDashboardService.getDashboard(userId),
    ]);

    const { puntaje_financiero, nivel_riesgo } = scoreData;
    const problematicExpenses = await this.getRecentProblematicExpenses(userId);

    let greeting = '';
    
    // Si hay un gasto problemático reciente, el saludo cambia
    if (problematicExpenses.length > 0) {
      const exp = problematicExpenses[0];
      const cat = (exp.categorias as any)?.nombre?.toLowerCase() || '';
      
      if (cat.includes('educ')) {
        greeting = `¡Hey! Noté que gastaste $${exp.monto} en ${exp.descripcion || 'educación'}. Si me dices tu ubicación, puedo buscarte papelerías o lugares más baratos cercanos.`;
      } else if (cat.includes('transporte')) {
        greeting = `¡Hey! Vi un gasto reciente de $${exp.monto} en transporte y tu saldo es $${dashboardData.saldoDisponible.toFixed(2)}. ¿A dónde necesitas ir? Puedo sugerirte rutas de autobús económicas.`;
      } else if (cat.includes('comida') || cat.includes('alimenta')) {
        greeting = `¡Hey! Gastaste $${exp.monto} en ${exp.descripcion || 'comida'}. Si me dices por dónde estás, te busco opciones de almuerzos o aperitivos más económicos cerca de ti.`;
      } else {
        greeting = `¡Hey! Tu situación financiera podría mejorar. ¡Chatea conmigo para encontrar opciones más baratas!`;
      }
    } else {
      greeting = puntaje_financiero < 50
        ? '¡Hey! Tu situación necesita atención. ¡Juntos lo resolvemos! ¿En qué ciudad o sector te encuentras?'
        : '¡Hey! Veo que tienes margen para mejorar tu salud financiera. ¡Yo te guío!';
    }

    return {
      greeting,
      tips: [], // Ya no usaremos tips estáticos en el chat
      score: puntaje_financiero,
      nivel_riesgo,
      hasContextMsg: problematicExpenses.length > 0
    };
  }

  // Chat conversacional con Tool Calling a Nominatim (Maps API gratuita)
  async chatWithWallyBot(userId: string, history: { role: 'user'|'assistant'|'system', content: string }[]) {
    const [scoreData, dashboardData] = await Promise.all([
      this.analysisPredictionsService.calculateAndSaveWallyScore(userId),
      this.analysisDashboardService.getDashboard(userId),
    ]);

    const problematicExpenses = await this.getRecentProblematicExpenses(userId);
    const contextStr = problematicExpenses.map(m => `- $${m.monto} en ${(m.categorias as any)?.nombre} (${m.descripcion})`).join('\n');

    const systemPrompt = `Eres WallyBot, un asistente financiero muy amigable y empático para estudiantes universitarios.
Tu objetivo es ayudarles a ahorrar ofreciendo alternativas económicas de papelerías, transporte público o comida económica.
**IMPORTANTE**: El estudiante se encuentra en Quito, Ecuador. Tus sugerencias y conocimiento deben enfocarse exclusivamente en Quito (ej. Ecovía, Trolebús, Metro de Quito, etc.).

DATOS DEL ESTUDIANTE:
- Saldo disponible: $${dashboardData.saldoDisponible.toFixed(2)}
- Wally Score: ${scoreData.puntaje_financiero}/100
- Gastos recientes relevantes:
${contextStr}

INSTRUCCIONES CLAVES:
1. Si el usuario te da una ubicación o te pide buscar un lugar (ej. papelerías, restaurantes, paradas de bus), DEBES usar la función 'search_nearby_places'.
2. Luego de usar la función, resume las opciones encontradas de forma amigable, mencionando la distancia si es posible, y recomendando la más económica.
3. Habla en español, de forma concisa y cercana (usa emojis).
4. No des consejos genéricos si el usuario pide lugares, dale las opciones reales que encontraste.`;

    const messages: any[] = [
      { role: 'system', content: systemPrompt },
      ...history
    ];

    const tools = [
      {
        type: 'function',
        function: {
          name: 'search_nearby_places',
          description: 'Busca lugares de interés (Point of Interest) cercanos a una ubicación usando OpenStreetMap.',
          parameters: {
            type: 'object',
            properties: {
              location: { type: 'string', description: 'La ubicación o barrio del usuario (ej. "Universidad Católica Quito", "Centro Histórico Lima")' },
              place_type: { type: 'string', description: 'El tipo de lugar a buscar (ej. "papelería", "restaurante barato", "parada de autobús", "copias")' },
            },
            required: ['location', 'place_type'],
          },
        },
      },
    ];

    try {
      const response = await this.groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: messages,
        tools: tools,
        tool_choice: 'auto',
        max_tokens: 1000,
      });

      let responseMessage = response.choices[0]?.message;

      // Si el modelo decide usar la herramienta de búsqueda de mapas
      if (responseMessage.tool_calls) {
        messages.push(responseMessage); // Guardar la llamada a la herramienta en el historial

        for (const toolCall of responseMessage.tool_calls) {
          if (toolCall.function.name === 'search_nearby_places') {
            const args = JSON.parse(toolCall.function.arguments);
            const searchResults = await this.searchNominatim(args.place_type, args.location);
            
            messages.push({
              tool_call_id: toolCall.id,
              role: 'tool',
              name: 'search_nearby_places',
              content: JSON.stringify(searchResults),
            });
          }
        }

        // Segunda llamada a Groq con los resultados del mapa
        const secondResponse = await this.groq.chat.completions.create({
          model: 'llama-3.3-70b-versatile',
          messages: messages,
        });

        return secondResponse.choices[0]?.message?.content || 'No pude procesar la respuesta final.';
      }

      return responseMessage.content || 'Hubo un error al procesar tu solicitud.';
    } catch (error: any) {
      console.error('Error en Groq API:', error.error ? JSON.stringify(error.error) : error);
      throw new BadRequestException('Error al comunicarse con la IA');
    }
  }

  // Llama a la API de Nominatim (OpenStreetMap)
  private async searchNominatim(placeType: string, location: string) {
    try {
      const searchLocation = location.toLowerCase().includes('quito') ? location : `${location}, Quito`;
      const query = encodeURIComponent(`${placeType} cerca de ${searchLocation}`);
      const response = await fetch(`https://nominatim.openstreetmap.org/search?q=${query}&format=json&limit=4`, {
        headers: {
          'User-Agent': 'WallyntApp/1.0',
        }
      });
      if (!response.ok) return [{ error: 'No se pudo conectar al servidor de mapas' }];
      
      const data: any[] = await response.json();
      
      if (data.length === 0) {
        return [{ info: 'No se encontraron lugares específicos, sugiere opciones generales para esa zona.' }];
      }

      return data.map(item => ({
        name: item.display_name.split(',')[0],
        full_address: item.display_name,
        type: item.type,
      }));
    } catch (e) {
      console.error('Nominatim error:', e);
      return [{ error: 'Error al buscar ubicaciones.' }];
    }
  }
}
