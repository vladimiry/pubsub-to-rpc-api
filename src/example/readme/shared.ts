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
