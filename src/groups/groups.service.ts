import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { CreateGroupDto } from './dto/create-group.dto';
import { AddMemberDto } from './dto/add-member.dto';
import { AddExpenseDto } from './dto/add-expense.dto';

@Injectable()
export class GroupsService {
  constructor(private readonly supabaseService: SupabaseService) {}

  async findAll(userId: string) {
    const supabase = this.supabaseService.getClient();

    // Grupos donde el usuario es creador o participante (ACTIVO)
    const { data: participaciones } = await supabase
      .from('participantes_grupo')
      .select('grupo_id')
      .eq('usuario_id', userId)
      .eq('estado', 'ACTIVO');

    const grupoIds = (participaciones || []).map(p => p.grupo_id);

    const { data: creados } = await supabase
      .from('grupos_gastos')
      .select('id, nombre, creador_id, fecha_creacion')
      .eq('creador_id', userId);

    const todosIds = [...new Set([...grupoIds, ...(creados || []).map(g => g.id)])];

    if (todosIds.length === 0) return [];

    const { data: grupos, error } = await supabase
      .from('grupos_gastos')
      .select('*, participantes_grupo(id, estado, usuarios(nombre, correo))')
      .in('id', todosIds);

    if (error) throw new BadRequestException(error.message);
    
    // Formatear para contar solo miembros ACTIVOS
    return (grupos || []).map((g: any) => ({
      ...g,
      miembros: g.participantes_grupo,
      cantidad_activos: (g.participantes_grupo || []).filter((p: any) => p.estado === 'ACTIVO').length
    }));
  }

  async create(userId: string, dto: CreateGroupDto) {
    const supabase = this.supabaseService.getClient();
    const { data: grupo, error } = await supabase
      .from('grupos_gastos')
      .insert([{ nombre: dto.nombre, creador_id: userId }])
      .select()
      .single();

    if (error) throw new BadRequestException(error.message);

    // El creador entra como ACTIVO directamente
    await supabase.from('participantes_grupo').insert([{ grupo_id: grupo.id, usuario_id: userId, estado: 'ACTIVO' }]);

    if (dto.correo_invitado && dto.correo_invitado.trim() !== '') {
      try {
        await this.addMember(userId, grupo.id, { correo: dto.correo_invitado });
      } catch (e) {
        console.log('Error inviting user on group creation:', e.message);
        // We do not throw error here, so the group is still created
      }
    }

    return grupo;
  }

  async addMember(creatorId: string, groupId: string, dto: AddMemberDto) {
    const supabase = this.supabaseService.getClient();

    const { data: grupo } = await supabase
      .from('grupos_gastos').select('creador_id, nombre').eq('id', groupId).single();

    if (!grupo) throw new NotFoundException('Grupo no encontrado');
    if (grupo.creador_id !== creatorId) throw new ForbiddenException('Solo el creador puede invitar miembros');

    const { data: usuario } = await supabase
      .from('usuarios').select('id, nombre, correo').eq('correo', dto.correo).single();

    if (!usuario) throw new NotFoundException(`No existe un usuario con el correo ${dto.correo}`);

    // Insertar como PENDIENTE
    const { data, error } = await supabase
      .from('participantes_grupo')
      .insert([{ grupo_id: groupId, usuario_id: usuario.id, estado: 'PENDIENTE' }])
      .select()
      .single();

    if (error) throw new BadRequestException(error.message);

    // Crear alerta
    await supabase.from('alertas').insert([{
      usuario_id: usuario.id,
      titulo: 'Nueva invitación a grupo',
      mensaje: `Te han invitado a unirte al grupo "${grupo.nombre}". Ve a Grupos para aceptar.`,
      tipo: 'INFO',
      leida: false
    }]);

    return { ...data, usuario };
  }

