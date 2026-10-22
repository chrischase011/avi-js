#!/usr/bin/env node
import { create } from './index.js';

process.exitCode = await create(process.argv.slice(2));
