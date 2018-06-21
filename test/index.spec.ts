import {delay, map, take} from "rxjs/operators";
import {EventEmitter} from "eventemitter3";
import {interval, merge, of, throwError} from "rxjs";
import {test} from "ava";

import {Model, Service} from "../dist/index";

test.cb("base", (t) => {
    t.plan(3);

    const service = new Service<{
        method1: Model.Action<{ input1: string }, { output1: number }>;
        method2: Model.Action<number, { output2: number }>;
    }>({channel: "channel-123"});
    const providerEmitters = {emitter: new EventEmitter(), listener: new EventEmitter()};
    const emitters = {emitter: providerEmitters.listener, listener: providerEmitters.emitter};
    const method1Input = {input1: "345"};
    const method1Expected = {output1: Number(method1Input.input1)};
    const method2Input = 123;
    const method2ExpectedItems = [0, 1, 2].map((i) => ({output2: method2Input * i}));
    const method2ActualItems: Array<{ output2: number }> = [];
    const client = service.caller(emitters);

    service.register(
        {
            method1: ({input1: val}) => of({output1: Number(val)}),
            method2: (val) => interval(150).pipe(
                take(3),
                map((v) => ({output2: val * v})),
            ),
        },
        providerEmitters.listener,
        {
            requestResolver: (payload) => ({payload, emitter: providerEmitters.emitter}),
        },
    );

    merge(
        client("method1")(method1Input),
        client("method2")(method2Input),
    ).subscribe(
        (value) => {
            if ("output1" in value) {
                t.deepEqual(value, method1Expected);
            } else {
                method2ActualItems.push(value);
                if (method2ActualItems.length >= method2ExpectedItems.length) {
                    t.deepEqual(method2ExpectedItems, method2ActualItems);
                }
            }
        },
        () => {
            // NOOP
        },
        () => {
            t.pass("complete");
            t.end();
        },
    );
});

test("unregister", (t) => {
    t.plan(8);

    const channel = "channel-4546";
    const service = new Service<{
        numberToString: Model.Action<number, string>;
        stringToNumber: Model.Action<string, number>;
    }>({channel});
    const emitter = new EventEmitter();
    const client = service.caller({emitter, listener: emitter});
    const multipliers = [1, 2, 3];
    let unregisterCalled = 0;

    t.falsy(service.unregister);

    multipliers.map((i) => {
        if (service.unregister) {
            service.unregister = ((unregister) => () => {
                unregisterCalled++;
                return unregister();
            })(service.unregister);
        }

        return service.register(
            {
                numberToString: (input) => of(String(input * i)),
                stringToNumber: (input) => of(Number(input) * i),
            },
            emitter,
        );
    });

    t.is(2, unregisterCalled);
    t.is(emitter.listenerCount(channel), 1);

    const call = () => {
        client("numberToString")(123).subscribe((result) => {
            t.is(String(123 * multipliers[multipliers.length - 1]), result);
        });
        client("stringToNumber")("234").subscribe((result) => {
            t.is(234 * multipliers[multipliers.length - 1], result);
        });
    };

    call();
    call();

    if (service.unregister) {
        service.unregister();
        t.falsy(service.unregister);
    }

    call();
});

test("backend error", async (t) => {
    const service = new Service<{ method: Model.Action<string, number> }>({channel: "channel-345"});
    const emitter = new EventEmitter();

    service.register(
        {
            method: (input) => isNaN(Number(input)) ? throwError(new Error(`"${input}" can't be parsed to number`)) : of(Number(input)),
        },
        emitter,
    );

    await t.throws(service.call("method", {}, {emitter, listener: emitter})("w-456").toPromise(), `"w-456" can't be parsed to number`);
});

test("timeout error", async (t) => {
    const channel = "channel-4546";
    const service = new Service<{ numberToString: Model.Action<number, string> }>({channel});
    const emitter = new EventEmitter();
    const inputValue = 123;
    const method = "numberToString";
    const client = service.caller({emitter, listener: emitter}, {timeoutMs: 500});

    service.register(
        {
            numberToString: (input) => of(String(input)).pipe(delay(1000)),
        },
        emitter,
    );

    await t.throws(
        client(method)(inputValue).toPromise(),
        `Invocation timeout of "${method}" method on "${channel}" channel`,
    );

    t.is(String(inputValue), await client(method, {timeoutMs: 1500})(inputValue).toPromise());
});
