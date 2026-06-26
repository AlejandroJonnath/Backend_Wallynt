import { IsBoolean, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateProfileDto {
  @IsString()
  nombre: string;

  @IsBoolean()
  @IsOptional()
  trabaja?: boolean;

  @IsNumber()
  @Min(5)
  @IsOptional()
  ingreso_mensual?: number;

  @IsNumber()
  @IsOptional()
  gasto_estimado?: number;
}
