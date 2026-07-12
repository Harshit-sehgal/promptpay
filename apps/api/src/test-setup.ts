// BigInt values cannot be serialized by JSON.stringify by default. Every
// monetary column in the schema is stored as BigInt, so without this polyfill
// any response containing an amount would throw at runtime during tests.
// Mirrors the polyfill in apps/api/src/main.ts.
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};
