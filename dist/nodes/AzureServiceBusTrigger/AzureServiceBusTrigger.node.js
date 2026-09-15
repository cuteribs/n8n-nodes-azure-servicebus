"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AzureServiceBusTrigger = void 0;
const n8n_workflow_1 = require("n8n-workflow");
const GenericFunctions_1 = require("../GenericFunctions");
class AzureServiceBusTrigger {
    constructor() {
        this.description = {
            displayName: 'Azure Service Bus Trigger',
            name: 'azureServiceBusTrigger',
            icon: 'file:azureServiceBus.svg',
            group: ['trigger'],
            version: 1,
            description: 'Triggers when a message is received from Azure Service Bus',
            defaults: {
                name: 'Azure Service Bus Trigger',
            },
            inputs: [],
            outputs: ['main'],
            credentials: [
                {
                    name: 'azureServiceBusApi',
                    required: true,
                },
            ],
            properties: [
                {
                    displayName: 'Resource',
                    name: 'resource',
                    type: 'options',
                    noDataExpression: true,
                    options: [
                        {
                            name: 'Queue',
                            value: 'queue',
                        },
                        {
                            name: 'Topic Subscription',
                            value: 'subscription',
                        },
                    ],
                    default: 'queue',
                    description: 'The resource to listen to',
                },
                {
                    displayName: 'Max Retry Attempts',
                    name: 'maxRetryAttempts',
                    type: 'number',
                    default: 1000000,
                    description: 'Maximum number of retry attempts for transient errors. Set a very large number to approximate infinite retries. (SDK does not support -1)',
                },
                {
                    displayName: 'Session Mode',
                    name: 'sessionMode',
                    type: 'options',
                    options: [
                        {
                            name: 'No Sessions',
                            value: 'none',
                            description: 'Standard queue/subscription without session support',
                        },
                        {
                            name: 'Accept Any Session',
                            value: 'any',
                            description: 'Accept messages from any available session',
                        },
                        {
                            name: 'Specific Session',
                            value: 'specific',
                            description: 'Only accept messages from a specific session',
                        },
                    ],
                    default: 'none',
                    description: 'How to handle sessions in the trigger',
                },
                {
                    displayName: 'Session ID',
                    name: 'specificSessionId',
                    type: 'string',
                    displayOptions: {
                        show: {
                            sessionMode: ['specific'],
                        },
                    },
                    default: '',
                    placeholder: 'session-123',
                    description: 'Specific session ID to listen for',
                    required: true,
                },
                {
                    displayName: 'Session Timeout (seconds)',
                    name: 'sessionTimeout',
                    type: 'number',
                    displayOptions: {
                        show: {
                            sessionMode: ['any', 'specific'],
                        },
                    },
                    default: 300,
                    description: 'Session lock timeout in seconds',
                },
                {
                    displayName: 'Queue Name',
                    name: 'queueName',
                    type: 'string',
                    displayOptions: {
                        show: {
                            resource: ['queue'],
                        },
                    },
                    default: '',
                    placeholder: 'my-queue',
                    description: 'Name of the queue to listen to',
                    required: true,
                },
                {
                    displayName: 'Topic Name',
                    name: 'topicName',
                    type: 'string',
                    displayOptions: {
                        show: {
                            resource: ['subscription'],
                        },
                    },
                    default: '',
                    placeholder: 'my-topic',
                    description: 'Name of the topic',
                    required: true,
                },
                {
                    displayName: 'Subscription Name',
                    name: 'subscriptionName',
                    type: 'string',
                    displayOptions: {
                        show: {
                            resource: ['subscription'],
                        },
                    },
                    default: '',
                    placeholder: 'my-subscription',
                    description: 'Name of the subscription',
                    required: true,
                },
                {
                    displayName: 'Max Concurrent Calls',
                    name: 'maxConcurrentCalls',
                    type: 'number',
                    default: 1,
                    description: 'Maximum number of concurrent message processing calls',
                },
                {
                    displayName: 'Auto Complete Messages',
                    name: 'autoComplete',
                    type: 'boolean',
                    default: true,
                    description: 'Whether to automatically complete messages after processing',
                },
            ],
            // This is a real-time trigger, not polling-based
        };
    }
    trigger() {
        return __awaiter(this, void 0, void 0, function* () {
            console.log('🚀 Azure Service Bus Trigger started');
            const resource = this.getNodeParameter('resource');
            let maxRetryAttempts = this.getNodeParameter('maxRetryAttempts', 1000000);
            // Azure SDK expects maxRetries >= 0, so convert negative values to a very large number for infinite
            if (typeof maxRetryAttempts !== 'number' || maxRetryAttempts < 0) {
                maxRetryAttempts = 1000000;
            }
            const maxConcurrentCalls = this.getNodeParameter('maxConcurrentCalls', 1);
            const autoComplete = this.getNodeParameter('autoComplete', true);
            const sessionMode = this.getNodeParameter('sessionMode', 'none');
            console.log(`📝 Trigger parameters: resource=${resource}, sessionMode=${sessionMode}, maxConcurrentCalls=${maxConcurrentCalls}`);
            const credentials = yield this.getCredentials('azureServiceBusApi');
            console.log('🔗 Creating ServiceBusClient...');
            const retryOptions = {
                maxRetries: maxRetryAttempts,
                retryDelayInMs: 1000,
                maxRetryDelayInMs: 30000,
            };
            let serviceBusClient;
            try {
                serviceBusClient = (0, GenericFunctions_1.createServiceBusClient)(credentials, { retryOptions });
                console.log('✅ ServiceBusClient created successfully');
            }
            catch (error) {
                throw new n8n_workflow_1.NodeOperationError(this.getNode(), error.message);
            }
            const receivers = [];
            let entityName;
            let sessionReceiverManager = null;
            if (resource === 'queue') {
                const queueName = this.getNodeParameter('queueName');
                entityName = queueName;
                if (sessionMode === 'none') {
                    const receiver = serviceBusClient.createReceiver(queueName);
                    receivers.push(receiver);
                    console.log(`📬 Created standard receiver for queue: ${queueName}`);
                }
                else {
                    console.log(`🔐 Session mode ${sessionMode} enabled for queue: ${queueName}`);
                    sessionReceiverManager = {
                        queueName,
                        sessionMode,
                        serviceBusClient,
                        activeReceivers: new Map(),
                    };
                }
            }
            else {
                const topicName = this.getNodeParameter('topicName');
                const subscriptionName = this.getNodeParameter('subscriptionName');
                entityName = `${topicName}/${subscriptionName}`;
                if (sessionMode === 'none') {
                    const receiver = serviceBusClient.createReceiver(topicName, subscriptionName);
                    receivers.push(receiver);
                    console.log(`📬 Created standard receiver for topic: ${topicName}, subscription: ${subscriptionName}`);
                }
                else {
                    console.log(`🔐 Session mode ${sessionMode} enabled for topic: ${topicName}, subscription: ${subscriptionName}`);
                    sessionReceiverManager = {
                        topicName,
                        subscriptionName,
                        sessionMode,
                        serviceBusClient,
                        activeReceivers: new Map(),
                    };
                }
            }
            const getOrCreateSessionReceiver = () => __awaiter(this, void 0, void 0, function* () {
                if (!sessionReceiverManager) {
                    throw new Error('Session receiver manager not initialized');
                }
                const sessionTimeout = this.getNodeParameter('sessionTimeout', 300);
                let receiver;
                if (sessionMode === 'specific') {
                    const specificSessionId = this.getNodeParameter('specificSessionId');
                    if (sessionReceiverManager.activeReceivers.has(specificSessionId)) {
                        return sessionReceiverManager.activeReceivers.get(specificSessionId);
                    }
                    try {
                        if (resource === 'queue') {
                            receiver = yield sessionReceiverManager.serviceBusClient.acceptSession(sessionReceiverManager.queueName, specificSessionId, { maxAutoLockRenewalDurationInMs: sessionTimeout * 1000 });
                        }
                        else {
                            receiver = yield sessionReceiverManager.serviceBusClient.acceptSession(sessionReceiverManager.topicName, sessionReceiverManager.subscriptionName, specificSessionId, { maxAutoLockRenewalDurationInMs: sessionTimeout * 1000 });
                        }
                        sessionReceiverManager.activeReceivers.set(specificSessionId, receiver);
                        console.log(`✅ Accepted specific session: ${specificSessionId}`);
                        return receiver;
                    }
                    catch (error) {
                        console.error(`❌ Failed to accept specific session ${specificSessionId}:`, error);
                        throw error;
                    }
                }
                else if (sessionMode === 'any') {
                    try {
                        if (resource === 'queue') {
                            receiver = yield sessionReceiverManager.serviceBusClient.acceptNextSession(sessionReceiverManager.queueName, { maxAutoLockRenewalDurationInMs: sessionTimeout * 1000 });
                        }
                        else {
                            receiver = yield sessionReceiverManager.serviceBusClient.acceptNextSession(sessionReceiverManager.topicName, sessionReceiverManager.subscriptionName, { maxAutoLockRenewalDurationInMs: sessionTimeout * 1000 });
                        }
                        const acceptedSessionId = receiver.sessionId;
                        sessionReceiverManager.activeReceivers.set(acceptedSessionId, receiver);
                        console.log(`✅ Accepted next available session: ${acceptedSessionId}`);
                        return receiver;
                    }
                    catch (error) {
                        console.error('❌ No available sessions or failed to accept session:', error);
                        throw error;
                    }
                }
                throw new Error(`Unsupported session mode: ${sessionMode}`);
            });
            const processMessage = (message, currentReceiver) => __awaiter(this, void 0, void 0, function* () {
                var _a;
                console.log(`📨 Received message: ${message.messageId}`);
                let messageBody = message.body;
                if (messageBody && typeof messageBody === 'object' && messageBody.type === 'Buffer') {
                    const buffer = Buffer.from(messageBody.data);
                    messageBody = buffer.toString('utf8');
                    console.log(`🔄 Converted Buffer to string`);
                }
                else if (Buffer.isBuffer(messageBody)) {
                    messageBody = messageBody.toString('utf8');
                    console.log(`🔄 Converted Buffer to string`);
                }
                if (typeof messageBody === 'string' && messageBody.trim().startsWith('{')) {
                    try {
                        messageBody = JSON.parse(messageBody);
                        console.log('📦 Parsed JSON message body');
                    }
                    catch (parseError) {
                        console.log('⚠️ Could not parse as JSON, keeping as string');
                    }
                }
                const nodeExecutionData = {
                    json: {
                        messageId: message.messageId,
                        body: messageBody,
                        contentType: message.contentType,
                        enqueuedTimeUtc: message.enqueuedTimeUtc,
                        applicationProperties: message.applicationProperties || {},
                        deliveryCount: message.deliveryCount,
                        sequenceNumber: (_a = message.sequenceNumber) === null || _a === void 0 ? void 0 : _a.toString(),
                        sessionId: message.sessionId,
                        receivedAt: new Date().toISOString(),
                        entityName,
                        resource,
                        sessionMode,
                    },
                };
                if (sessionMode !== 'none' && currentReceiver && 'sessionId' in currentReceiver) {
                    try {
                        const sessionState = yield currentReceiver.getSessionState();
                        nodeExecutionData.json.sessionInfo = {
                            sessionId: currentReceiver.sessionId,
                            sessionState,
                            isSessionMessage: true,
                        };
                    }
                    catch (stateError) {
                        console.log(`⚠️ Could not retrieve session state: ${stateError}`);
                        nodeExecutionData.json.sessionInfo = {
                            sessionId: currentReceiver.sessionId,
                            sessionState: null,
                            isSessionMessage: true,
                        };
                    }
                }
                this.emit([[nodeExecutionData]]);
                console.log(`✅ Message ${message.messageId} processed and emitted to workflow`);
            });
            const processError = (args) => __awaiter(this, void 0, void 0, function* () {
                console.error(`❌ Error occurred with ${args.entityPath}: `, args.error);
                if (sessionMode !== 'none' && sessionReceiverManager) {
                    console.log('🔄 Session error detected, attempting to recreate receivers...');
                    for (const [sessionId, receiver] of sessionReceiverManager.activeReceivers) {
                        try {
                            yield receiver.close();
                        }
                        catch (closeError) {
                            console.log(`⚠️ Error closing receiver for session ${sessionId}:`, closeError);
                        }
                    }
                    sessionReceiverManager.activeReceivers.clear();
                }
            });
            console.log(`🔔 Starting message subscription with ${maxConcurrentCalls} max concurrent calls...`);
            if (sessionMode === 'none') {
                for (const receiver of receivers) {
                    receiver.subscribe({
                        processMessage: (message) => processMessage(message, receiver),
                        processError,
                    }, {
                        autoCompleteMessages: autoComplete,
                        maxConcurrentCalls,
                    });
                }
            }
            else {
                const startSessionHandling = () => __awaiter(this, void 0, void 0, function* () {
                    while (true) {
                        try {
                            const sessionReceiver = yield getOrCreateSessionReceiver();
                            sessionReceiver.subscribe({
                                processMessage: (message) => processMessage(message, sessionReceiver),
                                processError: (args) => __awaiter(this, void 0, void 0, function* () {
                                    yield processError(args);
                                    for (const [sessionId, receiver] of sessionReceiverManager.activeReceivers) {
                                        if (receiver === sessionReceiver) {
                                            sessionReceiverManager.activeReceivers.delete(sessionId);
                                            break;
                                        }
                                    }
                                }),
                            }, {
                                autoCompleteMessages: autoComplete,
                                maxConcurrentCalls,
                            });
                            if (sessionMode === 'specific') {
                                break;
                            }
                            yield new Promise(resolve => setTimeout(resolve, 1000));
                        }
                        catch (sessionError) {
                            console.error('❌ Error in session handling:', sessionError);
                            yield new Promise(resolve => setTimeout(resolve, 5000));
                        }
                    }
                });
                startSessionHandling().catch(error => {
                    console.error('❌ Fatal error in session handling:', error);
                });
            }
            console.log(`✅ Azure Service Bus trigger is now listening on ${entityName} with session mode: ${sessionMode}`);
            const closeFunction = () => __awaiter(this, void 0, void 0, function* () {
                console.log('🔒 Closing Azure Service Bus trigger...');
                try {
                    for (const receiver of receivers) {
                        yield receiver.close();
                    }
                    if (sessionReceiverManager) {
                        for (const [sessionId, receiver] of sessionReceiverManager.activeReceivers) {
                            try {
                                console.log(`🔒 Closing session receiver for: ${sessionId}`);
                                yield receiver.close();
                            }
                            catch (closeError) {
                                console.log(`⚠️ Error closing session receiver ${sessionId}:`, closeError);
                            }
                        }
                        sessionReceiverManager.activeReceivers.clear();
                    }
                    yield serviceBusClient.close();
                    console.log('✅ Azure Service Bus trigger closed successfully');
                }
                catch (error) {
                    console.error('❌ Error closing Azure Service Bus trigger:', error);
                }
            });
            return {
                closeFunction,
            };
        });
    }
}
exports.AzureServiceBusTrigger = AzureServiceBusTrigger;
