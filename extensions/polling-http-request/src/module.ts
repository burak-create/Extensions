import { createExtension } from "@cognigy/extension-tools";
import {
	onPollingFailure,
	onPollingSuccess,
	onPollingTimeout,
	pollingHttpRequest,
} from "./nodes/pollingHttpRequest";

export default createExtension({
	nodes: [
		pollingHttpRequest,
		onPollingSuccess,
		onPollingFailure,
		onPollingTimeout,
	],
	connections: [],
});
