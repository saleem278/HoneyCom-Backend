import { IsNumber, IsString, IsNotEmpty, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AdminWalletActionDto {
  @ApiProperty({ description: 'Amount to credit or debit', example: 100 })
  @IsNumber()
  @Min(1, { message: 'Amount must be at least 1' })
  amount: number;

  @ApiProperty({ description: 'Reason / description for the transaction', example: 'Goodwill credit' })
  @IsString()
  @IsNotEmpty({ message: 'Description is required' })
  description: string;
}
