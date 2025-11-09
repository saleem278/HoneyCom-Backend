import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Review, IReview } from '../../models/Review.model';
import { Product, IProduct } from '../../models/Product.model';

@Injectable()
export class ReviewsService {
  constructor(
    @InjectModel('Review') private reviewModel: Model<IReview>,
    @InjectModel('Product') private productModel: Model<IProduct>,
  ) {}

  async create(userId: string, productId: string, reviewData: any) {
    const product = await this.productModel.findById(productId);
    if (!product) {
      throw new NotFoundException('Product not found');
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
      .populate('user', 'name email')
      .sort({ createdAt: -1 });

    return {
      success: true,
      reviews,
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

    const updatedReview = await this.reviewModel.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    );

    // Update product rating
    await this.updateProductRating(review.product.toString());

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
    const review = await this.reviewModel.findById(reviewId);
    if (!review) {
      throw new NotFoundException('Review not found');
    }

    // Check if user already marked as helpful (assuming helpfulUsers array exists)
    const helpfulUsers = (review as any).helpfulUsers || [];
    if (helpfulUsers.includes(userId)) {
      throw new BadRequestException('You have already marked this review as helpful');
    }

    helpfulUsers.push(userId);
    review.helpful = (review.helpful || 0) + 1;
    (review as any).helpfulUsers = helpfulUsers;
    await review.save();

    return {
      success: true,
      review,
    };
  }

  private async updateProductRating(productId: string) {
    const reviews = await this.reviewModel.find({ product: productId });
    const rating =
      reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length;

    await this.productModel.findByIdAndUpdate(productId, {
      rating: rating || 0,
      numReviews: reviews.length,
    });
  }
}

