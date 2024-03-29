import {bufferCount} from "rxjs/operators";
import {lastValueFrom} from "rxjs";
import test, {ExecutionContext} from "ava";

import {API_IMPLEMENTATION} from "./";

const apiActionTests: Record<keyof typeof API_IMPLEMENTATION, (t: ExecutionContext) => void> = {
    evaluateMathExpression: async (t) => {
        t.is(25, await API_IMPLEMENTATION.evaluateMathExpression("12 * 2 + 1"));
    },
    httpPing: async (t) => {
        const entries = [
            {address: "google.com", attempts: 1},
            {address: "github.com"},
            {address: "1.1.1.1"},
        ];

        const results = await lastValueFrom(
            API_IMPLEMENTATION
                .httpPing(entries)
                .pipe(bufferCount(entries.length)),
        );

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
