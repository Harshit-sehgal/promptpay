import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

/**
 * A small, audited list of the most common passwords. This is defense-in-depth
 * behind the complexity rules below — it is not exhaustive. In production a
 * breached-password API (e.g. HaveIBeenPwned k-anonymity) should augment this.
 */
const COMMON_PASSWORDS = new Set(
  [
    'password', 'password1', 'password123', '123456', '12345678', '123456789',
    'qwerty', 'abc123', 'letmein', 'welcome', 'admin', 'iloveyou', 'monkey',
    'sunshine', 'football', 'secret', 'passw0rd', 'p@ssword', 'qwerty123',
    '1q2w3e4r', 'baseball', 'master', 'hello123', 'freedom', 'shadow',
    'trustno1', 'whatever', 'dragon', 'superman', 'batman', 'changeme',
  ].map((p) => p.toLowerCase()),
);

export const PASSWORD_RULES =
  'Must be 8-128 chars and include uppercase, lowercase, digit, and symbol';

@ValidatorConstraint({ name: 'isStrongPassword', async: false })
export class IsStrongPasswordConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'string') return false;
    if (value.length < 8 || value.length > 128) return false;
    if (!/[a-z]/.test(value)) return false;
    if (!/[A-Z]/.test(value)) return false;
    if (!/[0-9]/.test(value)) return false;
    if (!/[^A-Za-z0-9]/.test(value)) return false;
    if (COMMON_PASSWORDS.has(value.toLowerCase())) return false;
    return true;
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
