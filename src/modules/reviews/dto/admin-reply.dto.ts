import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';

export class AdminReplyDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  body: string;

  @IsIn(['admin', 'seller'])
  author: 'admin' | 'seller';

  @IsString()
  @MaxLength(200)
  authorName: string;
}
