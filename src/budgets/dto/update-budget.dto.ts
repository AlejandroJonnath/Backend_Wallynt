import { IsNumber, IsOptional, Min } from 'class-validator';

export class UpdateBudgetDto {
  @IsNumber()
  @Min(0.01)
  @IsOptional()
  limite_monto?: number;
}
