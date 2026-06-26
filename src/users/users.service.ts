import { Injectable, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { CreateProfileDto } from './dto/create-profile.dto';

@Injectable()
export class UsersService {
  constructor(private readonly supabaseService: SupabaseService) {}

  async createProfile(userId: string, email: string, dto: CreateProfileDto) {
    const supabase = this.supabaseService.getClient();
    const { data, error } = await supabase
      .from('usuarios')
      .upsert([
        {
          id: userId,
          correo: email,
          nombre: dto.nombre,
          trabaja: dto.trabaja,
          ingreso_mensual: dto.ingreso_mensual,
          gasto_estimado: dto.gasto_estimado,
          rol: 'ESTUDIANTE' // Por defecto para auto-registro
        }
      ], { onConflict: 'id' })
      .select()
      .single();

    if (error) {
      throw new BadRequestException(error.message);
    }

    // Auto-generar presupuestos base si el usuario es nuevo y tiene gasto estimado
    if (dto.gasto_estimado && dto.gasto_estimado > 0) {
      // Intentamos no sobreescribir si ya tiene presupuestos
      const { count } = await supabase.from('presupuestos').select('id', { count: 'exact', head: true }).eq('usuario_id', userId);
      
      if (count === 0) {
        // Tomamos hasta 4 categorías principales para dividir el gasto
        const { data: categorias } = await supabase.from('categorias').select('id').limit(4);
        if (categorias && categorias.length > 0) {
          const limitePorCategoria = Number((dto.gasto_estimado / categorias.length).toFixed(2));
          const presupuestosIniciales = categorias.map(c => ({
            usuario_id: userId,
            categoria_id: c.id,
            limite_monto: limitePorCategoria,
            periodo: 'MENSUAL'
          }));
          await supabase.from('presupuestos').insert(presupuestosIniciales);
        }
      }
    }

    return data;
  }

  async getProfile(userId: string) {
    const supabase = this.supabaseService.getClient();
    const { data, error } = await supabase
      .from('usuarios')
      .select('*')
      .eq('id', userId)
      .single();

    if (error) {
      throw new BadRequestException(error.message);
    }
    return data;
  }
}
