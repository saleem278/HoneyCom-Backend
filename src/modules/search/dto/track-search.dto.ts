import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class TrackSearchDto {
  @ApiProperty({ example: 'wireless earbuds', description: 'Search term to track' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  term: string;
}
