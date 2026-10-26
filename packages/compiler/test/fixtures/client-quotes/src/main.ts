import { Controller, Get, createAvi, defineController } from '@avijs/core';

@Controller('/people')
export class PeopleController {
  @Get("/o'neil")
  oneil() {
    return 1;
  }

  @Get('/a\b')
  slash() {
    return 2;
  }
}

export const odd = defineController({
  routes: [
    { method: 'GET', path: "/x'; } export const pwned = 1; interface Z { 'q", handler: () => 3 },
    { method: 'GET', path: '/line\nbreak', handler: () => 4 },
    // Not an HTTP method: left out with a warning.
    { method: "GET' | 'POST" as 'GET', path: '/bad-method', handler: () => 5 },
  ],
});

createAvi().register({ controllers: [PeopleController, odd] });
