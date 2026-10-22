export const HTTP_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const;

export type HttpMethod = (typeof HTTP_METHODS)[number];
