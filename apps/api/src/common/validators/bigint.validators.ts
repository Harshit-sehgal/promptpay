import { registerDecorator, ValidationArguments, ValidationOptions } from 'class-validator';

/**
 * Validates that a value is a BigInt (or can be coerced to one).
 * Use for monetary fields that are stored as Postgres BIGINT.
 */
export function IsBigInt(validationOptions?: ValidationOptions): PropertyDecorator {
  return function (object: object, propertyName: string | symbol) {
    registerDecorator({
      name: 'isBigInt',
      target: object.constructor,
      propertyName: propertyName as string,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          return typeof value === 'bigint';
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} must be a BigInt`;
        },
      },
    });
  };
}

/**
 * Validates that a BigInt value is >= minValue.
 * Must be used together with @Transform(({ value }) => BigInt(value)) and @IsBigInt().
 */
export function MinBigInt(
  minValue: bigint,
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return function (object: object, propertyName: string | symbol) {
    registerDecorator({
      name: 'minBigInt',
      target: object.constructor,
      propertyName: propertyName as string,
      options: validationOptions,
      constraints: [minValue],
      validator: {
        validate(value: unknown, args: ValidationArguments) {
          if (typeof value !== 'bigint') return false;
          const [min] = args.constraints as [bigint];
          return value >= min;
        },
        defaultMessage(args: ValidationArguments) {
          const [min] = args.constraints as [bigint];
          return `${args.property} must be greater than or equal to ${min.toString()}`;
        },
      },
    });
  };
}
