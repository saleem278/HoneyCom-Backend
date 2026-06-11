import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class AdminUpdateReviewStatusDto {
  @IsIn(['approved', 'rejected'])
  status: 'approved' | 'rejected';

  /** Optional rejection reason (surfaced on the review card; emailed to customer). */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  rejectionReason?: string;
}
