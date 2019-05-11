// no need to put implementation logic here
// but only API definition and service instance creating
// as this file is supposed to be shared between provider and client implementations

import {ActionReturnType, ScanServiceTypes, createService} from "lib";

export const API_SERVICE = createService({
    // channel used to communicate between event emitters
    channel: "some-event-name",

    // api definition
    actionsDefinition: {
        evaluateMathExpression: (expression: string) => ActionReturnType.Promise<number>(),
        httpPing: (
            ...args: Array<{
                address?: string;
                port?: number;
                attempts?: number;
                timeout?: number;
            }>
        ) => ActionReturnType.Observable<{ domain: string } & ({ time: number } | { error: string })>(),
    },
});

export type Api = ScanServiceTypes<typeof API_SERVICE>["Api"];

export type UnpackedApi = ScanServiceTypes<typeof API_SERVICE>["UnpackedApi"];
