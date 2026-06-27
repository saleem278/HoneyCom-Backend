import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Review, IReview } from '../../models/Review.model';
import { Product, IProduct } from '../../models/Product.model';
import { IOrder } from '../../models/Order.model';
import { EmailService } from '../../services/email.service';
import { AdminUpdateReviewStatusDto } from './dto/admin-update-status.dto';
import { AdminReplyDto } from './dto/admin-reply.dto';

@Injectable()
export class ReviewsService {
  constructor(
    @InjectModel('Review') private reviewModel: Model<IReview>,
    @InjectModel('Product') private productModel: Model<IProduct>,
    @InjectModel('Order') private orderModel: Model<IOrder>,
    private emailService: EmailService,
  ) {}

  async create(userId: string, productId: string, reviewData: any) {
    const product = await this.productModel.findById(productId);
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    // Verify that user has purchased the product and it is delivered
    const hasPurchased = await this.orderModel.findOne({
      customer: userId,
      status: 'delivered',
      'items.product': productId,
    });
    if (!hasPurchased) {
      throw new BadRequestException('You can only review products you have purchased and had delivered.');
    }

    // Check if user already reviewed
    const existingReview = await this.reviewModel.findOne({
      product: productId,
      user: userId,
    });
    if (existingReview) {
      throw new BadRequestException('You have already reviewed this product');
    }

    let review: IReview;
    try {
      review = await this.reviewModel.create({
        ...reviewData,
        product: productId,
        user: userId,
      });
    } catch (error: any) {
      // MongoDB unique index on (product, user) prevents duplicates. The
      // pre-flight check above handles the common case; this catch handles the
      // race where two concurrent requests both pass the check.
      if (error?.code === 11000) {
        throw new ConflictException('You have already reviewed this product');
      }
      throw error;
    }

    // Update product rating
    await this.updateProductRating(productId);

    // Notify the seller of the new review. Best-effort, fire-and-forget.
    setImmediate(async () => {
      try {
        const populatedProduct = await this.productModel.findById(productId).populate('seller', 'name email');
        const seller: any = (populatedProduct as any)?.seller;
        if (seller?.email) {
          await this.emailService.sendReviewNotificationEmail({
            to: seller.email,
            sellerName: seller.name || 'Seller',
            productName: product.name,
            productId,
            rating: reviewData.rating,
            title: reviewData.title,
            comment: reviewData.comment,
          });
        }
      } catch {
        // best-effort notification
      }
    });

    return {
      success: true,
      review,
    };
  }

  async findAll(productId?: string) {
    // Only surface approved reviews publicly. Pending/rejected reviews must
    // never appear in the public-facing list or skew the rating distribution.
    const filter: any = { status: 'approved' };
    if (productId) {
      filter.product = productId;
    }

    const reviews = await this.reviewModel
      .find(filter)
      .populate('user', 'name email avatar')
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();

    // Real rating distribution from actual review data
    const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    const approvedReviews = reviews;
    for (const r of approvedReviews) {
      const star = Math.round(r.rating);
      if (star >= 1 && star <= 5) distribution[star]++;
    }
    const total = approvedReviews.length;
    const ratingDistribution: Record<number, number> = {};
    for (let s = 1; s <= 5; s++) {
      ratingDistribution[s] = total > 0 ? Math.round((distribution[s] / total) * 100) : 0;
    }

    const avgRating = total > 0
      ? approvedReviews.reduce((sum, r) => sum + r.rating, 0) / total
      : 0;

    return {
      success: true,
      reviews: approvedReviews,
      averageRating: Math.round(avgRating * 10) / 10,
      ratingDistribution,
      totalReviews: total,
    };
  }

  async update(id: string, userId: string, updateData: any) {
    const review = await this.reviewModel.findById(id);
    if (!review) {
      throw new NotFoundException('Review not found');
    }

    if (review.user.toString() !== userId) {
      throw new BadRequestException('Not authorized');
    }

    // SECURITY: Whitelist only safe review fields to prevent Mass Assignment.
    // Users must not be able to modify the associated product, review author, or helpful counts.
    const allowedFields = ['rating', 'title', 'comment'];
    const filteredUpdateData: any = {};
    for (const key of Object.keys(updateData)) {
      if (allowedFields.includes(key)) {
        filteredUpdateData[key] = updateData[key];
      }
    }

    const updatedReview = await this.reviewModel.findByIdAndUpdate(
      id,
      filteredUpdateData,
      { new: true, runValidators: true }
    );

    // updateProductRating is handled by the Review model's post-save hook.
    // Calling it here as well was causing a double recalculation.
    // If the model hook is ever removed, re-add the call here.

    return {
      success: true,
      review: updatedReview,
    };
  }

