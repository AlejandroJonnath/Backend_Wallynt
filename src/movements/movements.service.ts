import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { AnalysisAlertsService } from '../analysis/services/analysis-alerts.service';
import { AnalysisDashboardService } from '../analysis/services/analysis-dashboard.service';
import { CreateMovementDto } from './dto/create-movement.dto';
import { UpdateMovementDto } from './dto/update-movement.dto';

@Injectable()
export class MovementsService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly analysisAlertsService: AnalysisAlertsService,
    private readonly analysisDashboardService: AnalysisDashboardService,
  ) {}

  async create(userId: string, dto: CreateMovementDto) {
    // Validar que no se puedan registrar gastos si el saldo es insuficiente
    if (dto.tipo === 'GASTO') {
      const saldoDisponible = await this.analysisDashboardService.calcularSaldoHistorico(userId);
      if (saldoDisponible < dto.monto) {
        throw new BadRequestException('Ya has gastado todo el dinero disponible para este mes.');
      }
    }

    const supabase = this.supabaseService.getClient();
    const { data, error } = await supabase
      .from('movimientos')
      .insert([
        {
          usuario_id: userId,
          categoria_id: dto.categoria_id,
          tipo: dto.tipo,
          monto: dto.monto,
          descripcion: dto.descripcion,
          fecha: dto.fecha || new Date().toISOString().split('T')[0],
        }
      ])
      .select()
      .single();

    if (error) throw new BadRequestException(error.message);

    // Generar alertas en background, sin bloquear la respuesta
    this.analysisAlertsService.generateAlerts(userId).catch(() => {});

    return data;
  }

  async findAll(userId: string) {
    const supabase = this.supabaseService.getClient();
    const { data, error } = await supabase
      .from('movimientos')
      .select('*, categorias(nombre, icono)')
      .eq('usuario_id', userId)
      .order('fecha', { ascending: false });

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async update(userId: string, id: string, dto: UpdateMovementDto) {
    const supabase = this.supabaseService.getClient();

    // Verificar que el movimiento pertenece al usuario
    const { data: existing, error: findError } = await supabase
      .from('movimientos')
      .select('id, usuario_id')
      .eq('id', id)
      .single();

    if (findError || !existing) throw new NotFoundException('Movimiento no encontrado');
    if (existing.usuario_id !== userId) throw new ForbiddenException('No tienes permiso para editar este movimiento');

    const { data, error } = await supabase
      .from('movimientos')
      .update({
        ...(dto.categoria_id && { categoria_id: dto.categoria_id }),
        ...(dto.tipo && { tipo: dto.tipo }),
        ...(dto.monto && { monto: dto.monto }),
        ...(dto.descripcion !== undefined && { descripcion: dto.descripcion }),
        ...(dto.fecha && { fecha: dto.fecha }),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async remove(userId: string, id: string) {
    const supabase = this.supabaseService.getClient();

    // Verificar propiedad
    const { data: existing, error: findError } = await supabase
      .from('movimientos')
      .select('id, usuario_id')
      .eq('id', id)
      .single();

    if (findError || !existing) throw new NotFoundException('Movimiento no encontrado');
    if (existing.usuario_id !== userId) throw new ForbiddenException('No tienes permiso para eliminar este movimiento');

    const { error } = await supabase
      .from('movimientos')
      .delete()
      .eq('id', id);

    if (error) throw new BadRequestException(error.message);
    return { message: 'Movimiento eliminado correctamente' };
  }
}
