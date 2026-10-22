import type { HttpMethod } from '@avijs/http';

/** A REST-style route table: 40 routes mixing static, parameter and catch-all paths. */
export const ROUTES: [HttpMethod, string][] = [
  ['GET', '/'],
  ['GET', '/health'],
  ['GET', '/api/v1/status'],
  ['GET', '/api/v1/users/settings/profile'],
  ...['users', 'teams', 'projects', 'issues', 'comments', 'labels'].flatMap(
    (resource): [HttpMethod, string][] => [
      ['GET', `/${resource}`],
      ['POST', `/${resource}`],
      ['GET', `/${resource}/:id`],
      ['PATCH', `/${resource}/:id`],
      ['DELETE', `/${resource}/:id`],
    ],
  ),
  ['GET', '/users/me'],
  ['GET', '/users/:id/posts'],
  ['GET', '/users/:id/posts/:postId'],
  ['GET', '/teams/:id/members/:memberId/roles'],
  ['GET', '/files/*'],
  ['GET', '/static/assets/*'],
];

export const PROBES: [string, string][] = [
  ['static root', '/'],
  ['static deep', '/api/v1/users/settings/profile'],
  ['one param', '/users/123'],
  ['static beats param', '/users/me'],
  ['two params', '/users/123/posts/456'],
  ['deep params', '/teams/7/members/42/roles'],
  ['encoded param', '/users/caf%C3%A9'],
  ['catch-all', '/files/a/b/c.txt'],
  ['trailing slash', '/users/123/'],
  ['miss (404)', '/nope/nothing/here'],
];

/** Routes every server registers besides the ones a benchmark case hits. */
export const FILLER = ROUTES.filter(([, path]) => path !== '/' && path !== '/users/:id');
