import { IsEnum, IsNumber, IsOptional, IsUUID, Min } from 'class-validator';

export class CreateBudgetDto {
  @IsUUID()
  categoria_id: string;

  @IsNumber()
  @Min(0.01)
  limite_monto: number;

  @IsEnum(['SEMANAL', 'MENSUAL', 'ANUAL'])
  @IsOptional()
  periodo?: 'SEMANAL' | 'MENSUAL' | 'ANUAL';
}
