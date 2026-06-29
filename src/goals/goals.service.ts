import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { CreateGoalDto } from './dto/create-goal.dto';
import { ContributeGoalDto } from './dto/contribute-goal.dto';

@Injectable()
export class GoalsService {
  constructor(private readonly supabaseService: SupabaseService) {}

  async findAll(userId: string) {
    const supabase = this.supabaseService.getClient();
    const { data, error } = await supabase
      .from('metas_ahorro')
      .select('*')
      .eq('usuario_id', userId)
      .order('fecha_creacion', { ascending: false });

    if (error) throw new BadRequestException(error.message);

    return data.map(goal => {
      const hoy = new Date();
      const fechaObj = new Date(goal.fecha_objetivo);
      const diasRestantes = Math.max(Math.ceil((fechaObj.getTime() - hoy.getTime()) / (1000 * 60 * 60 * 24)), 0);
      const faltante = Number(goal.monto_objetivo) - Number(goal.monto_actual);
      const aporte_diario_recomendado = diasRestantes > 0 ? Math.ceil((faltante / diasRestantes) * 100) / 100 : 0;
      const porcentaje = Math.round((Number(goal.monto_actual) / Number(goal.monto_objetivo)) * 100);

      return {
        ...goal,
        dias_restantes: diasRestantes,
        porcentaje,
        aporte_diario_recomendado,
        completada: Number(goal.monto_actual) >= Number(goal.monto_objetivo),
      };
    });
  }

  async create(userId: string, dto: CreateGoalDto) {
    const supabase = this.supabaseService.getClient();
    const { data, error } = await supabase
      .from('metas_ahorro')
      .insert([{
        usuario_id: userId,
        nombre: dto.nombre,
        monto_objetivo: dto.monto_objetivo,
        monto_actual: 0,
        fecha_objetivo: dto.fecha_objetivo,
      }])
      .select()
      .single();

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async contribute(userId: string, id: string, dto: ContributeGoalDto) {
    const supabase = this.supabaseService.getClient();

    const { data: goal, error: findError } = await supabase
      .from('metas_ahorro')
      .select('*')
      .eq('id', id)
      .single();

    if (findError || !goal) throw new NotFoundException('Meta no encontrada');
    if (goal.usuario_id !== userId) throw new ForbiddenException();

    const nuevoMonto = Number(goal.monto_actual) + Number(dto.aporte);
    if (nuevoMonto > Number(goal.monto_objetivo)) {
      throw new BadRequestException(`No puedes aportar más del objetivo. Máximo permitido: $${(Number(goal.monto_objetivo) - Number(goal.monto_actual)).toFixed(2)}`);
    }

    const { data, error } = await supabase
      .from('metas_ahorro')
      .update({ monto_actual: nuevoMonto })
      .eq('id', id)
      .select()
      .single();

    if (error) throw new BadRequestException(error.message);

    // Buscar categoría "Otros" para registrar el gasto
    const { data: categoria } = await supabase
      .from('categorias')
      .select('id')
      .eq('nombre', 'Otros')
      .single();

    if (categoria) {
      // Registrar como movimiento de gasto para que descuente del saldo disponible
      await supabase.from('movimientos').insert([{
        usuario_id: userId,
        categoria_id: categoria.id,
        tipo: 'GASTO',
        monto: dto.aporte,
        descripcion: `Aporte a meta: ${goal.nombre}`,
        fecha: new Date().toISOString().split('T')[0]
      }]);
    }

    return data;
  }

  async remove(userId: string, id: string) {
    const supabase = this.supabaseService.getClient();

    const { data: existing } = await supabase
      .from('metas_ahorro').select('usuario_id, nombre').eq('id', id).single();

    if (!existing) throw new NotFoundException('Meta no encontrada');
    if (existing.usuario_id !== userId) throw new ForbiddenException();

    // Eliminar los movimientos de gasto generados por aportes a esta meta
    await supabase
      .from('movimientos')
      .delete()
      .eq('usuario_id', userId)
      .eq('descripcion', `Aporte a meta: ${existing.nombre}`);

    const { error } = await supabase.from('metas_ahorro').delete().eq('id', id);
    if (error) throw new BadRequestException(error.message);
    return { message: 'Meta eliminada' };
  }
}
