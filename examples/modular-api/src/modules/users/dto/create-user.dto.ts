export interface CreateUserDto {
  name: string;
}

export function parseCreateUser(input: unknown): CreateUserDto | undefined {
  if (typeof input !== 'object' || input === null) return undefined;
  const { name } = input as { name?: unknown };
  return typeof name === 'string' && name.trim() !== '' ? { name: name.trim() } : undefined;
}
