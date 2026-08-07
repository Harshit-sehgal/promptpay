export class PayoutProviderUnsafeFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PayoutProviderUnsafeFailure';
  }
}

/**
 * A provider failure for which no remote money movement remains possible, or
 * any completed funding leg has been conclusively reversed. Local allocations
 * may therefore be released through the normal failed-payout transition.
 */
export class PayoutProviderSafeFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PayoutProviderSafeFailure';
  }
}
