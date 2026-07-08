export class PayoutProviderUnsafeFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PayoutProviderUnsafeFailure';
  }
}
