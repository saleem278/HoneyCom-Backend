import { Model, type Types } from 'mongoose';
import { IOrder } from '../../models/Order.model';

/**
 * Shared, refund-aware net-earnings computation for a single seller.
 *
 * This is the single source of truth for "how much has this seller actually
 * earned (net of platform commission and net of refunds) from delivered
 * orders". PayoutsService.computeBalance, the seller dashboard, and the seller
 * sales-report all reuse this so the figures can never drift apart (previously
 * the dashboard/report showed gross-of-refund earnings while payouts showed
 * net-of-refund, confusing sellers).
 *
 * Mirrors the two-step logic that used to live inline in computeBalance:
 *   1. Sum each line item's sellerEarning for the seller's own products on
 *      delivered orders, excluding items whose refundStatus/returnStatus is
 *      'completed'.
 *   2. Subtract the seller's proportional share of any order-level
 *      `refundedAmount` (partial/admin refunds that stamp the order total but
 *      not per-item refundStatus), capped at the seller's earning per order.
 */
export async function computeSellerNetEarnings(
  orderModel: Model<IOrder>,
  productIds: Array<Types.ObjectId>,
): Promise<{ grossEarnings: number; totalRefundShare: number; totalEarnings: number }> {
  const earningsAgg = await orderModel.aggregate([
    { $match: { 'items.product': { $in: productIds }, status: 'delivered' } },
    { $unwind: '$items' },
    {
      $match: {
        'items.product': { $in: productIds },
        'items.refundStatus': { $ne: 'completed' },
        'items.returnStatus': { $ne: 'completed' },
      },
    },
    {
      $group: {
        _id: null,
        totalNetEarnings: {
          $sum: { $ifNull: ['$items.sellerEarning', { $multiply: ['$items.price', '$items.quantity'] }] },
        },
      },
    },
  ]);
  const grossEarnings = earningsAgg[0]?.totalNetEarnings ?? 0;

  // An admin partial refund (and a full refund on a multi-item order) leaves the
  // order status as 'delivered' and only stamps the order-level `refundedAmount`,
  // with no per-item refundStatus. So the aggregation above still counts the full
  // sellerEarning. Subtract the seller's proportional share of each delivered
  // order's refundedAmount so partial refunds actually reduce net earnings.
  const refundAgg = await orderModel.aggregate([
    {
      $match: {
        'items.product': { $in: productIds },
        status: 'delivered',
        refundedAmount: { $gt: 0 },
      },
    },
    { $unwind: '$items' },
    {
      $group: {
        _id: '$_id',
        refundedAmount: { $first: '$refundedAmount' },
        orderTotal: { $first: '$total' },
        sellerEarning: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $in: ['$items.product', productIds] },
                  { $ne: ['$items.refundStatus', 'completed'] },
                  { $ne: ['$items.returnStatus', 'completed'] },
                ],
              },
              { $ifNull: ['$items.sellerEarning', { $multiply: ['$items.price', '$items.quantity'] }] },
              0,
            ],
          },
        },
      },
    },
    {
      $group: {
        _id: null,
        totalRefundShare: {
          $sum: {
            // Attribute the order's refundedAmount to this seller in proportion
            // to their share of the order total, capped at the seller's earning
            // so a refund never pushes the seller's contribution below zero.
            $min: [
              '$sellerEarning',
              {
                $cond: [
                  { $gt: ['$orderTotal', 0] },
                  { $multiply: ['$refundedAmount', { $divide: ['$sellerEarning', '$orderTotal'] }] },
                  0,
                ],
              },
            ],
          },
        },
      },
    },
  ]);
  const totalRefundShare = refundAgg[0]?.totalRefundShare ?? 0;
  const totalEarnings = Math.max(0, grossEarnings - totalRefundShare);

  return { grossEarnings, totalRefundShare, totalEarnings };
}
