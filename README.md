# pubsub-to-rpc-api

Is a Node.js / browser library that converts _publish-subscribe / IPC_ - like interaction model into the _request/response_ model with _provider_ and _client_ parties involved. So it's like flattening _pub/sub_ interactions into the Observables or Promises. It comes with type safety out of the box, thanks to TypeScript.

[![Build Status: Linux / MacOS](https://travis-ci.org/vladimiry/pubsub-to-rpc-api.svg?branch=master)](https://travis-ci.org/vladimiry/pubsub-to-rpc-api) [![Build status: Windows](https://ci.appveyor.com/api/projects/status/5tk7cwgldmsd5r8n?svg=true)](https://ci.appveyor.com/project/vladimiry/pubsub-to-rpc-api)

## Getting started

Your project needs `rxjs@6` to be installed, which is a peer dependency of this module.

Example-related source code is located [here](src/example/readme), can be executed by running `yarn example` console command.

Let's first describe API methods and create service instance ([shared/index.ts](src/example/readme/shared/index.ts)):
```typescript
// no need to put implementation logic here
// but only API definition and service instance creating
// as this file is supposed to be shared between provider and client implementations

import {ActionType, ScanService, createService} from "lib";

const apiDefinition = {
    evaluateMathExpression: ActionType.Promise<string, number>(),
    httpPing: ActionType.Observable<Array<{
        address?: string;
        port?: number;
        attempts?: number;
        timeout?: number;
    }>, { domain: string } & ({ time: number } | { error: string })>(),
};

export const API_SERVICE = createService({
    channel: "some-event-name", // event name used to communicate between the event emitters
    apiDefinition,
});

// optionally exposing inferred API structure
export type ScannedApiService = ScanService<typeof API_SERVICE>;
```

`ActionReturnType.Promise` and `ActionReturnType.Observable` return values used to preserve action result type in runtime so the client-side code is able to distinguish return types not knowing anything about the actual API implementation at the provider-side.

API implementation, ie provider side ([provider/index.ts](src/example/readme/provider/index.ts)):
```typescript
import tcpPing from "tcp-ping";
import {evaluate} from "maths.ts";
import {from, merge} from "rxjs";
import {promisify} from "util";

import {API_SERVICE, ScannedApiService} from "../shared";
import {EM_CLIENT, EM_PROVIDER} from "../shared/event-emitters-mock";

export const API_IMPLEMENTATION: ScannedApiService["ApiImpl"] = {
    evaluateMathExpression: async (input) => Number(String(evaluate(input))),
    httpPing(entries) {
        const promises = entries.map(async (entry) => {
            const ping = await promisify(tcpPing.ping)(entry);
            const baseResponse = {domain: ping.address};
            const failed = typeof ping.avg === "undefined" || isNaN(ping.avg);

            return failed
                ? {...baseResponse, error: JSON.stringify(ping)}
                : {...baseResponse, time: ping.avg};
        });

        return merge(
            ...promises.map((promise) => from(promise)),
        );
    },
};

API_SERVICE.register(
    API_IMPLEMENTATION,
    EM_PROVIDER,
    // 3-rd parameter is optional
    // if not defined, then "EM_PROVIDER" would be used for listening and emitting
    // but normally listening and emitting happens on different instances, so specifying separate emitting instance as 3rd parameter
    {
        onEventResolver: (payload) => ({payload, emitter: EM_CLIENT}),
        // in a more real world scenario you would extract emitter from the payload, see Electron.js example:
        // onEventResolver: ({sender}, payload) => ({payload, emitter: {emit: sender.send.bind(sender)}}),
    },
);
```

Now we can call the defined and implemented methods in a type-safe way ([client/index.ts](src/example/readme/client/index.ts)):
```typescript
// tslint:disable:no-console

import {API_SERVICE} from "../shared";
import {EM_CLIENT, EM_PROVIDER} from "../shared/event-emitters-mock";

const apiClient = API_SERVICE.caller({emitter: EM_PROVIDER, listener: EM_CLIENT});
const evaluateMathExpressionMethod = apiClient("evaluateMathExpression"/*, {timeoutMs: 600}*/);
const httpPingMethod = apiClient("httpPing"/*, {timeoutMs: 600}*/);

evaluateMathExpressionMethod("32 * 2")
    .then(console.log)
    .catch(console.error);

httpPingMethod([{address: "google.com", attempts: 1}, {address: "github.com"}, {address: "1.1.1.1"}])
    .subscribe(console.log, console.error);
```

And here is how API methods test structure might look (we leverage combination of `Api` model and TypeScript's `Record` type to make sure that tests for all the methods got defined, see [provider/api.spec.ts](src/example/readme/provider/api.spec.ts)):
```typescript
import test, {ExecutionContext, ImplementationResult} from "ava";
import {bufferCount} from "rxjs/operators";

import {API_IMPLEMENTATION} from ".";

const apiActionTests: Record<keyof typeof API_IMPLEMENTATION, (t: ExecutionContext) => ImplementationResult> = {
    evaluateMathExpression: async (t) => {
        t.is(25, await API_IMPLEMENTATION.evaluateMathExpression("12 * 2 + 1"));
    },
    httpPing: async (t) => {
        const entries = [
            {address: "google.com", attempts: 1},
            {address: "github.com"},
            {address: "1.1.1.1"},
        ];

        const results = await API_IMPLEMENTATION
            .httpPing(...entries)
            .pipe(bufferCount(entries.length))
            .toPromise();

        // type checking like assertions implemented below are not really needed since TypeScript handles the type checking

        t.is(results.length, entries.length);

        for (const result of results) {
            if ("time" in result) {
                t.true(typeof result.time === "number");
                t.false("error" in result);
                continue;
            }

            t.true("error" in result && typeof result.error === "string");
        }
    },
};

for (const [apiMethodName, apiMethodTest] of Object.entries(apiActionTests)) {
    test(`API: ${apiMethodName}`, apiMethodTest);
}
```