  async remove(id: string, userId: string) {
    const review = await this.reviewModel.findById(id);
    if (!review) {
      throw new NotFoundException('Review not found');
    }

    if (review.user.toString() !== userId) {
      throw new BadRequestException('Not authorized');
    }

    const productId = review.product.toString();
    await this.reviewModel.findByIdAndDelete(id);

    // Update product rating
    await this.updateProductRating(productId);

    return {
      success: true,
      message: 'Review deleted',
    };
  }

  async findByUser(userId: string, page = 1, limit = 20) {
    const safeLimit = Math.min(Math.max(1, Number(limit) || 20), 100);
    const safePage = Math.max(1, Number(page) || 1);
    const skip = (safePage - 1) * safeLimit;
    const [reviews, total] = await Promise.all([
      this.reviewModel
        .find({ user: userId })
        .populate('product', 'name images slug price')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(safeLimit)
        .lean(),
      this.reviewModel.countDocuments({ user: userId }),
    ]);
    return {
      success: true,
      reviews,
      pagination: { page: safePage, limit: safeLimit, total, pages: Math.ceil(total / safeLimit) },
    };
  }

  async markHelpful(reviewId: string, userId: string) {
    // Atomic $addToSet + $inc prevents the read-modify-write race condition
    // where two concurrent requests both pass the "already marked" check before
    // either has committed. $addToSet is a no-op if the value is already in
    // the array, so this is idempotent.
    const updated = await (this.reviewModel as any).findOneAndUpdate(
      { _id: reviewId, helpfulUsers: { $ne: userId } },
      {
        $addToSet: { helpfulUsers: userId },
        $inc: { helpful: 1 },
      },
      { new: true },
    );

    if (!updated) {
      // Either review doesn't exist or user already marked it helpful.
      const exists = await this.reviewModel.exists({ _id: reviewId });
      if (!exists) throw new NotFoundException('Review not found');
      throw new BadRequestException('You have already marked this review as helpful');
    }

    return { success: true, review: updated };
  }

  // -------- Admin methods --------

  async adminFindAll(
    page = 1,
    limit = 20,
    status?: string,
    productId?: string,
    userId?: string,
    search?: string,
    rating?: number,
    verifiedPurchase?: boolean,
    reported?: boolean,
    sort?: string,
  ) {
    const filter: Record<string, unknown> = {};
    if (status) filter.status = status;
    if (productId) filter.product = productId;
    if (userId) filter.user = userId;
    if (rating && rating >= 1 && rating <= 5) filter.rating = rating;
    if (verifiedPurchase === true) filter.verifiedPurchase = true;
    if (reported === true) filter.reportCount = { $gt: 0 };

    // Server-side text search on comment (case-insensitive).
    // User/product name search requires a two-step lookup (resolve ids first)
    // which we skip here for simplicity; the comment search covers the primary use-case.
    if (search && search.trim()) {
      filter.comment = { $regex: search.trim(), $options: 'i' };
    }

    const sortMap: Record<string, Record<string, 1 | -1>> = {
      newest: { createdAt: -1 },
      oldest: { createdAt: 1 },
      'lowest-rating': { rating: 1, createdAt: -1 },
      'highest-rating': { rating: -1, createdAt: -1 },
      'most-helpful': { helpful: -1, createdAt: -1 },
    };
    const sortClause = sortMap[sort ?? ''] ?? sortMap.newest;

    const safeLimit = Math.min(Math.max(1, Number(limit) || 20), 100);
    const safePage = Math.max(1, Number(page) || 1);
    const skip = (safePage - 1) * safeLimit;
    const [reviews, total] = await Promise.all([
      this.reviewModel
        .find(filter)
        .populate('user', 'name email avatar')
        .populate('product', 'name images _id')
        .sort(sortClause)
        .skip(skip)
        .limit(safeLimit),
      this.reviewModel.countDocuments(filter),
    ]);

    return {
      success: true,
      reviews,
      pagination: { page: safePage, limit: safeLimit, total, pages: Math.ceil(total / safeLimit) },
    };
  }

  async adminGetStats() {
    const [statusCounts, ratingAgg] = await Promise.all([
      this.reviewModel.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      this.reviewModel.aggregate([
        { $match: { status: 'approved' } },
        {
          $group: {
            _id: null,
            avgRating: { $avg: '$rating' },
            total: { $sum: 1 },
            oneStarCount: { $sum: { $cond: [{ $eq: ['$rating', 1] }, 1, 0] } },
          },
        },
      ]),
    ]);

    const counts: Record<string, number> = { pending: 0, approved: 0, rejected: 0 };
    for (const { _id, count } of statusCounts) {
      if (_id && typeof _id === 'string') counts[_id] = count;
    }

    const totalAll = counts.pending + counts.approved + counts.rejected;
    const approvalRate = totalAll > 0
      ? Math.round((counts.approved / totalAll) * 100)
      : 0;

    const ratingStats = ratingAgg[0] ?? { avgRating: 0, total: 0, oneStarCount: 0 };

    return {
      success: true,
      stats: {
        pending: counts.pending,
        approved: counts.approved,
        rejected: counts.rejected,
        total: totalAll,
        approvalRate,
        avgRating: ratingStats.avgRating ? Math.round(ratingStats.avgRating * 10) / 10 : 0,
        oneStarCount: ratingStats.oneStarCount ?? 0,
      },
    };
  }

