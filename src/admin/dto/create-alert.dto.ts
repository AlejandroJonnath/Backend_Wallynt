import { IsString, IsOptional, IsArray } from 'class-validator';

export class CreateAlertDto {
  @IsString()
  titulo: string;

  @IsString()
  mensaje: string;

  @IsString()
  @IsOptional()
  tipo?: string;

  @IsArray()
  @IsOptional()
  usuarios_ids?: string[]; // Si está vacío, es para todos
}
