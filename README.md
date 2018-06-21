# pubsub-to-stream-api

Is a Node.js / browser library that converts _publish-subscribe / IPC_ - like interaction model into the _request/response_ model with _provider_ and _client_ parties involved. So it's like flattening _pub/sub_ interactions into a RxJS streams. It comes with type safety out of the box, thanks to TypeScript.

[![Build Status: Linux / MacOS](https://travis-ci.org/vladimiry/pubsub-to-stream-api.svg?branch=master)](https://travis-ci.org/vladimiry/pubsub-to-stream-api) [![Build status: Windows](https://ci.appveyor.com/api/projects/status/5tk7cwgldmsd5r8n?svg=true)](https://ci.appveyor.com/project/vladimiry/pubsub-to-stream-api)

## Getting started

Related source code is located [here](src/example/readme), can be executed by running `yarn example:start` console command.

Let's first describe API methods and create service instance (shared.ts):
```typescript
// no need to put implementation logic here
// but only API structure definition and service instance creating
// as this stuff is supposed to be shared between provider and client implementations

import {Model, Service} from "pubsub-to-stream-api";

// API structure
export interface Api {
    evaluateMathExpression: Model.Action<string, number>;
    httpPing: Model.Action<Array<{ domain: string }>, Array<{ domain: string, time: number }>>;
}

// channel used to communicate between event emitters
export const CHANNEL = "some-event-name";

// service shared between provider and client
// there is no logic here, but channel and API structure definition only
export const SERVICE = new Service<Api>({channel: CHANNEL});
```

API implementation, ie provider side (provider.ts):
```typescript
import ping from "node-http-ping";
import {evaluate} from "maths.ts";
import {from, of} from "rxjs";
import {map} from "rxjs/operators";

import {Api, SERVICE} from "./shared";
import {EM_CLIENT, EM_PROVIDER} from "./event-emitters-mock";

// API implementation
export const API_IMPL: Api = {
    evaluateMathExpression: (input) => of(Number(String(evaluate(input)))),
    httpPing: (items) => from(
        Promise.all(items.map(({domain}) => ping(domain))),
    ).pipe(
        map((values) => values.map((time, i) => ({time, domain: items[i].domain}))),
    ),
};

SERVICE.register(
    API_IMPL,
    EM_PROVIDER,
    // this/3-rd parameter is optional
    // if not defined, then "EM_PROVIDER" would be used for listening and emitting
    // but normally listening and emitting happens on different instances, so specifying separate emitting instance as 3rd parameter
    {
        requestResolver: (payload) => ({payload, emitter: EM_CLIENT}),
        // in a more real world case you would extract emitter from the payload, Electron.js related example:
        // requestResolver: ({sender}, payload) => ({payload, emitter: {emit: sender.send.bind(sender)}}),
    },
);
```

Now we can call the defined and implemented methods in a type-safe way (client.ts):
```typescript
import {SERVICE} from "./shared";
import {EM_CLIENT, EM_PROVIDER} from "./event-emitters-mock";

const client = SERVICE.caller({
    emitter: EM_PROVIDER,
    listener: EM_CLIENT,
});

client("evaluateMathExpression")("32 * 2").subscribe(console.log);

client("httpPing"/*, {timeoutMs: 600}*/)([
    {domain: "https://google.com"},
    {domain: "google.com"},
    {domain: "https://github.com"},
]).subscribe(console.log);
```

And here is how API methods test structure might look (we leverage combination of `Api` model and TypeScript's `Record` type to make sure that tests for all the methods got defined):
```typescript
import test, {ExecutionContext, ImplementationResult} from "ava";

import {Api} from "./shared";
import {API_IMPL} from "./provider";

const tests: Record<keyof Api, (t: ExecutionContext) => ImplementationResult> = {
    evaluateMathExpression: async (t) => {
        t.is(25, await API_IMPL.evaluateMathExpression("12 * 2 + 1").toPromise());
    },
    httpPing: async (t) => {
        const input = [{domain: "google.com"}];
        const result = await API_IMPL.httpPing(input).toPromise();
        t.is(input.length, result.length);
        t.is(input[0].domain, result[0].domain);
        t.is("number", typeof result[0].time);
    },
};

Object
    .entries(tests)
    .forEach(([apiMethodName, testFn]) => {
        test(`API: ${apiMethodName}`, testFn);
    });
```
