import { IsString, IsOptional, IsUrl, MaxLength } from 'class-validator';
import { MAX_AD_MESSAGE_LENGTH } from '@waitlayer/shared';

export class CreateCreativeDto {
  @IsString()
  @MaxLength(100)
  title!: string;

  @IsString()
  @MaxLength(MAX_AD_MESSAGE_LENGTH)
  sponsoredMessage!: string;

  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(500)
  destinationUrl!: string;

  @IsString()
  @MaxLength(100)
  displayDomain!: string;
}

export class UpdateCreativeDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_AD_MESSAGE_LENGTH)
  sponsoredMessage?: string;

  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(500)
  destinationUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  displayDomain?: string;
}
