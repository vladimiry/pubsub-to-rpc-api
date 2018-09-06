import sinon from "sinon";
import uuid from "uuid-browser";
import {delay, map, take} from "rxjs/operators";
import {EMPTY, interval, merge, of, throwError} from "rxjs";
import {EventEmitter} from "eventemitter3";
import test from "ava";

import {Model, Service} from "../dist/index";

// TODO test a whole emitter|listener.on|off|emit cycle of provider and client
// TODO test multiple registered api sets on the single service

test("calling 2 methods", async (t) => {
    interface Api {
        method1: Model.Action<{ input1: string }, { output1: number }>;
        method2: Model.Action<number, { output2: number }>;
    }

    const channel = randomStr();
    const service = new Service<Api>({channel});
    const providerEmitters = {emitter: new EventEmitter(), listener: new EventEmitter()};
    const clientEmitters = {emitter: providerEmitters.listener, listener: providerEmitters.emitter};
    const method1Input = {input1: randomStr()};
    const method1Expected = {output1: Number(method1Input.input1)};
    const method2Input = 123;
    const method2ExpectedItems = [0, 1, 2].map((i) => ({output2: method2Input * i}));
    const clientEmitterSpy = sinon.spy(clientEmitters.emitter, "emit");
    const providerEmitterSpy = sinon.spy(providerEmitters.emitter, "emit");
    const client = service.caller(clientEmitters);

    service.register(
        {
            method1: (val) => of(method1Expected),
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

    await merge(
        client("method1")(method1Input),
        client("method2")(method2Input),
    ).toPromise();

    t.true(clientEmitterSpy.calledWithExactly(
        channel,
        sinon.match((request: Model.RequestPayload<keyof Api>) => {
            const uid = Boolean(request.uid.length);
            const type = request.type === "request";
            const name = request.name === "method1" || request.name === "method2";
            const data = request.name === "method1" ? request.data === method1Input
                : request.name === "method2" ? request.data === method2Input
                    : false;

            return uid && type && name && data;
        }, "request"),
    ));

    t.true(providerEmitterSpy.calledWithExactly(
        channel,
        sinon.match((response: Model.ResponsePayload<keyof Api, Model.AnyType>) => {
            const uid = Boolean(response.uid.length);
            const type = response.type === "response";
            const data = "data" in response && (response.data === method1Expected || response.data === method2ExpectedItems);

            return uid && type && data;
        }, "request"),
    ));
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

    await t.throwsAsync(service.call(
        "method",
        {timeoutMs: 500},
        {emitter, listener: emitter},
    )("w-456").toPromise(), `"w-456" can't be parsed to number`);
});

test("timeout error", async (t) => {
    const channel = randomStr();
    const service = new Service<{ numberToString: Model.Action<number, string> }>({channel});
    const emitter = new EventEmitter();
    const inputValue = 123;
    const method = "numberToString";
    const client = service.caller({emitter, listener: emitter}, {timeoutMs: 500});

    service.register({numberToString: (input) => of(String(input)).pipe(delay(1000))}, emitter);

    await t.throwsAsync(
        client(method)(inputValue).toPromise(),
        `Invocation timeout of "${method}" method on "${channel}" channel`,
    );

    t.is(String(inputValue), await client(method, {timeoutMs: 1500})(inputValue).toPromise());
});

test("calling method without input an argument", async (t) => {
    interface Api {
        ping: Model.ActionWithoutInput<never>;
    }

    const channel = randomStr();
    const service = new Service<Api>({channel});
    const em = new EventEmitter();
    const emitSpy = sinon.spy(em, "emit");

    service.register({ping: () => EMPTY}, em);
    await service.call("ping", {timeoutMs: 500}, {listener: em, emitter: em})().toPromise();

    t.true(emitSpy.calledWithExactly(
        channel,
        sinon.match((request: Model.RequestPayload<keyof Api>) => !("data" in request), "dataLessRequest"),
    ));
});

function randomStr(): string {
    return uuid.v4();
}
