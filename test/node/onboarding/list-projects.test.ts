import { describe, expect, it } from "vitest";
import { prepareEvent } from "../../../src/core/ingest/prepare.ts";
import { IngestState } from "../../../src/core/ingest/state.ts";
import { storeEvent } from "../../../src/core/ingest/store.ts";
import { createProject, listProjects } from "../../../src/core/projects.ts";
import { testPorts } from "../../support/node-ports.ts";

describe("listProjects for the Apps page", () => {
	it("has events_24h, last_event_at and demo", async () => {
		const { ports, clock } = await testPorts();
		const shop = await createProject(ports, { name: "Shop" });
		await createProject(ports, { name: "Demo", demo: true });
		const state = new IngestState();
		const send = async () =>
			storeEvent(
				ports,
				state,
				shop.internalId,
				await prepareEvent(new TextEncoder().encode('{"message":"x"}'), clock.now()),
			);
		await send();
		clock.advance(30 * 3_600_000);
		await send();
		await send();
		const [a, b] = await listProjects(ports.db, clock.now());
		expect(a).toMatchObject({
			name: "Shop",
			demo: false,
			events_24h: 2,
			last_event_at: "2026-10-11T18:00:00.000Z",
		});
		expect(b).toMatchObject({ name: "Demo", demo: true, events_24h: 0, last_event_at: null });
	});
});
