/**
 * @echosphere/core — deterministic conversation engine.
 *
 * No I/O, no framework, no environment access. Everything here is pure or takes
 * its dependencies as arguments, which is what makes the policy in `escalation`,
 * `verification` and `order-policy` testable without a database, a model or a
 * voice channel.
 */

export * from './types.js';
export * from './config.js';
export * from './fields.js';
export * from './confidence.js';
export * from './conversation-state.js';
export * from './signals.js';
export * from './persuasion.js';
export * from './order-policy.js';
export * from './verification.js';
export * from './escalation.js';
export * from './safety.js';
export * from './speech-text.js';
export * from './prompt.js';
export * from './turn.js';
