import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Review, IReview } from '../../models/Review.model';
import { Product, IProduct } from '../../models/Product.model';
import { IOrder } from '../../models/Order.model';

@Injectable()
export class ReviewsService {
  constructor(
    @InjectModel('Review') private reviewModel: Model<IReview>,
    @InjectModel('Product') private productModel: Model<IProduct>,
    @InjectModel('Order') private orderModel: Model<IOrder>,
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

    const review = await this.reviewModel.create({
      ...reviewData,
      product: productId,
      user: userId,
    });

    // Update product rating
    await this.updateProductRating(productId);

    return {
      success: true,
      review,
    };
  }

  async findAll(productId?: string) {
    const filter: any = {};
    if (productId) {
      filter.product = productId;
    }

    const reviews = await this.reviewModel
      .find(filter)
      .populate('user', 'name email avatar')
      .sort({ createdAt: -1 });

    // Real rating distribution from actual review data
    const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    const approvedReviews = reviews.filter((r) => r.status === 'approved' || r.status === undefined);
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

  async adminFindAll(page = 1, limit = 20, status?: string, productId?: string) {
    const filter: Record<string, unknown> = {};
    if (status) filter.status = status;
    if (productId) filter.product = productId;

    const skip = (page - 1) * limit;
    const [reviews, total] = await Promise.all([
      this.reviewModel
        .find(filter)
        .populate('user', 'name email avatar')
        .populate('product', 'name images')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      this.reviewModel.countDocuments(filter),
    ]);

    return {
      success: true,
      reviews,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }

  async adminUpdateStatus(id: string, status: 'approved' | 'rejected') {
    const review = await this.reviewModel.findById(id);
    if (!review) throw new NotFoundException('Review not found');
    review.status = status;
    await review.save();
    await this.updateProductRating(review.product.toString());
    return { success: true, review };
  }

  async adminDelete(id: string) {
    const review = await this.reviewModel.findById(id);
    if (!review) throw new NotFoundException('Review not found');
    const productId = review.product.toString();
    await this.reviewModel.findByIdAndDelete(id);
    await this.updateProductRating(productId);
    return { success: true, message: 'Review deleted' };
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

