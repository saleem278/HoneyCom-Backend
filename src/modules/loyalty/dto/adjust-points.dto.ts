import { IsInt, IsString, Min, MinLength } from 'class-validator';

export class AdjustPointsDto {
  @IsInt()
  @Min(1)
  points: number;

  @IsString()
  @MinLength(3)
  description: string;
}
