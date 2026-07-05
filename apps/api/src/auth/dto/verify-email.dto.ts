import { IsString, MinLength } from 'class-validator';

export class VerifyEmailConfirmDto {
  @IsString()
  @MinLength(1)
  token!: string;
}
