import { IsDateString, IsNumber, IsString, Min } from 'class-validator';

export class CreateGoalDto {
  @IsString()
  nombre: string;

  @IsNumber()
  @Min(0.01)
  monto_objetivo: number;

  @IsDateString()
  fecha_objetivo: string;
}
