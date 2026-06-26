import { IsNumber, IsString, Min } from 'class-validator';

export class AddExpenseDto {
  @IsString()
  descripcion: string;

  @IsNumber()
  @Min(0.01)
  monto: number;
}
