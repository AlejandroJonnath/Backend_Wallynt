import { Injectable, ForbiddenException } from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';

@Injectable()
export class AdminCoreService {
  constructor(private readonly supabaseService: SupabaseService) {}

  async verifyRole(userId: string) {
    const supabase = this.supabaseService.getClient();
    const { data } = await supabase
      .from('usuarios').select('rol').eq('id', userId).single();
    if (!data || (data.rol !== 'ADMIN' && data.rol !== 'SUPERADMIN')) {
      throw new ForbiddenException('Acceso restringido a administradores');
    }
    return data.rol;
  }
}
