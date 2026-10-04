/**
 * Host half of the per-step token usage bundle.
 *
 * The feature is entirely a Client presentation change. It reads the usage the
 * provider already reported on each durable `assistant/message` session event,
 * so there is nothing to compute, project, or configure on the Host: no route,
 * no service, no session projection, no configuration schema.
 *
 * This half exists so the bundle has a mountable Host entry point, which is
 * what makes the package a DSH plugin rather than a loose browser script.
 */
export function apply() {}
