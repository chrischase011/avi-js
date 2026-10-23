import { AviFactory } from '@avijs/core';
import { AppModule } from './app.module.js';

const app = await AviFactory.create(AppModule);
await app.listen(3000);
