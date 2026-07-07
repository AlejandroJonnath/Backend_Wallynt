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
              location: { type: 'string', description: 'La ubicación, barrio o dirección del usuario. Si el usuario proveyó coordenadas GPS, úsalas literalmente (ej. "lat=-0.1234 lon=-78.5678")' },
              place_type: { type: 'string', description: 'El tipo de lugar a buscar (ej. "papelería", "restaurante", "parada de bus", "trolebús", "metro")' },
            },
            required: ['location', 'place_type'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'request_user_location',
          description: 'Pide al usuario su ubicación actual. Úsalo ÚNICAMENTE si el usuario te pide recomendaciones de lugares cercanos y no sabes dónde está.',
          parameters: {
            type: 'object',
            properties: {
              reason: { type: 'string', description: 'Razón amigable para pedir la ubicación' },
            },
            required: ['reason'],
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

        let needsSecondCall = false;

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
            needsSecondCall = true;
          } else if (toolCall.function.name === 'request_user_location') {
            // Retorna una señal especial para el frontend
            const args = JSON.parse(toolCall.function.arguments);
            return JSON.stringify({ _action: 'REQUEST_LOCATION', reason: args.reason });
          }
        }

        if (needsSecondCall) {
          // Segunda llamada a Groq: forzar respuesta en texto, sin herramientas
          const secondResponse = await this.groq.chat.completions.create({
            model: 'llama-3.3-70b-versatile',
            messages: messages,
            tool_choice: 'none',
            max_tokens: 1200,
          });

          const finalContent = secondResponse.choices[0]?.message?.content;
          if (finalContent) return finalContent;

          // Fallback si Groq aún no responde en texto
          return 'Encontré opciones en el mapa pero hubo un problema al redactarlas. Inténtalo de nuevo.';
        }
      }

      return responseMessage.content || 'Hubo un error al procesar tu solicitud.';
    } catch (error: any) {
      console.error('Error en Groq API:', error.error ? JSON.stringify(error.error) : error);
      throw new BadRequestException('Error al comunicarse con la IA');
    }
  }

  // Mapeo de tipos de lugar en español a tags de OpenStreetMap
  private getOsmTags(placeType: string): { key: string; value: string }[] {
    const pt = placeType.toLowerCase();

    if (pt.includes('restaurante') || pt.includes('comida') || pt.includes('almuerzo') || pt.includes('comer')) {
      return [
        { key: 'amenity', value: 'restaurant' },
        { key: 'amenity', value: 'fast_food' },
        { key: 'amenity', value: 'cafe' },
      ];
    }
    if (pt.includes('papelería') || pt.includes('papeleria') || pt.includes('copia') || pt.includes('imprenta')) {
      return [
        { key: 'shop', value: 'stationery' },
        { key: 'shop', value: 'copyshop' },
        { key: 'amenity', value: 'copyshop' },
      ];
    }
    if (pt.includes('bus') || pt.includes('parada') || pt.includes('trole') || pt.includes('ecov') || pt.includes('metro') || pt.includes('transporte')) {
      return [
        { key: 'highway', value: 'bus_stop' },
        { key: 'amenity', value: 'bus_station' },
        { key: 'railway', value: 'station' },
        { key: 'railway', value: 'halt' },
      ];
    }
    if (pt.includes('supermercado') || pt.includes('tienda') || pt.includes('bodega')) {
      return [
        { key: 'shop', value: 'supermarket' },
        { key: 'shop', value: 'convenience' },
      ];
    }
    // Fallback: buscar por nombre libre en Nominatim
    return [];
  }

  // Geocodifica un texto a lat/lon usando Nominatim (o extrae coords GPS si ya vienen en el mensaje)
  private async geocodeLocation(location: string): Promise<{ lat: number; lon: number } | null> {
    try {
      // Si el mensaje incluye coordenadas GPS exactas (formato del frontend)
      const gpsMatch = location.match(/lat=([\-\d.]+)\s+lon=([\-\d.]+)/);
      if (gpsMatch) {
        return { lat: parseFloat(gpsMatch[1]), lon: parseFloat(gpsMatch[2]) };
      }

      // Fallback: geocodificar con Nominatim
      const searchLocation = location.toLowerCase().includes('quito') ? location : `${location}, Quito, Ecuador`;
      const query = encodeURIComponent(searchLocation);
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${query}&format=json&limit=1&countrycodes=ec`,
        { headers: { 'User-Agent': 'WallyntApp/1.0 (wallynt@demo.com)' } }
      );
      if (!response.ok) return null;
      const data: any[] = await response.json();
      if (!data.length) return null;
      return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
    } catch {
      return null;
    }
  }

  // Busca amenidades reales con Overpass API en un radio de 1.5km
  private async searchWithOverpass(osmTags: { key: string; value: string }[], lat: number, lon: number, radius = 1500) {
    try {
      // Construir la query Overpass con todos los tags posibles
      const tagQueries = osmTags.map(t => `node["${t.key}"="${t.value}"](around:${radius},${lat},${lon});`).join('\n');
      const overpassQuery = `[out:json][timeout:10];\n(\n${tagQueries}\n);\nout body 5;`;

      const response = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(overpassQuery)}`,
      });

      if (!response.ok) return null;
      const data: any = await response.json();
      return data.elements as any[];
    } catch {
      return null;
    }
  }

  // Método principal: geocodifica + Overpass
  private async searchNominatim(placeType: string, location: string) {
    try {
      // 1. Geocodificar la ubicación del usuario
      const coords = await this.geocodeLocation(location);
      if (!coords) {
        return [{ info: `No pude encontrar la ubicación "${location}" en el mapa. ¿Puedes ser más específico? (ej. nombre del barrio, calle o hito cercano en Quito)` }];
      }

      // 2. Obtener los tags OSM correctos para el tipo de lugar
      const osmTags = this.getOsmTags(placeType);
      
      if (osmTags.length === 0) {
        // Fallback: búsqueda libre con Nominatim si no reconocemos el tipo
        const query = encodeURIComponent(`${placeType} ${location}, Quito`);
        const response = await fetch(`https://nominatim.openstreetmap.org/search?q=${query}&format=json&limit=4&countrycodes=ec`, {
          headers: { 'User-Agent': 'WallyntApp/1.0 (wallynt@demo.com)' }
        });
        const data: any[] = await response.json();
        if (!data.length) return [{ info: 'No se encontraron resultados para esa búsqueda.' }];
        return data.map(item => ({
          name: item.display_name.split(',')[0],
          type: item.type,
          lat: item.lat,
          lon: item.lon,
        }));
      }

      // 3. Buscar con Overpass API (más precisa para amenidades reales)
      const elements = await this.searchWithOverpass(osmTags, coords.lat, coords.lon);

      if (!elements || elements.length === 0) {
        return [{ info: `No encontré ${placeType} en un radio de 1.5km alrededor de "${location}" en Quito. Prueba con un radio mayor o un punto de referencia diferente.` }];
      }

      // 4. Calcular distancia aproximada y formatear resultados
      return elements.slice(0, 5).map(el => {
        const distKm = this.haversineDistance(coords.lat, coords.lon, el.lat, el.lon);
        const name = el.tags?.name || el.tags?.['name:es'] || placeType;
        const address = [el.tags?.['addr:street'], el.tags?.['addr:housenumber']].filter(Boolean).join(' ') || 'dirección no disponible';
        return {
          name,
          address,
          distance_m: Math.round(distKm * 1000),
          phone: el.tags?.phone || el.tags?.['contact:phone'] || null,
        };
      });
    } catch (e) {
      console.error('Search error:', e);
      return [{ error: 'Error al buscar ubicaciones.' }];
    }
  }

  // Fórmula de Haversine para calcular distancia entre dos coordenadas
  private haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
}
