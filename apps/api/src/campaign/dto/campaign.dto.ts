import { IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

import { MAX_AD_MESSAGE_LENGTH } from '@waitlayer/shared';

export class CreateCreativeDto {
  @ApiProperty()
  @IsString()
  @MaxLength(100)
  title!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(MAX_AD_MESSAGE_LENGTH)
  sponsoredMessage!: string;

  @ApiProperty()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(500)
  destinationUrl!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(100)
  displayDomain!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  ctaText?: string;
}

export class UpdateCreativeDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  title?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_AD_MESSAGE_LENGTH)
  sponsoredMessage?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(500)
  destinationUrl?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  displayDomain?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  ctaText?: string;
}