  async removeMember(creatorId: string, groupId: string, memberId: string) {
    const supabase = this.supabaseService.getClient();

    const { data: grupo } = await supabase
      .from('grupos_gastos').select('creador_id').eq('id', groupId).single();

    if (!grupo) throw new NotFoundException('Grupo no encontrado');
    if (grupo.creador_id !== creatorId) throw new ForbiddenException();
    if (memberId === creatorId) throw new BadRequestException('El creador no puede abandonar el grupo');

    const { error } = await supabase
      .from('participantes_grupo')
      .delete()
      .eq('grupo_id', groupId)
      .eq('usuario_id', memberId);

    if (error) throw new BadRequestException(error.message);
    return { message: 'Miembro removido' };
  }

  async respondInvitation(userId: string, groupId: string, accept: boolean) {
    const supabase = this.supabaseService.getClient();
    if (accept) {
      const { error } = await supabase
        .from('participantes_grupo')
        .update({ estado: 'ACTIVO' })
        .eq('grupo_id', groupId)
        .eq('usuario_id', userId);
      if (error) throw new BadRequestException(error.message);
      return { message: 'Invitación aceptada' };
    } else {
      const { error } = await supabase
        .from('participantes_grupo')
        .delete()
        .eq('grupo_id', groupId)
        .eq('usuario_id', userId);
      if (error) throw new BadRequestException(error.message);
      return { message: 'Invitación rechazada' };
    }
  }

  async getExpenses(userId: string, groupId: string) {
    const supabase = this.supabaseService.getClient();

    const { data: miembro } = await supabase
      .from('participantes_grupo')
      .select('id').eq('grupo_id', groupId).eq('usuario_id', userId).eq('estado', 'ACTIVO').single();

    if (!miembro) throw new ForbiddenException('No eres miembro activo de este grupo');

    const { data, error } = await supabase
      .from('gastos_compartidos')
      .select('*, usuarios(nombre, correo), grupo_aprobaciones_gasto(*)')
      .eq('grupo_id', groupId)
      .order('fecha', { ascending: false });

    if (error) throw new BadRequestException(error.message);
    return data || [];
  }

  async addExpense(userId: string, groupId: string, dto: AddExpenseDto) {
    const supabase = this.supabaseService.getClient();

    const { data: miembro } = await supabase
      .from('participantes_grupo')
      .select('id').eq('grupo_id', groupId).eq('usuario_id', userId).eq('estado', 'ACTIVO').single();

    if (!miembro) throw new ForbiddenException('No eres miembro activo de este grupo');

    const { data: miembros } = await supabase
      .from('participantes_grupo')
      .select('usuario_id')
      .eq('grupo_id', groupId)
      .eq('estado', 'ACTIVO');

    if (!miembros || miembros.length === 0) throw new BadRequestException('No hay miembros activos para dividir el gasto');

    const { data: gasto, error } = await supabase
      .from('gastos_compartidos')
      .insert([{ grupo_id: groupId, usuario_id: userId, descripcion: dto.descripcion, monto: dto.monto }])
      .select()
      .single();

    if (error) throw new BadRequestException(error.message);

    if (dto.estado === 'PENDIENTE') {
      return gasto; // Se guarda como borrador, sin restar ni dividir
    }

    // Dividir monto
    const division = Number((dto.monto / miembros.length).toFixed(2));
    
    // Crear aprobaciones
    const aprobaciones = miembros.map(m => ({
      gasto_id: gasto.id,
      usuario_id: m.usuario_id,
      monto_dividido: division,
      estado: m.usuario_id === userId ? 'APROBADO' : 'PENDIENTE' // El que lo crea lo aprueba auto
    }));

    await supabase.from('grupo_aprobaciones_gasto').insert(aprobaciones);

    return gasto;
  }

