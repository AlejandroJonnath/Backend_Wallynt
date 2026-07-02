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

  async generateUsers(adminId: string, count: number) {
    const rol = await this.adminCoreService.verifyRole(adminId);
    if (rol !== 'SUPERADMIN') throw new ForbiddenException('Solo SuperAdmin puede generar usuarios');

    if (count > 400) throw new BadRequestException('El límite máximo es de 400 usuarios por lote');

    const supabase = this.supabaseService.getClient();
    const { data: categorias } = await supabase.from('categorias').select('id').limit(4);

    const generateBatch = async (batchSize: number) => {
      const promises = Array.from({ length: batchSize }).map(async () => {
        const randomStr = Math.random().toString(36).substring(7);
        const email = `est_${Math.floor(Math.random() * 100000)}_${randomStr}@hotmail.com`;
        const password = `Pass_${randomStr}123!`;
        const nombre = `Estudiante ${Math.floor(Math.random() * 10000)}`;

        const { data: authData, error: authError } = await supabase.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { nombre }
        });

        if (authError || !authData.user) return null;
        const userId = authData.user.id;

        const ingreso_mensual = Math.floor(Math.random() * (400 - 50 + 1)) + 50; 
        const gasto_estimado = Math.floor(ingreso_mensual * (Math.random() * (0.95 - 0.7) + 0.7)); 

        await supabase.from('usuarios').upsert([{
          id: userId,
          correo: email,
          nombre,
          trabaja: Math.random() > 0.7,
          ingreso_mensual,
          gasto_estimado,
          rol: 'ESTUDIANTE'
        }], { onConflict: 'id' });

        if (categorias && categorias.length > 0) {
          const limitePorCategoria = Number((gasto_estimado / categorias.length).toFixed(2));
          const presupuestosIniciales = categorias.map(c => ({
            usuario_id: userId,
            categoria_id: c.id,
            limite_monto: limitePorCategoria,
            periodo: 'MENSUAL'
          }));
          await supabase.from('presupuestos').insert(presupuestosIniciales);
        }
        return userId;
      });
      return Promise.all(promises);
    };

    const BATCH_SIZE = 20;
    let createdCount = 0;
    for (let i = 0; i < count; i += BATCH_SIZE) {
      const currentBatchSize = Math.min(BATCH_SIZE, count - i);
      const results = await generateBatch(currentBatchSize);
      createdCount += results.filter(id => id !== null).length;
    }

    return { message: `${createdCount} usuarios generados correctamente.` };
  }
}
