import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

import {
  PASSWORD_MAX_UTF8_BYTES,
  PASSWORD_RULES,
  passwordUtf8Bytes,
  passwordValidationError,
} from '@waitlayer/shared';

export { PASSWORD_RULES } from '@waitlayer/shared';

@ValidatorConstraint({ name: 'isStrongPassword', async: false })
export class IsStrongPasswordConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return typeof value === 'string' && passwordValidationError(value) === null;
  }

  defaultMessage(_args: ValidationArguments): string {
    return PASSWORD_RULES;
  }
}

export function IsStrongPassword(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: 'isStrongPassword',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: IsStrongPasswordConstraint,
    });
  };
}

@ValidatorConstraint({ name: 'isBcryptPasswordLength', async: false })
export class IsBcryptPasswordLengthConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return (
      typeof value === 'string' && value.length > 0 && passwordUtf8Bytes(value) <= PASSWORD_MAX_UTF8_BYTES
    );
  }

  defaultMessage(): string {
    return `Password must not exceed ${PASSWORD_MAX_UTF8_BYTES} UTF-8 bytes`;
  }
}

export function IsBcryptPasswordLength(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: 'isBcryptPasswordLength',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: IsBcryptPasswordLengthConstraint,
    });
  };
}
