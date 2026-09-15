import {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	NodeOperationError,
} from 'n8n-workflow';
import { ServiceBusClient, ServiceBusMessage } from '@azure/service-bus';
import fetch from 'node-fetch';
import { createServiceBusClient } from '../GenericFunctions';

interface ConnectionDetails {
	hostname: string;
	username: string;
	password: string;
	entityPath?: string;
}

interface MessageWithSession extends ServiceBusMessage {
	sessionId?: string;
	applicationProperties?: Record<string, string | number | boolean>;
}

function isEmptyMessageBody(messageBody: unknown): boolean {
	if (messageBody === null || messageBody === undefined) {
		return true;
	}
	if (typeof messageBody === 'string') {
		return messageBody.trim() === '';
	}
	if (typeof messageBody === 'number' || typeof messageBody === 'boolean') {
		return false;
	}
	if (typeof messageBody === 'object') {
		return false;
	}
	return true;
}

function parseConnectionString(connectionString: string): ConnectionDetails {
	console.log('🔧 Parsing connection string for HTTP REST API...');
	const parts = connectionString.split(';');
	const parsed: Record<string, string> = {};

	for (const part of parts) {
		const [key, value] = part.split('=', 2);
		if (key && value) {
			parsed[key.toLowerCase()] = value;
		}
	}

	console.log('🔧 Parsed connection parts:', Object.keys(parsed));

	const endpoint = parsed.endpoint;
	if (!endpoint) {
		throw new Error('Missing Endpoint in connection string');
	}

	const hostname = endpoint.replace('sb://', '').replace('/', '');
	const result: ConnectionDetails = {
		hostname,
		username: parsed.sharedaccesskeyname || '',
		password: parsed.sharedaccesskey || '',
		entityPath: parsed.entitypath
	};

	console.log('🔧 Connection details for HTTP:', {
		hostname: result.hostname,
		hasUsername: !!result.username,
		hasPassword: !!result.password,
		entityPath: result.entityPath
	});

	return result;
}

function createSasToken(uri: string, keyName: string, key: string): string {
	const encoded = encodeURIComponent(uri);
	const now = new Date();
	const ttl = Math.floor(now.getTime() / 1000) + 3600;
	const signature = encoded + '\n' + ttl;

	console.log('🔐 Creating SAS token for:', { uri, keyName, ttl });
	console.log('🔐 Signature string:', signature);

	const crypto = require('crypto');
	const hmac = crypto.createHmac('sha256', key);
	hmac.update(signature, 'utf8');
	const hash = hmac.digest('base64');
	const encodedSignature = encodeURIComponent(hash);

	const token = `SharedAccessSignature sr=${encoded}&sig=${encodedSignature}&se=${ttl}&skn=${keyName}`;
	console.log('🔐 SAS token created successfully');
	return token;
}

async function sendMessageViaHTTP(connectionDetails: ConnectionDetails, queueName: string, message: MessageWithSession): Promise<void> {
	console.log('🌍 Starting HTTP REST API approach...');

	const url = `https://${connectionDetails.hostname}/${queueName}/messages?timeout=60`;
	console.log('🌍 HTTP URL:', url);

	const sasToken = createSasToken(
		`https://${connectionDetails.hostname}/${queueName}`,
		connectionDetails.username,
		connectionDetails.password
	);

	const messageBody = typeof message.body === 'string' ? message.body : JSON.stringify(message.body);

	const headers: Record<string, string> = {
		'Authorization': sasToken,
		'Content-Type': message.contentType || 'application/atom+xml;type=entry;charset=utf-8',
	};

	const brokerProperties: Record<string, string> = {};
	if (message.messageId) {
		brokerProperties.MessageId = String(message.messageId);
	}
	if (message.sessionId) {
		brokerProperties.SessionId = message.sessionId;
		console.log(`🔐 HTTP: Added session ID: ${message.sessionId}`);
	}

	if (Object.keys(brokerProperties).length > 0) {
		headers['BrokerProperties'] = JSON.stringify(brokerProperties);
	}

	if (message.applicationProperties) {
		for (const [key, value] of Object.entries(message.applicationProperties)) {
			headers[key] = String(value);
		}
	}

	console.log('🌍 Request headers (auth hidden):', {
		...headers,
		Authorization: 'SharedAccessSignature sr=***'
	});
	console.log('🌍 Message body length:', messageBody.length);
	console.log('🌍 Sending HTTP POST request...');

	const response = await fetch(url, {
		method: 'POST',
		headers,
		body: messageBody,
	});

	console.log('🌍 HTTP Response status:', response.status, response.statusText);

	if (!response.ok) {
		const errorText = await response.text();
		console.error('❌ HTTP Error response:', errorText);
		throw new Error(`HTTP ${response.status}: ${errorText}`);
	}

	console.log('✅ Message sent via HTTP REST API!');
}

