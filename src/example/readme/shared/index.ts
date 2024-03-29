// no need to put implementation logic here
// but only API definition and service instance creating
// as this file is supposed to be shared between provider and client implementations

import {ActionType, createService, ScanService} from "lib";

const apiDefinition = {
    evaluateMathExpression: ActionType.Promise<string, number>(),
    httpPing: ActionType.Observable<Array<{ address?: string; port?: number; attempts?: number; timeout?: number; }>,
        { domain: string } & ({ time: number } | { error: string })>(),
};

export const API_SERVICE = createService({
    channel: "some-event-name", // event name used to communicate between the event emitters
    apiDefinition,
});

// optionally exposing inferred API structure
export type ScannedApiService = ScanService<typeof API_SERVICE>;
