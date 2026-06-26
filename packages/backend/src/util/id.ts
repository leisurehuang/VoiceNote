import { nanoid } from 'nanoid';

/** 会话 ID（URL 友好的短串）。 */
export const newId = (): string => nanoid(12);
