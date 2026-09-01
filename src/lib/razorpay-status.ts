export type RazorpayRefundStatus = 'pending' | 'processed' | 'failed'

export type WaystayRefundStatus = 'REFUND_PENDING' | 'REFUNDED' | 'REFUND_FAILED'

export function waystayStatusForRazorpayRefund(status: RazorpayRefundStatus): WaystayRefundStatus {
  if (status === 'processed') return 'REFUNDED'
  if (status === 'failed') return 'REFUND_FAILED'
  return 'REFUND_PENDING'
}
