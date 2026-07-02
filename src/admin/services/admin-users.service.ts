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

          const metas = [
            {
              usuario_id: userId,
              nombre: 'Nuevo teléfono',
              monto_objetivo: 200,
              monto_actual: 200, // completada
              fecha_objetivo: new Date(new Date().setMonth(new Date().getMonth() + 2)).toISOString().split('T')[0]
            },
            {
              usuario_id: userId,
              nombre: 'Viaje fin de semestre',
              monto_objetivo: 150,
              monto_actual: Math.floor(Math.random() * 100), // incompleta
              fecha_objetivo: new Date(new Date().setMonth(new Date().getMonth() + 5)).toISOString().split('T')[0]
            }
          ];
          await supabase.from('metas_ahorro').insert(metas);

          const catComida = categorias[0].id;
          const catTrans = categorias.length > 1 ? categorias[1].id : categorias[0].id;

          const movimientos = [
            {
              usuario_id: userId,
              categoria_id: catComida,
              tipo: 'GASTO',
              monto: Math.floor(gasto_estimado * 0.4),
              descripcion: 'Almuerzos universidad',
              fecha: new Date().toISOString().split('T')[0],
            },
            {
              usuario_id: userId,
              categoria_id: catTrans,
              tipo: 'GASTO',
              monto: Math.floor(gasto_estimado * 0.2),
              descripcion: 'Transporte público',
              fecha: new Date().toISOString().split('T')[0],
            },
            {
              usuario_id: userId,
              categoria_id: catComida, 
              tipo: 'INGRESO',
              monto: ingreso_mensual,
              descripcion: 'Mesada/Ingresos del mes',
              fecha: new Date(new Date().setDate(1)).toISOString().split('T')[0],
            }
          ];
          await supabase.from('movimientos').insert(movimientos);
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
