import { IsEnum, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class CreateMovementDto {
  @IsUUID()
  categoria_id: string;

  @IsEnum(['INGRESO', 'GASTO'])
  tipo: 'INGRESO' | 'GASTO';

  @IsNumber()
  @Min(0.01)
  monto: number;

  @IsString()
  @IsOptional()
  descripcion?: string;

  @IsString()
  @IsOptional()
  fecha?: string;
}
