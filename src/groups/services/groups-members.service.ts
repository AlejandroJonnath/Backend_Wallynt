import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';
import { AddMemberDto } from '../dto/add-member.dto';

@Injectable()
export class GroupsMembersService {
  constructor(private readonly supabaseService: SupabaseService) {}

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
}