  async adminUpdateStatus(id: string, dto: AdminUpdateReviewStatusDto, moderatorId?: string) {
    const review = await this.reviewModel.findById(id);
    if (!review) throw new NotFoundException('Review not found');
    review.status = dto.status;
    if (dto.rejectionReason) review.rejectionReason = dto.rejectionReason;
    if (moderatorId) {
      (review as any).moderatedBy = new Types.ObjectId(moderatorId);
      (review as any).moderatedAt = new Date();
    }
    await review.save();
    await this.updateProductRating(review.product.toString());
    return { success: true, review };
  }

  async adminBulkUpdateStatus(ids: string[], status: 'approved' | 'rejected', rejectionReason?: string, moderatorId?: string) {
    const objectIds = ids.map((id) => new Types.ObjectId(id));

    // Collect distinct product ids before mutation to recompute ratings after.
    const reviews = await this.reviewModel.find({ _id: { $in: objectIds } }).select('product');
    const productIds = [...new Set(reviews.map((r) => r.product.toString()))];

    const updateFields: Record<string, unknown> = { status };
    if (rejectionReason) updateFields.rejectionReason = rejectionReason;
    if (moderatorId) {
      updateFields.moderatedBy = new Types.ObjectId(moderatorId);
      updateFields.moderatedAt = new Date();
    }

    const result = await this.reviewModel.updateMany(
      { _id: { $in: objectIds } },
      { $set: updateFields },
    );

    // Recompute product ratings for all affected products.
    await Promise.all(productIds.map((pid) => this.updateProductRating(pid)));

    return { success: true, modified: result.modifiedCount };
  }

  async adminBulkDelete(ids: string[]) {
    const objectIds = ids.map((id) => new Types.ObjectId(id));
    const reviews = await this.reviewModel.find({ _id: { $in: objectIds } }).select('product');
    const productIds = [...new Set(reviews.map((r) => r.product.toString()))];

    await this.reviewModel.deleteMany({ _id: { $in: objectIds } });
    await Promise.all(productIds.map((pid) => this.updateProductRating(pid)));

    return { success: true, deleted: ids.length };
  }

  async adminDelete(id: string) {
    const review = await this.reviewModel.findById(id);
    if (!review) throw new NotFoundException('Review not found');
    const productId = review.product.toString();
    await this.reviewModel.findByIdAndDelete(id);
    await this.updateProductRating(productId);
    return { success: true, message: 'Review deleted' };
  }

  async adminSetReply(id: string, dto: AdminReplyDto) {
    const review = await this.reviewModel.findById(id);
    if (!review) throw new NotFoundException('Review not found');

    const now = new Date();
    (review as any).reply = {
      body: dto.body,
      author: dto.author,
      authorName: dto.authorName,
      createdAt: (review as any).reply?.createdAt ?? now,
      updatedAt: now,
    };
    await review.save();
    return { success: true, review };
  }

  async adminDeleteReply(id: string) {
    const review = await this.reviewModel.findByIdAndUpdate(
      id,
      { $unset: { reply: '' } },
      { new: true },
    );
    if (!review) throw new NotFoundException('Review not found');
    return { success: true, review };
  }

  async reportReview(id: string, userId: string, reason: string) {
    const review = await this.reviewModel.findById(id);
    if (!review) throw new NotFoundException('Review not found');

    const alreadyReported = (review as any).reports?.some(
      (r: any) => r.reporter?.toString() === userId,
    );
    if (alreadyReported) {
      throw new BadRequestException('You have already reported this review');
    }

    await this.reviewModel.findByIdAndUpdate(id, {
      $push: { reports: { reporter: new Types.ObjectId(userId), reason, createdAt: new Date() } },
      $inc: { reportCount: 1 },
    });

    return { success: true, message: 'Review reported' };
  }

  private async updateProductRating(productId: string) {
    // Only count approved reviews so pending/rejected ones don't skew the score.
    // Use aggregation to calculate atomically in a single round-trip rather than
    // fetching all documents and computing in JS (avoids the read/write race
    // where two concurrent reviews could overwrite each other's calculation).
    const [result] = await this.reviewModel.aggregate([
      { $match: { product: new (require('mongoose').Types.ObjectId)(productId), status: 'approved' } },
      { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } },
    ]);

    await this.productModel.findByIdAndUpdate(productId, {
      rating: result ? Number(result.avg.toFixed(1)) : 0,
      numReviews: result ? result.count : 0,
    });
  }
}

