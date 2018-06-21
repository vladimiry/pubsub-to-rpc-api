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
