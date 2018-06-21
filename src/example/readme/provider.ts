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
