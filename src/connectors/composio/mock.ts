import { MockSourceConnector } from "../mock.js";

/**
 * The Composio mock is intentionally just the fixture-backed `MockSourceConnector`.
 * It documents that, until real Composio wiring lands, the Composio "mode"
 * serves the same local fixtures behind the identical `SourceConnector`
 * interface. Swapping to `ComposioConnector` later requires no upstream change.
 */
export { MockSourceConnector as ComposioMockConnector };
