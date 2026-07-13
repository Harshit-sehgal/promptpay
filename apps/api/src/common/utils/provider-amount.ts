export const STRIPE_MAX_MINOR_AMOUNT = 99_999_999n;

/**
 * Validate a monetary amount before crossing an SDK/API boundary that accepts
 * JavaScript numbers. BigInt protects the ledger only until a provider call
 * silently rounds it; reject instead of changing the amount sent.
 */
export function requireProviderSafeMinorAmount(
  amountMinor: bigint,
  provider: string,
  maximum: bigint = BigInt(Number.MAX_SAFE_INTEGER),
): bigint {
  const amount = BigInt(amountMinor);
  if (amount <= 0n) {
    throw new Error(`Refusing ${provider} payment with non-positive amount: ${amount}`);
  }
  if (amount > maximum) {
    throw new Error(
      `Refusing ${provider} payment amount ${amount}: maximum safely supported minor-unit amount is ${maximum}`,
    );
  }
  return amount;
}
