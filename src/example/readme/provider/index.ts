import tcpPing from "tcp-ping";
import {evaluate} from "maths.ts";
import {from, merge} from "rxjs";
import {promisify} from "util";

import {API_SERVICE, Api} from "../shared";
import {EM_CLIENT, EM_PROVIDER} from "../shared/event-emitters-mock";

// API implementation
export const API: Api = {
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
    API,
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
