import { IsEmail, IsIn, IsInt, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateFeedbackDto {
  @ApiProperty()
  @IsString()
  @MinLength(1, { message: 'Feedback message is required' })
  @MaxLength(2000, { message: 'Feedback must be at most 2000 characters' })
  message!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  rating?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsEmail({}, { message: 'Email must be valid' })
  email?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsIn(['bug', 'feature', 'praise', 'other'])
  category?: 'bug' | 'feature' | 'praise' | 'other';

  /** Honeypot field. Real users never fill this; bots do. */
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  company?: string;
}
