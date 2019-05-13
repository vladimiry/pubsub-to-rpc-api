// no need to put implementation logic here
// but only API definition and service instance creating
// as this file is supposed to be shared between provider and client implementations

import {ActionType, ScanApiDefinition, createService} from "lib";

const apiDefinition = {
    evaluateMathExpression: ActionType.Promise<[string], number>(),
    httpPing: ActionType.Observable<Array<{
        address?: string;
        port?: number;
        attempts?: number;
        timeout?: number;
    }>, { domain: string } & ({ time: number } | { error: string })>(),
};

export const API_SERVICE = createService({
    channel: "some-event-name", // event name used to communicate between event emitters
    apiDefinition,
});

// optionally exposing inferred API structure
export type Api = ScanApiDefinition<typeof apiDefinition>["Api"];

// alternatively the service instance can also be scanned
// export type Api =  ScanService<typeof API_SERVICE>["Api"]
