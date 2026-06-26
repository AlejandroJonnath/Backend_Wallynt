import { IsEmail } from 'class-validator';

export class AddMemberDto {
  @IsEmail()
  correo: string;
}
