import {
	IDataObject,
	INodeType,
	INodeTypeDescription,
	ITriggerFunctions,
	ITriggerResponse,
	INodeExecutionData,
	NodeOperationError,
} from 'n8n-workflow';
import {
	ServiceBusClient,
	ServiceBusReceivedMessage,
	ServiceBusReceiver,
	ServiceBusSessionReceiver,
	ProcessErrorArgs,
} from '@azure/service-bus';
import { createServiceBusClient } from '../GenericFunctions';

interface SessionReceiverManager {
	queueName?: string;
	topicName?: string;
	subscriptionName?: string;
	sessionMode: string;
	serviceBusClient: ServiceBusClient;
	activeReceivers: Map<string, ServiceBusSessionReceiver>;
}

export class AzureServiceBusTrigger implements INodeType {
	description: INodeTypeDescription = {
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

	async trigger(this: ITriggerFunctions): Promise<ITriggerResponse> {
		console.log('🚀 Azure Service Bus Trigger started');

		const resource = this.getNodeParameter('resource') as string;
		let maxRetryAttempts = this.getNodeParameter('maxRetryAttempts', 1000000) as number;
		// Azure SDK expects maxRetries >= 0, so convert negative values to a very large number for infinite
		if (typeof maxRetryAttempts !== 'number' || maxRetryAttempts < 0) {
			maxRetryAttempts = 1000000;
		}
		const maxConcurrentCalls = this.getNodeParameter('maxConcurrentCalls', 1) as number;
		const autoComplete = this.getNodeParameter('autoComplete', true) as boolean;
		const sessionMode = this.getNodeParameter('sessionMode', 'none') as string;

		console.log(`📝 Trigger parameters: resource=${resource}, sessionMode=${sessionMode}, maxConcurrentCalls=${maxConcurrentCalls}`);

		const credentials = await this.getCredentials('azureServiceBusApi');

		console.log('🔗 Creating ServiceBusClient...');

		const retryOptions = {
			maxRetries: maxRetryAttempts,
			retryDelayInMs: 1000,
			maxRetryDelayInMs: 30000,
		};

		let serviceBusClient: ServiceBusClient;
		try {
			serviceBusClient = createServiceBusClient(credentials, { retryOptions });
			console.log('✅ ServiceBusClient created successfully');
		} catch (error) {
			throw new NodeOperationError(this.getNode(), (error as Error).message);
		}

		const receivers: ServiceBusReceiver[] = [];
		let entityName: string;
		let sessionReceiverManager: SessionReceiverManager | null = null;

		if (resource === 'queue') {
			const queueName = this.getNodeParameter('queueName') as string;
			entityName = queueName;

			if (sessionMode === 'none') {
				const receiver = serviceBusClient.createReceiver(queueName);
				receivers.push(receiver);
				console.log(`📬 Created standard receiver for queue: ${queueName}`);
			} else {
				console.log(`🔐 Session mode ${sessionMode} enabled for queue: ${queueName}`);
				sessionReceiverManager = {
					queueName,
					sessionMode,
					serviceBusClient,
					activeReceivers: new Map(),
				};
			}
		} else {
			const topicName = this.getNodeParameter('topicName') as string;
			const subscriptionName = this.getNodeParameter('subscriptionName') as string;
			entityName = `${topicName}/${subscriptionName}`;

			if (sessionMode === 'none') {
				const receiver = serviceBusClient.createReceiver(topicName, subscriptionName);
				receivers.push(receiver);
				console.log(`📬 Created standard receiver for topic: ${topicName}, subscription: ${subscriptionName}`);
			} else {
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

		const getOrCreateSessionReceiver = async (): Promise<ServiceBusSessionReceiver> => {
			if (!sessionReceiverManager) {
				throw new Error('Session receiver manager not initialized');
			}

			const sessionTimeout = this.getNodeParameter('sessionTimeout', 300) as number;
			let receiver: ServiceBusSessionReceiver;

			if (sessionMode === 'specific') {
				const specificSessionId = this.getNodeParameter('specificSessionId') as string;

				if (sessionReceiverManager.activeReceivers.has(specificSessionId)) {
					return sessionReceiverManager.activeReceivers.get(specificSessionId)!;
				}

				try {
					if (resource === 'queue') {
						receiver = await sessionReceiverManager.serviceBusClient.acceptSession(
							sessionReceiverManager.queueName!,
							specificSessionId,
							{ maxAutoLockRenewalDurationInMs: sessionTimeout * 1000 }
						);
					} else {
						receiver = await sessionReceiverManager.serviceBusClient.acceptSession(
							sessionReceiverManager.topicName!,
							sessionReceiverManager.subscriptionName!,
							specificSessionId,
							{ maxAutoLockRenewalDurationInMs: sessionTimeout * 1000 }
						);
					}
					sessionReceiverManager.activeReceivers.set(specificSessionId, receiver);
					console.log(`✅ Accepted specific session: ${specificSessionId}`);
					return receiver;
				} catch (error) {
					console.error(`❌ Failed to accept specific session ${specificSessionId}:`, error);
					throw error;
				}
			} else if (sessionMode === 'any') {
				try {
					if (resource === 'queue') {
						receiver = await sessionReceiverManager.serviceBusClient.acceptNextSession(
							sessionReceiverManager.queueName!,
							{ maxAutoLockRenewalDurationInMs: sessionTimeout * 1000 }
						);
					} else {
						receiver = await sessionReceiverManager.serviceBusClient.acceptNextSession(
							sessionReceiverManager.topicName!,
							sessionReceiverManager.subscriptionName!,
							{ maxAutoLockRenewalDurationInMs: sessionTimeout * 1000 }
						);
					}
					const acceptedSessionId = receiver.sessionId;
					sessionReceiverManager.activeReceivers.set(acceptedSessionId, receiver);
					console.log(`✅ Accepted next available session: ${acceptedSessionId}`);
					return receiver;
				} catch (error) {
					console.error('❌ No available sessions or failed to accept session:', error);
					throw error;
				}
			}

			throw new Error(`Unsupported session mode: ${sessionMode}`);
		};

		const processMessage = async (message: ServiceBusReceivedMessage, currentReceiver: ServiceBusReceiver | ServiceBusSessionReceiver): Promise<void> => {
			console.log(`📨 Received message: ${message.messageId}`);

			let messageBody: unknown = message.body;

			if (messageBody && typeof messageBody === 'object' && (messageBody as any).type === 'Buffer') {
				const buffer = Buffer.from((messageBody as any).data);
				messageBody = buffer.toString('utf8');
				console.log(`🔄 Converted Buffer to string`);
			} else if (Buffer.isBuffer(messageBody)) {
				messageBody = messageBody.toString('utf8');
				console.log(`🔄 Converted Buffer to string`);
			}

			if (typeof messageBody === 'string' && messageBody.trim().startsWith('{')) {
				try {
					messageBody = JSON.parse(messageBody);
					console.log('📦 Parsed JSON message body');
				} catch (parseError) {
					console.log('⚠️ Could not parse as JSON, keeping as string');
				}
			}

		const nodeExecutionData: INodeExecutionData = {
				json: {
					messageId: message.messageId,
					body: messageBody as IDataObject | string | number | boolean,
					contentType: message.contentType,
					enqueuedTimeUtc: message.enqueuedTimeUtc,
					applicationProperties: message.applicationProperties || {},
					deliveryCount: message.deliveryCount,
					sequenceNumber: message.sequenceNumber?.toString(),
					sessionId: message.sessionId,
					receivedAt: new Date().toISOString(),
					entityName,
					resource,
					sessionMode,
				},
			};

			if (sessionMode !== 'none' && currentReceiver && 'sessionId' in currentReceiver) {
				try {
					const sessionState = await (currentReceiver as ServiceBusSessionReceiver).getSessionState();
					(nodeExecutionData.json as Record<string, unknown>).sessionInfo = {
						sessionId: (currentReceiver as ServiceBusSessionReceiver).sessionId,
						sessionState,
						isSessionMessage: true,
					};
				} catch (stateError) {
					console.log(`⚠️ Could not retrieve session state: ${stateError}`);
					(nodeExecutionData.json as Record<string, unknown>).sessionInfo = {
						sessionId: (currentReceiver as ServiceBusSessionReceiver).sessionId,
						sessionState: null,
						isSessionMessage: true,
					};
				}
			}

			this.emit([[nodeExecutionData]]);
			console.log(`✅ Message ${message.messageId} processed and emitted to workflow`);
		};

		const processError = async (args: ProcessErrorArgs): Promise<void> => {
			console.error(`❌ Error occurred with ${args.entityPath}: `, args.error);

			if (sessionMode !== 'none' && sessionReceiverManager) {
				console.log('🔄 Session error detected, attempting to recreate receivers...');

				for (const [sessionId, receiver] of sessionReceiverManager.activeReceivers) {
					try {
						await receiver.close();
					} catch (closeError) {
						console.log(`⚠️ Error closing receiver for session ${sessionId}:`, closeError);
					}
				}
				sessionReceiverManager.activeReceivers.clear();
			}
		};

		console.log(`🔔 Starting message subscription with ${maxConcurrentCalls} max concurrent calls...`);

		if (sessionMode === 'none') {
			for (const receiver of receivers) {
				receiver.subscribe(
					{
						processMessage: (message) => processMessage(message, receiver),
						processError,
					},
					{
						autoCompleteMessages: autoComplete,
						maxConcurrentCalls,
					}
				);
			}
		} else {
			const startSessionHandling = async (): Promise<void> => {
				while (true) {
					try {
						const sessionReceiver = await getOrCreateSessionReceiver();

						sessionReceiver.subscribe(
							{
								processMessage: (message) => processMessage(message, sessionReceiver),
								processError: async (args) => {
									await processError(args);
									for (const [sessionId, receiver] of sessionReceiverManager!.activeReceivers) {
										if (receiver === sessionReceiver) {
											sessionReceiverManager!.activeReceivers.delete(sessionId);
											break;
										}
									}
								},
							},
							{
								autoCompleteMessages: autoComplete,
								maxConcurrentCalls,
							}
						);

						if (sessionMode === 'specific') {
							break;
						}

						await new Promise(resolve => setTimeout(resolve, 1000));
					} catch (sessionError) {
						console.error('❌ Error in session handling:', sessionError);
						await new Promise(resolve => setTimeout(resolve, 5000));
					}
				}
			};

			startSessionHandling().catch(error => {
				console.error('❌ Fatal error in session handling:', error);
			});
		}

		console.log(`✅ Azure Service Bus trigger is now listening on ${entityName} with session mode: ${sessionMode}`);

		const closeFunction = async (): Promise<void> => {
			console.log('🔒 Closing Azure Service Bus trigger...');
			try {
				for (const receiver of receivers) {
					await receiver.close();
				}

				if (sessionReceiverManager) {
					for (const [sessionId, receiver] of sessionReceiverManager.activeReceivers) {
						try {
							console.log(`🔒 Closing session receiver for: ${sessionId}`);
							await receiver.close();
						} catch (closeError) {
							console.log(`⚠️ Error closing session receiver ${sessionId}:`, closeError);
						}
					}
					sessionReceiverManager.activeReceivers.clear();
				}

				await serviceBusClient.close();
				console.log('✅ Azure Service Bus trigger closed successfully');
			} catch (error) {
				console.error('❌ Error closing Azure Service Bus trigger:', error);
			}
		};

		return {
			closeFunction,
		};
	}
}
