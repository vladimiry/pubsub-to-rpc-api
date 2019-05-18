import * as M from "../model";
import * as PM from "../private/model";
import {buildClientMethods} from "./client";
import {buildProviderMethods} from "./provider";
import {curryLogger} from "../private/util";

export function createService<AD extends M.ApiDefinition<AD>, ACA extends PM.DefACA | void = void>(
    {
        channel,
        apiDefinition,
        callTimeoutMs = PM.ONE_SECOND_MS * 3,
        logger: _logger_ = PM.LOG_STUB, // tslint:disable-line:variable-name
    }: M.CreateServiceInput<AD>,
): M.CreateServiceReturn<AD, ACA> {
    const logger: PM.InternalLogger = curryLogger(_logger_);

    logger.info("createService()");

    const serviceOptions: M.CreateServiceOptions<AD> = {channel, apiDefinition, callTimeoutMs, logger};
    const providerMethods = buildProviderMethods<AD, ACA>(serviceOptions);
    const clientMethods = buildClientMethods<AD, ACA>(serviceOptions);

    return {
        ...providerMethods,
        ...clientMethods,
    };
}
