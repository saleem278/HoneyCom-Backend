import { IsArray, IsIn, IsOptional, IsString, MaxLength, ArrayMinSize } from 'class-validator';

export class BulkStatusDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  ids: string[];

  @IsIn(['approved', 'rejected'])
  status: 'approved' | 'rejected';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  rejectionReason?: string;
}
