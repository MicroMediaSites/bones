// Public engine surface. The UI imports only from here.
export type * from './types';
export { validate, ruleLabel, pipMap, cellKey } from './validate';
export { generate, PRESETS } from './generate';
export type { Preset } from './generate';
export { solve, countSolutions } from './solve';
