import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';
import { AdminCoreService } from './admin-core.service';

@Injectable()
export class AdminUsersService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly adminCoreService: AdminCoreService,
  ) {}

  async getUsers(adminId: string) {
    const rol = await this.adminCoreService.verifyRole(adminId);
    if (rol !== 'SUPERADMIN') throw new ForbiddenException('Solo SuperAdmin puede gestionar usuarios');

    const supabase = this.supabaseService.getClient();
    const { data, error } = await supabase
      .from('usuarios').select('id, nombre, correo, rol, fecha_registro');

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async updateUserRole(adminId: string, userId: string, nuevoRol: string) {
    const rol = await this.adminCoreService.verifyRole(adminId);
    if (rol !== 'SUPERADMIN') throw new ForbiddenException('Solo SuperAdmin puede cambiar roles');

    const supabase = this.supabaseService.getClient();
    const { data, error } = await supabase
      .from('usuarios').update({ rol: nuevoRol }).eq('id', userId).select().single();

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async deleteUser(adminId: string, userId: string) {
    const rol = await this.adminCoreService.verifyRole(adminId);
    if (rol !== 'SUPERADMIN') throw new ForbiddenException('Solo SuperAdmin puede eliminar usuarios');

    const supabase = this.supabaseService.getClient();
    const { error } = await supabase.auth.admin.deleteUser(userId);
    if (error) throw new BadRequestException(error.message);
    return { message: 'Usuario eliminado' };
  }
}
