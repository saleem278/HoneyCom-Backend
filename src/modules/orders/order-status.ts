import { BadRequestException } from '@nestjs/common';

/**
 * Allowed order-status transitions. Anything not listed here is rejected
 * by `assertOrderTransition`. Cancelled and refunded are terminal.
 *
 * Pulled out into its own file so seller.service and admin.service can use
 * the same rules without importing OrdersService.
 */
export const ALLOWED_ORDER_TRANSITIONS: Record<string, string[]> = {
  pending: ['processing', 'cancelled'],
  // Admins can refund a processing order if the customer disputes early.
  processing: ['shipped', 'cancelled', 'refunded'],
  // Shipped orders can be refunded if the customer requests a return
  // (e.g. wrong address, package recalled).
  shipped: ['delivered', 'cancelled', 'refunded'],
  delivered: ['refunded'],
  cancelled: [],
  refunded: [],
};

export function assertOrderTransition(from: string, to: string): void {
  if (from === to) return; // idempotent — no-op
  const allowed = ALLOWED_ORDER_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    throw new BadRequestException(
      `Invalid order status transition: ${from} -> ${to}`,
    );
  }
}
