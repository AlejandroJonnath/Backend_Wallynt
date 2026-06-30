import { IsString } from 'class-validator';

export class CreateGroupDto {
  @IsString()
  nombre: string;

  @IsString()
  correo_invitado?: string;
}