  async confirmExpense(userId: string, groupId: string, expenseId: string) {
    const supabase = this.supabaseService.getClient();

    const { data: gasto } = await supabase.from('gastos_compartidos').select('*').eq('id', expenseId).single();
    if (!gasto) throw new NotFoundException('Gasto no encontrado');
    if (gasto.usuario_id !== userId) throw new ForbiddenException('Solo el creador puede confirmar el gasto');

    const { data: aprobacionesExistentes } = await supabase.from('grupo_aprobaciones_gasto').select('id').eq('gasto_id', expenseId);
    if (aprobacionesExistentes && aprobacionesExistentes.length > 0) {
      throw new BadRequestException('El gasto ya fue confirmado');
    }

    const { data: miembros } = await supabase
      .from('participantes_grupo')
      .select('usuario_id')
      .eq('grupo_id', groupId)
      .eq('estado', 'ACTIVO');

    if (!miembros || miembros.length === 0) throw new BadRequestException('No hay miembros activos para dividir el gasto');

    const division = Number((gasto.monto / miembros.length).toFixed(2));
    
    const aprobaciones = miembros.map(m => ({
      gasto_id: gasto.id,
      usuario_id: m.usuario_id,
      monto_dividido: division,
      estado: m.usuario_id === userId ? 'APROBADO' : 'PENDIENTE'
    }));

    await supabase.from('grupo_aprobaciones_gasto').insert(aprobaciones);
    return { message: 'Gasto confirmado y dividido' };
  }

  async respondExpense(userId: string, approvalId: string, accept: boolean) {
    const supabase = this.supabaseService.getClient();
    
    const { data: aprobacion } = await supabase.from('grupo_aprobaciones_gasto').select('*, gastos_compartidos(descripcion)').eq('id', approvalId).single();
    if (!aprobacion) throw new NotFoundException('Solicitud no encontrada');
    if (aprobacion.usuario_id !== userId) throw new ForbiddenException();
    if (aprobacion.estado !== 'PENDIENTE') throw new BadRequestException('Ya fue respondida');

    if (accept) {
      // 1. Encontrar categoria
      let { data: cat } = await supabase.from('categorias').select('id').eq('nombre', 'Grupos').single();
      if (!cat) {
        const { data: otra } = await supabase.from('categorias').select('id').limit(1).single();
        cat = otra;
      }

      // 2. Crear movimiento
      const { data: mov } = await supabase.from('movimientos').insert([{
        usuario_id: userId,
        monto: aprobacion.monto_dividido,
        tipo: 'GASTO',
        descripcion: `Gasto de grupo: ${(aprobacion.gastos_compartidos as any).descripcion}`,
        categoria_id: cat?.id
      }]).select('id').single();

      // 3. Actualizar estado
      await supabase.from('grupo_aprobaciones_gasto')
        .update({ estado: 'APROBADO', movimiento_generado_id: mov?.id })
        .eq('id', approvalId);

      return { message: 'Aprobado y descontado de tu saldo' };
    } else {
      await supabase.from('grupo_aprobaciones_gasto').update({ estado: 'RECHAZADO' }).eq('id', approvalId);
      return { message: 'Gasto rechazado' };
    }
  }

  async getPendingRequests(userId: string) {
    const supabase = this.supabaseService.getClient();
    
    const { data: invitaciones } = await supabase
      .from('participantes_grupo')
      .select('grupo_id, grupos_gastos(nombre, usuarios(nombre))')
      .eq('usuario_id', userId)
      .eq('estado', 'PENDIENTE');

    const { data: gastos } = await supabase
      .from('grupo_aprobaciones_gasto')
      .select('id, monto_dividido, gastos_compartidos(descripcion, grupos_gastos(nombre), usuarios(nombre))')
      .eq('usuario_id', userId)
      .eq('estado', 'PENDIENTE');

    return {
      invitaciones: invitaciones || [],
      gastos: gastos || []
    };
  }

  async removeExpense(userId: string, groupId: string, expenseId: string) {
    const supabase = this.supabaseService.getClient();

    const { data: gasto } = await supabase
      .from('gastos_compartidos').select('usuario_id').eq('id', expenseId).single();

    if (!gasto) throw new NotFoundException('Gasto no encontrado');
    if (gasto.usuario_id !== userId) throw new ForbiddenException('Solo quien registró el gasto puede eliminarlo');

    // Al tener ON DELETE CASCADE, esto borrará también las aprobaciones de grupo_aprobaciones_gasto
    const { error } = await supabase.from('gastos_compartidos').delete().eq('id', expenseId);
    if (error) throw new BadRequestException(error.message);
    return { message: 'Gasto eliminado' };
  }
}
