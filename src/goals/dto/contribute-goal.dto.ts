import { IsNumber, Min } from 'class-validator';

export class ContributeGoalDto {
  @IsNumber()
  @Min(0.01)
  aporte: number;
}