export class AzureServiceBus implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Azure Service Bus',
		name: 'azureServiceBus',
		icon: 'file:azureServiceBus.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Send and receive messages from Azure Service Bus',
		defaults: {
			name: 'Azure Service Bus',
		},
		inputs: ['main'],
		outputs: ['main'],
		credentials: [
			{
				name: 'azureServiceBusApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Protocol',
				name: 'protocol',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Azure SDK (Recommended)',
						value: 'sdk',
						description: 'Use official @azure/service-bus SDK',
					},
					{
						name: 'HTTP REST API',
						value: 'http',
						description: 'Use Azure Service Bus REST API (firewall-friendly)',
					},
				],
				default: 'sdk',
				description: 'Protocol to use for Azure Service Bus connection',
			},
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
						name: 'Topic',
						value: 'topic',
					},
				],
				default: 'queue',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['queue'],
					},
				},
				options: [
					{
						name: 'Send Message',
						value: 'sendMessage',
						description: 'Send a message to a queue',
						action: 'Send a message to a queue',
					},
					{
						name: 'Receive Messages',
						value: 'receiveMessages',
						description: 'Receive messages from a queue',
						action: 'Receive messages from a queue',
					},
				],
				default: 'sendMessage',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['topic'],
					},
				},
				options: [
					{
						name: 'Send Message',
						value: 'sendMessage',
						description: 'Send a message to a topic',
						action: 'Send a message to a topic',
					},
				],
				default: 'sendMessage',
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
				description: 'Name of the queue',
			},
			{
				displayName: 'Topic Name',
				name: 'topicName',
				type: 'string',
				displayOptions: {
					show: {
						resource: ['topic'],
					},
				},
				default: '',
				placeholder: 'my-topic',
				description: 'Name of the topic',
			},
			{
				displayName: 'Message Body',
				name: 'messageBody',
				type: 'json',
				typeOptions: {
					rows: 4,
				},
				displayOptions: {
					show: {
						operation: ['sendMessage'],
					},
				},
				default: '',
				description: 'The message body to send. Can be a string, number, boolean, or JSON object/array.',
			},
			{
				displayName: 'Session ID',
				name: 'sessionId',
				type: 'string',
				displayOptions: {
					show: {
						operation: ['sendMessage'],
					},
				},
				default: '',
				description: 'Session identifier for session-enabled queues/topics (optional)',
			},
			{
				displayName: 'Message Properties',
				name: 'messageProperties',
				placeholder: 'Add Property',
				type: 'fixedCollection',
				typeOptions: {
					multipleValues: true,
				},
				displayOptions: {
					show: {
						operation: ['sendMessage'],
					},
				},
				default: {},
				options: [
					{
						name: 'property',
						displayName: 'Property',
						values: [
							{
								displayName: 'Key',
								name: 'key',
								type: 'string',
								default: '',
								description: 'Property key',
							},
							{
								displayName: 'Value',
								name: 'value',
								type: 'string',
								default: '',
								description: 'Property value',
							},
						],
					},
				],
			},
			{
				displayName: 'Content Type',
				name: 'contentType',
				type: 'string',
				displayOptions: {
					show: {
						operation: ['sendMessage'],
					},
				},
				default: 'application/json',
				description: 'Content type of the message',
			},
			{
				displayName: 'Message ID',
				name: 'messageId',
				type: 'string',
				displayOptions: {
					show: {
						operation: ['sendMessage'],
					},
				},
				default: '',
				description: 'Unique identifier for the message',
			},
			{
				displayName: 'Session Mode',
				name: 'sessionMode',
				type: 'options',
				displayOptions: {
					show: {
						operation: ['receiveMessages'],
						protocol: ['sdk'],
					},
				},
				options: [
					{
						name: 'No Sessions',
						value: 'none',
						description: 'Standard queue without session support',
					},
					{
						name: 'Specific Session',
						value: 'specific',
						description: 'Receive messages from a specific session',
					},
					{
						name: 'Next Available Session',
						value: 'next',
						description: 'Accept the next available session',
					},
				],
				default: 'none',
				description: 'How to handle sessions when receiving messages',
			},
			{
				displayName: 'Session ID',
				name: 'receiveSessionId',
				type: 'string',
				displayOptions: {
					show: {
						operation: ['receiveMessages'],
						sessionMode: ['specific'],
					},
				},
				default: '',
				placeholder: 'session-123',
				description: 'Specific session ID to receive messages from',
				required: true,
			},
			{
				displayName: 'Session Timeout (seconds)',
				name: 'sessionTimeout',
				type: 'number',
				displayOptions: {
					show: {
						operation: ['receiveMessages'],
						sessionMode: ['specific', 'next'],
					},
				},
				default: 60,
				description: 'Maximum time to wait when accepting a session',
			},
			{
				displayName: 'Manage Session State',
				name: 'manageSessionState',
				type: 'boolean',
				displayOptions: {
					show: {
						operation: ['receiveMessages'],
						sessionMode: ['specific', 'next'],
					},
				},
				default: false,
				description: 'Whether to retrieve and update session state',
			},
			{
				displayName: 'New Session State',
				name: 'newSessionState',
				type: 'string',
				typeOptions: {
					rows: 2,
				},
				displayOptions: {
					show: {
						operation: ['receiveMessages'],
						sessionMode: ['specific', 'next'],
						manageSessionState: [true],
					},
				},
				default: '',
				placeholder: '{"status": "processed", "timestamp": "2024-01-01T00:00:00Z"}',
				description: 'JSON object to set as new session state (leave empty to not update)',
			},
			{
				displayName: 'Max Message Count',
				name: 'maxMessageCount',
				type: 'number',
				displayOptions: {
					show: {
						operation: ['receiveMessages'],
					},
				},
				default: 10,
				description: 'Maximum number of messages to receive',
			},
			{
				displayName: 'Max Wait Time (seconds)',
				name: 'maxWaitTimeInSeconds',
				type: 'number',
				displayOptions: {
					show: {
						operation: ['receiveMessages'],
					},
				},
				default: 60,
				description: 'Maximum time to wait for messages',
			},
			{
				displayName: 'Receive Mode',
				name: 'receiveMode',
				type: 'options',
				displayOptions: {
					show: {
						operation: ['receiveMessages'],
					},
				},
				options: [
					{
						name: 'Peek Lock',
						value: 'peekLock',
						description: 'Message is locked and must be completed or abandoned',
					},
					{
						name: 'Receive and Delete',
						value: 'receiveAndDelete',
						description: 'Message is automatically deleted after receiving',
					},
				],
				default: 'peekLock',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		console.log('🚀 AzureServiceBus execute started');
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		const resource = this.getNodeParameter('resource', 0) as string;
		const operation = this.getNodeParameter('operation', 0) as string;
		const protocol = this.getNodeParameter('protocol', 0, 'sdk') as string;

		console.log(`📝 Parameters: resource=${resource}, operation=${operation}, protocol=${protocol}`);

		console.log('🔑 Getting credentials...');
		const credentials = await this.getCredentials('azureServiceBusApi');

		let serviceBusClient: ServiceBusClient | null = null;
		let httpConnectionDetails: ConnectionDetails | null = null;

		if (protocol === 'sdk') {
			console.log('🔗 Creating ServiceBusClient...');
			try {
				serviceBusClient = createServiceBusClient(credentials);
				console.log('✅ ServiceBusClient created successfully');
			} catch (error) {
				throw new NodeOperationError(this.getNode(), (error as Error).message);
			}
		} else if (protocol === 'http') {
			if ((credentials.authentication as string) === 'managedIdentity') {
				throw new NodeOperationError(this.getNode(), 'HTTP protocol requires connection string authentication; use the SDK protocol with Managed Identity');
			}

			console.log('🔗 Parsing connection string for HTTP REST API...');
			const connectionString = credentials.connectionString as string;
			if (!connectionString) {
				throw new NodeOperationError(this.getNode(), 'Azure Service Bus connection string is required');
			}
			if (connectionString.includes('__n8n_BLANK_VALUE_')) {
				throw new NodeOperationError(this.getNode(), 'Connection string contains blank values. Please re-enter your credentials.');
			}
			httpConnectionDetails = parseConnectionString(connectionString);
		}

		try {
			if (resource === 'queue') {
				const queueName = this.getNodeParameter('queueName', 0) as string;
				console.log(`📫 Queue operation: ${operation} on queue: ${queueName}`);

				if (operation === 'sendMessage') {
					console.log('📤 Starting send message operation...');

					let sender = null;
					if (protocol === 'sdk' && serviceBusClient) {
						sender = serviceBusClient.createSender(queueName);
						console.log('📤 Azure SDK sender created successfully');
					}

					for (let i = 0; i < items.length; i++) {
						console.log(`📝 Processing message ${i + 1}/${items.length}`);

						const messageBody = this.getNodeParameter('messageBody', i);
						const messageProperties = this.getNodeParameter('messageProperties', i, {}) as { property?: Array<{ key: string; value: string }> };
						const contentType = this.getNodeParameter('contentType', i, 'application/json') as string;
						const messageId = this.getNodeParameter('messageId', i, '') as string;
						const sessionId = this.getNodeParameter('sessionId', i, '') as string;

						console.log(`📝 Message details:`, {
							bodyType: typeof messageBody,
							bodyLength: typeof messageBody === 'string' ? messageBody.length : 'N/A',
							contentType,
							hasMessageId: !!messageId,
							hasSessionId: !!sessionId,
							hasProperties: !!messageProperties?.property
						});

						if (isEmptyMessageBody(messageBody)) {
							console.error('❌ Message body is empty!');
							throw new NodeOperationError(this.getNode(), 'Message Body cannot be empty');
						}

						const message: MessageWithSession = {
							body: messageBody,
							contentType,
						};

						if (messageId && messageId.trim() !== '') {
							message.messageId = messageId;
						}

						if (sessionId && sessionId.trim() !== '') {
							message.sessionId = sessionId;
							console.log(`🔐 Topic: Added session ID: ${sessionId}`);
						}

						if (messageProperties?.property) {
							message.applicationProperties = {};
							for (const prop of messageProperties.property) {
								if (prop.key && prop.value) {
									message.applicationProperties[prop.key] = prop.value;
								}
							}
						}

						console.log('📤 Sending message to Service Bus...');

						if (protocol === 'sdk' && sender) {
							await sender.sendMessages(message);
							console.log('✅ Message sent via Azure SDK!');
						} else if (protocol === 'http' && httpConnectionDetails) {
							const sessionIdValue = this.getNodeParameter('sessionId', i, '') as string;
							const messageWithSession = { ...message };
							if (sessionIdValue && sessionIdValue.trim() !== '') {
								messageWithSession.sessionId = sessionIdValue;
							}
							await sendMessageViaHTTP(httpConnectionDetails, queueName, messageWithSession);
							console.log('✅ Message sent via HTTP!');
						} else {
							throw new NodeOperationError(this.getNode(), 'Invalid protocol configuration');
						}

						returnData.push({
							json: {
								success: true,
								messageId: message.messageId,
								queueName,
								sentAt: new Date().toISOString(),
							},
						});
					}

					if (protocol === 'sdk' && sender) {
						console.log('🔒 Closing Azure SDK sender...');
						await sender.close();
						console.log('✅ Azure SDK sender closed successfully');
					}
				} else if (operation === 'receiveMessages') {
					if (protocol !== 'sdk' || !serviceBusClient) {
						throw new NodeOperationError(this.getNode(), 'Receive messages is only supported with Azure SDK protocol');
					}

					const maxMessageCount = this.getNodeParameter('maxMessageCount', 0) as number;
					const maxWaitTimeInSeconds = this.getNodeParameter('maxWaitTimeInSeconds', 0) as number;
					const receiveMode = this.getNodeParameter('receiveMode', 0) as 'peekLock' | 'receiveAndDelete';
					const sessionMode = this.getNodeParameter('sessionMode', 0, 'none') as string;

					console.log(`📨 Receiving messages with session mode: ${sessionMode}`);

					let receiver;
					let isSessionReceiver = false;
					let currentSessionId: string | undefined;
					let currentSessionState: unknown = null;

					if (sessionMode === 'specific') {
						const receiveSessionId = this.getNodeParameter('receiveSessionId', 0) as string;
						const sessionTimeout = this.getNodeParameter('sessionTimeout', 0, 60) as number;

						console.log(`🔐 Accepting specific session: ${receiveSessionId}`);
						try {
							receiver = await serviceBusClient.acceptSession(queueName, receiveSessionId, {
								maxAutoLockRenewalDurationInMs: sessionTimeout * 1000,
							});
							isSessionReceiver = true;
							currentSessionId = receiveSessionId;
							console.log(`✅ Successfully accepted session: ${receiveSessionId}`);
						} catch (sessionError) {
							console.error(`❌ Failed to accept session ${receiveSessionId}:`, sessionError);
							throw new NodeOperationError(
								this.getNode(),
								`Failed to accept session '${receiveSessionId}': ${sessionError instanceof Error ? sessionError.message : String(sessionError)}`
							);
						}
					} else if (sessionMode === 'next') {
						const sessionTimeout = this.getNodeParameter('sessionTimeout', 0, 60) as number;

						console.log('🔐 Accepting next available session...');
						try {
							receiver = await serviceBusClient.acceptNextSession(queueName, {
								maxAutoLockRenewalDurationInMs: sessionTimeout * 1000,
							});
							isSessionReceiver = true;
							currentSessionId = receiver.sessionId;
							console.log(`✅ Successfully accepted next session: ${currentSessionId}`);
						} catch (sessionError) {
							console.error('❌ Failed to accept next session:', sessionError);
							throw new NodeOperationError(
								this.getNode(),
								`No available sessions or failed to accept session: ${sessionError instanceof Error ? sessionError.message : String(sessionError)}`
							);
						}
					} else {
						console.log('📨 Creating standard receiver (no sessions)');
						receiver = serviceBusClient.createReceiver(queueName, {
							receiveMode,
						});
					}

					if (isSessionReceiver && sessionMode !== 'none') {
						const manageSessionState = this.getNodeParameter('manageSessionState', 0, false) as boolean;
						if (manageSessionState) {
							try {
								currentSessionState = await (receiver as any).getSessionState();
								console.log(`🔐 Retrieved session state for ${currentSessionId}:`, currentSessionState);
							} catch (stateError) {
								console.log(`⚠️ No session state found for ${currentSessionId} (this is normal for new sessions)`);
								currentSessionState = null;
							}
						}
					}

					const messages = await receiver.receiveMessages(maxMessageCount, {
						maxWaitTimeInMs: maxWaitTimeInSeconds * 1000,
					});

					console.log(`📨 Received ${messages.length} messages from ${isSessionReceiver ? `session ${currentSessionId}` : 'queue'}`);

					for (const message of messages) {
						console.log(`📝 Processing message ID: ${message.messageId}`);
						console.log(`📝 Original body type: ${typeof message.body}, isBuffer: ${Buffer.isBuffer(message.body)}`);

						let messageBody = message.body;

						if (messageBody && typeof messageBody === 'object' && (messageBody as any).type === 'Buffer') {
							const buffer = Buffer.from((messageBody as any).data);
							messageBody = buffer.toString('utf8');
							console.log(`🔄 Converted Buffer to string: ${messageBody}`);
						} else if (Buffer.isBuffer(messageBody)) {
							messageBody = messageBody.toString('utf8');
							console.log(`🔄 Converted Buffer to string: ${messageBody}`);
						}

						if (typeof messageBody === 'string' && messageBody.trim().startsWith('{')) {
							try {
								messageBody = JSON.parse(messageBody);
								console.log('📦 Parsed JSON message body');
							} catch (parseError) {
								console.log('⚠️ Could not parse as JSON, keeping as string');
							}
						}

						const result: IDataObject = {
							messageId: message.messageId,
							body: messageBody,
							contentType: message.contentType,
							enqueuedTimeUtc: message.enqueuedTimeUtc,
							applicationProperties: message.applicationProperties,
							deliveryCount: message.deliveryCount,
							sequenceNumber: message.sequenceNumber?.toString(),
							sessionId: message.sessionId,
						};

						if (isSessionReceiver && currentSessionId) {
							result.sessionInfo = {
								sessionId: currentSessionId,
								sessionState: currentSessionState,
								isSessionMessage: true,
							};
						}

						returnData.push({ json: result });

						if (receiveMode === 'peekLock') {
							await receiver.completeMessage(message);
						}
					}

					if (isSessionReceiver && sessionMode !== 'none') {
						const manageSessionState = this.getNodeParameter('manageSessionState', 0, false) as boolean;
						const newSessionState = this.getNodeParameter('newSessionState', 0, '') as string;

						if (manageSessionState && newSessionState && newSessionState.trim() !== '') {
							try {
								const stateObject = JSON.parse(newSessionState);
								await (receiver as any).setSessionState(stateObject);
								console.log(`✅ Updated session state for ${currentSessionId}:`, stateObject);
							} catch (stateError) {
								console.error(`❌ Failed to update session state for ${currentSessionId}:`, stateError);
								throw new NodeOperationError(
									this.getNode(),
									`Failed to update session state: ${stateError instanceof Error ? stateError.message : String(stateError)}`
								);
							}
						}
					}

					await receiver.close();
					console.log(`✅ Receiver closed successfully`);
				}
			} else if (resource === 'topic') {
				const topicName = this.getNodeParameter('topicName', 0) as string;

				if (operation === 'sendMessage') {
					if (protocol !== 'sdk' || !serviceBusClient) {
						throw new NodeOperationError(this.getNode(), 'Topic operations are only supported with Azure SDK protocol');
					}

					const sender = serviceBusClient.createSender(topicName);

					for (let i = 0; i < items.length; i++) {
						const messageBody = this.getNodeParameter('messageBody', i);
						const messageProperties = this.getNodeParameter('messageProperties', i, {}) as { property?: Array<{ key: string; value: string }> };
						const contentType = this.getNodeParameter('contentType', i, 'application/json') as string;
						const messageId = this.getNodeParameter('messageId', i, '') as string;
						const sessionId = this.getNodeParameter('sessionId', i, '') as string;

						if (isEmptyMessageBody(messageBody)) {
							throw new NodeOperationError(this.getNode(), 'Message Body cannot be empty');
						}

						const message: MessageWithSession = {
							body: messageBody,
							contentType,
						};

						if (messageId && messageId.trim() !== '') {
							message.messageId = messageId;
						}

						if (sessionId && sessionId.trim() !== '') {
							message.sessionId = sessionId;
						}

						if (messageProperties?.property) {
							message.applicationProperties = {};
							for (const prop of messageProperties.property) {
								if (prop.key && prop.value) {
									message.applicationProperties[prop.key] = prop.value;
								}
							}
						}

						await sender.sendMessages(message);
						returnData.push({
							json: {
								success: true,
								messageId: message.messageId,
								topicName,
								sentAt: new Date().toISOString(),
							},
						});
					}

					await sender.close();
				}
			}
		} catch (error) {
			console.error('❌ Error in Azure Service Bus operation:', error);
			const errorMessage = error instanceof Error ? error.message : String(error);
			throw new NodeOperationError(this.getNode(), `Azure Service Bus operation failed: ${errorMessage}`);
		} finally {
			if (protocol === 'sdk' && serviceBusClient) {
				console.log('🔒 Closing ServiceBusClient...');
				await serviceBusClient.close();
				console.log('✅ ServiceBusClient closed successfully');
			}
		}

		console.log(`🎉 Operation completed successfully. Returned ${returnData.length} items`);
		return [returnData];
	}
}
