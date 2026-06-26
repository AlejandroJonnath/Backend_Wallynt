import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { CreateBudgetDto } from './dto/create-budget.dto';
import { UpdateBudgetDto } from './dto/update-budget.dto';

@Injectable()
export class BudgetsService {
  constructor(private readonly supabaseService: SupabaseService) {}

  async findAll(userId: string) {
    const supabase = this.supabaseService.getClient();

    const { data: budgets, error } = await supabase
      .from('presupuestos')
      .select('*, categorias(id, nombre, icono)')
      .eq('usuario_id', userId);

    if (error) throw new BadRequestException(error.message);

    // Para cada presupuesto, calcular gasto actual del mes
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    const startDate = startOfMonth.toISOString().split('T')[0];

    const enriched = await Promise.all(budgets.map(async (budget) => {
      const { data: movs } = await supabase
        .from('movimientos')
        .select('monto')
        .eq('usuario_id', userId)
        .eq('categoria_id', budget.categoria_id)
        .eq('tipo', 'GASTO')
        .gte('fecha', startDate);

      const gastoActual = (movs || []).reduce((sum, m) => sum + Number(m.monto), 0);
      const porcentaje = Math.round((gastoActual / Number(budget.limite_monto)) * 100);
      const estado = porcentaje >= 100 ? 'excedido' : porcentaje >= 80 ? 'advertencia' : 'ok';

      return {
        ...budget,
        gasto_actual: gastoActual,
        porcentaje_usado: Math.min(porcentaje, 100),
        estado,
        restante: Math.max(Number(budget.limite_monto) - gastoActual, 0),
      };
    }));

    return enriched;
  }

  async create(userId: string, dto: CreateBudgetDto) {
    const supabase = this.supabaseService.getClient();
    const { data, error } = await supabase
      .from('presupuestos')
      .insert([{
        usuario_id: userId,
        categoria_id: dto.categoria_id,
        limite_monto: dto.limite_monto,
        periodo: dto.periodo || 'MENSUAL',
      }])
      .select('*, categorias(id, nombre, icono)')
      .single();

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async update(userId: string, id: string, dto: UpdateBudgetDto) {
    const supabase = this.supabaseService.getClient();

    const { data: existing } = await supabase
      .from('presupuestos').select('usuario_id').eq('id', id).single();

    if (!existing) throw new NotFoundException('Presupuesto no encontrado');
    if (existing.usuario_id !== userId) throw new ForbiddenException();

    const { data, error } = await supabase
      .from('presupuestos')
      .update({ limite_monto: dto.limite_monto })
      .eq('id', id)
      .select()
      .single();

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async remove(userId: string, id: string) {
    const supabase = this.supabaseService.getClient();

    const { data: existing } = await supabase
      .from('presupuestos').select('usuario_id').eq('id', id).single();

    if (!existing) throw new NotFoundException('Presupuesto no encontrado');
    if (existing.usuario_id !== userId) throw new ForbiddenException();

    const { error } = await supabase.from('presupuestos').delete().eq('id', id);
    if (error) throw new BadRequestException(error.message);
    return { message: 'Presupuesto eliminado' };
  }
}
