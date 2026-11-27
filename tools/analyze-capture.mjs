#!/usr/bin/env node
import { register } from 'tsx/esm/api';

register();
await import('./analyze-capture-impl.mjs');
