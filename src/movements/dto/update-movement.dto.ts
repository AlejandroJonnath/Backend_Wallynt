import { IsEnum, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class UpdateMovementDto {
  @IsUUID()
  @IsOptional()
  categoria_id?: string;

  @IsEnum(['INGRESO', 'GASTO'])
  @IsOptional()
  tipo?: 'INGRESO' | 'GASTO';

  @IsNumber()
  @Min(0.01)
  @IsOptional()
  monto?: number;

  @IsString()
  @IsOptional()
  descripcion?: string;

  @IsString()
  @IsOptional()
  fecha?: string;
}
