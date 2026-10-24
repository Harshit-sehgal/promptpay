import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';

import type { PersonSubject } from '@ateva/db';

/** Maps the `:subject` URL segment (`users` | `waitlist`) to the enum value. */
@Injectable()
export class PersonSubjectPipe implements PipeTransform<unknown, PersonSubject> {
  transform(value: unknown): PersonSubject {
    if (value === 'users') return 'user';
    if (value === 'waitlist') return 'waitlist';
    throw new BadRequestException('subject must be "users" or "waitlist"');
  }
}
