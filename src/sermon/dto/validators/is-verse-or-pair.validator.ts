import {
  registerDecorator,
  ValidationOptions,
  ValidationArguments,
} from 'class-validator';

export function IsVerseOrPair(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: 'isVerseOrPair',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown, _args: ValidationArguments): boolean {
          if (value === undefined || value === null) {
            return true; // @IsOptional handles null/undefined
          }
          if (typeof value === 'number' && !isNaN(value)) {
            return true;
          }
          if (
            Array.isArray(value) &&
            value.length === 2 &&
            value.every((v) => typeof v === 'number' && !isNaN(v))
          ) {
            return true;
          }
          return false;
        },
        defaultMessage(_args: ValidationArguments): string {
          return 'verse must be a number or an array of exactly two numbers [number, number]';
        },
      },
    });
  };
}
