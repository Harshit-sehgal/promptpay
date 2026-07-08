import { IsEmail, IsIn, IsInt, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateFeedbackDto {
  @IsString()
  @MinLength(1, { message: 'Feedback message is required' })
  @MaxLength(2000, { message: 'Feedback must be at most 2000 characters' })
  message!: string;

  @IsOptional()
  @IsInt()
  rating?: number;

  @IsOptional()
  @IsEmail({}, { message: 'Email must be valid' })
  email?: string;

  @IsOptional()
  @IsIn(['bug', 'feature', 'praise', 'other'])
  category?: 'bug' | 'feature' | 'praise' | 'other';

  /** Honeypot field. Real users never fill this; bots do. */
  @IsOptional()
  @IsString()
  company?: string;
}
