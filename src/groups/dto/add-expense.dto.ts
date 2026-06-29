import { IsNumber, IsString, Matches, Min } from 'class-validator';

export class AddExpenseDto {
  @IsString()
  @Matches(/[a-zA-ZáéíóúÁÉÍÓÚñÑ]/, { message: 'La descripción debe contener al menos una letra' })
  descripcion: string;

  @IsNumber()
  @Min(0.01)
  monto: number;
}
