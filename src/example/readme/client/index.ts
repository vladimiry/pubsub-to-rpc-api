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
