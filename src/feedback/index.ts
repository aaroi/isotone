/**
 * isotone/feedback — collect feedback from a deployed app.
 *
 * `feedback()` turns the host's own route into the endpoint the panel posts
 * to, and hands each validated record to the host's store. It only writes:
 * nothing is read back, so the endpoint cannot leak what others sent, and a
 * note is changed or removed only by the browser that wrote it. Built
 * on the Fetch API's `Request` and `Response`, with no Node built-ins, so it
 * runs wherever the host's routes do.
 */
export { feedback, type FeedbackOptions, type FeedbackStore } from './handler';
export { toNode } from './node';
export { postgresStore, type PostgresClient, type PostgresOptions } from './postgres';
export type { FeedbackBrowser, FeedbackEntry } from '../core/feedback';
